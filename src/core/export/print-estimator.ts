import type { PreflightOptions } from '../pdf';
import { countMergeCoverPages, prepareCoverEstimateLayout } from '../pdf/merge-cover';
import { fourUpOptionsFor, isImposition, recordSheetCount, type FourUpOptions, type Imposition, type ImpositionUnavailableReason } from '../pdf/imposition-settings';
import { resolveRowSelection, type RowSelection } from '../worker/row-selection';
import { validateGroupingPlan, type GroupingPlan, type OutputGroup } from './grouping';
import { planCombinedPrint, planSplitPrint, type PrintJobContext, type PrintOutputPlan } from './print-job';

export interface PrintEstimateRequest {
  coverSheet?: PrintJobContext['coverSheet'];
  rowSelection?: RowSelection;
  grouping?: GroupingPlan;
  imposition?: Imposition;
  fourUp?: FourUpOptions;
}

export interface PrintEstimateInput extends PrintEstimateRequest, Omit<PrintJobContext, 'rowNumbers' | 'coverSheet' | 'exportedAt'> {
  templatePagesPerRecord: number;
  exportedAt: string;
  twoUpUnavailableReason?: ImpositionUnavailableReason;
  fourUpUnavailableReason?: ImpositionUnavailableReason;
}

export interface PrintSheetTotals {
  totalRecords: number;
  templatePagesPerRecord: number;
  coverPages: number;
  activePhysicalSheets: number;
  oneUpPhysicalSheets: number;
  twoUpPhysicalSheets: number | null;
  sheetsSavedByTwoUp: number | null;
  percentPaperSaved: number | null;
  fourUpPhysicalSheets: number | null;
  sheetsSavedByFourUp: number | null;
  percentPaperSavedByFourUp: number | null;
}

export interface GroupPrintEstimate extends PrintSheetTotals, OutputGroup {
  filename: string;
}

export interface PrintJobEstimate extends PrintSheetTotals {
  imposition: Imposition;
  twoUpUnavailableReason?: ImpositionUnavailableReason;
  fourUpUnavailableReason?: ImpositionUnavailableReason;
  split?: PrintSheetTotals & { groupBreakdowns: GroupPrintEstimate[] };
}

function printTotals(
  totalRecords: number, templatePagesPerRecord: number, coverPages: number, twoUpRecordSheets: number | null, fourUpRecordSheets: number | null,
  imposition: Imposition,
): PrintSheetTotals {
  const oneUpPhysicalSheets = totalRecords * templatePagesPerRecord + coverPages;
  const twoUpPhysicalSheets = twoUpRecordSheets === null ? null : twoUpRecordSheets + coverPages;
  const fourUpPhysicalSheets = fourUpRecordSheets === null ? null : fourUpRecordSheets + coverPages;
  const sheetsSavedByTwoUp = twoUpPhysicalSheets === null ? null : oneUpPhysicalSheets - twoUpPhysicalSheets;
  const sheetsSavedByFourUp = fourUpPhysicalSheets === null ? null : oneUpPhysicalSheets - fourUpPhysicalSheets;
  const percentage = (saved: number | null) => saved === null ? null : oneUpPhysicalSheets
    ? Math.round(saved * 10_000 / oneUpPhysicalSheets) / 100 : 0;
  return {
    totalRecords, templatePagesPerRecord, coverPages, oneUpPhysicalSheets,
    twoUpPhysicalSheets, sheetsSavedByTwoUp, percentPaperSaved: percentage(sheetsSavedByTwoUp),
    fourUpPhysicalSheets, sheetsSavedByFourUp, percentPaperSavedByFourUp: percentage(sheetsSavedByFourUp),
    activePhysicalSheets: imposition === '4-up' ? fourUpPhysicalSheets! : imposition === '2-up' ? twoUpPhysicalSheets! : oneUpPhysicalSheets,
  };
}

export function estimatePrintJob(input: PrintEstimateInput): PrintJobEstimate {
  return estimateWithCoverLayout(input, prepareCoverEstimateLayout(input.preflight.fonts));
}

export function preparePrintJobEstimator(preflight: PreflightOptions) {
  const makeCoverLayout = prepareCoverEstimateLayout(preflight.fonts);
  return (input: Omit<PrintEstimateInput, 'preflight'>) => estimateWithCoverLayout({ ...input, preflight }, makeCoverLayout);
}

function estimateWithCoverLayout(input: PrintEstimateInput, makeCoverLayout: ReturnType<typeof prepareCoverEstimateLayout>): PrintJobEstimate {
  const { rows, templatePagesPerRecord, rowSelection, grouping, coverSheet } = input;
  if (!Number.isSafeInteger(templatePagesPerRecord) || templatePagesPerRecord < 0) throw new Error('invalid-template-page-count');
  if (input.imposition !== undefined && !isImposition(input.imposition)) throw new Error('invalid-imposition');
  if (coverSheet && coverSheet.filenames.length !== rows.length) throw new Error('cover-sheet-invalid-metadata');
  if (grouping) validateGroupingPlan(grouping, rows.length);

  const { selectedRowNumbers } = resolveRowSelection(rows, rowSelection);
  const twoUpUnavailableReason = templatePagesPerRecord !== 1 ? 'imposition-requires-single-page' : input.twoUpUnavailableReason;
  const fourUpUnavailableReason = twoUpUnavailableReason ?? input.fourUpUnavailableReason;
  const requested = input.imposition ?? '1-up';
  const unavailable = requested === '4-up' ? fourUpUnavailableReason : requested === '2-up' ? twoUpUnavailableReason : undefined;
  const imposition = unavailable ? '1-up' : requested;
  const fourUp = fourUpOptionsFor(imposition, input.fourUp);
  const context = { ...input, rowNumbers: selectedRowNumbers };
  const coverLayout = makeCoverLayout();
  const estimateOutput = ({ rowNumbers, cover, filenames }: PrintOutputPlan) => {
    const total = rowNumbers.length;
    // Page-range labels differ by mode. The modes have the same fixed table
    // columns and heading heights, so pagination itself is mode-independent.
    const coverPages = total && cover ? countMergeCoverPages(filenames.map((filename) => ({
      filename, pageCount: templatePagesPerRecord,
    })), cover, imposition, coverLayout, fourUp) : 0;
    return printTotals(total, templatePagesPerRecord, coverPages, twoUpUnavailableReason ? null : recordSheetCount(total, '2-up'),
      fourUpUnavailableReason ? null : recordSheetCount(total, '4-up'), imposition);
  };
  const combined = estimateOutput(planCombinedPrint(context));
  const estimate: PrintJobEstimate = { ...combined, imposition, ...(twoUpUnavailableReason && { twoUpUnavailableReason }),
    ...(fourUpUnavailableReason && { fourUpUnavailableReason }) };
  if (grouping) {
    const groupBreakdowns = planSplitPrint(context, grouping).map(({ folder, groupValue, ...plan }): GroupPrintEstimate => ({
      ...estimateOutput(plan), folder, groupValue, rowNumbers: plan.rowNumbers, filename: `${folder}-merged.pdf`,
    }));
    const coverPages = groupBreakdowns.reduce((sum, group) => sum + group.coverPages, 0);
    const twoUpRecordSheets = twoUpUnavailableReason ? null : groupBreakdowns.reduce((sum, group) => sum + recordSheetCount(group.totalRecords, '2-up'), 0);
    const fourUpRecordSheets = fourUpUnavailableReason ? null : groupBreakdowns.reduce((sum, group) => sum + recordSheetCount(group.totalRecords, '4-up'), 0);
    estimate.split = { ...printTotals(combined.totalRecords, templatePagesPerRecord, coverPages, twoUpRecordSheets, fourUpRecordSheets, imposition), groupBreakdowns };
  }
  return estimate;
}
