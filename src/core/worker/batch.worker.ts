import { ApprovalSealError } from '../pdf/approval-seal-settings';
import { createBatchProcessor } from './batch';
import type { BatchRequest, BatchResponse } from './protocol';

// This file is loaded only as a dedicated module worker. The project also compiles DOM UI code.
const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<BatchRequest>) => void): void;
  postMessage(message: BatchResponse, transfer?: Transferable[]): void;
};

const processBatch = createBatchProcessor();
scope.addEventListener('message', async ({ data: request }) => {
  const { id } = request;
  try {
    const result = await processBatch(request, (progress) => scope.postMessage({ id, kind: 'progress', progress }));
    const bytes = result instanceof Uint8Array ? result : result && 'bytes' in result ? result.bytes : undefined;
    const transfer = bytes ? [bytes.buffer as ArrayBuffer] : [];
    if (result && 'pdfZip' in result && result.pdfZip) transfer.push(result.pdfZip.bytes.buffer as ArrayBuffer);
    scope.postMessage({ id, kind: 'result', result }, transfer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'batch-worker-failed';
    const approvalSealProblem = error instanceof ApprovalSealError ? { code: error.code, pageNumber: error.pageNumber, fieldName: error.fieldName } : undefined;
    scope.postMessage({ id, kind: 'error', message, approvalSealProblem });
  }
});
