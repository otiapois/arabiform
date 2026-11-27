import * as engine from '../core/roster';
import type { RosterSheet } from '../core/roster';
import * as virtual from '../core/roster/virtual-columns';
import { errorCode } from './resources';

type ActiveSheet = { sheetName?: string; sheet?: RosterSheet; sheetError?: string };
export type RosterSource = ActiveSheet & {
  name: string;
  bytes: Uint8Array;
  engine: typeof engine;
  virtual: typeof virtual;
  localDate: string;
  workbook?: { sheetNames: readonly string[]; select: (name: string) => ActiveSheet };
  explicitSheet?: boolean;
  remapMissing?: boolean;
};

export async function loadRosterSource(file: File, openedAt: Date): Promise<RosterSource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const source = { name: file.name, bytes, engine, virtual, localDate: virtual.localVirtualDate(openedAt) };
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
