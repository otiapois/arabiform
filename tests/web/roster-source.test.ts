import { expect, it } from 'vitest';
import type { RosterRow } from '../../src/core/roster';
import type { ConditionalFieldRule } from '../../src/core/rules/conditional-fields';
import { rosterViews } from '../../src/web/roster-source';

it('keeps Excel formula warnings used only by a rule predicate or text token', () => {
  const row: RosterRow = {
    values: { Name: 'Synthetic', Role: 'VIP', Banner: 'ضيف', Other: '' },
    warnings: ['Name', 'Role', 'Banner', 'Other'].map((column, index) => ({
      code: 'excel-formula-warning', column, source: { row: 2, column: 'ABCD'[index]! },
      formulaHasCachedValue: index < 3,
    })),
  };
  const rule: ConditionalFieldRule = { field: 'Name', column: 'Role', operator: 'equals', operand: 'VIP',
    action: { type: 'set-text', value: '{{Banner}}' } };
  const mapped = { Name: 'Name' };
  const [legacy] = rosterViews.effectiveRows([row], mapped, {}, []);
  const [current] = rosterViews.effectiveRows([row], mapped, { 0: { Role: 'Standard' } }, [rule]);
  expect(legacy!.warnings.map(({ column }) => column)).toEqual(['Name']);
  expect(current!.warnings).toEqual(row.warnings.slice(0, 3));
  expect(current!.values.Role).toBe('Standard');
});

it('keeps formula warnings and literal edits on an unmapped schema column', () => {
  const warning: RosterRow['warnings'][number] = {
    code: 'excel-formula-warning', column: 'IBAN', source: { row: 2, column: 'B' }, formulaHasCachedValue: false,
  };
  const row: RosterRow = { values: { Name: 'Synthetic', IBAN: '' }, warnings: [warning] };
  const iban = 'SA31 0000 0000 0000 0001 0001';
  const [effective] = rosterViews.effectiveRows([row], { Name: 'Name' }, { 0: { IBAN: iban } }, [],
    [{ column: 'IBAN', kind: 'iban-mod97' }]);
  expect(effective?.warnings).toEqual([warning]);
  expect(effective?.values.IBAN).toBe(iban);
  expect(row.values.IBAN).toBe('');
});
