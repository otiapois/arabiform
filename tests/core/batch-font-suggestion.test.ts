import { expect, it } from 'vitest';
import { suggestBatchFontSize } from '../../src/core/pdf/batch-font-suggestion';
import type { DiagnosticCode } from '../../src/core/pdf';

const issue = (code: DiagnosticCode, requiredFontSizePt?: number) => ({ code, requiredFontSizePt });
const flagged = (...diagnostics: ReturnType<typeof issue>[]) => ({ status: 'flagged' as const, diagnostics });

it('counts eligible rows only and uses the highest floor that fixes all of them', () => {
  const narrow = flagged(issue('too-narrow', 7.58));
  const rows = [
    narrow,
    flagged(issue('too-narrow', 7.4), issue('too-low', 6.88)),
    flagged(issue('too-narrow', 6.5), issue('exceeds-maxlen')),
    flagged(issue('too-narrow', 5.99)),
    flagged(issue('invalid-choice')),
  ];
  expect(suggestBatchFontSize(rows, 8)).toEqual({ minFontSizePt: 6.88, fixableRows: 2 });
  expect(suggestBatchFontSize([narrow], 8)).toEqual({ minFontSizePt: 7.58, fixableRows: 1 });
});

it('includes the 6 pt boundary and excludes ready or unsolved rows', () => {
  const rows = [
    { status: 'pass' as const, diagnostics: [] },
    flagged(issue('too-narrow', 6)),
    flagged(issue('too-narrow', 5.99)),
    flagged(issue('too-low')),
    flagged(),
  ];
  expect(suggestBatchFontSize(rows, 8)).toEqual({ minFontSizePt: 6, fixableRows: 1 });
  expect(suggestBatchFontSize(rows, 6)).toBeUndefined();
});
