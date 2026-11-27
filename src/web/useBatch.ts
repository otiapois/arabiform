import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CustodyManifest, CustodySources } from '../core/audit/custody';
import type { AlignOverride } from '../core/pdf/alignment';
import type { Imposition } from '../core/pdf/exports';
import type { QrStampSettings } from '../core/pdf/qr-settings';
import type { WatermarkSettings } from '../core/pdf/watermark-settings';
import type { FilenamePlan, RosterRow } from '../core/roster';
import type { resolveVirtualMapping, VirtualColumnMapping } from '../core/roster/virtual-columns';
import type { BatchProgress, BatchRowResult, createBatchWorker } from '../core/worker/client';
import type { MergeCoverSheet } from '../core/worker/protocol';
import { resolveRowSelection, type RowSelection } from '../core/worker/row-selection';
import type { FontMode } from './presets';
import { errorCode, loadFonts, saveDownload } from './resources';

export type BatchWorker = ReturnType<typeof createBatchWorker>;
export type ExportKind = 'zip' | 'merged' | 'csv' | 'json';
type CustodyOutputs = Pick<CustodyManifest, 'entries' | 'mergedPdfSha256'>;

export type OutputSettings = {
  filenamePlans: readonly FilenamePlan[];
  rowSelection: RowSelection;
  flattenZip: boolean;
  cover?: Omit<MergeCoverSheet, 'filenames'>;
  watermark?: WatermarkSettings;
  qrStamp?: Exclude<QrStampSettings, { placement: 'none' }>;
  imposition?: Imposition;
};

export type BatchSettings = {
  template: Uint8Array;
  roster: Uint8Array;
  sheetName?: string;
  rows: readonly RosterRow[];
  mapping: Record<string, string>;
  virtualMappings: Record<string, VirtualColumnMapping>;
  localDate: string;
  resolveVirtualMapping: typeof resolveVirtualMapping;
  alignOverrides: Record<string, AlignOverride>;
  minFontSize: number;
  font: FontMode;
  customFont?: Uint8Array;
};

export function useBatch(batch: BatchSettings | null, selected: number, output: OutputSettings) {
  const generation = useRef(0);
  const worker = useRef<BatchWorker | undefined>(undefined);
  const exportLock = useRef<symbol | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  const [paused, setPaused] = useState(false);
  const [checked, setChecked] = useState<{ batch: BatchSettings; results?: BatchRowResult[]; custody?: CustodySources; error?: string }>();
  const [exported, setExported] = useState<{ settings: OutputSettings; digests: CustodyOutputs }>();
  const [preview, setPreview] = useState<{ results: BatchRowResult[]; row: number; bytes?: Uint8Array }>();
  const [progress, setProgress] = useState<BatchProgress>();
  const [exporting, setExporting] = useState<ExportKind>();
  const [exportError, setExportError] = useState<{ code: string; rowNumber?: number }>();
  const current = checked?.batch === batch ? checked : undefined;
  const results = current?.results;
  const exportScope = useMemo(() => resolveRowSelection(results ?? [], output.rowSelection), [results, output.rowSelection]);
  const exportCount = exportScope.selectedRowNumbers.length;
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
    setExported(undefined);
    setPreview(undefined);
    setProgress(undefined);
    setExporting(undefined);
    setExportError(undefined);
    if (unpause) setPaused(false);
  }

  function trackProgress(client: BatchWorker) {
    let lastPaint = -Infinity;
    return (update: BatchProgress) => {
      // The UI already shows zero before the worker reports progress.
      if (update.completed === 0 || worker.current !== client) return;
      const now = performance.now();
      if (now - lastPaint >= 80 || update.completed === update.total) {
        const firstIntermediate = lastPaint === -Infinity && update.completed < update.total;
        lastPaint = now;
        // Commit once before a queued worker result can batch away the intermediate update.
        if (firstIntermediate) flushSync(() => setProgress(update));
        else setProgress(update);
      }
    };
  }

  useEffect(() => {
    if (!batch || paused) return;
    let active = true;
    let client: BatchWorker | undefined;
    const timer = window.setTimeout(async () => {
      try {
        const [{ createBatchWorker, makeBatchInput }, fonts] = await Promise.all([import('./batch-preflight'), loadFonts()]);
        if (!active || generation.current !== revision) return;
        client = createBatchWorker();
        worker.current = client;
        const { rows: results, custody } = await client.preflight(makeBatchInput(batch, fonts), trackProgress(client));
        if (worker.current === client) {
          setChecked({ batch, results, custody });
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

  async function download(kind: ExportKind) {
    const client = worker.current;
    if (!batch || !client || !results || exportLock.current) return;
    if (!exportCount && (output.rowSelection !== 'all-ready' || kind === 'zip' || kind === 'merged')) return;
    const operation = Symbol();
    exportLock.current = operation;
    setExporting(kind);
    setExportError(undefined);
    const currentExport = () => exportLock.current === operation && worker.current === client;
    try {
      if (kind === 'zip' || kind === 'merged') {
        setProgress({ phase: kind, completed: 0, total: exportCount });
      }
      const { buildDownload } = await import('./batch-exports');
      if (!currentExport()) return;
      const download = await buildDownload(kind, client, trackProgress(client), batch, results, output, exportScope, currentExport);
      if (download && currentExport()) {
        const { data, filename, mime, digests } = download;
        saveDownload(data, filename, mime);
        if (digests) {
          setExported((previous) => ({ settings: output, digests: {
            ...(previous?.settings === output ? previous.digests : undefined), ...digests,
          } }));
        }
      }
    } catch (error) {
      if (exportLock.current === operation) {
        const rowNumber = error instanceof Error && 'rowNumber' in error && typeof error.rowNumber === 'number' ? error.rowNumber : undefined;
        setExportError({ code: errorCode(error, 'exportError') || 'exportError', rowNumber });
      }
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
    exportScope, exportCount, custody: current?.custody,
    custodyOutputs: exported?.settings === output ? exported.digests : undefined,
    previewBytes: currentPreview?.bytes, previewError: Boolean(currentPreview && !currentPreview.bytes),
    exporting: Boolean(exporting), exportingZip: exporting === 'zip', exportError,
    exportLocked: () => Boolean(exportLock.current),
    invalidate, clearExportError: () => setExportError(undefined), cancel,
    resume: () => invalidate(true), download,
  };
}
