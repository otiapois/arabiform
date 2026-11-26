import type { AlignOverride } from '../core/pdf/alignment';
import { ChoiceList } from './Choices';
import type { translator } from './labels';
import type { useWorkbench } from './useWorkbench';

const en = {
  mappingHelp: 'Match each PDF field to a spreadsheet column. An unmapped field keeps its original content.',
  pdfField: 'PDF field',
  rosterColumn: 'Roster column',
  unmapped: 'Leave unchanged',
  align: 'Align',
  alignAuto: 'Auto',
  alignRtl: 'Right (RTL)',
  alignLtr: 'Left (LTR)',
  alignCenter: 'Center',
  preserved: 'Preserved untouched',
};

const ar: typeof en = {
  mappingHelp: 'اربط كل حقل في PDF بعمود من الجدول. يحتفظ الحقل غير المرتبط بمحتواه الأصلي.',
  pdfField: 'حقل PDF',
  rosterColumn: 'عمود الجدول',
  unmapped: 'أبقِ المحتوى الأصلي',
  align: 'المحاذاة',
  alignAuto: 'تلقائية',
  alignRtl: 'يمين (RTL)',
  alignLtr: 'يسار (LTR)',
  alignCenter: 'وسط',
  preserved: 'يبقى دون تغيير',
};

export default function MappingRows({ desk, language }: {
  desk: ReturnType<typeof useWorkbench>;
  language: ReturnType<typeof translator>;
}) {
  const { arabic, labels } = language;
  const copy = arabic ? ar : en;
  const fieldKinds = { text: labels.kindText, checkbox: labels.kindCheckbox, radio: labels.kindRadio, dropdown: labels.kindDropdown };
  return (
    <>
      <p className="quiet mapping-help">{copy.mappingHelp}</p>
      <div className="mapping-labels" aria-hidden="true">
        <span>{copy.pdfField}</span><span>{copy.rosterColumn}</span>
      </div>
      <div className="mapping-rows">
        {desk.templateFields.map((field) => (
          <div key={field.name} className="mapping-row">
            <div className="mapping-field">
              <bdi title={field.name}>{field.name}</bdi>
              <span className="tag tag-pending">{fieldKinds[field.kind]}</span>
              {field.choices?.length ? (
                <details className="choice-options">
                  <summary>{labels.allowedChoices}</summary>
                  <ChoiceList choices={field.choices} label={labels.allowedChoices} blank={labels.blankChoice} />
                </details>
              ) : null}
            </div>
            {Object.hasOwn(desk.mapping, field.name) ? (
              <div className="mapping-target">
                <select dir="auto" aria-label={field.name} data-pdf-field={field.name} value={desk.mapping[field.name]}
                  onChange={(event) => desk.changeMapping(field.name, event.currentTarget.value)}>
                  <option value="">{copy.unmapped}</option>
                  {desk.sheet?.headers.map((column) => <option key={column} value={column}>{column}</option>)}
                </select>
                {field.kind === 'text' && desk.mapping[field.name] && (
                  <label className="align-control">
                    {copy.align}
                    <select aria-label={`${copy.align} ${field.name}`} data-align-field={field.name}
                      value={Object.hasOwn(desk.alignOverrides, field.name) ? desk.alignOverrides[field.name] : 'auto'}
                      onChange={(event) => desk.changeAlignment(field.name, event.currentTarget.value as AlignOverride)}>
                      <option value="auto">{copy.alignAuto}</option>
                      <option value="rtl">{copy.alignRtl}</option>
                      <option value="ltr">{copy.alignLtr}</option>
                      <option value="center">{copy.alignCenter}</option>
                    </select>
                  </label>
                )}
                {field.choices && !desk.mapping[field.name] && <small className="quiet">{copy.preserved}</small>}
              </div>
            ) : <span className="quiet">{copy.preserved}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
