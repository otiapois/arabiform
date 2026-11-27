import type { Imposition } from '../pdf';
import type { GroupingPlan } from '../export/grouping';
import type { BatchQrPrintRequest } from '../pdf/qr-settings';
import type { WatermarkSettings } from '../pdf/watermark-settings';
import type { BatchCommand, BatchInput, BatchMergedResult, BatchPreflightResult, BatchProgress, BatchRequest, BatchResponse,
  BatchResult, BatchSplitResult, BatchZipResult, MergeCoverSheet } from './protocol';
import type { RowSelection } from './row-selection';

export type { BatchInput, BatchMergedResult, BatchPreflightResult, BatchProgress, BatchRowResult, BatchSplitResult, BatchZipResult } from './protocol';
type ProgressListener = (progress: BatchProgress) => void;

export function createBatchWorker() {
  const worker = new Worker(new URL('./batch.worker.ts', import.meta.url), { type: 'module' });
  const waiting = new Map<number, { resolve: (value: BatchResult) => void; reject: (reason: Error) => void; onProgress?: ProgressListener }>();
  let nextId = 0;
  let stopped: Error | undefined;

  function stop(reason: Error) {
    if (stopped) return;
    stopped = reason;
    worker.terminate();
    for (const request of waiting.values()) request.reject(reason);
    waiting.clear();
  }

  worker.addEventListener('message', ({ data }: MessageEvent<BatchResponse>) => {
    const request = waiting.get(data.id);
    if (!request) return;
    if (data.kind === 'progress') {
      request.onProgress?.(data.progress);
      return;
    }
    waiting.delete(data.id);
    if (data.kind === 'error') request.reject(new Error(data.message));
    else request.resolve(data.result);
  });
  worker.addEventListener('error', (event) => {
    event.preventDefault();
    stop(new Error(event.message || 'batch-worker-failed'));
  });
  worker.addEventListener('messageerror', () => stop(new Error('batch-worker-message-failed')));

  function send(command: BatchCommand, onProgress?: ProgressListener): Promise<BatchResult> {
    if (stopped) return Promise.reject(stopped);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, onProgress });
      try {
        worker.postMessage({ ...command, id } satisfies BatchRequest);
      } catch (error) {
        waiting.delete(id);
        reject(error);
      }
    });
  }

  return {
    preflight: (input: BatchInput, onProgress?: ProgressListener) => send({ phase: 'preflight', input }, onProgress) as Promise<BatchPreflightResult>,
    preview: (rowIndex: number) => send({ phase: 'preview', rowIndex }) as Promise<Uint8Array | undefined>,
    zip: (filenames: readonly string[], onProgress?: ProgressListener, flattenZip = false, watermark?: WatermarkSettings, rowSelection?: RowSelection, qrStamp?: BatchQrPrintRequest, grouping?: GroupingPlan) =>
      send({ phase: 'zip', filenames, flattenZip, watermark, rowSelection, qrStamp, grouping }, onProgress) as Promise<BatchZipResult>,
    merged: (onProgress?: ProgressListener, coverSheet?: MergeCoverSheet, watermark?: WatermarkSettings, rowSelection?: RowSelection, qrStamp?: BatchQrPrintRequest, imposition?: Imposition) =>
      send({ phase: 'merged', coverSheet, watermark, rowSelection, qrStamp, imposition }, onProgress) as Promise<BatchMergedResult>,
    split: (grouping: GroupingPlan, onProgress?: ProgressListener, coverSheet?: MergeCoverSheet, watermark?: WatermarkSettings, rowSelection?: RowSelection, qrStamp?: BatchQrPrintRequest, imposition?: Imposition) =>
      send({ phase: 'split', grouping, coverSheet, watermark, rowSelection, qrStamp, imposition }, onProgress) as Promise<BatchSplitResult>,
    dispose: () => stop(new DOMException('Batch canceled', 'AbortError')),
  };
}
