import { fillLabel, type translator } from './labels';
import type { RowResult } from './useWorkbench';

type Diagnostic = RowResult['diagnostics'][number];
type Language = ReturnType<typeof translator>;

export function diagnosticText(issue: Diagnostic, minSize: number, { labels, problem }: Language) {
  if (issue.requiredFontSizePt !== undefined) {
    return fillLabel(labels.needsSize, { size: issue.requiredFontSizePt, min: minSize });
  }
  if (issue.maxLengthExcess !== undefined) {
    return fillLabel(issue.maxLengthExcess === 1 ? labels.exceedsOneChar : labels.exceedsChars, { count: issue.maxLengthExcess });
  }
  return problem(issue.code) ?? labels.pdfError;
}

export function safeRowMinSize(issues: readonly Diagnostic[], minSize: number) {
  if (!issues.length) return;
  let size = minSize;
  for (const { requiredFontSizePt } of issues) {
    if (requiredFontSizePt === undefined || requiredFontSizePt < 6 || requiredFontSizePt >= minSize) return;
    size = Math.min(size, requiredFontSizePt);
  }
  if (size < minSize) return size;
}

export function Diagnostics({ issues, minSize, language, testId }: {
  issues: readonly Diagnostic[];
  minSize: number;
  language: Language;
  testId: string;
}) {
  return (
    <ul className="diagnostics" aria-label={language.labels.diagnostics} data-testid={testId}>
      {issues.map((issue, index) => (
        <li key={index}><bdi dir="auto">{issue.field}</bdi>{' · '}{diagnosticText(issue, minSize, language)}</li>
      ))}
    </ul>
  );
}
