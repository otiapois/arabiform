import * as engine from '../core/roster';
import type { RosterSheet } from '../core/roster';
import type { FieldMetadata } from '../core/pdf';
import type { BatchDraft } from '../core/draft/batch-draft';
import * as virtual from '../core/roster/virtual-columns';
import { planGroupedOutput } from '../core/export/grouping';
import { errorCode } from './resources';

type ActiveSheet = { sheetName?: string; sheet?: RosterSheet; sheetError?: string };
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
  effectiveRows(rows: RosterSheet['rows'], mapping: Record<string, string>, edits: BatchDraft['edits']) {
    const mappedColumns = new Set(Object.values(mapping));
    return rows.map((row, index) => {
      const warnings = row.warnings.filter(({ code, column }) => code !== 'excel-formula-warning' || mappedColumns.has(column));
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
