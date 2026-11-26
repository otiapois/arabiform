import { useMemo, useRef, useState } from 'react';
import type { FilenamePlan } from '../core/roster';
import type { BatchRowResult } from '../core/worker/client';
import { parseMappingPreset, presetMismatches, type FontMode, type MappingPreset } from './presets';
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

type CustomFont = { status: 'loading' } | { status: 'invalid'; maxMiB?: number } | {
  status: 'ready'; family: string; bytes: Uint8Array;
};

export function useWorkbench() {
  const [template, setTemplate] = useState<{ name: string; bytes: Uint8Array; info: TemplateInfo }>();
  const [roster, setRoster] = useState<{ name: string; data: Roster; engine: RosterEngine }>();
  const [synthetic, setSynthetic] = useState(false);
  const [busy, setBusy] = useState({ pdf: false, roster: false });
  const [errors, setErrors] = useState<{ pdf?: string; roster?: string }>({});
  const request = useRef({ pdf: 0, roster: 0, preset: 0, customFont: 0 });
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mappingSettings, setMappingSettings] = useState<{ fromPreset: boolean; values: Record<string, string> }>({
    fromPreset: false, values: {},
  });
  const [edits, setEdits] = useState<Record<number, Record<string, string>>>({});
  const [selected, setSelected] = useState(0);
  const [requestedPage, setRequestedPage] = useState<number>();
  const [filter, setFilter] = useState<RowFilter>('all');
  const [minFontSize, setMinFontSize] = useState(8);
  const [font, setFont] = useState<FontMode>('auto');
  const [customFont, setCustomFont] = useState<CustomFont>();
  const [pattern, setPattern] = useState('{{ID}}-{{Name}}.pdf');
  const [flattenZip, setFlattenZip] = useState(false);
  const [presetError, setPresetError] = useState(false);

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
    ? presetMismatches(mappingSettings.values, pattern, template ? fields.map(({ name }) => name) : undefined, sheet?.headers)
    : undefined, [fields, mappingSettings, pattern, sheet, template]);

  const hasMapping = fields.some((field) => Boolean(mapping[field.name]));
  const fontBlocked = customFont?.status === 'loading' || customFont?.status === 'invalid';
  const batch = useMemo(() => template && rows.length && hasMapping && !fontBlocked
    ? { template: template.bytes, rows, mapping, minFontSize, font, customFont: customFont?.status === 'ready' ? customFont.bytes : undefined }
    : null, [template, rows, mapping, minFontSize, font, customFont, hasMapping, fontBlocked]);
  const filenamePlans = useMemo(() => roster?.engine.planFilenames(rows, pattern) ?? [], [roster, rows, pattern]);
  const { invalidate, clearExportError, download, cancel, ...job } = useBatch(batch, selected);
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
    retainPreviewPage();
    invalidate();
  }

  function resetRows() {
    setSheetIndex(0);
    setSelected(0);
    setRequestedPage(undefined);
    setFilter('all');
    setMappingSettings((current) => current.fromPreset ? current : { fromPreset: false, values: {} });
    setEdits({});
  }

  async function loadPdf(file: File) {
    const id = ++request.current.pdf;
    invalidate(true);
    setTemplate(undefined);
    setRequestedPage(undefined);
    setSynthetic(false);
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
    setSynthetic(false);
    resetRows();
    setErrors((current) => ({ ...current, roster: undefined }));
    setBusy((current) => ({ ...current, roster: true }));
    try {
      const [parser, bytes] = await Promise.all([import('../core/roster'), file.arrayBuffer()]);
      const data = await parser.readRoster(bytes, file.name);
      if (request.current.roster === id) setRoster({ name: file.name, data, engine: parser });
    } catch (error) {
      if (request.current.roster === id) setErrors((current) => ({ ...current, roster: errorCode(error, 'loadError') }));
    } finally {
      if (request.current.roster === id) setBusy((current) => ({ ...current, roster: false }));
    }
  }

  async function loadSample() {
    const pdfId = ++request.current.pdf;
    const rosterId = ++request.current.roster;
    request.current.preset++;
    invalidate(true);
    resetRows();
    setMappingSettings({ fromPreset: false, values: {} });
    setPresetError(false);
    setTemplate(undefined);
    setRoster(undefined);
    setSynthetic(false);
    setErrors({});
    setBusy({ pdf: true, roster: true });
    try {
      const [assets, engine, parser] = await Promise.all([
        import('virtual:arabiform/sample'),
        import('../core/pdf'),
        import('../core/roster'),
      ]);
      const bytes = decodeBase64(assets.template);
      const [info, data] = await Promise.all([
        engine.inspectTemplate(bytes),
        parser.readRoster(decodeBase64(assets.roster), 'synthetic-roster.csv'),
      ]);
      if (request.current.pdf === pdfId) setTemplate({ name: 'synthetic-acroform.pdf', bytes, info });
      if (request.current.roster === rosterId) setRoster({ name: 'synthetic-roster.csv', data, engine: parser });
      if (request.current.pdf === pdfId && request.current.roster === rosterId) setSynthetic(true);
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

  function editCell(row: number, column: string, value: string) {
    recheck();
    setEdits((current) => ({ ...current, [row]: { ...current[row], [column]: value } }));
  }

  function restoreRowEdit(row: number, original: Record<string, string> | undefined) {
    if (edits[row] === original) return;
    recheck();
    setEdits((current) => {
      if (original) return { ...current, [row]: original };
      const restored = { ...current };
      delete restored[row];
      return restored;
    });
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
    clearExportError();
    setPattern(value);
  }

  function changeFlattenZip(value: boolean) {
    clearExportError();
    setFlattenZip(value);
  }

  async function importPreset(file: File) {
    const id = ++request.current.preset;
    const customFontId = request.current.customFont;
    setPresetError(false);
    try {
      const preset = parseMappingPreset(await file.text());
      if (id !== request.current.preset) return;
      if (customFontId === request.current.customFont) clearCustomFont();
      else recheck();
      setMappingSettings({ fromPreset: true, values: preset.mapping });
      setPattern(preset.filenamePattern);
      setMinFontSize(preset.minFontSize);
      setFont(preset.font);
      setFlattenZip(preset.version === 2 && preset.flattenZip);
    } catch {
      if (id === request.current.preset) setPresetError(true);
    }
  }

  function exportPreset() {
    const settings = {
      mapping: Object.fromEntries(fields.flatMap(({ name, kind }) =>
        kind === 'text' || kind === 'checkbox' || mapping[name] ? [[name, mapping[name]!]] : [])),
      filenamePattern: pattern, minFontSize, font,
    };
    const preset: MappingPreset = flattenZip
      ? { version: 2, ...settings, flattenZip }
      : { version: 1, ...settings };
    saveDownload(JSON.stringify(preset, null, 2), 'arabiform-mapping-preset.json', 'application/json');
  }

  return {
    template, roster, synthetic, busy, errors, sheet, sheetIndex, rows, templateFields, fields, mapping,
    hasMapping, selected, selectRow, previewPage, setPreviewPage: setRequestedPage, filter, setFilter,
    minFontSize, font, customFont, fontBlocked, pattern, filenamePlans, flattenZip, changeFlattenZip,
    ...job, results, ready, flagged: results ? results.length - ready : 0, warningRows,
    loadPdf, loadRoster, loadSample, changeSheet, changeMapping, resetMapping, editCell,
    rowEdit: edits[selected], restoreRowEdit,
    changeSize, changeFont, loadCustomFont, clearCustomFont, changePattern, presetError, presetWarnings, exportPreset, importPreset,
    cancel: () => { retainPreviewPage(); cancel(); },
    download: (kind: Parameters<typeof download>[0]) => download(kind, filenamePlans, ready, flattenZip),
  };
}
