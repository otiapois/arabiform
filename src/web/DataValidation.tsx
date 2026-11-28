import { useId, useState } from 'react';
import { readRosterSchemaRules, type RosterSchemaRule } from '../core/validation/roster-schema';
import { schemaLabels } from './schema-labels';
import type { useWorkbench } from './useWorkbench';
import './conditional-rules.css';

const en = {
  help: 'Apply rules to any roster column. Rows that fail an active rule stay out of PDF exports.',
  wait: 'Choose a roster to add rules.',
  replace: 'The demo replaces the current files and settings.',
  add: 'Add validation rule',
  edit: 'Edit rule',
  remove: 'Remove rule',
  column: 'Roster column',
  kind: 'Validation rule',
  digits: 'Number of digits (1–32)',
  values: 'Allowed values',
  valuesHelp: 'Enter one value per line. An empty line allows a blank value.',
  trimmed: 'Ignore leading and trailing whitespace',
  apply: 'Apply rule',
  cancel: 'Cancel',
  missing: 'This column is missing from the current roster. Edit the rule to choose a current column, or remove the rule.',
  invalid: 'Choose a current column and enter valid rule settings.',
};

const ar: typeof en = {
  help: 'طبّق القواعد على أي عمود في الجدول. يُستبعد من تصدير ملفات PDF كل صف لا يجتاز قاعدة مفعّلة.',
  wait: 'اختر جدول بيانات لإضافة قواعد.',
  replace: 'يستبدل المثال الملفات والإعدادات الحالية.',
  add: 'أضف قاعدة تحقق',
  edit: 'عدّل القاعدة',
  remove: 'احذف القاعدة',
  column: 'عمود الجدول',
  kind: 'قاعدة التحقق',
  digits: 'عدد الأرقام (1–32)',
  values: 'القيم المسموح بها',
  valuesHelp: 'أدخل قيمة واحدة في كل سطر. يسمح السطر الفارغ بقيمة فارغة.',
  trimmed: 'تجاهل المسافات في بداية القيمة ونهايتها',
  apply: 'طبّق القاعدة',
  cancel: 'إلغاء',
  missing: 'هذا العمود غير موجود في الجدول الحالي. عدّل القاعدة لاختيار عمود موجود أو احذفها.',
  invalid: 'اختر عمودًا موجودًا وأدخل إعدادات صالحة للقاعدة.',
};

type Editor = {
  source: RosterSchemaRule[];
  index?: number;
  column: string;
  kind: RosterSchemaRule['kind'];
  digits: string;
  values: string[];
  match?: 'exact' | 'trimmed';
  invalid?: boolean;
};

const kinds = Object.keys(schemaLabels.en) as RosterSchemaRule['kind'][];

export default function DataValidation({ desk, arabic }: { desk: ReturnType<typeof useWorkbench>; arabic: boolean }) {
  const copy = arabic ? ar : en;
  const names = schemaLabels[arabic ? 'ar' : 'en'];
  const rules = desk.schemaRules;
  const columns = desk.sheet?.headers ?? [];
  const disabled = desk.exporting || desk.busy.pdf || desk.busy.roster;
  const id = useId();
  const [editing, setEditing] = useState<Editor>();
  const editor = editing?.source === rules ? editing : undefined;

  function focus(suffix: string) {
    requestAnimationFrame(() => document.getElementById(id + suffix)?.focus());
  }

  function open(index?: number) {
    const rule = index === undefined ? undefined : rules[index];
    setEditing({
      source: rules, index, column: rule?.column ?? columns[0]!, kind: rule?.kind ?? 'required',
      digits: rule?.kind === 'exact-digits' ? String(rule.digits) : '10',
      values: rule?.kind === 'allowed-values' ? rule.values : [''],
      match: rule?.kind === 'allowed-values' ? rule.match : undefined,
    });
    focus('-column');
  }

  function close(index?: number) {
    setEditing(undefined);
    focus(index === undefined ? '-add' : `-edit-${index}`);
  }

  function apply(draft: Editor) {
    const { index, column, kind } = draft;
    const updated: RosterSchemaRule = kind === 'exact-digits' ? { column, kind, digits: Number(draft.digits) }
      : kind === 'allowed-values' ? { column, kind, values: draft.values, ...(draft.match && { match: draft.match }) }
        : { column, kind };
    const next = index === undefined ? [...rules, updated] : rules.map((rule, i) => i === index ? updated : rule);
    const parsed = columns.includes(column) && readRosterSchemaRules(next);
    if (!parsed) {
      setEditing({ ...draft, invalid: true });
      return;
    }
    desk.changeSchemaRules(parsed);
    close(index ?? rules.length);
  }

  return (
    <div className="conditional-rules-body">
      <p className="quiet">{copy.help}</p>
      <div className="actions compact">
        <button type="button" className="button secondary" data-testid="schema-rule-add" id={id + '-add'}
          disabled={disabled || !columns.length} onClick={() => open()}>{copy.add}</button>
        <button type="button" className="button secondary" data-testid="schema-demo" disabled={disabled}
          aria-describedby={desk.template || desk.roster ? id + '-replace' : undefined}
          onClick={() => void desk.loadSample('payroll')}>{arabic
            ? <span>جرّب مثال رواتب الخليج الاصطناعي للتحقق من <bdi dir="ltr">IBAN</bdi></span>
            : 'Try Synthetic GCC Payroll / IBAN Demo'}</button>
      </div>
      {(desk.template || desk.roster) && <p className="quiet" id={id + '-replace'}>{copy.replace}</p>}
      {!columns.length && <p className="quiet">{copy.wait}</p>}
      {rules.map(({ column, kind }, index) => (
        <div className="conditional-rule" key={index} data-testid="schema-rule">
          <p><bdi dir="auto">{column}</bdi>{' · '}<bdi dir="auto">{names[kind]}</bdi></p>
          {desk.roster && !columns.includes(column) &&
            <p className="alert" role="status" data-testid="schema-column-unavailable">{copy.missing}</p>}
          <div className="actions compact">
            <button type="button" className="button secondary" disabled={disabled || !columns.length} id={`${id}-edit-${index}`}
              aria-label={`${copy.edit} · ${column} · ${names[kind]}`} onClick={() => open(index)}>{copy.edit}</button>
            <button type="button" className="text-button" disabled={disabled}
              aria-label={`${copy.remove} · ${column} · ${names[kind]}`} onClick={(event) => {
                desk.changeSchemaRules(rules.filter((_, i) => i !== index));
                if (columns.length) close();
                else event.currentTarget.closest('details')?.querySelector('summary')?.focus();
              }}>{copy.remove}</button>
          </div>
        </div>
      ))}
      {editor && <form onSubmit={(event) => { event.preventDefault(); apply(editor); }}>
        <fieldset className="conditional-rule" disabled={disabled}>
          <legend>{editor.index === undefined ? copy.add : copy.edit}</legend>
          <label className="full-control">
            {copy.column}
            <select id={id + '-column'} dir="auto" value={editor.column} data-testid="schema-rule-column"
              onChange={(event) => setEditing({ ...editor, column: event.currentTarget.value, invalid: false })}>
              {!columns.includes(editor.column) && <option value={editor.column} disabled>{editor.column}</option>}
              {columns.map((column) => <option key={column} value={column}>{column}</option>)}
            </select>
          </label>
          <label className="full-control">
            {copy.kind}
            <select value={editor.kind} data-testid="schema-rule-kind" onChange={(event) =>
              setEditing({ ...editor, kind: event.currentTarget.value as Editor['kind'], invalid: false })}>
              {kinds.map((kind) => <option key={kind} value={kind}>{names[kind]}</option>)}
            </select>
          </label>
          {editor.kind === 'exact-digits' && <label className="full-control">
            {copy.digits}
            <input type="number" dir="ltr" min={1} max={32} required value={editor.digits} data-testid="schema-rule-digits"
              onChange={(event) => setEditing({ ...editor, digits: event.currentTarget.value, invalid: false })} />
          </label>}
          {editor.kind === 'allowed-values' && <>
            <label className="full-control">
              {copy.values}
              <textarea dir="auto" rows={3} value={editor.values.join('\n')} aria-describedby={id + '-values-help'}
                data-testid="schema-rule-values" onChange={(event) => setEditing({ ...editor, values: event.currentTarget.value.split('\n') })} />
            </label>
            <p className="quiet" id={id + '-values-help'}>{copy.valuesHelp}</p>
            <label className="schema-trimmed">
              <input type="checkbox" checked={editor.match === 'trimmed'} data-testid="schema-rule-trimmed" onChange={(event) =>
                setEditing({ ...editor, match: event.currentTarget.checked ? 'trimmed' : 'exact' })} />
              {copy.trimmed}
            </label>
          </>}
          {editor.invalid && <p role="alert" className="alert">{copy.invalid}</p>}
          <div className="actions compact">
            <button type="submit" className="button primary" data-testid="schema-rule-apply">{copy.apply}</button>
            <button type="button" className="text-button" onClick={() => close(editor.index)}>{copy.cancel}</button>
          </div>
        </fieldset>
      </form>}
    </div>
  );
}
