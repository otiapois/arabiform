import type { RosterSheet } from './index';

export interface HygieneOperation {
  columns: number[];
  normalizeSpaces?: boolean;
  normalizeAlef?: boolean;
  normalizeTaaMarbuta?: boolean;
  normalizeAlefMaqsura?: boolean;
  stripHarakat?: boolean;
  find?: string;
  replace?: string;
  matchCase?: boolean;
}

export interface HygieneChange {
  rowIndex: number;
  columnIndex: number;
  column: string;
  before: string;
  after: string;
}

export interface HygieneSummary {
  operation: HygieneOperation;
  affectedRows: number;
  affectedCells: number;
}

export interface HygienePreview extends Omit<HygieneSummary, 'operation'> {
  samples: HygieneChange[];
  changes: HygieneChange[];
}

export function previewRosterHygiene(sheet: RosterSheet, operation: HygieneOperation): HygienePreview {
  const columns = [...new Set(operation.columns)].sort((first, second) => first - second);
  if (columns.some((index) => !Number.isInteger(index) || index < 0 || index >= sheet.headers.length)) {
    throw new Error('invalid-hygiene-column');
  }
  const { find, replace = '' } = operation;
  // Escape every metacharacter. The compiled expression contains only a literal Unicode
  // sequence, so it provides case-insensitive matching without user-controlled operators.
  const insensitive = find && operation.matchCase === false
    ? new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu') : undefined;
  let affectedRows = 0;
  const changes: HygieneChange[] = [];
  for (const [rowIndex, { values }] of sheet.rows.entries()) {
    const previousCount = changes.length;
    for (const columnIndex of columns) {
      const column = sheet.headers[columnIndex]!;
      const before = values[column]!;
      let after = before;
      if (operation.normalizeSpaces !== false) after = after.replace(/[\u200B\uFEFF]/g, '').replace(/\s+/gu, ' ').trim();
      if (operation.normalizeAlef) after = after.replace(/[أإآ]/g, 'ا');
      if (operation.normalizeTaaMarbuta) after = after.replaceAll('ة', 'ه');
      if (operation.normalizeAlefMaqsura) after = after.replaceAll('ى', 'ي');
      if (operation.stripHarakat) after = after.replace(/[\u064B-\u065F\u0670]/g, '');
      if (find) after = after.replaceAll(insensitive ?? find, () => replace);
      if (before !== after) changes.push({ rowIndex, columnIndex, column, before, after });
    }
    if (changes.length !== previousCount) affectedRows++;
  }
  return { affectedRows, affectedCells: changes.length, samples: changes.slice(0, 5), changes };
}

export function applyRosterHygiene(sheet: RosterSheet, operation: HygieneOperation) {
  const { affectedRows, affectedCells, changes } = previewRosterHygiene(sheet, operation);
  const rows = sheet.rows.slice();
  for (const { rowIndex, column, after } of changes) {
    const original = sheet.rows[rowIndex]!;
    if (rows[rowIndex] === original) rows[rowIndex] = { ...original, values: { ...original.values } };
    rows[rowIndex]!.values[column] = after;
  }
  const summary: HygieneSummary = { operation: { ...operation, columns: [...operation.columns] }, affectedRows, affectedCells };
  return { sheet: changes.length ? { ...sheet, rows } : sheet, undo: sheet, summary };
}
