import { BatchDiffError, compareBatches, MAX_BATCH_ZIP_BYTES, type BatchDiffResult } from '../core/diff/batch-diff';
import { buildBatchDiffSummary } from '../core/diff/summary';

export type ComparisonSide = 'previous' | 'next';
export type ComparisonFailure = { code: BatchDiffError['code']; batch: ComparisonSide | null; path: string | null };
export type ComparisonRequest = {
  previous: File;
  next: File;
  fonts: { arabic: Uint8Array<ArrayBuffer>; latin: Uint8Array<ArrayBuffer> };
};
export type ComparisonResult = BatchDiffResult & { summary: Uint8Array };
export type ComparisonResponse = { ok: true; output: ComparisonResult } | { ok: false; failure?: ComparisonFailure };

self.addEventListener('message', async ({ data }: MessageEvent<ComparisonRequest>) => {
  try {
    const oversized = data.previous.size > MAX_BATCH_ZIP_BYTES ? 'previous' : data.next.size > MAX_BATCH_ZIP_BYTES ? 'next' : null;
    if (oversized) {
      const response: ComparisonResponse = { ok: false, failure: { code: 'zip-limit', batch: oversized, path: null } };
      self.postMessage(response);
      return;
    }
    const [previous, next] = await Promise.all([data.previous.arrayBuffer(), data.next.arrayBuffer()]);
    const result = await compareBatches(new Uint8Array(previous), new Uint8Array(next));
    const summary = await buildBatchDiffSummary(result, data.fonts);
    const response: ComparisonResponse = { ok: true, output: { ...result, summary } };
    const transfer = [result.deltaZip.buffer, result.auditCsv.buffer, result.auditJson.buffer, summary.buffer] as ArrayBuffer[];
    self.postMessage(response, { transfer });
  } catch (error) {
    const failure = error instanceof BatchDiffError ? { code: error.code, batch: error.batch, path: error.path } : undefined;
    const response: ComparisonResponse = { ok: false, failure };
    self.postMessage(response);
  }
});
