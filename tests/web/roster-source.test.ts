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
