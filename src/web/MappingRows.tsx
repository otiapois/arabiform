import { useEffect, useRef } from 'react';
import type { AlignOverride } from '../core/pdf/alignment';
import { VIRTUAL_COLUMNS, validateVirtualTemplate, virtualFilenameToken } from '../core/roster/virtual-columns';
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
  presetInvalid: 'This file is not a valid ArabiForm mapping preset. Your settings are unchanged.',
  presetMismatch: 'Check this preset against your current files. Missing mappings are skipped.',
  missingFields: 'Missing or read-only PDF fields',
  missingColumns: 'Missing roster columns',
  virtualGroup: 'Virtual columns (computed locally)',
  virtualTemplate: 'Text around the value (optional)',
  virtualTemplateHelp: 'Leave blank for the value alone. Include {token} once to add text around it.',
  virtualTemplateError: 'Use {token} exactly once and remove any other tokens.',
  virtualFilename: 'Use these codes to add locally computed values to filenames.',
  virtualLabels: {
    ROW_INDEX: 'Row number (1, 2, 3…)',
    PADDED_ROW_001: 'Padded serial (0001, 0002…)',
    TODAY_ISO: 'Local date (YYYY-MM-DD)',
    TODAY_AR: 'Arabic date (٢٠٢٦-٠١-٠٩)',
  },
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
  presetInvalid: 'تعذّر قراءة إعدادات الربط من هذا الملف. بقيت إعداداتك كما هي.',
  presetMismatch: 'راجع توافق الإعدادات مع ملفاتك الحالية. تُتخطّى الروابط غير المتاحة.',
  missingFields: 'حقول PDF مفقودة أو للقراءة فقط',
  missingColumns: 'أعمدة مفقودة في الجدول',
  virtualGroup: 'أعمدة افتراضية (تُحسب محليًا)',
  virtualTemplate: 'نص حول القيمة (اختياري)',
  virtualTemplateHelp: 'اتركه فارغًا لإدراج القيمة وحدها. أضف {token} مرة واحدة لإحاطة القيمة بنص.',
  virtualTemplateError: 'استخدم {token} مرة واحدة فقط واحذف أي رموز أخرى.',
  virtualFilename: 'استخدم هذه الرموز لإضافة القيم المحسوبة محليًا إلى أسماء الملفات.',
  virtualLabels: {
    ROW_INDEX: 'رقم الصف (1، 2، 3…)',
    PADDED_ROW_001: 'رقم تسلسلي (0001، 0002…)',
    TODAY_ISO: 'التاريخ المحلي (YYYY-MM-DD)',
    TODAY_AR: 'التاريخ بالأرقام العربية (٢٠٢٦-٠١-٠٩)',
  },
};

export function VirtualFilenameTokens({ arabic }: { arabic: boolean }) {
  const copy = arabic ? ar : en;
  return (
    <div className="virtual-filename">
      <small>{copy.virtualFilename}</small>
      <ul>
        {VIRTUAL_COLUMNS.map((id) => <li key={id}><code dir="ltr" data-virtual-filename-token={id}>{virtualFilenameToken(id)}</code></li>)}
      </ul>
    </div>
  );
}

export function PresetFeedback({ invalid, warnings, arabic }: {
  invalid: boolean;
  warnings: ReturnType<typeof useWorkbench>['presetWarnings'];
  arabic: boolean;
}) {
  const labels = arabic ? ar : en;
  const mismatches = warnings
    ? [[labels.missingFields, warnings.missingFields], [labels.missingColumns, warnings.missingColumns]] as const : [];
  return (
    <>
      {invalid && <p className="alert" role="alert" data-testid="preset-error">{labels.presetInvalid}</p>}
      {mismatches.some(([, names]) => names.length > 0) && (
        <div className="alert warning preset-warning" role="status" data-testid="preset-warning">
          <p>{labels.presetMismatch}</p>
          {mismatches.map(([label, names]) => names.length > 0 && (
            <p key={label}>{label}{' · '}
              {names.map((name, index) => <span key={name}>{index > 0 ? ', ' : ''}<bdi dir="auto">{name}</bdi></span>)}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

export default function MappingRows({ desk, language }: {
  desk: ReturnType<typeof useWorkbench>;
  language: ReturnType<typeof translator>;
}) {
  const { arabic, labels } = language;
  const fieldLabels = activeFillLabels(arabic);
  const copy = arabic ? ar : en;
  const rows = useRef<HTMLDivElement>(null);
  const focusingFromCanvas = useRef(false);
  const selection = desk.fieldSelection;
  const headers = desk.sheet?.headers;
  let virtualPrefix = '@';
  while (headers?.some((header) => VIRTUAL_COLUMNS.some((id) => header === virtualPrefix + id))) virtualPrefix += '@';
  const virtualOptions = new Map(VIRTUAL_COLUMNS.map((id) => [virtualPrefix + id, id]));

  useEffect(() => {
    if (selection?.widgetIndex === undefined || !rows.current) return;
    const row = Array.from(rows.current.querySelectorAll<HTMLElement>('[data-mapping-field]'))
      .find((element) => element.dataset.mappingField === selection.fieldName);
    const target = row?.querySelector<HTMLSelectElement>('select[data-pdf-field]') ?? row;
    if (!target) return;
    focusingFromCanvas.current = true;
    row?.scrollIntoView({ block: 'center', inline: 'nearest' });
    target.focus({ preventScroll: true });
    focusingFromCanvas.current = false;
  }, [selection]);

  function focusField(fieldName: string) {
    const widgets = desk.template?.overlays.filter((widget) => widget.fieldName === fieldName) ?? [];
    const page = widgets.some(({ pageNumber }) => pageNumber === desk.previewPage) ? undefined : widgets[0]?.pageNumber;
    desk.focusMappingField(fieldName, page);
  }

  const fieldKinds = { text: fieldLabels.kindText, checkbox: fieldLabels.kindCheckbox, radio: fieldLabels.kindRadio, dropdown: fieldLabels.kindDropdown };
  return (
    <>
      <p className="quiet mapping-help">{copy.mappingHelp}</p>
      <div className="mapping-labels" aria-hidden="true">
        <span>{copy.pdfField}</span><span>{copy.rosterColumn}</span>
      </div>
      <div className="mapping-rows" ref={rows}>
        {desk.templateFields.map((field, index) => {
          const editable = Object.hasOwn(desk.mapping, field.name);
          const binding = Object.hasOwn(desk.virtualMappings, field.name) ? desk.virtualMappings[field.name] : undefined;
          const pattern = binding?.template ?? '';
          const invalid = Boolean(binding && pattern && !validateVirtualTemplate(binding.column, pattern));
          const token = binding ? `{{${binding.column}}}` : '';
          const hintId = `virtual-template-hint-${index}`;
          const hint = (invalid ? copy.virtualTemplateError : copy.virtualTemplateHelp).split('{token}');
          function choose(value: string) {
            const column = field.kind === 'text' ? virtualOptions.get(value) : undefined;
            if (column) desk.changeVirtualMapping(field.name, { column });
            else desk.changeMapping(field.name, value);
          }
          return (
            <div key={field.name} className="mapping-row" data-mapping-field={field.name}
              data-active={selection?.fieldName === field.name ? 'true' : undefined}
              tabIndex={editable ? undefined : 0} role={editable ? undefined : 'group'} aria-label={editable ? undefined : field.name}
              onFocus={() => { if (!focusingFromCanvas.current) focusField(field.name); }}>
              <div className="mapping-field">
                <bdi title={field.name} onClick={() => focusField(field.name)}>{field.name}</bdi>
                <span className="tag tag-pending">{fieldKinds[field.kind]}</span>
                {field.choices?.length ? (
                  <details className="choice-options">
                    <summary>{fieldLabels.allowedChoices}</summary>
                    <ChoiceList choices={field.choices} label={fieldLabels.allowedChoices} blank={fieldLabels.blankChoice} />
                  </details>
                ) : null}
              </div>
              {editable ? (
                <div className="mapping-target">
                  <select dir="auto" aria-label={field.name} data-pdf-field={field.name}
                    value={binding ? virtualPrefix + binding.column : desk.mapping[field.name]}
                    onChange={(event) => choose(event.currentTarget.value)}>
                    <option value="">{copy.unmapped}</option>
                    {headers?.map((column) => <option key={column} value={column}>{column}</option>)}
                    {field.kind === 'text' && <optgroup label={copy.virtualGroup}>
                      {Array.from(virtualOptions, ([value, id]) => (
                        <option key={id} value={value} data-virtual-column={id}>{copy.virtualLabels[id]}</option>
                      ))}
                    </optgroup>}
                  </select>
                  {binding && (
                    <label className="virtual-template">
                      <span>{copy.virtualTemplate}</span>
                      <input type="text" dir="auto" value={pattern} placeholder={`CERT-${token}`}
                        data-virtual-template-field={field.name} aria-label={`${copy.virtualTemplate} ${field.name}`}
                        aria-invalid={invalid || undefined} aria-describedby={hintId}
                        onChange={(event) => {
                          const template = event.currentTarget.value;
                          desk.changeVirtualMapping(field.name, template ? { column: binding.column, template } : { column: binding.column });
                        }} />
                      <small id={hintId} role={invalid ? 'alert' : undefined} className={invalid ? 'virtual-template-error' : undefined}>
                        {hint[0]}<code dir="ltr">{token}</code>{hint[1]}
                      </small>
                    </label>
                  )}
                  {field.kind === 'text' && (binding || desk.mapping[field.name]) && (
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
          );
        })}
      </div>
    </>
  );
}
import { activeFillLabels } from './active-fill-labels';
