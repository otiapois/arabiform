import type { RosterSchemaDiagnostic } from '../core/validation/roster-schema';
import { ChoiceList } from './Choices';
import { activeFillLabels } from './active-fill-labels';
import { fillLabel, type translator } from './labels';
import { sourceProblem } from './source-problems';
import { schemaLabels } from './schema-labels';
import type { RowResult } from './useWorkbench';

type Diagnostic = RowResult['diagnostics'][number];
type Language = ReturnType<typeof translator>;

const en = {
  diagnostics: 'PDF field diagnostics',
  needsSize: 'Needs {size} pt (min is {min} pt)',
  exceedsOneChar: 'Exceeds MaxLen by {count} char',
  exceedsChars: 'Exceeds MaxLen by {count} chars',
  rule: 'Rule {index}',
};

const ar: typeof en = {
  diagnostics: 'نتائج فحص حقول PDF',
  needsSize: 'يلزم حجم {size} نقطة (الحد الأدنى الحالي {min} نقطة)',
  exceedsOneChar: 'يتجاوز الحد الأقصى للحقل (MaxLen) بحرف واحد',
  exceedsChars: 'عدد الأحرف الزائدة على الحد الأقصى للحقل (MaxLen) هو {count}',
  rule: 'القاعدة {index}',
};

const problems: Record<string, readonly [string, string]> = {
  'too-narrow': ['Text exceeds the field width at the minimum font size.', 'يتجاوز النص عرض الحقل عند الحد الأدنى لحجم الخط.'],
  'too-low': ['Text exceeds the field height at the minimum font size.', 'يتجاوز النص ارتفاع الحقل عند الحد الأدنى لحجم الخط.'],
  'exceeds-maxlen': ['Text exceeds the character limit set by the PDF.', 'يتجاوز النص الحد الأقصى لعدد الأحرف في ملف PDF.'],
  'unsupported-glyph': ['The selected font cannot render all characters in this value.', 'يتعذّر على الخط المحدد عرض جميع أحرف هذه القيمة.'],
  'missing-glyphs': ['The custom font is missing glyphs for this value.', 'يفتقد الخط المخصص بعض أحرف هذه القيمة.'],
  'invalid-checkbox-value': ['Enter true or false, yes or no, 1 or 0, x or blank, or نعم or لا for this checkbox.', 'أدخل نعم أو لا، أو true أو false، أو yes أو no، أو 1 أو 0، أو x، أو اترك الخلية فارغة.'],
  'invalid-choice': ['Choose a value allowed by this PDF field.', 'اختر قيمة من الخيارات التي يسمح بها حقل PDF.'],
  'invalid-conditional-rule': ['Review the target, roster column and values in Conditional rules.', 'راجع الحقل والعمود والقيم في قواعد التعبئة الشرطية.'],
  'unsupported-checkbox-appearance': ['This checkbox lacks a usable checked or unchecked appearance.', 'يفتقر مربع الاختيار إلى مظهر صالح لإحدى الحالتين: محدد أو غير محدد.'],
  'unsupported-radio-appearance': ['These radio buttons lack usable appearances for their options.', 'تفتقر أزرار الاختيار هذه إلى مظهر صالح لخياراتها.'],
  'unsupported-bidi': ['This value contains an unsupported direction or joining control. Review the source text.', 'تتضمن القيمة علامة غير مدعومة للتحكم في اتجاه الكتابة أو اتصال الحروف. راجع النص الأصلي.'],
  'widget-rotated-unsupported': ['This field uses a rotation the PDF engine cannot fill.', 'يستخدم هذا الحقل زاوية دوران يتعذّر على محرّك PDF تعبئتها.'],
  'missing-required': ['Enter a value for this required field.', 'أدخل قيمة لهذا الحقل الإلزامي.'],
  'unknown-field': ['This field was not found in the PDF.', 'لم يُعثر على هذا الحقل في ملف PDF.'],
  'no-widget': ['This field has no visible fillable area.', 'لا توجد مساحة مرئية لتعبئة هذا الحقل.'],
  'unsupported-field-mode': ['This field uses a mode the PDF engine cannot fill.', 'يستخدم الحقل وضعًا يتعذّر على محرّك PDF تعبئته.'],
  'unsupported-line-break': ['This field requires a single line of text.', 'يتطلب هذا الحقل سطرًا واحدًا من النص.'],
  'unsupported-widget': ['The PDF engine cannot fill this field area.', 'يتعذّر على محرّك PDF تعبئة هذه المساحة من الحقل.'],
  'readonly-field': ['This field is read-only.', 'هذا الحقل للقراءة فقط.'],
  'excel-scientific-notation-warning': ['Excel uses scientific notation here. Verify the full original value.', 'يعرض Excel القيمة بالصيغة العلمية. تحقّق من القيمة الأصلية كاملة.'],
  'excel-numeric-identifier-warning': ['Excel stored this identifier as a number. Leading zeros may already be missing.', 'خزّن Excel هذا المعرّف كرقم. ربما فُقدت الأصفار من بدايته.'],
  'excel-formula-warning': ['This value comes from an Excel formula. Verify the stored result.', 'هذه القيمة ناتجة عن معادلة في Excel. تحقّق من النتيجة المحفوظة.'],
  'excel-cell-error-warning': ['Excel stored an error in this cell. Replace it with the verified original value.', 'سجّل Excel خطأ في هذه الخلية. استبدله بالقيمة الأصلية بعد التحقّق منها.'],
  'excel-number-format-warning': ['Excel uses a number format that cannot be reproduced. Check the raw value against the workbook.', 'يستخدم Excel تنسيق أرقام يتعذّر استعادته. قارن القيمة الخام بما يظهر في المصنف.'],
};

export function diagnosticProblem(code: string, { arabic }: Pick<Language, 'arabic'>) {
  return problems[code]?.[arabic ? 1 : 0] ?? sourceProblem(code, arabic);
}

export function diagnosticText(issue: Diagnostic, minSize: number, language: Language) {
  const copy = language.arabic ? ar : en;
  if (issue.requiredFontSizePt !== undefined) {
    return fillLabel(copy.needsSize, { size: issue.requiredFontSizePt, min: minSize });
  }
  if (issue.maxLengthExcess !== undefined) {
    return fillLabel(issue.maxLengthExcess === 1 ? copy.exceedsOneChar : copy.exceedsChars, { count: issue.maxLengthExcess });
  }
  return diagnosticProblem(issue.code, language) ?? activeFillLabels(language.arabic).pdfError;
}

export { safeRowMinSize } from '../core/pdf/batch-font-suggestion';

export function SchemaIssue({ issue, arabic }: { issue: RosterSchemaDiagnostic; arabic: boolean }) {
  const locale = arabic ? 'ar' : 'en';
  return <><bdi dir="auto">{issue.column}</bdi>{' · '}<bdi dir="auto">{schemaLabels[locale][issue.rule]}</bdi>{' · '}{issue.reason[locale]}</>;
}

export function Diagnostics({ issues, schemaIssues, minSize, language, testId }: {
  issues: readonly Diagnostic[];
  schemaIssues?: readonly RosterSchemaDiagnostic[];
  minSize: number;
  language: Language;
  testId: string;
}) {
  const labels = activeFillLabels(language.arabic);
  return (
    <ul className="diagnostics" data-testid={testId} aria-label={schemaIssues?.length
      ? language.arabic ? 'نتائج فحص الصف' : 'Row diagnostics'
      : (language.arabic ? ar : en).diagnostics}>
      {schemaIssues?.map((issue, index) => (
        <li key={'schema-' + index} data-testid="schema-issue" data-reason={issue.reasonCode}>
          <SchemaIssue issue={issue} arabic={language.arabic} />
        </li>
      ))}
      {issues.map((issue, index) => (
        <li key={index}>
          {issue.ruleIndex !== undefined && <>{fillLabel((language.arabic ? ar : en).rule, { index: issue.ruleIndex })}{' · '}</>}
          {issue.field && <><bdi dir="auto">{issue.field}</bdi>{' · '}</>}{diagnosticText(issue, minSize, language)}
          {issue.choices?.length
            ? <ChoiceList choices={issue.choices} label={labels.allowedChoices} blank={labels.blankChoice} />
            : null}
        </li>
      ))}
    </ul>
  );
}
