import { createFlattenedZip, createMergedPdf, createZip, preflightRow, type RowPreflightResult } from '../pdf';
import type { BatchProgress, BatchRequest, BatchResponse, BatchResult } from './protocol';

// This file is loaded only as a dedicated module worker. The project also compiles DOM UI code.
const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<BatchRequest>) => void): void;
  postMessage(message: BatchResponse, transfer?: Transferable[]): void;
};
let preflightStarted = false;
let cached: RowPreflightResult[] | undefined;

scope.addEventListener('message', async ({ data: request }) => {
  const { id, phase } = request;
  const progress = (completed: number, total: number) => {
    if (phase !== 'preview') scope.postMessage({ id, kind: 'progress', progress: { phase, completed, total } satisfies BatchProgress });
  };
  let result: BatchResult;
  try {
    if (phase === 'preflight') {
      if (preflightStarted) throw new Error('batch-already-started');
      preflightStarted = true;
      const { template, rows, options } = request.input;
      const results: RowPreflightResult[] = [];
      progress(0, rows.length);
      for (const row of rows) {
        results.push(await preflightRow(template, row, options));
        progress(results.length, rows.length);
      }
      cached = results;
      result = results.map(({ status, diagnostics, fontSizes, pageNumbers }) => ({ status, diagnostics, fontSizes, pageNumbers }));
    } else {
      if (!cached) throw new Error('batch-not-ready');
      if (phase === 'preview') {
        result = cached[request.rowIndex]?.pdfBytes?.slice();
      } else {
        if (phase === 'zip' && request.filenames.length !== cached.length) throw new Error('batch-filename-count-mismatch');
        const ready = cached.flatMap(({ pdfBytes }, index) => pdfBytes ? [{
          filename: phase === 'zip' ? request.filenames[index]! : '', pdfBytes,
        }] : []);
        if (!ready.length) throw new Error('empty-export');
        if (phase === 'zip') result = request.flattenZip ? await createFlattenedZip(ready, progress) : createZip(ready, progress);
        else result = await createMergedPdf(ready, progress);
      }
    }
    scope.postMessage({ id, kind: 'result', result }, result instanceof Uint8Array ? [result.buffer as ArrayBuffer] : []);
  } catch (error) {
    scope.postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : 'batch-worker-failed' });
  }
});
