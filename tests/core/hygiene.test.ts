import { describe, expect, it } from 'vitest';
import { applyRosterHygiene, previewRosterHygiene } from '../../src/core/roster/hygiene';
import type { RosterSheet } from '../../src/core/roster';

const roster: RosterSheet = {
  name: 'Original sheet',
  headers: ['ID', 'Name', 'Note'],
  rows: Array.from({ length: 7 }, (_, index) => ({
    values: { ID: index ? '00007' : '00123', Name: '  \u200bإِبْرَاهِيم\u00a0  بِ\u200dنْتُ\u200c  آمنة فى أم\uFEFF  ', Note: ' Untouched \n Note ' },
    warnings: [{ column: 'Name', code: 'excel-formula-warning', source: { row: index + 8, column: 'B' }, formulaHasCachedValue: true }],
  })),
};

describe('literal roster transforms', () => {
  it('previews exact changes, caps samples at five and undoes to the complete original sheet', () => {
    const operation = { columns: [1], normalizeSpaces: true, normalizeAlef: true, normalizeTaaMarbuta: true, normalizeAlefMaqsura: true, stripHarakat: true };
    const original = JSON.stringify(roster);
    const preview = previewRosterHygiene(roster, operation);
    expect(preview).toMatchObject({ affectedRows: 7, affectedCells: 7 });
    expect(preview.samples).toEqual(preview.changes.slice(0, 5));
    expect(preview.samples).toHaveLength(5);
    expect(preview.changes[0]).toEqual({
      rowIndex: 0, columnIndex: 1, column: 'Name', before: roster.rows[0]!.values.Name,
      after: 'ابراهيم ب\u200dنت\u200c امنه في ام',
    });
    const result = applyRosterHygiene(roster, operation);
    expect(result.sheet.headers).toBe(roster.headers);
    expect(result.sheet.name).toBe(roster.name);
    expect(result.sheet.rows[0]!.warnings).toBe(roster.rows[0]!.warnings);
    expect(result.sheet.rows[0]!.values).toEqual({ ...roster.rows[0]!.values, Name: preview.changes[0]!.after });
    expect(result.sheet.rows.map(({ values }) => values.ID)).toEqual(['00123', ...Array(6).fill('00007')]);
    expect(result.summary).toEqual({ operation, affectedRows: 7, affectedCells: 7 });
    expect(result.undo).toBe(roster);
    expect(JSON.stringify(result.undo)).toBe(original);
  });

  it('preserves opt-in Arabic spellings, processes space cleanup before replacing and keeps find and replacement literal', () => {
    const one: RosterSheet = { ...roster, rows: [{
      values: { ID: '00123', Name: '   É(x) A.* a.* \u200B', Note: 'آمنة فى أُمّ' }, warnings: [],
    }] };
    const clean = applyRosterHygiene(one, { columns: [1, 2], find: 'a.*', replace: '$&$1', matchCase: false });
    expect(clean.sheet.rows[0]!.values).toEqual({ ID: '00123', Name: 'É(x) $&$1 $&$1', Note: 'آمنة فى أُمّ' });
    expect(clean.summary).toMatchObject({ affectedRows: 1, affectedCells: 1 });
    expect(previewRosterHygiene(one, { columns: [1], normalizeSpaces: false, find: 'A.*', replace: 'z' }).samples[0]?.after).toBe('   É(x) z a.* \u200B');
    expect(previewRosterHygiene(one, { columns: [1], normalizeSpaces: false, find: '', replace: 'no' }).changes).toEqual([]);
    expect(previewRosterHygiene(one, { columns: [2, 1], find: 'a.*', replace: '' }).samples[0]?.after).toBe('É(x) A.* ');
  });
});
