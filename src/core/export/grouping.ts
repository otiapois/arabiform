import { filenameKey, isSafePdfFilename, planFilenames, type FilenamePlan } from '../roster/filenames';
import type { RosterRow } from '../roster';
import { escapeSpreadsheetCell } from '../roster/spreadsheet-csv';

export const UNGROUPED_FOLDER = '_Ungrouped';
export const SPLIT_CUSTODY_PATH = 'batch-custody.json';

export type GroupedRow = FilenamePlan & { zipPath: string; folder: string };

export interface OutputGroup {
  groupValue: string | null;
  folder: string;
  rowNumbers: number[];
}

export interface GroupingPlan {
  groupByColumn: string;
  rows: GroupedRow[];
  groups: OutputGroup[];
}

export function planGroupedOutput(
  rows: readonly (Record<string, string> | RosterRow)[], column: string, pattern?: string, context?: { localDate: string },
): GroupingPlan {
  if (!column.trim()) throw new Error('invalid-grouping-column');
  const groupRows = new Map<string | null, number[]>();
  const groupValues = rows.map((row, index) => {
    const values = Array.isArray(row.warnings) ? (row as RosterRow).values : row as Record<string, string>;
    if (!Object.hasOwn(values, column)) throw new Error('invalid-grouping-column');
    const value = values[column]!;
    const groupValue = value.trim() ? value : null;
    const rowNumbers = groupRows.get(groupValue) ?? [];
    rowNumbers.push(index + 1);
    groupRows.set(groupValue, rowNumbers);
    return groupValue;
  });

  // Reserve the blank folder before assigning any nonblank name, even when a
  // real _Ungrouped cell precedes the first blank row in the roster.
  const rawValues = [null, ...[...groupRows.keys()].filter((value) => value !== null)];
  const folderPlans = planFilenames(rawValues.map((value) => ({ group: value ?? UNGROUPED_FOLDER })), '{{group}}.pdf', undefined, { spreadsheetSafe: true });
  const folders = new Map(rawValues.map((value, index) => [value, folderPlans[index]!.filename.slice(0, -4)]));
  const rowFolders = groupValues.map((value) => folders.get(value)!);
  return {
    groupByColumn: column,
    rows: planFilenames(rows, pattern, context, { folders: rowFolders }).map((plan, index) => {
      const folder = rowFolders[index]!;
      return { ...plan, folder, zipPath: `${folder}/${plan.filename}` };
    }),
    groups: Array.from(groupRows, ([groupValue, rowNumbers]) => ({ groupValue, folder: folders.get(groupValue)!, rowNumbers })),
  };
}

export function isSafeGroupedPdfPath(path: string): boolean {
  const [folder, filename, extra] = path.split('/');
  return extra === undefined && folder !== undefined && filename !== undefined && escapeSpreadsheetCell(folder) === folder
    && isSafePdfFilename(`${folder}.pdf`) && isSafePdfFilename(filename);
}

export function validateGroupingPlan(plan: GroupingPlan, rosterLength: number): void {
  if (!plan.groupByColumn.trim() || plan.rows.length !== rosterLength) throw new Error('invalid-grouping-plan');
  const folders = new Set<string>();
  const values = new Set<string | null>();
  const rowNumbers = new Set<number>();
  const paths = new Set<string>();
  for (const { groupValue, folder, rowNumbers: members } of plan.groups) {
    const folderKey = filenameKey(folder);
    if (!members.length || folders.has(folderKey) || values.has(groupValue)
      || (groupValue === null ? folder !== UNGROUPED_FOLDER : !groupValue.trim() || folderKey === filenameKey(UNGROUPED_FOLDER))) {
      throw new Error('invalid-grouping-plan');
    }
    folders.add(folderKey);
    values.add(groupValue);
    let previous = 0;
    for (const number of members) {
      const row = plan.rows[number - 1];
      if (!Number.isInteger(number) || number <= previous || rowNumbers.has(number) || row?.folder !== folder
        || row.zipPath !== `${folder}/${row.filename}` || !isSafeGroupedPdfPath(row.zipPath) || paths.has(filenameKey(row.zipPath))) {
        throw new Error('invalid-grouping-plan');
      }
      previous = number;
      rowNumbers.add(number);
      paths.add(filenameKey(row.zipPath));
    }
  }
  if (rowNumbers.size !== rosterLength) throw new Error('invalid-grouping-plan');
}
