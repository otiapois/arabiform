import type { PdfIntakeCode } from '../pdf/template';

export type BatchDiffCode = 'invalid-zip' | 'zip-limit' | 'unsafe-path' | 'duplicate-path' | 'non-pdf-entry'
  | Exclude<PdfIntakeCode, 'flat-scanned-no-fields'>;

export class BatchDiffError extends Error {
  constructor(readonly batch: 'previous' | 'next', readonly code: BatchDiffCode, readonly path: string | null = null,
    cause?: unknown) {
    super(code, { cause });
    this.name = 'BatchDiffError';
  }
}
