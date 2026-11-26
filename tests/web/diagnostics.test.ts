import { expect, it } from 'vitest';
import { diagnosticText, safeRowMinSize } from '../../src/web/Diagnostics';
import { translator } from '../../src/web/labels';

it('uses the lowest safe threshold only when it resolves every failed widget', () => {
  const wide = { field: 'Name', code: 'too-narrow' as const, widgetIndex: 0, requiredFontSizePt: 7.58, pageNumbers: [1] };
  const short = { field: 'Name', code: 'too-low' as const, widgetIndex: 1, requiredFontSizePt: 6.88, pageNumbers: [2] };
  const tooLong = { field: 'ID', code: 'exceeds-maxlen' as const, maxLengthExcess: 6, pageNumbers: [2] };
  expect(safeRowMinSize([wide, short], 8)).toBe(6.88);
  expect(safeRowMinSize([wide, short, tooLong], 8)).toBeUndefined();
  expect(safeRowMinSize([{ ...short, requiredFontSizePt: 5.99 }], 8)).toBeUndefined();
  expect(diagnosticText(wide, 8, translator(false))).toBe('Needs 7.58 pt (min is 8 pt)');
  expect(diagnosticText(tooLong, 8, translator(false))).toBe('Exceeds MaxLen by 6 chars');
});
