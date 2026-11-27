import { countMergeCoverPages } from '../pdf/merge-cover';
import type { Imposition } from '../pdf/exports';
import { twoUpSheetCount } from '../pdf/two-up-sheets';
import { resolveRowSelection, type RowSelection } from '../worker/row-selection';
import { validateGroupingPlan, type GroupingPlan, type OutputGroup } from './grouping';
import { planCombinedPrint, planSplitPrint, type PrintJobContext, type PrintOutputPlan } from './print-job';

export interface PrintEstimateRequest {
  coverSheet?: PrintJobContext['coverSheet'];
  rowSelection?: RowSelection;
  grouping?: GroupingPlan;
  imposition?: Imposition;
}

type TwoUpUnavailableReason = 'imposition-requires-single-page' | 'imposition-invalid-page-geometry' | 'imposition-unsupported-print-annotation';

export interface PrintEstimateInput extends PrintEstimateRequest, Omit<PrintJobContext, 'rowNumbers' | 'coverSheet' | 'exportedAt'> {
  templatePagesPerRecord: number;
  exportedAt: string;
  twoUpUnavailableReason?: TwoUpUnavailableReason;
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
}

export interface GroupPrintEstimate extends PrintSheetTotals, OutputGroup {
  filename: string;
}

export interface PrintJobEstimate extends PrintSheetTotals {
  imposition: Imposition;
  twoUpUnavailableReason?: TwoUpUnavailableReason;
  split?: PrintSheetTotals & { groupBreakdowns: GroupPrintEstimate[] };
}

function printTotals(
  totalRecords: number, templatePagesPerRecord: number, coverPages: number, twoUpRecordSheets: number | null, imposition: Imposition,
): PrintSheetTotals {
  const oneUpPhysicalSheets = totalRecords * templatePagesPerRecord + coverPages;
  const twoUpPhysicalSheets = twoUpRecordSheets === null ? null : twoUpRecordSheets + coverPages;
  const sheetsSavedByTwoUp = twoUpPhysicalSheets === null ? null : oneUpPhysicalSheets - twoUpPhysicalSheets;
  return {
    totalRecords, templatePagesPerRecord, coverPages, oneUpPhysicalSheets, twoUpPhysicalSheets, sheetsSavedByTwoUp,
    activePhysicalSheets: imposition === '2-up' ? twoUpPhysicalSheets! : oneUpPhysicalSheets,
    percentPaperSaved: sheetsSavedByTwoUp === null ? null : oneUpPhysicalSheets
      ? Math.round(sheetsSavedByTwoUp * 10_000 / oneUpPhysicalSheets) / 100
      : 0,
  };
}

export function estimatePrintJob(input: PrintEstimateInput): PrintJobEstimate {
  const { rows, templatePagesPerRecord, rowSelection, grouping, coverSheet } = input;
  if (!Number.isSafeInteger(templatePagesPerRecord) || templatePagesPerRecord < 0) throw new Error('invalid-template-page-count');
  if (input.imposition !== undefined && input.imposition !== '1-up' && input.imposition !== '2-up') throw new Error('invalid-imposition');
  if (coverSheet && coverSheet.filenames.length !== rows.length) throw new Error('cover-sheet-invalid-metadata');
  if (grouping) validateGroupingPlan(grouping, rows.length);

  const { selectedRowNumbers } = resolveRowSelection(rows, rowSelection);
  const reason = templatePagesPerRecord !== 1 ? 'imposition-requires-single-page' : input.twoUpUnavailableReason;
  const imposition = reason ? '1-up' : input.imposition ?? '1-up';
  const context = { ...input, rowNumbers: selectedRowNumbers };
  const estimateOutput = ({ rowNumbers, cover, filenames }: PrintOutputPlan) => {
    const total = rowNumbers.length;
    // Page-range labels differ by mode. Both modes have the same fixed table
    // columns and heading heights, so pagination itself is mode-independent.
    const coverPages = total && cover ? countMergeCoverPages(filenames.map((filename) => ({
      filename, pageCount: templatePagesPerRecord,
    })), cover, imposition) : 0;
    return printTotals(total, templatePagesPerRecord, coverPages, reason ? null : twoUpSheetCount(total), imposition);
  };
  const combined = estimateOutput(planCombinedPrint(context));
  const estimate: PrintJobEstimate = { ...combined, imposition, ...(reason && { twoUpUnavailableReason: reason }) };
  if (grouping) {
    const groupBreakdowns = planSplitPrint(context, grouping).map(({ folder, groupValue, ...plan }): GroupPrintEstimate => ({
      ...estimateOutput(plan), folder, groupValue, rowNumbers: plan.rowNumbers, filename: `${folder}-merged.pdf`,
    }));
    const coverPages = groupBreakdowns.reduce((sum, group) => sum + group.coverPages, 0);
    const twoUpRecordSheets = reason ? null : groupBreakdowns.reduce((sum, group) => sum + twoUpSheetCount(group.totalRecords), 0);
    estimate.split = { ...printTotals(combined.totalRecords, templatePagesPerRecord, coverPages, twoUpRecordSheets, imposition), groupBreakdowns };
  }
  return estimate;
}
