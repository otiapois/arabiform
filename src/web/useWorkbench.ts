import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeBase64, loadFonts } from './resources';

type PdfEngine = typeof import('../core/pdf');
export type TemplateInfo = Awaited<ReturnType<PdfEngine['inspectTemplate']>>;
export type RowResult = Awaited<ReturnType<PdfEngine['preflightRow']>>;
type RosterEngine = typeof import('../core/roster');
type Roster = Awaited<ReturnType<RosterEngine['readRoster']>>;
export type SourceRow = Roster['sheets'][number]['rows'][number];
type Font = 'auto' | 'arabic' | 'latin';
export type RowFilter = 'all' | 'ready' | 'flagged' | 'warnings';
type ExportKind = 'zip' | 'merged' | 'csv' | 'json';

const emptyRows: SourceRow[] = [];

function errorCode(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return 'code' in error && typeof error.code === 'string' ? error.code : error.message;
}

export function saveDownload(data: Uint8Array | string, name: string, type: string) {
  const part = typeof data === 'string' ? data : Uint8Array.from(data);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function useWorkbench() {
  const [template, setTemplate] = useState<{ name: string; bytes: Uint8Array; info: TemplateInfo }>();
  const [roster, setRoster] = useState<{ name: string; data: Roster; engine: RosterEngine }>();
  const [synthetic, setSynthetic] = useState(false);
  const [busy, setBusy] = useState({ pdf: false, roster: false });
  const [errors, setErrors] = useState<{ pdf?: string; roster?: string }>({});
  const request = useRef({ pdf: 0, roster: 0 });
  const revision = useRef(0);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<number, Record<string, string>>>({});
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState<RowFilter>('all');
  const [minFontSize, setMinFontSize] = useState(8);
  const [font, setFont] = useState<Font>('auto');
  const [pattern, setPattern] = useState('{{ID}}-{{Name}}.pdf');
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const [exportError, setExportError] = useState(false);

  const sheet = roster?.data.sheets[sheetIndex];
  const rows = useMemo(() => sheet?.rows.map((row, index) =>
    edits[index] ? { ...row, values: { ...row.values, ...edits[index] } } : row,
  ) ?? emptyRows, [sheet, edits]);
  const fields = useMemo(() =>
    template?.info.fields.filter((field) => !field.readOnly) ?? [], [template]);
  const mapping: Record<string, string> = useMemo(() => Object.assign(
    Object.create(null),
    roster?.engine.autoMap(fields.map((field) => field.name), sheet?.headers ?? []),
    mappingOverrides,
  ), [fields, sheet, roster, mappingOverrides]);
  const hasMapping = fields.some((field) => Boolean(mapping[field.name]));
  const batch = useMemo(() => template && rows.length && hasMapping
    ? { template, rows, mapping, minFontSize, font } : null,
  [template, rows, mapping, minFontSize, font, hasMapping]);
  const filenames = useMemo(() => roster?.engine.makeFilenames(rows, pattern) ?? [], [roster, rows, pattern]);

  const [checked, setChecked] = useState<{
    batch: typeof batch;
    results?: RowResult[];
    error?: string;
  }>();
  const current = checked?.batch === batch ? checked : undefined;
  const results = current?.results;
  const checking = Boolean(batch && !current);

  useEffect(() => {
    if (!batch) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const [engine, fonts] = await Promise.all([import('../core/pdf'), loadFonts()]);
        const results: RowResult[] = [];
        for (const row of batch.rows) {
          if (cancelled) return;
          const valuesByField = Object.fromEntries(
            Object.entries(batch.mapping)
              .filter(([, column]) => column)
              .map(([field, column]) => [field, row.values[column] ?? '']),
          );
          const result = await engine.preflightRow(batch.template.bytes, valuesByField, {
            fonts,
            minFontSize: batch.minFontSize,
            preferredFont: batch.font,
          });
          results.push(result);
          // Let the browser paint and handle edits between successive rows.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
        if (!cancelled) setChecked({ batch, results });
      } catch (error) {
        if (!cancelled) setChecked({ batch, error: errorCode(error, 'pdfError') });
      }
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [batch]);

  function invalidate() {
    revision.current++;
    setExportError(false);
  }

  function resetRows() {
    setSheetIndex(0);
    setSelected(0);
    setFilter('all');
    setMappingOverrides({});
    setEdits({});
  }

  async function loadPdf(file: File) {
    const id = ++request.current.pdf;
    invalidate();
    setTemplate(undefined);
    setSynthetic(false);
    setMappingOverrides({});
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
    invalidate();
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
    invalidate();
    resetRows();
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
    invalidate();
    resetRows();
    setSheetIndex(index);
  }

  function changeMapping(field: string, column: string) {
    invalidate();
    setMappingOverrides((current) => ({ ...current, [field]: column }));
  }

  function resetMapping() {
    invalidate();
    setMappingOverrides({});
  }

  function editCell(row: number, column: string, value: string) {
    invalidate();
    setEdits((current) => ({ ...current, [row]: { ...current[row], [column]: value } }));
  }

  function changeSize(size: number) {
    invalidate();
    setMinFontSize(size);
  }

  function changeFont(value: Font) {
    invalidate();
    setFont(value);
  }

  function changePattern(value: string) {
    invalidate();
    setPattern(value);
  }

  async function download(kind: ExportKind) {
    if (!results || exportLock.current) return;
    exportLock.current = true;
    const startRevision = revision.current;
    setExporting(true);
    setExportError(false);
    try {
      const engine = await import('../core/pdf');
      if (startRevision !== revision.current) return;
      if (kind === 'csv' || kind === 'json') {
        const audit = engine.createAudit(results.map((result, index) => ({
          rowNumber: index + 1,
          filename: filenames[index]!,
          status: result.status,
          diagnostics: result.diagnostics,
          fontSizes: result.fontSizes,
        })));
        saveDownload(audit[kind], `arabiform-preflight.${kind}`, kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
      } else {
        const passing = results.flatMap((result, index) => result.status === 'pass' && result.pdfBytes
          ? [{ filename: filenames[index]!, pdfBytes: result.pdfBytes }] : []);
        if (!passing.length) return;
        const isZip = kind === 'zip';
        const data = await (isZip ? engine.createZip(passing) : engine.createMergedPdf(passing));
        if (startRevision === revision.current) {
          saveDownload(data, isZip ? 'arabiform-clean.zip' : 'arabiform-merged.pdf', isZip ? 'application/zip' : 'application/pdf');
        }
      }
    } catch {
      if (startRevision === revision.current) setExportError(true);
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  }

  return {
    template, roster, synthetic, busy, errors, sheet, sheetIndex, rows, fields, mapping,
    hasMapping, selected, setSelected, filter, setFilter, minFontSize, font, pattern, filenames,
    results, checking, preflightError: current?.error, exporting, exportError, loadPdf, loadRoster,
    loadSample, changeSheet, changeMapping, resetMapping, editCell, changeSize, changeFont,
    changePattern, download,
  };
}
