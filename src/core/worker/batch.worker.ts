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
    scope.postMessage({ id, kind: 'result', result }, bytes ? [bytes.buffer as ArrayBuffer] : []);
  } catch (error) {
    scope.postMessage({ id, kind: 'error', message: error instanceof Error ? error.message : 'batch-worker-failed' });
  }
});
