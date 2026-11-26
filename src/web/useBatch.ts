import { useEffect, useRef, useState } from 'react';
import type { RosterRow } from '../core/roster';
import type { BatchProgress, BatchRowResult, createBatchWorker } from '../core/worker/client';
import type { FontMode } from './presets';
import { errorCode, loadFonts, saveDownload } from './resources';

type BatchWorker = ReturnType<typeof createBatchWorker>;
type ExportKind = 'zip' | 'merged' | 'csv' | 'json';

type BatchSettings = {
  template: Uint8Array;
  rows: readonly RosterRow[];
  mapping: Record<string, string>;
  minFontSize: number;
  font: FontMode;
};

export function useBatch(batch: BatchSettings | null, selected: number) {
  const generation = useRef(0);
  const worker = useRef<BatchWorker | undefined>(undefined);
  const exportLock = useRef<symbol | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  const [paused, setPaused] = useState(false);
  const [checked, setChecked] = useState<{ batch: BatchSettings; results?: BatchRowResult[]; error?: string }>();
  const [preview, setPreview] = useState<{ results: BatchRowResult[]; row: number; bytes?: Uint8Array }>();
  const [progress, setProgress] = useState<BatchProgress>();
  const [exporting, setExporting] = useState<ExportKind>();
  const [exportError, setExportError] = useState(false);
  const current = checked?.batch === batch ? checked : undefined;
  const results = current?.results;
  const currentPreview = preview?.results === results && preview?.row === selected ? preview : undefined;
  const checking = Boolean(batch && !current && !paused);
  const activeProgress = progress ?? (checking && batch
    ? { phase: 'preflight' as const, completed: 0, total: batch.rows.length } : undefined);

  function invalidate(unpause = false) {
    const next = ++generation.current;
    const client = worker.current;
    worker.current = undefined;
    client?.dispose();
    exportLock.current = undefined;
    setRevision(next);
    setChecked(undefined);
    setPreview(undefined);
    setProgress(undefined);
    setExporting(undefined);
    setExportError(false);
    if (unpause) setPaused(false);
  }

  function trackProgress(client: BatchWorker) {
    let lastPaint = -Infinity;
    return (update: BatchProgress) => {
      const now = performance.now();
      if (worker.current === client && (now - lastPaint >= 80 || update.completed === update.total)) {
        lastPaint = now;
        setProgress(update);
      }
    };
  }

  useEffect(() => {
    if (!batch || paused) return;
    let active = true;
    let client: BatchWorker | undefined;
    const timer = window.setTimeout(async () => {
      try {
        const [{ createBatchWorker }, fonts] = await Promise.all([import('../core/worker/client'), loadFonts()]);
        if (!active || generation.current !== revision) return;
        client = createBatchWorker();
        worker.current = client;
        const mapped = Object.entries(batch.mapping).filter(([, column]) => column);
        const rows = batch.rows.map(({ values }) => Object.fromEntries(
          mapped.map(([field, column]) => [field, Object.hasOwn(values, column) ? values[column]! : '']),
        ));
        const results = await client.preflight({
          template: batch.template, rows,
          options: { fonts, minFontSize: batch.minFontSize, preferredFont: batch.font },
        }, trackProgress(client));
        if (worker.current === client) {
          setChecked({ batch, results });
          setProgress(undefined);
        }
      } catch (error) {
        if (active && generation.current === revision) {
          worker.current = undefined;
          client?.dispose();
          setChecked({ batch, error: errorCode(error, 'pdfError') });
          setProgress(undefined);
        }
      }
    }, 140);

    return () => {
      active = false;
      window.clearTimeout(timer);
      if (client && worker.current === client) {
        worker.current = undefined;
        client.dispose();
      }
    };
  }, [batch, paused, revision]);

  useEffect(() => {
    const client = worker.current;
    setPreview(undefined);
    if (!client || !results || results[selected]?.status !== 'pass') return;
    let active = true;
    void client.preview(selected).then((bytes) => {
      if (active && worker.current === client) setPreview({ results, row: selected, bytes });
    }, () => {
      if (active && worker.current === client) setPreview({ results, row: selected });
    });
    return () => { active = false; };
  }, [results, selected]);

  function cancel() {
    invalidate();
    setPaused(true);
  }

  function changeFilenames() {
    if (exportLock.current) invalidate();
    else setExportError(false);
  }

  async function download(kind: ExportKind, filenames: readonly string[], ready: number) {
    const client = worker.current;
    if (!client || !results || exportLock.current) return;
    if ((kind === 'zip' || kind === 'merged') && !ready) return;
    const operation = Symbol();
    exportLock.current = operation;
    setExporting(kind);
    setExportError(false);
    try {
      if (kind === 'csv' || kind === 'json') {
        const { createAudit } = await import('../core/pdf');
        if (exportLock.current !== operation || worker.current !== client) return;
        const audit = createAudit(results.map((result, index) => ({
          rowNumber: index + 1,
          filename: filenames[index]!,
          status: result.status,
          diagnostics: result.diagnostics,
          fontSizes: result.fontSizes,
        })));
        saveDownload(audit[kind], `arabiform-preflight.${kind}`, kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json');
      } else {
        const onProgress = trackProgress(client);
        setProgress({ phase: kind, completed: 0, total: ready });
        const isZip = kind === 'zip';
        const data = await (isZip ? client.zip(filenames, onProgress) : client.merged(onProgress));
        if (exportLock.current === operation && worker.current === client) {
          saveDownload(data, isZip ? 'arabiform-clean.zip' : 'arabiform-merged.pdf', isZip ? 'application/zip' : 'application/pdf');
        }
      }
    } catch {
      if (exportLock.current === operation) setExportError(true);
    } finally {
      if (exportLock.current === operation) {
        exportLock.current = undefined;
        setExporting(undefined);
        setProgress(undefined);
      }
    }
  }

  return {
    results, checking, paused, progress: activeProgress, preflightError: current?.error,
    previewBytes: currentPreview?.bytes, previewError: Boolean(currentPreview && !currentPreview.bytes),
    exporting: Boolean(exporting), exportError, invalidate, changeFilenames, cancel,
    resume: () => invalidate(true), download,
  };
}
