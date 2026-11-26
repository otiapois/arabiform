import { ChoiceList } from './Choices';
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

export { safeRowMinSize } from '../core/pdf/batch-font-suggestion';

export function Diagnostics({ issues, minSize, language, testId }: {
  issues: readonly Diagnostic[];
  minSize: number;
  language: Language;
  testId: string;
}) {
  const { labels } = language;
  return (
    <ul className="diagnostics" aria-label={labels.diagnostics} data-testid={testId}>
      {issues.map((issue, index) => (
        <li key={index}>
          <bdi dir="auto">{issue.field}</bdi>{' · '}{diagnosticText(issue, minSize, language)}
          {issue.choices?.length
            ? <ChoiceList choices={issue.choices} label={labels.allowedChoices} blank={labels.blankChoice} />
            : null}
        </li>
      ))}
    </ul>
  );
}
