import type { PreflightOptions, RowPreflightResult } from '../pdf';

export interface BatchInput {
  template: Uint8Array | ArrayBuffer;
  rows: readonly Record<string, string>[];
  options: PreflightOptions;
}

export type BatchRowResult = Omit<RowPreflightResult, 'pdfBytes'>;
export interface BatchProgress {
  phase: 'preflight' | 'zip' | 'merged';
  completed: number;
  total: number;
}

export type MergeCoverSheet = { locale: 'en' | 'ar'; templateName: string; filenames: readonly string[] };

export type BatchCommand =
  | { phase: 'preflight'; input: BatchInput }
  | { phase: 'preview'; rowIndex: number }
  | { phase: 'zip'; filenames: readonly string[]; flattenZip?: boolean }
  | { phase: 'merged'; coverSheet?: MergeCoverSheet };

export type BatchRequest = BatchCommand & { id: number };
export type BatchResult = BatchRowResult[] | Uint8Array | undefined;
export type BatchResponse = { id: number } & (
  | { kind: 'progress'; progress: BatchProgress }
  | { kind: 'result'; result: BatchResult }
  | { kind: 'error'; message: string }
);
