import { useId, useMemo } from 'react';
import { matchChoice } from '../core/pdf/choice-match';
import { conditionalRuleColumns, prepareConditionalFields, type ConditionalFieldRule } from '../core/rules/conditional-fields';
import { choiceText, editableChoices } from './Choices';
import { fillLabel } from './labels';
import type { useWorkbench } from './useWorkbench';
import './conditional-rules.css';

type Operator = ConditionalFieldRule['operator'];
type Action = ConditionalFieldRule['action'];

const en = {
  help: 'For each field, the first matching rule applies. Counts include the current roster edits.',
  wait: 'Choose a PDF and roster, then map a field to add a rule.',
  replace: 'The example replaces the current files and settings.',
  add: 'Add rule',
  rule: 'Rule {index}',
  field: 'PDF field',
  fieldChoose: 'Choose a mapped field',
  fieldMissing: 'Choose a mapped PDF field for this rule.',
  column: 'Roster column',
  columnChoose: 'Choose a roster column',
  columnMissing: 'Choose a column from the current roster for this rule.',
  unavailable: 'Unavailable',
  operator: 'Operator',
  operators: {
    'equals': 'Equals', 'not-equals': 'Does not equal', 'contains': 'Contains', 'is-blank': 'Is blank',
    'is-not-blank': 'Is not blank', 'gte-number': 'At least (number)', 'lte-number': 'At most (number)',
  } satisfies Record<Operator, string>,
  operand: 'Compare with',
  action: 'Action',
  actions: {
    'set-text': 'Set text', 'set-checkbox': 'Set checkbox', 'set-choice': 'Set choice', 'clear-field': 'Clear field',
  } satisfies Record<Action['type'], string>,
  value: 'Value',
  tokenUse: 'Use',
  tokenHelp: 'to insert a cell from the same row. Use the exact column name.',
  choiceChoose: 'Choose a PDF option',
  blank: '(blank)',
  checked: 'Checked',
  unchecked: 'Unchecked',
  up: 'Move up',
  down: 'Move down',
  remove: 'Delete rule',
  matches: 'Matches {count} of {total} rows',
  invalid: 'Check the comparison value and action. Number comparisons require a decimal value.',
  invalidChoice: 'Choose one of the options allowed by this PDF field.',
  missingTokens: 'Unavailable roster columns',
};

const ar: typeof en = {
  help: 'تُطبَّق أول قاعدة مطابقة لكل حقل. تُحتسب تعديلات الجدول الحالية ضمن عدد الصفوف.',
  wait: 'اختر ملف PDF وجدولًا، ثم اربط حقلًا لتتمكن من إضافة قاعدة.',
  replace: 'يستبدل المثال الملفات والإعدادات الحالية.',
  add: 'أضف قاعدة',
  rule: 'القاعدة {index}',
  field: 'حقل PDF',
  fieldChoose: 'اختر حقلًا مرتبطًا',
  fieldMissing: 'اختر حقل PDF مرتبطًا لهذه القاعدة.',
  column: 'عمود الجدول',
  columnChoose: 'اختر عمودًا من الجدول',
  columnMissing: 'اختر عمودًا من الجدول الحالي لهذه القاعدة.',
  unavailable: 'غير متاح',
  operator: 'عامل المقارنة',
  operators: {
    'equals': 'يساوي', 'not-equals': 'لا يساوي', 'contains': 'يحتوي على', 'is-blank': 'فارغ',
    'is-not-blank': 'غير فارغ', 'gte-number': 'على الأقل (رقم)', 'lte-number': 'على الأكثر (رقم)',
  },
  operand: 'قيمة المقارنة',
  action: 'الإجراء',
  actions: { 'set-text': 'عيّن النص', 'set-checkbox': 'اضبط مربع الاختيار', 'set-choice': 'عيّن الخيار', 'clear-field': 'أفرغ الحقل' },
  value: 'القيمة',
  tokenUse: 'استخدم',
  tokenHelp: 'لإدراج خلية من الصف نفسه، واكتب اسم العمود كما يظهر في الجدول.',
  choiceChoose: 'اختر من خيارات PDF',
  blank: '(فارغ)',
  checked: 'محدّد',
  unchecked: 'غير محدّد',
  up: 'انقل لأعلى',
  down: 'انقل لأسفل',
  remove: 'احذف القاعدة',
  matches: 'تنطبق على {count} من أصل {total} صف',
  invalid: 'راجع قيمة المقارنة والإجراء. تتطلّب المقارنة الرقمية قيمة عشرية.',
  invalidChoice: 'اختر قيمة يسمح بها هذا الحقل في PDF.',
  missingTokens: 'أعمدة الجدول غير المتاحة',
};

const operators = Object.keys(en.operators) as Operator[];
const emptyColumns: readonly string[] = [];

function defaultAction(type: Action['type']): Action {
  if (type === 'set-checkbox') return { type, checked: false };
  if (type === 'clear-field') return { type };
  return { type, value: '' };
}

export default function ConditionalRules({ desk, arabic }: { desk: ReturnType<typeof useWorkbench>; arabic: boolean }) {
  const copy = arabic ? ar : en;
  const id = useId();
  const { conditionalRules: rules, changeConditionalRules: change, fields, mapping, virtualMappings, rows } = desk;
  const columns = desk.sheet?.headers ?? emptyColumns;
  const targets = useMemo(() => fields.filter(({ name }) => mapping[name] || Object.hasOwn(virtualMappings, name)),
    [fields, mapping, virtualMappings]);
  const available = targets.length > 0 && columns.length > 0;
  const disabled = desk.exporting || desk.busy.pdf || desk.busy.roster;
  const summary = useMemo(() => {
    const counts = new Uint32Array(rules.length);
    const issues = new Map<number, string>();
    if (rules.length) {
      const evaluate = prepareConditionalFields(rules, columns, fields);
      const mapped = Object.fromEntries(targets.map(({ name }) => [name, '']));
      for (const { values } of rows) {
        const { ruleApplied, diagnostics } = evaluate(mapped, values);
        for (const { ruleIndex } of ruleApplied) counts[ruleIndex - 1]!++;
        for (const { ruleIndex, code } of diagnostics) {
          if (ruleIndex !== undefined) issues.set(ruleIndex - 1, code);
        }
      }
    }
    return { counts, issues };
  }, [rules, columns, fields, targets, rows]);

  function update(index: number, partial: Partial<ConditionalFieldRule>) {
    change(rules.map((rule, position) => position === index ? { ...rule, ...partial } : rule));
  }

  function focusField(index: number) {
    requestAnimationFrame(() => document.getElementById(`${id}-${index}`)?.focus());
  }

  function move(index: number, direction: -1 | 1) {
    const next = rules.slice();
    const position = index + direction;
    [next[index], next[position]] = [next[position]!, next[index]!];
    change(next);
    focusField(position);
  }

  return (
    <div className="conditional-rules-body">
      <p className="quiet">{copy.help}</p>
      <div className="actions compact">
        <button type="button" className="button secondary" data-testid="conditional-rule-add" id={`${id}-add`}
          disabled={disabled || !available} onClick={() => {
            change([...rules, { field: '', column: '', operator: 'equals', action: defaultAction('set-text') }]);
            focusField(rules.length);
          }}>{copy.add}</button>
        <button type="button" className="button secondary" data-testid="conditional-rules-example" disabled={disabled}
          aria-describedby={desk.template || desk.roster ? `${id}-replace` : undefined}
          onClick={() => void desk.loadSample('conditional')}>{arabic
            ? <span>جرّب مثال <bdi dir="ltr">VIP</bdi> و<bdi dir="ltr">Standard</bdi> الاصطناعي</span>
            : 'Try Synthetic VIP/Standard Example'}</button>
      </div>
      {(desk.template || desk.roster) && <p className="quiet" id={`${id}-replace`}>{copy.replace}</p>}
      {!available && <p className="quiet">{copy.wait}</p>}
      {rules.map((rule, index) => {
        const field = targets.find(({ name }) => name === rule.field);
        const hasColumn = columns.includes(rule.column);
        const issue = summary.issues.get(index);
        const missingTokens = conditionalRuleColumns(rule).slice(1).filter((column) => !columns.includes(column));
        const error = !field ? copy.fieldMissing : !hasColumn ? copy.columnMissing
          : issue === 'invalid-choice' ? copy.invalidChoice
            : missingTokens.length ? copy.missingTokens : issue ? copy.invalid : undefined;
        const errorId = `${id}-error-${index}`;
        const types: Action['type'][] = field?.kind === 'checkbox' ? ['set-checkbox', 'clear-field']
          : field?.choices ? ['set-choice'] : ['set-text', 'clear-field'];
        const { action } = rule;
        const choices = field?.choices ?? [];
        const options = editableChoices(choices);
        const choiceIndex = action.type === 'set-choice' ? matchChoice(choices, action.value) : undefined;
        const choiceInput = options.find(({ index: position }) => position === choiceIndex)?.input;
        const binary = rule.operator !== 'is-blank' && rule.operator !== 'is-not-blank';
        return (
          <fieldset className="conditional-rule" key={index} data-testid="conditional-rule" disabled={disabled}>
            <legend>{fillLabel(copy.rule, { index: index + 1 })}</legend>
            <label className="full-control">
              {copy.field}
              <select dir="auto" id={`${id}-${index}`} aria-label={copy.field} data-testid="conditional-rule-field" value={rule.field}
                aria-invalid={!field || undefined} aria-describedby={!field ? errorId : undefined} onChange={(event) => {
                  const name = event.currentTarget.value;
                  const kind = targets.find((target) => target.name === name)?.kind;
                  const type = kind === 'checkbox' ? 'set-checkbox' : kind === 'text' ? 'set-text' : 'set-choice';
                  update(index, { field: name, action: defaultAction(type) });
                }}>
                <option value="" disabled>{copy.fieldChoose}</option>
                {!field && rule.field && <option value={rule.field} disabled>{rule.field} · {copy.unavailable}</option>}
                {targets.map(({ name }) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="full-control">
              {copy.column}
              <select dir="auto" aria-label={copy.column} data-testid="conditional-rule-column" value={rule.column} aria-invalid={!hasColumn || undefined}
                aria-describedby={field && !hasColumn ? errorId : undefined}
                onChange={(event) => update(index, { column: event.currentTarget.value })}>
                <option value="" disabled>{copy.columnChoose}</option>
                {!hasColumn && rule.column && <option value={rule.column} disabled>{rule.column} · {copy.unavailable}</option>}
                {columns.map((column) => <option key={column} value={column}>{column}</option>)}
              </select>
            </label>
            <label className="full-control">
              {copy.operator}
              <select aria-label={copy.operator} data-testid="conditional-rule-operator" value={rule.operator} onChange={(event) => {
                const operator = event.currentTarget.value as Operator;
                const { operand, ...rest } = rule;
                const updated = operator === 'is-blank' || operator === 'is-not-blank'
                  ? { ...rest, operator } : { ...rest, operator, operand: operand ?? '' };
                change(rules.map((current, position) => position === index ? updated : current));
              }}>
                {operators.map((operator) => <option key={operator} value={operator}>{copy.operators[operator]}</option>)}
              </select>
            </label>
            {binary && <label className="full-control">
              {copy.operand}
              <input type="text" dir="auto" data-testid="conditional-rule-operand" value={rule.operand ?? ''}
                inputMode={rule.operator === 'gte-number' || rule.operator === 'lte-number' ? 'decimal' : undefined}
                aria-describedby={error ? errorId : undefined} onChange={(event) => update(index, { operand: event.currentTarget.value })} />
            </label>}
            <label className="full-control">
              {copy.action}
              <select aria-label={copy.action} data-testid="conditional-rule-action" value={action.type}
                onChange={(event) => update(index, { action: defaultAction(event.currentTarget.value as Action['type']) })}>
                {!types.includes(action.type) && <option value={action.type} disabled>{copy.actions[action.type]} · {copy.unavailable}</option>}
                {types.map((type) => <option key={type} value={type}>{copy.actions[type]}</option>)}
              </select>
            </label>
            {action.type === 'set-text' && <>
              <label className="full-control">
                {copy.value}
                <textarea dir="auto" data-testid="conditional-rule-value" rows={2} value={action.value}
                  aria-describedby={`${id}-tokens-${index}${error ? ` ${errorId}` : ''}`}
                  onChange={(event) => update(index, { action: { type: 'set-text', value: event.currentTarget.value } })} />
              </label>
              <small id={`${id}-tokens-${index}`}>{copy.tokenUse}{' '}<bdi dir="ltr">{'{{Column}}'}</bdi>{' '}{copy.tokenHelp}</small>
            </>}
            {action.type === 'set-checkbox' && <label className="full-control">
              {copy.value}
              <select aria-label={copy.value} data-testid="conditional-rule-value" value={String(action.checked)}
                onChange={(event) => update(index, { action: { type: 'set-checkbox', checked: event.currentTarget.value === 'true' } })}>
                <option value="true">{copy.checked}</option>
                <option value="false">{copy.unchecked}</option>
              </select>
            </label>}
            {action.type === 'set-choice' && <label className="full-control">
              {copy.value}
              <select dir="auto" aria-label={copy.value} data-testid="conditional-rule-value" value={choiceInput ?? action.value}
                aria-invalid={issue === 'invalid-choice' || undefined} aria-describedby={error ? errorId : undefined}
                onChange={(event) => update(index, { action: { type: 'set-choice', value: event.currentTarget.value } })}>
                {choiceInput === undefined && <option value={action.value} disabled>{action.value || copy.choiceChoose}</option>}
                {options.map(({ choice, input }) => <option key={input} value={input}>{choiceText(choice, copy.blank)}</option>)}
              </select>
            </label>}
            {error && <p className="alert" id={errorId} role="status" data-testid="conditional-rule-error">
              {error}{missingTokens.length > 0 && field && hasColumn && <>{' · '}<bdi dir="auto">{missingTokens.join(', ')}</bdi></>}
            </p>}
            <p className="quiet" role="status" data-testid="conditional-rule-matches">
              {fillLabel(copy.matches, { count: summary.counts[index]!, total: rows.length })}
            </p>
            <div className="actions compact">
              <button type="button" className="button secondary" data-testid="conditional-rule-up" disabled={index === 0}
                onClick={() => move(index, -1)}>{copy.up}</button>
              <button type="button" className="button secondary" data-testid="conditional-rule-down" disabled={index + 1 === rules.length}
                onClick={() => move(index, 1)}>{copy.down}</button>
              <button type="button" className="text-button" data-testid="conditional-rule-delete" onClick={(event) => {
                change(rules.filter((_, position) => position !== index));
                if (rules.length > 1) focusField(Math.min(index, rules.length - 2));
                else if (available) document.getElementById(`${id}-add`)?.focus();
                else event.currentTarget.closest('details')?.querySelector('summary')?.focus();
              }}>{copy.remove}</button>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
