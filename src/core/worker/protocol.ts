import type { CustodyEntry, CustodySources } from '../audit/custody';
import type { PreflightOptions, RowPreflightResult } from '../pdf';
import type { WatermarkSettings } from '../pdf/watermark-settings';

export interface BatchInput {
  template: Uint8Array | ArrayBuffer;
  roster: Uint8Array | ArrayBuffer;
  rows: readonly Record<string, string>[];
  options: PreflightOptions;
}

export type BatchRowResult = Omit<RowPreflightResult, 'pdfBytes'>;
export interface BatchProgress {
  phase: 'preflight' | 'zip' | 'merged';
  completed: number;
  total: number;
}

export type MergeCoverSheet = { locale: 'en' | 'ar'; templateName: string; filenames: readonly string[]; includeCustody?: boolean };

export type BatchCommand =
  | { phase: 'preflight'; input: BatchInput }
  | { phase: 'preview'; rowIndex: number }
  | { phase: 'zip'; filenames: readonly string[]; flattenZip?: boolean; watermark?: WatermarkSettings }
  | { phase: 'merged'; coverSheet?: MergeCoverSheet; watermark?: WatermarkSettings };

export type BatchRequest = BatchCommand & { id: number };
export interface BatchPreflightResult { rows: BatchRowResult[]; custody: CustodySources }
export interface BatchZipResult { bytes: Uint8Array; entries: CustodyEntry[] }
export interface BatchMergedResult { bytes: Uint8Array; mergedPdfSha256: string }
export type BatchResult = BatchPreflightResult | BatchZipResult | BatchMergedResult | Uint8Array | undefined;
export type BatchResponse = { id: number } & (
  | { kind: 'progress'; progress: BatchProgress }
  | { kind: 'result'; result: BatchResult }
  | { kind: 'error'; message: string }
);
