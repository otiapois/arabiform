import { useMemo, useRef, useState } from 'react';
import type { BatchDraft } from '../core/draft/batch-draft';
import type { AlignOverride } from '../core/pdf/alignment';
import { DEFAULT_WATERMARK, validateWatermarkSettings, type WatermarkSettings } from '../core/pdf/watermark-settings';
import type { FilenamePlan } from '../core/roster';
import type { HygieneOperation, HygienePreview } from '../core/roster/hygiene';
import type { BatchRowResult } from '../core/worker/client';
import type { MergeCoverSheet } from '../core/worker/protocol';
import type { RowSelection } from '../core/worker/row-selection';
import type { FontMode, MappingPreset } from './presets';
import { decodeBase64, errorCode, saveDownload } from './resources';
import { useBatch } from './useBatch';

type PdfEngine = typeof import('../core/pdf');
export type TemplateInfo = Awaited<ReturnType<PdfEngine['inspectTemplate']>>;
export type RowResult = BatchRowResult & FilenamePlan;
type RosterEngine = typeof import('../core/roster');
type Roster = Awaited<ReturnType<RosterEngine['readRoster']>>;
export type SourceRow = Roster['sheets'][number]['rows'][number];
export type RowFilter = 'all' | 'ready' | 'flagged' | 'warnings';

const emptyRows: SourceRow[] = [];
const emptyFields: TemplateInfo['fields'] = [];
const samples = {
  workshop: {
    load: () => import('virtual:arabiform/sample'), pdf: 'synthetic-acroform.pdf', roster: 'synthetic-roster.csv', pattern: '{{ID}}-{{Name}}.pdf',
  },
  clinic: {
    load: () => import('virtual:arabiform/sample-clinic'), pdf: 'clinic-consent-mixed.pdf', roster: 'clinic-consent-roster.csv', pattern: '{{ID}}-{{Name}}.pdf',
  },
  hr: {
    load: () => import('virtual:arabiform/sample-hr'), pdf: 'multi-page-hr-choices.pdf', roster: 'multi-page-hr-choices.csv', pattern: '{{Employee}}.pdf',
  },
  badge: {
    load: () => import('virtual:arabiform/sample-badge'), pdf: 'landscape-badge.pdf', roster: 'badge-roster.csv', pattern: '{{Badge ID}}-{{Name}}.pdf',
  },
};
type SampleWorkflow = keyof typeof samples;
export const sampleWorkflows = Object.keys(samples) as SampleWorkflow[];

type CustomFont = { status: 'loading' } | { status: 'invalid'; maxMiB?: number } | {
  status: 'ready'; family: string; bytes: Uint8Array;
};

type MappingSettings = {
  fromPreset: boolean;
  values: Record<string, string>;
  alignment?: Record<string, AlignOverride>;
};

type Cells = Pick<BatchDraft, 'edits' | 'hygiene'>;
type CellState = Cells & { undo?: Cells; undoExpired?: boolean; revision: number };

export function useWorkbench(locale: MergeCoverSheet['locale']) {
  const [template, setTemplate] = useState<{ name: string; bytes: Uint8Array; info: TemplateInfo }>();
  const [roster, setRoster] = useState<{ name: string; bytes: Uint8Array; data: Roster; engine: RosterEngine }>();
  const [loadedSample, setLoadedSample] = useState<SampleWorkflow>();
  const [busy, setBusy] = useState({ pdf: false, roster: false });
  const [errors, setErrors] = useState<{ pdf?: string; roster?: string }>({});
  const request = useRef({ pdf: 0, roster: 0, preset: 0, customFont: 0, draft: 0 });
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mappingSettings, setMappingSettings] = useState<MappingSettings>({
    fromPreset: false, values: {},
  });
  const [cellState, setCellState] = useState<CellState>({ edits: {}, hygiene: [], revision: 0 });
  const { edits, hygiene, undo, undoExpired, revision: cellRevision } = cellState;
  const [selected, setSelected] = useState(0);
  const [requestedPage, setRequestedPage] = useState<number>();
  const [filter, setFilter] = useState<RowFilter>('all');
  const [rowSelection, setRowSelection] = useState<RowSelection>('all-ready');
  const [minFontSize, setMinFontSize] = useState(8);
  const [font, setFont] = useState<FontMode>('auto');
  const [customFont, setCustomFont] = useState<CustomFont>();
  const [pattern, setPattern] = useState('{{ID}}-{{Name}}.pdf');
  const [flattenZip, setFlattenZip] = useState(false);
  const [includeCoverSheet, setIncludeCoverSheet] = useState(false);
  const [includeCustody, setIncludeCustody] = useState(false);
  const [watermark, setWatermark] = useState<WatermarkSettings>(DEFAULT_WATERMARK);
  const [presetError, setPresetError] = useState(false);
  const [presetCodec, setPresetCodec] = useState<typeof import('./presets')>();

  const sheet = roster?.data.sheets[sheetIndex];
  const templateFields = template?.info.fields ?? emptyFields;
  const fields = useMemo(() => templateFields.filter((field) =>
    !field.readOnly && (field.kind === 'text' || field.kind === 'checkbox' || Boolean(field.choices?.length))),
  [templateFields]);
  const mapping = useMemo(() => {
    const headers = sheet?.headers ?? [];
    const autoNames = fields.filter(({ kind }) => kind === 'text' || kind === 'checkbox').map(({ name }) => name);
    const auto = mappingSettings.fromPreset ? undefined : roster?.engine.autoMap(autoNames, headers);
    const entries = fields.map(({ name: field }) => {
      const column = Object.hasOwn(mappingSettings.values, field) ? mappingSettings.values[field] : auto?.[field];
      return [field, column && headers.includes(column) ? column : ''] as const;
    });
    return Object.fromEntries(entries);
  }, [fields, sheet, roster, mappingSettings]);
  const alignOverrides = useMemo(() => Object.fromEntries(fields.flatMap(({ kind, name }) => {
    const alignment = mappingSettings.alignment;
    const value = alignment && Object.hasOwn(alignment, name) ? alignment[name] : undefined;
    return kind === 'text' && mapping[name] && value && value !== 'auto' ? [[name, value]] : [];
  })), [fields, mapping, mappingSettings.alignment]);
  const rows = useMemo(() => {
    if (!sheet) return emptyRows;
    const mappedColumns = new Set(Object.values(mapping));
    return sheet.rows.map((row, index) => {
      const warnings = row.warnings.filter(({ code, column }) =>
        code !== 'excel-formula-warning' || mappedColumns.has(column));
      const edit = edits[index];
      return edit || warnings.length !== row.warnings.length
        ? { ...row, values: edit ? { ...row.values, ...edit } : row.values, warnings }
        : row;
    });
  }, [sheet, mapping, edits]);
  const presetWarnings = useMemo(() => mappingSettings.fromPreset
    ? presetCodec?.presetMismatches(mappingSettings.values, pattern, template ? fields.map(({ name }) => name) : undefined, sheet?.headers)
    : undefined, [fields, mappingSettings, pattern, presetCodec, sheet, template]);
  const watermarkBlocked = useMemo(() => !validateWatermarkSettings(watermark), [watermark]);

  const hasMapping = fields.some((field) => Boolean(mapping[field.name]));
  const fontBlocked = customFont?.status === 'loading' || customFont?.status === 'invalid';
  const batch = useMemo(() => template && roster && rows.length && hasMapping && !fontBlocked
    ? { template: template.bytes, roster: roster.bytes, rows, mapping, alignOverrides, minFontSize, font,
      customFont: customFont?.status === 'ready' ? customFont.bytes : undefined }
    : null, [template, roster, rows, mapping, alignOverrides, minFontSize, font, customFont, hasMapping, fontBlocked]);
  const filenamePlans = useMemo(() => roster?.engine.planFilenames(rows, pattern) ?? [], [roster, rows, pattern]);
  const templateName = template?.name;
  const output = useMemo(() => ({
    filenamePlans, flattenZip, rowSelection,
    cover: includeCoverSheet && templateName ? { locale, templateName, includeCustody } : undefined,
    watermark: watermark.kind !== 'none' ? watermark : undefined,
  }), [filenamePlans, flattenZip, rowSelection, includeCoverSheet, templateName, locale, includeCustody, watermark]);
  const { invalidate, clearExportError, download, cancel, exportLocked, ...job } = useBatch(batch, selected, output);
  const results = useMemo(() => job.results?.map((result, index): RowResult => ({
    ...result, ...filenamePlans[index]!,
  })), [job.results, filenamePlans]);
  const ready = useMemo(() => job.results?.filter(({ status }) => status === 'pass').length ?? 0, [job.results]);
  const warningRows = useMemo(() => rows.filter((row) => row.warnings.length > 0).length, [rows]);
  const firstFlaggedPage = job.results?.[selected]?.pageNumbers[0];
  const previewPage = requestedPage ?? firstFlaggedPage ?? 1;

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

  function resetRows() {
    request.current.draft++;
    setSheetIndex(0);
    setSelected(0);
    setRequestedPage(undefined);
    setFilter('all');
    setRowSelection('all-ready');
    setMappingSettings((current) => current.fromPreset ? current : { fromPreset: false, values: {} });
    setCellState((current) => ({ edits: {}, hygiene: [], revision: current.revision + 1 }));
  }

  async function loadPdf(file: File) {
    const id = ++request.current.pdf;
    request.current.draft++;
    invalidate(true);
    setRowSelection('all-ready');
    setTemplate(undefined);
    setRequestedPage(undefined);
    setLoadedSample(undefined);
    setMappingSettings((current) => current.fromPreset ? current : { fromPreset: false, values: {} });
    setErrors((current) => ({ ...current, pdf: undefined }));
    setBusy((current) => ({ ...current, pdf: true }));
    try {
      const [engine, bytes] = await Promise.all([import('../core/pdf'), file.arrayBuffer()]);
      const info = await engine.inspectTemplate(new Uint8Array(bytes));
      if (request.current.pdf === id) setTemplate({ name: file.name, bytes: new Uint8Array(bytes), info });
    } catch (error) {
      if (request.current.pdf === id) setErrors((current) => ({ ...current, pdf: errorCode(error, 'loadError') }));
    } finally {
      if (request.current.pdf === id) setBusy((current) => ({ ...current, pdf: false }));
    }
  }

  async function loadRoster(file: File) {
    const id = ++request.current.roster;
    invalidate(true);
    setRoster(undefined);
    setLoadedSample(undefined);
    resetRows();
    setErrors((current) => ({ ...current, roster: undefined }));
    setBusy((current) => ({ ...current, roster: true }));
    try {
      const [parser, bytes] = await Promise.all([import('../core/roster'), file.arrayBuffer()]);
      const data = await parser.readRoster(bytes, file.name);
      if (request.current.roster === id) setRoster({ name: file.name, bytes: new Uint8Array(bytes), data, engine: parser });
    } catch (error) {
      if (request.current.roster === id) setErrors((current) => ({ ...current, roster: errorCode(error, 'loadError') }));
    } finally {
      if (request.current.roster === id) setBusy((current) => ({ ...current, roster: false }));
    }
  }

  async function loadSample(workflow?: SampleWorkflow) {
    const selectedSample = workflow ?? 'workshop';
    const sample = samples[selectedSample];
    const pdfId = ++request.current.pdf;
    const rosterId = ++request.current.roster;
    request.current.preset++;
    invalidate(true);
    resetRows();
    setMappingSettings({ fromPreset: false, values: selectedSample === 'hr' ? { Clinic: 'Clinic', Contact: 'Contact' } : {} });
    if (workflow !== undefined) {
      request.current.customFont++;
      setCustomFont(undefined);
      setMinFontSize(8);
      setFont('auto');
      setPattern(sample.pattern);
      setFlattenZip(false);
      setIncludeCoverSheet(false);
      setIncludeCustody(false);
      setWatermark(DEFAULT_WATERMARK);
    }
    setPresetError(false);
    setTemplate(undefined);
    setRoster(undefined);
    setLoadedSample(undefined);
    setErrors({});
    setBusy({ pdf: true, roster: true });
    try {
      const [assets, engine, parser] = await Promise.all([
        sample.load(),
        import('../core/pdf'),
        import('../core/roster'),
      ]);
      const bytes = decodeBase64(assets.template);
      const rosterBytes = decodeBase64(assets.roster);
      const [info, data] = await Promise.all([
        engine.inspectTemplate(bytes),
        parser.readRoster(rosterBytes, sample.roster),
      ]);
      if (request.current.pdf === pdfId) setTemplate({ name: sample.pdf, bytes, info });
      if (request.current.roster === rosterId) setRoster({ name: sample.roster, bytes: rosterBytes, data, engine: parser });
      if (request.current.pdf === pdfId && request.current.roster === rosterId) setLoadedSample(selectedSample);
    } catch (error) {
      if (request.current.pdf === pdfId) setErrors((current) => ({ ...current, pdf: errorCode(error, 'loadError') }));
    } finally {
      setBusy((current) => ({
        pdf: request.current.pdf === pdfId ? false : current.pdf,
        roster: request.current.roster === rosterId ? false : current.roster,
      }));
    }
  }

  function changeSheet(index: number) {
    invalidate(true);
    resetRows();
    setSheetIndex(index);
  }

  function changeMapping(field: string, column: string) {
    recheck();
    setMappingSettings((current) => ({ ...current, values: { ...current.values, [field]: column } }));
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
    clearExportError();
    request.current.draft++;
    setFlattenZip(value);
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
    setMappingSettings({ fromPreset: true, values: preset.mapping, alignment: 'alignOverrides' in preset ? preset.alignOverrides : undefined });
    setPattern(preset.filenamePattern);
    setMinFontSize(preset.minFontSize);
    setFont(preset.font);
    setFlattenZip(preset.version !== 1 && preset.flattenZip);
    setIncludeCoverSheet('includeCoverSheet' in preset && preset.includeCoverSheet);
    setIncludeCustody(false);
    setWatermark(preset.version === 5 ? preset.watermark : DEFAULT_WATERMARK);
  }

  function presetInputs() {
    const included = Object.fromEntries(fields.flatMap(({ name, kind }) =>
      kind === 'text' || kind === 'checkbox' || mapping[name] ? [[name, mapping[name]!]] : []));
    return [included, pattern, minFontSize, font, flattenZip, includeCoverSheet, alignOverrides, watermark] as const;
  }

  async function exportPreset() {
    if (watermarkBlocked) return;
    const inputs = presetInputs();
    const { makeMappingPreset } = await import('./presets');
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
    template, roster, loadedSample, busy, errors, sheet, sheetIndex, rows, templateFields, fields, mapping, alignOverrides, changeAlignment,
    sourceRevision: `${request.current.roster}:${sheetIndex}`,
    cellRevision, edits, hygiene, canUndoHygiene: Boolean(undo), undoExpired, applyHygiene, undoHygiene,
    presetInputs, beginDraft, restoreDraft,
    hasMapping, selected, selectRow, previewPage, setPreviewPage: setRequestedPage, filter, setFilter,
    rowSelection, changeRowSelection,
    minFontSize, font, customFont, fontBlocked, pattern, filenamePlans, flattenZip, changeFlattenZip, includeCoverSheet, changeIncludeCoverSheet,
    includeCustody, changeIncludeCustody,
    watermark, watermarkBlocked, changeWatermark,
    ...job, results, ready, flagged: results ? results.length - ready : 0, warningRows,
    loadPdf, loadRoster, loadSample, changeSheet, changeMapping, resetMapping, editCell,
    rowEdit: edits[selected], restoreRowEdit,
    changeSize, changeFont, loadCustomFont, clearCustomFont, changePattern, presetError, presetWarnings, exportPreset, importPreset,
    cancel: () => { retainPreviewPage(); cancel(); },
    download: (kind: Parameters<typeof download>[0]) => {
      const print = kind === 'merged' || (kind === 'zip' && flattenZip);
      if (print && watermarkBlocked) return;
      return download(kind);
    },
  };
}
