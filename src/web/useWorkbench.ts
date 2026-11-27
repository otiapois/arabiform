import { useMemo, useRef, useState } from 'react';
import type { BatchDraft } from '../core/draft/batch-draft';
import type { AlignOverride } from '../core/pdf/alignment';
import type { Imposition } from '../core/pdf/exports';
import { DEFAULT_QR_STAMP, validateQrStampSettings, type CoverLanguage, type QrStampSettings } from '../core/pdf/qr-settings';
import { DEFAULT_WATERMARK, validateWatermarkSettings, type WatermarkSettings } from '../core/pdf/watermark-settings';
import type { FilenamePlan, RosterRow } from '../core/roster';
import type { HygieneOperation, HygienePreview } from '../core/roster/hygiene';
import type { VirtualColumnMapping } from '../core/roster/virtual-columns';
import type { BatchRowResult } from '../core/worker/client';
import type { MergeCoverSheet } from '../core/worker/protocol';
import type { RowSelection } from '../core/worker/row-selection';
import type { FillTemplate, FlatSource } from './fill-template-source';
import type { FontMode, MappingPreset } from './presets';
import { errorCode, saveDownload } from './resources';
import type { RosterSource } from './roster-source';
import { useBatch } from './useBatch';

type PdfEngine = typeof import('../core/pdf');
export type TemplateInfo = Awaited<ReturnType<PdfEngine['inspectTemplate']>>;
export type RowResult = BatchRowResult & FilenamePlan;
export type SourceRow = RosterRow;
export type RowFilter = 'all' | 'ready' | 'flagged' | 'warnings';

const emptyRows: SourceRow[] = [];
const emptyFields: TemplateInfo['fields'] = [];
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
  virtual?: Record<string, VirtualColumnMapping>;
};

type FieldSelection = { fieldName: string; widgetIndex?: number };

type Cells = Pick<BatchDraft, 'edits' | 'hygiene'>;
type CellState = Cells & { undo?: Cells; undoExpired?: boolean; revision: number };

export function useWorkbench(locale: MergeCoverSheet['locale']) {
  const [template, setTemplate] = useState<FillTemplate>();
  const [flatSource, setFlatSource] = useState<FlatSource>();
  const [roster, setRoster] = useState<RosterSource>();
  const [sample, setSample] = useState<{ workflow: SampleWorkflow; notice: string }>();
  const [busy, setBusy] = useState({ pdf: false, roster: false });
  const [errors, setErrors] = useState<{ pdf?: string; roster?: string }>({});
  const request = useRef({ pdf: 0, roster: 0, preset: 0, customFont: 0, draft: 0 });
  const [mappingSettings, setMappingSettings] = useState<MappingSettings>({
    fromPreset: false, values: {},
  });
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
  const [includeCustody, setIncludeCustody] = useState(false);
  const [watermark, setWatermark] = useState<WatermarkSettings>(DEFAULT_WATERMARK);
  const [qrStamp, setQrStamp] = useState<QrStampSettings>(DEFAULT_QR_STAMP);
  const [qrOpen, setQrOpen] = useState(false);
  const [presetError, setPresetError] = useState(false);
  const [presetCodec, setPresetCodec] = useState<typeof import('./presets')>();

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
  const rows = useMemo(() => sheet && roster ? roster.views.effectiveRows(sheet.rows, mapping, edits) : emptyRows, [sheet, roster, mapping, edits]);
  const presetWarnings = useMemo(() => mappingSettings.fromPreset
    ? presetCodec?.presetMismatches(mappingSettings.values, pattern, template ? fields.map(({ name }) => name) : undefined,
      sheet?.headers, mappingSettings.virtual, template ? fields.filter(({ kind }) => kind === 'text').map(({ name }) => name) : undefined)
    : undefined, [fields, mappingSettings, pattern, presetCodec, sheet, template]);
  const watermarkBlocked = useMemo(() => !validateWatermarkSettings(watermark), [watermark]);
  const qrSettingsBlocked = useMemo(() => !validateQrStampSettings(qrStamp), [qrStamp]);
  const printSettingsBlocked = watermarkBlocked || qrSettingsBlocked;

  const virtualTemplateBlocked = Boolean(roster && Object.values(virtualMappings).some(({ column, template }) =>
    template && !roster.virtual.validateVirtualTemplate(column, template)));
  const hasMapping = Object.keys(virtualMappings).length > 0 || fields.some((field) => Boolean(mapping[field.name]));
  const fontBlocked = customFont?.status === 'loading' || customFont?.status === 'invalid';
  const batch = useMemo(() => template && roster && rows.length && hasMapping && !fontBlocked && !virtualTemplateBlocked
    ? { template: template.bytes, roster: roster.bytes, sheetName: roster.explicitSheet ? roster.sheetName : undefined,
      rows, mapping, virtualMappings, localDate: roster.localDate,
      resolveVirtualMapping: roster.virtual.resolveVirtualMapping, alignOverrides, minFontSize, font,
      customFont: customFont?.status === 'ready' ? customFont.bytes : undefined }
    : null, [template, roster, rows, mapping, virtualMappings, alignOverrides, minFontSize, font, customFont, hasMapping, fontBlocked, virtualTemplateBlocked]);
  const filenamePlans = useMemo(() => roster?.engine.planFilenames(rows, pattern, { localDate: roster.localDate }) ?? [], [roster, rows, pattern]);
  const grouping = useMemo(() => roster && groupByColumn !== null && sheet?.headers.includes(groupByColumn)
    ? roster.views.planGroupedOutput(rows, groupByColumn, pattern, { localDate: roster.localDate })
    : undefined, [roster, sheet, rows, pattern, groupByColumn]);
  const groupingBlocked = groupByColumn !== null && !grouping;
  const templateName = template?.name;
  const activeCoverLanguage = includeCoverSheet ? coverLanguage : 'auto';
  const impositionUnavailable = Boolean(template && template.info.pages.length > 1);
  const printLayout = impositionUnavailable ? '1-up' : imposition;
  const output = useMemo(() => ({
    filenamePlans, flattenZip, rowSelection, grouping, groupingBlocked,
    cover: includeCoverSheet && templateName ? { locale, templateName, includeCustody, coverLanguage: activeCoverLanguage } : undefined,
    watermark: watermark.kind !== 'none' ? watermark : undefined,
    qrStamp: qrStamp.placement !== 'none' ? qrStamp : undefined,
    imposition: printLayout,
  }), [filenamePlans, flattenZip, rowSelection, grouping, groupingBlocked, includeCoverSheet, templateName, locale, includeCustody, watermark, qrStamp, activeCoverLanguage, printLayout]);
  const { invalidate, clearExportError, download, cancel, exportLocked, ...job } = useBatch(batch, selected, output);
  const results = useMemo(() => job.results?.map((result, index): RowResult => ({
    ...result, ...(grouping?.rows[index] ?? filenamePlans[index]!),
  })), [job.results, grouping, filenamePlans]);
  const ready = useMemo(() => job.results?.filter(({ status }) => status === 'pass').length ?? 0, [job.results]);
  const warningRows = useMemo(() => rows.filter((row) => row.warnings.length > 0).length, [rows]);
  const firstFlaggedPage = job.results?.[selected]?.pageNumbers[0];
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
    setRequestedPage(job.results ? job.results[index]?.pageNumbers[0] ?? previewPage : undefined);
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

  async function loadPdf(file: File) {
    const id = ++request.current.pdf;
    request.current.draft++;
    invalidate(true);
    setRowSelection('all-ready');
    setTemplate(undefined);
    setFlatSource(undefined);
    setRequestedPage(undefined);
    setFieldSelection(undefined);
    setSample(undefined);
    setMappingSettings((current) => current.fromPreset ? current : { fromPreset: false, values: {} });
    setErrors((current) => ({ ...current, pdf: undefined }));
    setBusy((current) => ({ ...current, pdf: true }));
    try {
      const { inspectFillSource } = await import('./fill-template-source');
      const result = await inspectFillSource(file);
      if (request.current.pdf !== id) return;
      if (result.template) setTemplate(result.template);
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

  async function loadSample(workflow?: SampleWorkflow) {
    const selectedSample = workflow ?? 'workshop';
    const pdfId = ++request.current.pdf;
    const rosterId = ++request.current.roster;
    const openedAt = new Date();
    request.current.preset++;
    invalidate(true);
    resetRows();
    setMappingSettings({ fromPreset: false, values: selectedSample === 'hr' ? { Clinic: 'Clinic', Contact: 'Contact' } : {} });
    if (workflow !== undefined) {
      request.current.customFont++;
      setCustomFont(undefined);
      setMinFontSize(8);
      setFont('auto');
      setPattern(samplePatterns[selectedSample]);
      setFlattenZip(false);
      setGroupByColumn(null);
      setIncludeCoverSheet(false);
      setCoverLanguage('auto');
      setImposition('1-up');
      setIncludeCustody(false);
      setWatermark(DEFAULT_WATERMARK);
      setQrStamp(DEFAULT_QR_STAMP);
      setQrOpen(false);
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
      const { template, roster, notice } = await loadSampleWorkflow(selectedSample, openedAt, locale);
      if (request.current.pdf === pdfId) setTemplate(template);
      if (request.current.roster === rosterId) setRoster(roster);
      if (request.current.pdf === pdfId && request.current.roster === rosterId) setSample({ workflow: selectedSample, notice });
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

  function changeWatermark(value: WatermarkSettings) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setWatermark(value);
  }

  function changeQrStamp(value: QrStampSettings) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setQrStamp(value);
  }

  function changeCoverLanguage(value: CoverLanguage) {
    if (exportLocked()) return;
    clearExportError();
    request.current.draft++;
    setCoverLanguage(value);
  }

  function changeImposition(value: Imposition) {
    if (exportLocked() || impositionUnavailable) return;
    clearExportError();
    request.current.draft++;
    setImposition(value);
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
      virtual: 'virtualMappings' in preset ? preset.virtualMappings : undefined });
    setPattern(preset.filenamePattern);
    setMinFontSize(preset.minFontSize);
    setFont(preset.font);
    setFlattenZip(preset.version !== 1 && preset.flattenZip);
    setGroupByColumn('groupByColumn' in preset ? preset.groupByColumn : null);
    setIncludeCoverSheet('includeCoverSheet' in preset && preset.includeCoverSheet);
    setIncludeCustody(false);
    setWatermark('watermark' in preset ? preset.watermark : DEFAULT_WATERMARK);
    const stamp = 'qrStamp' in preset ? preset.qrStamp : DEFAULT_QR_STAMP;
    setQrStamp(stamp);
    setQrOpen(stamp.placement !== 'none');
    setCoverLanguage('coverLanguage' in preset ? preset.coverLanguage : 'auto');
    setImposition('imposition' in preset ? preset.imposition : '1-up');
  }

  function presetInputs() {
    const included = Object.fromEntries(fields.flatMap(({ name, kind }) =>
      !Object.hasOwn(virtualMappings, name) && (kind === 'text' || kind === 'checkbox' || mapping[name]) ? [[name, mapping[name]!]] : []));
    return [included, pattern, minFontSize, font, flattenZip, includeCoverSheet, alignOverrides, watermark, virtualMappings, qrStamp, coverLanguage, imposition, groupByColumn] as const;
  }

  async function exportPreset() {
    if (printSettingsBlocked || virtualTemplateBlocked) return;
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
    virtualMappings, virtualTemplateBlocked, changeVirtualMapping, fieldSelection, focusMappingField, selectWidget,
    sourceRevision: `${request.current.roster}:${roster?.sheetName ?? ''}`,
    cellRevision, edits, hygiene, canUndoHygiene: Boolean(undo), undoExpired, applyHygiene, undoHygiene,
    presetInputs, beginDraft, restoreDraft,
    hasMapping, selected, selectRow, previewPage, setPreviewPage: setRequestedPage, filter, setFilter,
    rowSelection, changeRowSelection,
    minFontSize, font, customFont, fontBlocked, pattern, filenamePlans, flattenZip, changeFlattenZip, includeCoverSheet, changeIncludeCoverSheet,
    groupByColumn, grouping, groupingBlocked, changeGrouping,
    includeCustody, changeIncludeCustody, coverLanguage, changeCoverLanguage, printLayout, impositionUnavailable, changeImposition,
    watermark, watermarkBlocked, changeWatermark,
    qrStamp, qrOpen, setQrOpen, qrSettingsBlocked, printSettingsBlocked, changeQrStamp,
    ...job, results, ready, flagged: results ? results.length - ready : 0, warningRows,
    loadPdf, loadRoster, loadSample, changeSheet, changeMapping, resetMapping, editCell,
    rowEdit: edits[selected], restoreRowEdit,
    changeSize, changeFont, loadCustomFont, clearCustomFont, changePattern, presetError, presetWarnings, exportPreset, importPreset,
    cancel: () => { retainPreviewPage(); cancel(); },
    download: (kind: Parameters<typeof download>[0]) => {
      const print = kind === 'merged' || kind === 'split' || (kind === 'zip' && flattenZip);
      if (print && printSettingsBlocked) return;
      return download(kind);
    },
  };
}
