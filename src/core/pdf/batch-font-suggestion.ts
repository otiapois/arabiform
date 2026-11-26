import type { FieldDiagnostic } from './index';

type Diagnostic = Pick<FieldDiagnostic, 'code' | 'requiredFontSizePt'>;

export function safeRowMinSize(issues: readonly Diagnostic[], current: number): number | undefined {
  let size = current;
  for (const { code, requiredFontSizePt: required } of issues) {
    if ((code !== 'too-narrow' && code !== 'too-low') || required === undefined || !(required >= 6 && required < current)) {
      return undefined;
    }
    size = Math.min(size, required);
  }
  return size < current ? size : undefined;
}

export function suggestBatchFontSize(
  rows: readonly { status: 'pass' | 'flagged'; diagnostics: readonly Diagnostic[] }[], current: number,
): { minFontSizePt: number; fixableRows: number } | undefined {
  let minFontSizePt = current;
  let fixableRows = 0;
  for (const row of rows) {
    if (row.status !== 'flagged') continue;
    const required = safeRowMinSize(row.diagnostics, current);
    if (required === undefined) continue;
    minFontSizePt = Math.min(minFontSizePt, required);
    fixableRows++;
  }
  return fixableRows ? { minFontSizePt, fixableRows } : undefined;
}
