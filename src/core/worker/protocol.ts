import type { CustodyEntry, CustodySources, GroupedCustodyEntry } from '../audit/custody';
import type { CustodyQrRecord } from '../custody/records';
import type { GroupingPlan } from '../export/grouping';
import type { PrintEstimateRequest, PrintJobEstimate } from '../export/print-estimator';
import type { FourUpOptions, Imposition, PreflightOptions, RowPreflightResult } from '../pdf';
import type { ApprovalSealProblem, ApprovalSealSettings } from '../pdf/approval-seal-settings';
import type { BatchQrPrintRequest, CoverLanguage } from '../pdf/qr-settings';
import type { WatermarkSettings } from '../pdf/watermark-settings';
import type { PrintCertificateNames } from '../pdf/print-certificate';
import type { RowSelection } from './row-selection';
import type { BoundaryRowSpotlight } from '../preflight/spotlight';
import type { ConditionalFieldRule } from '../rules/conditional-fields';

export interface BatchInput {
  template: Uint8Array | ArrayBuffer;
  roster: Uint8Array | ArrayBuffer;
  sheetName?: string;
  rows: readonly Record<string, string>[];
  conditional?: { rules: readonly ConditionalFieldRule[]; columns: readonly string[]; rows: readonly Record<string, string>[] };
  options: PreflightOptions;
}

export type BatchRowResult = Omit<RowPreflightResult, 'pdfBytes'>;
export interface BatchProgress {
  phase: 'preflight' | 'zip' | 'merged' | 'split';
  completed: number;
  total: number;
}

export type { CoverLanguage } from '../pdf/qr-settings';
export type MergeCoverSheet = {
  coverLanguage?: CoverLanguage; locale: 'en' | 'ar'; templateName: string; filenames: readonly string[];
  includeCustody?: boolean; exportedAt?: string;
};
export type PreviewPrintOptions = { approvalSeal?: ApprovalSealSettings; qrStamp?: BatchQrPrintRequest };

export type BatchCommand =
  | { phase: 'preflight'; input: BatchInput }
  | ({ phase: 'preview'; rowIndex: number } & PreviewPrintOptions)
  | ({ phase: 'estimate' } & PrintEstimateRequest)
  | ({ phase: 'zip'; filenames: readonly string[]; flattenZip?: boolean; watermark?: WatermarkSettings; rowSelection?: RowSelection; grouping?: GroupingPlan } & PreviewPrintOptions)
  | ({ phase: 'merged'; coverSheet?: MergeCoverSheet; watermark?: WatermarkSettings; rowSelection?: RowSelection; imposition?: Imposition; fourUp?: FourUpOptions } & PreviewPrintOptions)
  | ({ phase: 'split'; grouping: GroupingPlan; coverSheet?: MergeCoverSheet; watermark?: WatermarkSettings; rowSelection?: RowSelection; imposition?: Imposition; fourUp?: FourUpOptions } & PreviewPrintOptions)
  | { phase: 'certificate'; merged: Pick<BatchMergedResult, 'bytes' | 'mergedPdfSha256'>; names: PrintCertificateNames };

export type BatchRequest = BatchCommand & { id: number };
export interface BatchPreflightResult { rows: BatchRowResult[]; custody: CustodySources; spotlight: BoundaryRowSpotlight }
export interface BatchZipResult { bytes: Uint8Array; entries: CustodyEntry[]; groupByColumn?: string; qrRecords?: CustodyQrRecord[] }
export interface BatchMergedResult { bytes: Uint8Array; mergedPdfSha256: string; qrRecords?: CustodyQrRecord[] }
export interface BatchSplitResult { bytes: Uint8Array; groupByColumn: string; groups: GroupedCustodyEntry[]; qrRecords?: readonly CustodyQrRecord[] }
export type BatchResult = BatchPreflightResult | BatchZipResult | BatchMergedResult | BatchSplitResult | PrintJobEstimate | Uint8Array | undefined;
export type BatchResponse = { id: number } & (
  | { kind: 'progress'; progress: BatchProgress }
  | { kind: 'result'; result: BatchResult }
  | { kind: 'error'; message: string; approvalSealProblem?: ApprovalSealProblem }
);
