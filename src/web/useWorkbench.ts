import { useMemo, useRef, useState } from 'react';
import type { BatchDraft } from '../core/draft/batch-draft';
import type { AlignOverride } from '../core/pdf/alignment';
import type { ApprovalSealSettings } from '../core/pdf/approval-seal-settings';
import type { Imposition } from '../core/pdf/exports';
import type { FourUpOptions } from '../core/pdf/imposition-settings';
import type { FieldTypography, FieldTypographyMap } from '../core/pdf/field-typography';
import { DEFAULT_QR_STAMP, type CoverLanguage, type QrStampSettings } from '../core/pdf/qr-settings';
import { DEFAULT_WATERMARK, type WatermarkSettings } from '../core/pdf/watermark-settings';
import type { FilenamePlan, RosterRow } from '../core/roster';
import type { HygieneOperation, HygienePreview } from '../core/roster/hygiene';
import type { VirtualColumnMapping } from '../core/roster/virtual-columns';
import type { ConditionalFieldRule } from '../core/rules/conditional-fields';
import type { BatchRowResult } from '../core/worker/client';
import type { MergeCoverSheet } from '../core/worker/protocol';
import type { RowSelection } from '../core/worker/row-selection';
import type { BatchPublication } from './BatchSession';
import type { FillTemplate, FlatSource, MigratedTemplate } from './fill-template-source';
import type { FontMode, MappingPreset } from './presets';
import { errorCode, saveDownload } from './resources';
import type { RosterSource } from './roster-source';

type PdfEngine = typeof import('../core/pdf');
export type TemplateInfo = Awaited<ReturnType<PdfEngine['inspectTemplate']>>;
export type RowResult = BatchRowResult & FilenamePlan;
export type SourceRow = RosterRow;
export type RowFilter = 'all' | 'ready' | 'flagged' | 'warnings';

const emptyRows: SourceRow[] = [];
const emptyFields: TemplateInfo['fields'] = [];
const emptyRules: ConditionalFieldRule[] = [];
const noop = () => undefined;
const idleRenderRecord = async () => undefined;
const samplePatterns = {
  workshop: '{{ID}}-{{Name}}.pdf',
  clinic: '{{ID}}-{{Name}}.pdf',
  hr: '{{Employee}}.pdf',
  badge: '{{Badge ID}}-{{Name}}.pdf',
};
export type SampleWorkflow = keyof typeof samplePatterns;
export const sampleWorkflows = Object.keys(samplePatterns) as SampleWorkflow[];

type CustomFont = { status: 'loading' } | { status: 'invalid'; maxMiB?: number } | {
  status: 'ready'; family: string; bytes: Uint8Array;
};

type MappingSettings = {
  fromPreset: boolean;
  values: Record<string, string>;
  alignment?: Record<string, AlignOverride>;
  typography?: FieldTypographyMap;
  virtual?: Record<string, VirtualColumnMapping>;
};

type FieldSelection = { fieldName: string; widgetIndex?: number };

type Cells = Pick<BatchDraft, 'edits' | 'hygiene'>;
type CellState = Cells & { undo?: Cells; undoExpired?: boolean; revision: number };

export function useWorkbench(locale: MergeCoverSheet['locale']) {
  const [template, setTemplate] = useState<FillTemplate>();
  const [flatSource, setFlatSource] = useState<FlatSource>();
  const [roster, setRoster] = useState<RosterSource>();
  const [sample, setSample] = useState<{ workflow: SampleWorkflow | 'conditional'; notice: string }>();
  const [busy, setBusy] = useState({ pdf: false, roster: false });
  const [errors, setErrors] = useState<{ pdf?: string; roster?: string }>({});
  const request = useRef({ pdf: 0, roster: 0, preset: 0, customFont: 0, draft: 0 });
  const [mappingSettings, setMappingSettings] = useState<MappingSettings>({
    fromPreset: false, values: {},
  });
  const [conditionalRules, setConditionalRules] = useState(emptyRules);
  const [cellState, setCellState] = useState<CellState>({ edits: {}, hygiene: [], revision: 0 });
  const { edits, hygiene, undo, undoExpired, revision: cellRevision } = cellState;
  const [selected, setSelected] = useState(0);
  const [requestedPage, setRequestedPage] = useState<number>();
  const [fieldSelection, setFieldSelection] = useState<FieldSelection>();
  const [filter, setFilter] = useState<RowFilter>('all');
  const [rowSelection, setRowSelection] = useState<RowSelection>('all-ready');
  const [minFontSize, setMinFontSize] = useState(8);
  const [font, setFont] = useState<FontMode>('auto');
  const [customFont, setCustomFont] = useState<CustomFont>();
  const [pattern, setPattern] = useState('{{ID}}-{{Name}}.pdf');
  const [flattenZip, setFlattenZip] = useState(false);
  const [groupByColumn, setGroupByColumn] = useState<string | null>(null);
  const [includeCoverSheet, setIncludeCoverSheet] = useState(false);
  const [coverLanguage, setCoverLanguage] = useState<CoverLanguage>('auto');
  const [imposition, setImposition] = useState<Imposition>('1-up');
  const [fourUp, setFourUp] = useState<FourUpOptions>();
  const [includeCustody, setIncludeCustody] = useState(false);
  const [watermarkState, setWatermark] = useState({ value: DEFAULT_WATERMARK, valid: true });
  const [qrState, setQrStamp] = useState({ value: DEFAULT_QR_STAMP, valid: true });
  const [qrOpen, setQrOpen] = useState(false);
  const [sealState, setApprovalSeal] = useState<{ value: ApprovalSealSettings | null; valid: boolean }>({ value: null, valid: true });
  const [presetError, setPresetError] = useState(false);
  const [presetCodec, setPresetCodec] = useState<typeof import('./presets')>();
  const [publication, publishBatch] = useState<BatchPublication>();

  const sheet = roster?.sheet;
  const templateFields = template?.info.fields ?? emptyFields;
  const fields = useMemo(() => templateFields.filter((field) =>
    !field.readOnly && (field.kind === 'text' || field.kind === 'checkbox' || Boolean(field.choices?.length))),
  [templateFields]);
  const virtualMappings = useMemo(() => Object.fromEntries(fields.flatMap(({ kind, name }) => {
    const bindings = mappingSettings.virtual;
    return kind === 'text' && bindings && Object.hasOwn(bindings, name) ? [[name, bindings[name]!] as const] : [];
  })), [fields, mappingSettings.virtual]);
  const mapping = useMemo(() => roster?.views.fieldMapping(fields, sheet?.headers ?? [], mappingSettings.values, virtualMappings,
    mappingSettings.fromPreset, roster.remapMissing) ?? Object.fromEntries(fields.map(({ name }) => [name, ''])),
  [fields, sheet, roster, mappingSettings.values, mappingSettings.fromPreset, virtualMappings]);
  const alignOverrides = useMemo(() => Object.fromEntries(fields.flatMap(({ kind, name }) => {
    const alignment = mappingSettings.alignment;
    const value = alignment && Object.hasOwn(alignment, name) ? alignment[name] : undefined;
    return kind === 'text' && (mapping[name] || Object.hasOwn(virtualMappings, name)) && value && value !== 'auto' ? [[name, value]] : [];
  })), [fields, mapping, virtualMappings, mappingSettings.alignment]);
  const fieldTypography = useMemo(() => Object.fromEntries(fields.flatMap(({ kind, name }) => {
    const typography = mappingSettings.typography;
    return kind === 'text' && (mapping[name] || Object.hasOwn(virtualMappings, name)) && typography && Object.hasOwn(typography, name)
      ? [[name, typography[name]!]] : [];
  })), [fields, mapping, virtualMappings, mappingSettings.typography]);
  const rows = useMemo(() => sheet && roster ? roster.views.effectiveRows(sheet.rows, mapping, edits, conditionalRules) : emptyRows,
    [sheet, roster, mapping, edits, conditionalRules]);
  const presetWarnings = useMemo(() => mappingSettings.fromPreset
    ? presetCodec?.presetMismatches(mappingSettings.values, pattern, template ? fields.map(({ name }) => name) : undefined,
      sheet?.headers, mappingSettings.virtual, template ? fields.filter(({ kind }) => kind === 'text').map(({ name }) => name) : undefined,
      mappingSettings.typography, conditionalRules)
    : undefined, [fields, mappingSettings, pattern, presetCodec, sheet, template, conditionalRules]);
  const { value: watermark, valid: validWatermark } = watermarkState;
  const { value: qrStamp, valid: validQrStamp } = qrState;
  const { value: approvalSeal, valid: validApprovalSeal } = sealState;
  const watermarkBlocked = !validWatermark;
  const qrSettingsBlocked = !validQrStamp;
  const sealSettingsBlocked = !validApprovalSeal;
  const validSeal = validApprovalSeal ? approvalSeal : null;
  const settingsSaveBlocked = watermarkBlocked || qrSettingsBlocked || sealSettingsBlocked;

  const virtualTemplateBlocked = Boolean(roster && Object.values(virtualMappings).some(({ column, template }) =>
    template && !roster.virtual.validateVirtualTemplate(column, template)));
  const hasMapping = conditionalRules.length > 0 || Object.keys(virtualMappings).length > 0 || fields.some((field) => Boolean(mapping[field.name]));
  const fontBlocked = customFont?.status === 'loading' || customFont?.status === 'invalid';
  const batch = useMemo(() => template && roster && rows.length && hasMapping && !fontBlocked && !virtualTemplateBlocked
    ? { template: template.bytes, templateName: template.name, roster: roster.bytes, rosterName: roster.name,
      sheetName: roster.explicitSheet ? roster.sheetName : undefined,
      rows, mapping, virtualMappings, localDate: roster.localDate,
      resolveVirtualMapping: roster.virtual.resolveVirtualMapping, alignOverrides, fieldTypography, minFontSize, font,
      customFont: customFont?.status === 'ready' ? customFont.bytes : undefined,
      conditional: conditionalRules.length ? { rules: conditionalRules, columns: sheet!.headers } : undefined }
    : null, [template, roster, rows, mapping, virtualMappings, alignOverrides, fieldTypography, minFontSize, font, customFont, hasMapping, fontBlocked, virtualTemplateBlocked, conditionalRules, sheet]);
  const filenamePlans = useMemo(() => roster?.engine.planFilenames(rows, pattern, { localDate: roster.localDate }) ?? [], [roster, rows, pattern]);
  const grouping = useMemo(() => roster && groupByColumn !== null && sheet?.headers.includes(groupByColumn)
    ? roster.views.planGroupedOutput(rows, groupByColumn, pattern, { localDate: roster.localDate })
    : undefined, [roster, sheet, rows, pattern, groupByColumn]);
  const groupingBlocked = groupByColumn !== null && !grouping;
  const templateName = template?.name;
  const activeCoverLanguage = includeCoverSheet ? coverLanguage : 'auto';
  const compatibility = template?.impositionCompatibility;
  const printLayout = (imposition === '2-up' && compatibility?.twoUpUnavailableReason)
    || (imposition === '4-up' && compatibility?.fourUpUnavailableReason) ? '1-up' : imposition;
  const output = useMemo(() => ({
    filenamePlans, flattenZip, rowSelection, grouping, groupingBlocked,
    cover: includeCoverSheet && templateName ? { locale, templateName, includeCustody, coverLanguage: activeCoverLanguage } : undefined,
    watermark: watermark.kind !== 'none' ? watermark : undefined,
    qrStamp: qrStamp.placement !== 'none' ? qrStamp : undefined,
    approvalSeal: validSeal ?? undefined,
    imposition: printLayout,
    fourUp: printLayout === '4-up' ? fourUp : undefined,
  }), [filenamePlans, flattenZip, rowSelection, grouping, groupingBlocked, includeCoverSheet, templateName, locale, includeCustody, watermark, qrStamp, validSeal, activeCoverLanguage, printLayout, fourUp]);
  const sealPreviewBlocked = sealSettingsBlocked || Boolean(approvalSeal && qrSettingsBlocked);
  const batchSession = batch || publication ? { batch, selected, output, sealPreviewBlocked, publish: publishBatch } : undefined;
  const { invalidate = noop, clearExportError = noop, download, cancel = noop, exportLocked = noop } = publication?.job ?? {};
  const job = publication?.batch === batch ? publication?.job : undefined;
  const conditionalSaveBlocked = Boolean(conditionalRules.length && (!job?.results || job.results.some(({ diagnostics }) =>
    diagnostics.some(({ ruleIndex }) => ruleIndex !== undefined))));
  const printSettingsBlocked = settingsSaveBlocked || Boolean(job?.sealPrintBlocked);
  const results = useMemo(() => job?.results?.map((result, index): RowResult => ({
    ...result, ...(grouping?.rows[index] ?? filenamePlans[index]!),
  })), [job?.results, grouping, filenamePlans]);
  const ready = useMemo(() => job?.results?.filter(({ status }) => status === 'pass').length ?? 0, [job?.results]);
  const warningRows = useMemo(() => rows.filter((row) => row.warnings.length > 0).length, [rows]);
  const firstFlaggedPage = job?.results?.[selected]?.pageNumbers[0];
  const previewPage = requestedPage ?? firstFlaggedPage ?? 1;

  function focusMappingField(fieldName: string, page?: number) {
    setFieldSelection((current) => current?.fieldName === fieldName && current.widgetIndex === undefined ? current : { fieldName });
    if (page !== undefined) setRequestedPage(page);
  }

  function selectWidget(fieldName: string, widgetIndex: number) {
    setFieldSelection({ fieldName, widgetIndex });
  }

  function selectRow(index: number) {
    setSelected(index);
    setRequestedPage(results ? results[index]?.pageNumbers[0] ?? previewPage : undefined);
  }

  function retainPreviewPage() {
    if (requestedPage === undefined && firstFlaggedPage !== undefined) setRequestedPage(firstFlaggedPage);
  }

  function recheck() {
    request.current.draft++;
    retainPreviewPage();
    invalidate();
  }

  function resetRows(keepTemplateMapping = false) {
    request.current.draft++;
    setSelected(0);
    setRequestedPage(undefined);
    setFilter('all');
    setRowSelection('all-ready');
    if (!keepTemplateMapping) setMappingSettings((current) => current.fromPreset ? current : { fromPreset: false, values: {} });
    setCellState((current) => ({ edits: {}, hygiene: [], revision: current.revision + 1 }));
  }

  async function loadPdf(file: File, migration?: MigratedTemplate) {
    const id = ++request.current.pdf;
    const preset = migration?.preset;
    const presetId = preset ? ++request.current.preset : undefined;
    const customFontId = request.current.customFont;
    request.current.draft++;
    invalidate(true);
    setRowSelection('all-ready');
    setTemplate(undefined);
    setFlatSource(undefined);
    setRequestedPage(undefined);
    setFieldSelection(undefined);
    setSample(undefined);
    if (preset) setPresetError(false);
    setMappingSettings((current) => current.fromPreset ? current : { fromPreset: false, values: {} });
    setErrors((current) => ({ ...current, pdf: undefined }));
    setBusy((current) => ({ ...current, pdf: true }));
    try {
      const [result, codec] = await Promise.all([
        import('./fill-template-source').then(({ inspectFillSource }) => inspectFillSource(file)),
        preset && import('./presets'),
      ]);
      if (request.current.pdf !== id) return;
      if (result.template) {
        if (preset && codec && presetId === request.current.preset) {
          setPresetCodec(codec);
          if (customFontId === request.current.customFont) {
            request.current.customFont++;
            setCustomFont(undefined);
          }
          restoreSettings(preset);
        }
        setTemplate(migration?.synthetic ? { ...result.template, synthetic: true } : result.template);
      }
      else {
        setErrors((current) => ({ ...current, pdf: result.code }));
        setFlatSource(result.flatSource);
      }
    } catch (error) {
      if (request.current.pdf === id) setErrors((current) => ({ ...current, pdf: errorCode(error, 'loadError') }));
    } finally {
      if (request.current.pdf === id) setBusy((current) => ({ ...current, pdf: false }));
    }
  }

  async function loadRoster(file: File) {
    const id = ++request.current.roster;
    const openedAt = new Date();
    invalidate(true);
    setRoster(undefined);
    setSample(undefined);
    resetRows(!roster);
    setErrors((current) => ({ ...current, roster: undefined }));
    setBusy((current) => ({ ...current, roster: true }));
    try {
      const { loadRosterSource } = await import('./roster-source');
      const source = await loadRosterSource(file, openedAt);
      if (request.current.roster === id) setRoster(source);
    } catch (error) {
      if (request.current.roster === id) setErrors((current) => ({ ...current, roster: errorCode(error, 'loadError') }));
    } finally {
      if (request.current.roster === id) setBusy((current) => ({ ...current, roster: false }));
    }
  }

  async function loadSample(workflow?: SampleWorkflow | 'conditional') {
    const selectedSample = workflow ?? 'workshop';
    const pdfId = ++request.current.pdf;
    const rosterId = ++request.current.roster;
    const openedAt = new Date();
    const presetId = ++request.current.preset;
    invalidate(true);
    resetRows();
    setConditionalRules(emptyRules);
    setMappingSettings({ fromPreset: false, values: selectedSample === 'hr' ? { Clinic: 'Clinic', Contact: 'Contact' } : {} });
    if (workflow !== undefined) {
      request.current.customFont++;
      setCustomFont(undefined);
      setMinFontSize(8);
      setFont('auto');
      setPattern(samplePatterns[workflow === 'conditional' ? 'clinic' : workflow]);
      setFlattenZip(false);
      setGroupByColumn(null);
      setIncludeCoverSheet(false);
      setCoverLanguage('auto');
      setImposition('1-up');
      setFourUp(undefined);
      setIncludeCustody(false);
      setWatermark({ value: DEFAULT_WATERMARK, valid: true });
      setQrStamp({ value: DEFAULT_QR_STAMP, valid: true });
      setQrOpen(false);
      setApprovalSeal({ value: null, valid: true });
    }
    setPresetError(false);
    setTemplate(undefined);
    setFlatSource(undefined);
    setFieldSelection(undefined);
    setRoster(undefined);
    setSample(undefined);
    setErrors({});
    setBusy({ pdf: true, roster: true });
    try {
      const { loadSampleWorkflow } = await import('./workflow-loader');
      const { template, roster, notice, rules } = await loadSampleWorkflow(selectedSample, openedAt, locale);
      if (request.current.pdf === pdfId) setTemplate(template);
      if (request.current.roster === rosterId) setRoster(roster);
      if (request.current.pdf === pdfId && request.current.roster === rosterId) {
        setSample({ workflow: selectedSample, notice });
        if (rules && request.current.preset === presetId) setConditionalRules(rules);
      }
    } catch (error) {
      if (request.current.pdf === pdfId) setErrors((current) => ({ ...current, pdf: errorCode(error, 'loadError') }));
    } finally {
      setBusy((current) => ({
        pdf: request.current.pdf === pdfId ? false : current.pdf,
        roster: request.current.roster === rosterId ? false : current.roster,
      }));
    }
  }

  function changeSheet(name: string) {
    if (!roster?.workbook || name === roster.sheetName || !roster.workbook.sheetNames.includes(name)) return;
    invalidate(true);
    request.current.preset++;
    resetRows(true);
    setFieldSelection(undefined);
    setRoster({ ...roster, ...roster.workbook.select(name), explicitSheet: true, remapMissing: true });
  }

  function changeMapping(field: string, column: string) {
    recheck();
    setMappingSettings((current) => {
      const virtual = { ...current.virtual };
      delete virtual[field];
      return { ...current, virtual, values: { ...current.values, [field]: column } };
    });
  }

  function changeConditionalRules(rules: ConditionalFieldRule[]) {
    if (exportLocked()) return;
    recheck();
    setConditionalRules(rules);
  }

  function changeVirtualMapping(field: string, binding: VirtualColumnMapping) {
    recheck();
    setMappingSettings((current) => ({
      ...current, values: { ...current.values, [field]: '' }, virtual: { ...current.virtual, [field]: binding },
    }));
  }

  function resetMapping() {
    recheck();
    setMappingSettings({ fromPreset: false, values: {} });
  }

  function changeAlignment(field: string, value: AlignOverride) {
    recheck();
    setMappingSettings((current) => ({ ...current, alignment: { ...current.alignment, [field]: value } }));
  }

  function changeFieldTypography(field: string, { numeralPolicy, lineHeightScale, paddingPt }: FieldTypography) {
    if (exportLocked()) return;
    recheck();
    setMappingSettings((current) => {
      if (numeralPolicy || lineHeightScale || paddingPt) return { ...current, typography: { ...current.typography, [field]: {
        ...(numeralPolicy && { numeralPolicy }), ...(lineHeightScale && { lineHeightScale }), ...(paddingPt && { paddingPt }),
      } } };
      const typography = { ...current.typography };
      delete typography[field];
      return { ...current, typography };
    });
  }

  function editCell(row: number, column: string, value: string) {
    recheck();
    setCellState((current) => ({
      ...current, undo: undefined, undoExpired: current.undoExpired || Boolean(current.undo),
      edits: { ...current.edits, [row]: { ...current.edits[row], [column]: value } },
    }));
  }

  function restoreRowEdit(row: number, original: Record<string, string> | undefined) {
    if (edits[row] === original) return;
    recheck();
    setCellState((current) => {
      const restored = { ...current.edits };
      if (original) restored[row] = original;
      else delete restored[row];
      return { ...current, edits: restored, undo: undefined, undoExpired: current.undoExpired || Boolean(current.undo) };
    });
  }

  function applyHygiene(operation: HygieneOperation, preview: HygienePreview) {
    if (!preview.affectedCells || exportLocked()) return;
    recheck();
    setCellState((current) => {
      const edits = { ...current.edits };
      for (const { rowIndex, column, after } of preview.changes) {
        if (edits[rowIndex] === current.edits[rowIndex]) edits[rowIndex] = { ...current.edits[rowIndex] };
        Object.defineProperty(edits[rowIndex], column, { value: after, enumerable: true, writable: true, configurable: true });
      }
      const { affectedRows, affectedCells } = preview;
      return {
        edits, hygiene: [...current.hygiene, { operation, affectedRows, affectedCells }],
        undo: { edits: current.edits, hygiene: current.hygiene }, revision: current.revision + 1,
      };
    });
  }

  function undoHygiene() {
    if (!undo || exportLocked()) return;
    recheck();
    setCellState({ ...undo, revision: cellRevision + 1 });
  }

  function changeSize(size: number) {
    recheck();
    setMinFontSize(size);
  }

  function changeFont(value: FontMode) {
    recheck();
    setFont(value);
  }

  async function loadCustomFont(file: File) {
    const id = ++request.current.customFont;
    recheck();
    setCustomFont({ status: 'loading' });
    try {
      if (!/\.(?:ttf|otf)$/i.test(file.name)) throw new Error('invalid-custom-font');
      const { inspectCustomFont, MAX_CUSTOM_FONT_BYTES } = await import('../core/pdf');
      if (id !== request.current.customFont) return;
      if (file.size > MAX_CUSTOM_FONT_BYTES) {
        setCustomFont({ status: 'invalid', maxMiB: MAX_CUSTOM_FONT_BYTES / 1024 ** 2 });
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (id !== request.current.customFont) return;
      const { family } = inspectCustomFont(bytes);
      setCustomFont({ status: 'ready', family, bytes });
    } catch {
      if (id === request.current.customFont) setCustomFont({ status: 'invalid' });
    }
  }

  function clearCustomFont() {
    request.current.customFont++;
    recheck();
    setCustomFont(undefined);
  }

  function changePattern(value: string) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setPattern(value);
  }

  function changeRowSelection(selection: RowSelection) {
    if (exportLocked()) return;
    clearExportError();
    setRowSelection(selection);
  }

  function changeFlattenZip(value: boolean) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setFlattenZip(value);
  }

  function changeGrouping(column: string | null) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setGroupByColumn(column);
  }

  function changeIncludeCoverSheet(value: boolean) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setIncludeCoverSheet(value);
    if (!value) setIncludeCustody(false);
  }

  function changeIncludeCustody(value: boolean) {
    if (exportLocked()) return;
    clearExportError();
    setIncludeCustody(value);
  }

  function changeWatermark(value: WatermarkSettings, valid: boolean) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setWatermark({ value, valid });
  }

  function changeQrStamp(value: QrStampSettings, valid: boolean) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setQrStamp({ value, valid });
  }

  function changeApprovalSeal(value: ApprovalSealSettings | null, valid: boolean) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setApprovalSeal({ value, valid });
  }

  function changeCoverLanguage(value: CoverLanguage) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setCoverLanguage(value);
  }

  function changeImposition(value: Imposition) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setImposition(value);
  }

  function changeFourUp(value: FourUpOptions) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setFourUp(value);
  }

  async function importPreset(file: File) {
    if (exportLocked()) return;
    request.current.draft++;
    const id = ++request.current.preset;
    const customFontId = request.current.customFont;
    setPresetError(false);
    try {
      const [codec, text] = await Promise.all([import('./presets'), file.text()]);
      if (id !== request.current.preset || exportLocked()) return;
      const preset = codec.parseMappingPreset(text);
      setPresetCodec(codec);
      if (customFontId === request.current.customFont) clearCustomFont();
      else recheck();
      restoreSettings(preset);
    } catch {
      if (id === request.current.preset) setPresetError(true);
    }
  }

  function restoreSettings(preset: MappingPreset) {
    setRoster((current) => current?.remapMissing ? { ...current, remapMissing: false } : current);
    setMappingSettings({ fromPreset: true, values: preset.mapping, alignment: 'alignOverrides' in preset ? preset.alignOverrides : undefined,
      virtual: 'virtualMappings' in preset ? preset.virtualMappings : undefined,
      typography: 'fieldTypography' in preset ? preset.fieldTypography : undefined });
    setConditionalRules('conditionalRules' in preset ? preset.conditionalRules : emptyRules);
    setPattern(preset.filenamePattern);
    setMinFontSize(preset.minFontSize);
    setFont(preset.font);
    setFlattenZip(preset.version !== 1 && preset.flattenZip);
    setGroupByColumn('groupByColumn' in preset ? preset.groupByColumn : null);
    setIncludeCoverSheet('includeCoverSheet' in preset && preset.includeCoverSheet);
    setIncludeCustody(false);
    setWatermark({ value: 'watermark' in preset ? preset.watermark : DEFAULT_WATERMARK, valid: true });
    const stamp = 'qrStamp' in preset ? preset.qrStamp : DEFAULT_QR_STAMP;
    setQrStamp({ value: stamp, valid: true });
    setQrOpen(stamp.placement !== 'none');
    setApprovalSeal({ value: 'approvalSeal' in preset ? preset.approvalSeal : null, valid: true });
    setCoverLanguage('coverLanguage' in preset ? preset.coverLanguage : 'auto');
    setImposition('imposition' in preset ? preset.imposition : '1-up');
    setFourUp(preset.version === 12 ? { fourUpOrder: preset.fourUpOrder, centerCutGuides: preset.centerCutGuides } : undefined);
  }

  function presetInputs() {
    const included = Object.fromEntries(fields.flatMap(({ name, kind }) =>
      !Object.hasOwn(virtualMappings, name) && (kind === 'text' || kind === 'checkbox' || mapping[name]) ? [[name, mapping[name]!]] : []));
    return [included, pattern, minFontSize, font, flattenZip, includeCoverSheet, alignOverrides, watermark, virtualMappings, qrStamp, coverLanguage, imposition, groupByColumn, fieldTypography, validSeal ?? null, conditionalRules, fourUp] as const;
  }

  async function exportPreset() {
    if (settingsSaveBlocked || virtualTemplateBlocked || conditionalSaveBlocked) return;
    const id = request.current.draft;
    const inputs = presetInputs();
    const { makeMappingPreset } = await import('./presets');
    if (id !== request.current.draft) return;
    const preset = makeMappingPreset(...inputs);
    saveDownload(JSON.stringify(preset, null, 2), 'arabiform-mapping-preset.json', 'application/json');
  }

  function beginDraft(loading: boolean) {
    if (loading) request.current.preset++;
    const id = ++request.current.draft;
    return () => id === request.current.draft && !exportLocked();
  }

  function restoreDraft(draft: BatchDraft, codec: typeof import('./presets')) {
    if (draft.customFontSha256 === null) clearCustomFont();
    else recheck();
    setPresetError(false);
    setPresetCodec(codec);
    restoreSettings(draft.settings);
    setCellState((current) => ({ edits: draft.edits, hygiene: draft.hygiene, revision: current.revision + 1 }));
  }

  return {
    template, flatSource, roster, sample, busy, errors, sheet, rows, templateFields, fields, mapping, alignOverrides, changeAlignment,
    fieldTypography, changeFieldTypography, approvalSeal, changeApprovalSeal, sealSettingsBlocked, settingsSaveBlocked,
    conditionalRules, changeConditionalRules, conditionalSaveBlocked,
    virtualMappings, virtualTemplateBlocked, changeVirtualMapping, fieldSelection, focusMappingField, selectWidget,
    sourceRevision: `${request.current.roster}:${roster?.sheetName ?? ''}`,
    cellRevision, edits, hygiene, canUndoHygiene: Boolean(undo), undoExpired, applyHygiene, undoHygiene,
    presetInputs, beginDraft, restoreDraft,
    hasMapping, selected, selectRow, previewPage, setPreviewPage: setRequestedPage, filter, setFilter,
    rowSelection, changeRowSelection,
    minFontSize, font, customFont, fontBlocked, pattern, filenamePlans: grouping?.rows ?? filenamePlans,
    flattenZip, changeFlattenZip, includeCoverSheet, changeIncludeCoverSheet,
    groupByColumn, grouping, groupingBlocked, changeGrouping,
    output,
    includeCustody, changeIncludeCustody, coverLanguage, changeCoverLanguage, printLayout, changeImposition,
    fourUp, changeFourUp,
    watermark, watermarkBlocked, changeWatermark,
    qrStamp, qrOpen, setQrOpen, qrSettingsBlocked, printSettingsBlocked, changeQrStamp,
    ...job, batchSession, results, ready, flagged: results ? results.length - ready : 0, warningRows,
    exportScope: job?.exportScope ?? { exportScope: rowSelection === 'all-ready' ? 'all-ready' as const : 'selected-subset' as const, selectedRowNumbers: [] },
    exportCount: job?.exportCount ?? 0,
    exporting: job?.exporting ?? false,
    previewError: job?.previewError ?? sealPreviewBlocked,
    sealPreviewBlocked,
    renderRecord: job?.renderRecord ?? idleRenderRecord,
    loadPdf, loadRoster, loadSample, changeSheet, changeMapping, resetMapping, editCell,
    rowEdit: edits[selected], restoreRowEdit,
    changeSize, changeFont, loadCustomFont, clearCustomFont, changePattern, presetError, presetWarnings, exportPreset, importPreset,
    cancel: () => { retainPreviewPage(); cancel(); },
    download: (kind: Parameters<NonNullable<typeof download>>[0]) => {
      const print = kind === 'merged' || kind === 'split' || kind === 'certificate' || (kind === 'zip' && flattenZip);
      if (print && printSettingsBlocked) return;
      return download?.(kind);
    },
  };
}
