import type { CustodySources } from '../audit/custody';
import type { PreflightOptions } from '../pdf';
import type { MergeCoverOptions } from '../pdf/merge-cover';
import { isCoverLanguage } from '../pdf/qr-settings';
import type { MergeCoverSheet } from '../worker/protocol';
import type { GroupingPlan, OutputGroup } from './grouping';

export type PrintRowStatus = { status: 'pass' | 'flagged' };

export interface PrintJobContext {
  rows: readonly PrintRowStatus[];
  rowNumbers: number[];
  coverSheet?: MergeCoverSheet;
  preflight: PreflightOptions;
  custody?: CustodySources;
  exportedAt: Date | string;
}

export interface PrintOutputPlan {
  rowNumbers: number[];
  filenames: string[];
  cover?: MergeCoverOptions;
}

export function planCombinedPrint(context: PrintJobContext): PrintOutputPlan {
  const { rowNumbers, rows, coverSheet } = context;
  return {
    rowNumbers,
    filenames: rowNumbers.map((number) => coverSheet?.filenames[number - 1] ?? ''),
    cover: makeCover(context, rowNumbers, rows),
  };
}

export function planSplitPrint(context: PrintJobContext, grouping: GroupingPlan): (OutputGroup & PrintOutputPlan)[] {
  const selected = new Set(context.rowNumbers);
  return grouping.groups.flatMap(({ rowNumbers, ...group }) => {
    const members = rowNumbers.filter((number) => selected.has(number));
    return members.length ? [{
      ...group,
      rowNumbers: members,
      filenames: members.map((number) => grouping.rows[number - 1]!.filename),
      cover: makeCover(context, members, rowNumbers.map((number) => context.rows[number - 1]!)),
    }] : [];
  });
}

function makeCover(
  { coverSheet, preflight, exportedAt, custody }: PrintJobContext, rowNumbers: number[], rows: readonly PrintRowStatus[],
): MergeCoverOptions | undefined {
  if (!coverSheet) return undefined;
  const coverLanguage = coverSheet.coverLanguage ?? 'auto';
  if (!isCoverLanguage(coverLanguage)) throw new Error('cover-sheet-invalid-metadata');
  return {
    locale: coverLanguage === 'auto' ? coverSheet.locale : coverLanguage,
    templateName: coverSheet.templateName,
    exportedAt: coverSheet.exportedAt ?? exportedAt,
    preflight,
    rowNumbers,
    flagged: rows.filter(({ status }) => status === 'flagged').length,
    skipped: rows.length - rowNumbers.length,
    custody: coverSheet.includeCustody ? custody : undefined,
  };
}
