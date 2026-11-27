import type { CustodyEntry, CustodySources, GroupedCustodyEntry } from '../audit/custody';
import type { GroupingPlan } from '../export/grouping';
import type { Imposition, PreflightOptions, RowPreflightResult } from '../pdf';
import type { CoverLanguage, QrPrintRequest } from '../pdf/qr-settings';
import type { WatermarkSettings } from '../pdf/watermark-settings';
import type { RowSelection } from './row-selection';

export interface BatchInput {
  template: Uint8Array | ArrayBuffer;
  roster: Uint8Array | ArrayBuffer;
  sheetName?: string;
  rows: readonly Record<string, string>[];
  options: PreflightOptions;
}

export type BatchRowResult = Omit<RowPreflightResult, 'pdfBytes'>;
export interface BatchProgress {
  phase: 'preflight' | 'zip' | 'merged' | 'split';
  completed: number;
  total: number;
}

export type { CoverLanguage } from '../pdf/qr-settings';
export type MergeCoverSheet = { coverLanguage?: CoverLanguage; locale: 'en' | 'ar'; templateName: string; filenames: readonly string[]; includeCustody?: boolean };

export type BatchCommand =
  | { phase: 'preflight'; input: BatchInput }
  | { phase: 'preview'; rowIndex: number }
  | { phase: 'zip'; filenames: readonly string[]; flattenZip?: boolean; watermark?: WatermarkSettings; rowSelection?: RowSelection; qrStamp?: QrPrintRequest; grouping?: GroupingPlan }
  | { phase: 'merged'; coverSheet?: MergeCoverSheet; watermark?: WatermarkSettings; rowSelection?: RowSelection; qrStamp?: QrPrintRequest; imposition?: Imposition }
  | { phase: 'split'; grouping: GroupingPlan; coverSheet?: MergeCoverSheet; watermark?: WatermarkSettings; rowSelection?: RowSelection; qrStamp?: QrPrintRequest; imposition?: Imposition };

export type BatchRequest = BatchCommand & { id: number };
export interface BatchPreflightResult { rows: BatchRowResult[]; custody: CustodySources }
export interface BatchZipResult { bytes: Uint8Array; entries: CustodyEntry[]; groupByColumn?: string }
export interface BatchMergedResult { bytes: Uint8Array; mergedPdfSha256: string }
export interface BatchSplitResult { bytes: Uint8Array; groupByColumn: string; groups: GroupedCustodyEntry[] }
export type BatchResult = BatchPreflightResult | BatchZipResult | BatchMergedResult | BatchSplitResult | Uint8Array | undefined;
export type BatchResponse = { id: number } & (
  | { kind: 'progress'; progress: BatchProgress }
  | { kind: 'result'; result: BatchResult }
  | { kind: 'error'; message: string }
);
