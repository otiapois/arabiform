import * as engine from '../core/roster';
import type { RosterSheet } from '../core/roster';
import type { FieldMetadata } from '../core/pdf';
import type { BatchDraft } from '../core/draft/batch-draft';
import type { HygieneOperation, HygienePreview } from '../core/roster/hygiene';
import * as virtual from '../core/roster/virtual-columns';
import { planGroupedOutput } from '../core/export/grouping';
import { conditionalRuleColumns, type ConditionalFieldRule } from '../core/rules/conditional-fields';
import type { RosterSchemaRule } from '../core/validation/roster-schema';
import { errorCode } from './resources';

type ActiveSheet = { sheetName?: string; sheet?: RosterSheet; sheetError?: string };
type Cells = Pick<BatchDraft, 'edits' | 'hygiene'>;
export type CellState = Cells & { undo?: Cells; undoExpired?: boolean; revision: number };

export type RosterSource = ActiveSheet & {
  name: string;
  bytes: Uint8Array;
  engine: typeof engine;
  virtual: typeof virtual;
  views: typeof rosterViews;
  localDate: string;
  workbook?: { sheetNames: readonly string[]; select: (name: string) => ActiveSheet };
  explicitSheet?: boolean;
  remapMissing?: boolean;
};

export const rosterViews = {
  planGroupedOutput,
  editCell(current: CellState, row: number, column: string, value: string): CellState {
    return {
      ...current, undo: undefined, undoExpired: current.undoExpired || Boolean(current.undo),
      edits: { ...current.edits, [row]: { ...current.edits[row], [column]: value } },
    };
  },
  restoreRowEdit(current: CellState, row: number, original: Record<string, string> | undefined): CellState {
    const edits = { ...current.edits };
    if (original) edits[row] = original;
    else delete edits[row];
    return { ...current, edits, undo: undefined, undoExpired: current.undoExpired || Boolean(current.undo) };
  },
  applyHygiene(current: CellState, operation: HygieneOperation, preview: HygienePreview): CellState {
    const edits = { ...current.edits };
    for (const { rowIndex, column, after } of preview.changes) {
      if (edits[rowIndex] === current.edits[rowIndex]) edits[rowIndex] = { ...current.edits[rowIndex] };
      Object.defineProperty(edits[rowIndex], column, { value: after, enumerable: true, writable: true, configurable: true });
    }
    const { affectedRows, affectedCells } = preview;
    return {
      edits, hygiene: [...current.hygiene, { operation, affectedRows, affectedCells }],
      undo: { edits: current.edits, hygiene: current.hygiene }, revision: current.revision + 1,
    };
  },
  fieldMapping(fields: readonly FieldMetadata[], headers: readonly string[], values: Record<string, string>,
    bindings: Record<string, virtual.VirtualColumnMapping>, fromPreset: boolean, remapMissing = false) {
    const auto = !fromPreset || remapMissing
      ? engine.autoMap(fields.filter(({ kind }) => kind === 'text' || kind === 'checkbox').map(({ name }) => name), headers)
      : undefined;
    return Object.fromEntries(fields.map(({ name }) => {
      const configured = Object.hasOwn(values, name) ? values[name] : undefined;
      const column = configured === undefined || (remapMissing && configured && !headers.includes(configured))
        ? auto?.[name] : configured;
      return [name, column && !Object.hasOwn(bindings, name) && headers.includes(column) ? column : ''];
    }));
  },
  effectiveRows(rows: RosterSheet['rows'], mapping: Record<string, string>, edits: BatchDraft['edits'], rules: readonly ConditionalFieldRule[],
    schemaRules: readonly RosterSchemaRule[] = []) {
    const usedColumns = new Set([...Object.values(mapping), ...rules.flatMap(conditionalRuleColumns), ...schemaRules.map(({ column }) => column)]);
    return rows.map((row, index) => {
      const warnings = row.warnings.filter(({ code, column }) => code !== 'excel-formula-warning' || usedColumns.has(column));
      const edit = edits[index];
      return edit || warnings.length !== row.warnings.length
        ? { ...row, values: edit ? { ...row.values, ...edit } : row.values, warnings }
        : row;
    });
  },
};

export async function loadRosterSource(file: File, openedAt: Date): Promise<RosterSource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const source = { name: file.name, bytes, engine, virtual, views: rosterViews, localDate: virtual.localVirtualDate(openedAt) };
  if (!/\.xlsx$/i.test(file.name)) {
    const { sheets } = await engine.readRoster(bytes, file.name);
    return { ...source, sheet: sheets[0] };
  }

  const workbook = engine.inspectRosterWorkbook(bytes);
  const { sheetNames } = workbook;
  const first = sheetNames[0]!;
  if (sheetNames.length === 1) return { ...source, sheetName: first, sheet: workbook.readSheet(first) };

  function select(sheetName: string): ActiveSheet {
    try {
      return { sheetName, sheet: workbook.readSheet(sheetName), sheetError: undefined };
    } catch (error) {
      return { sheetName, sheet: undefined, sheetError: errorCode(error, 'invalid-xlsx') };
    }
  }

  return { ...source, workbook: { sheetNames, select }, ...select(first) };
}
