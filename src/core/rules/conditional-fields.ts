import type { FieldDiagnostic, FieldMetadata } from '../pdf';
import { matchChoice } from '../pdf/choice-match';

type ConditionalOperator = 'equals' | 'not-equals' | 'contains' | 'is-blank' | 'is-not-blank' | 'gte-number' | 'lte-number';
type ConditionalAction = { type: 'set-text'; value: string } | { type: 'set-choice'; value: string }
  | { type: 'set-checkbox'; checked: boolean } | { type: 'clear-field' };

export type ConditionalFieldRule = { field: string; column: string; operator: ConditionalOperator; operand?: string; action: ConditionalAction };
export type RuleApplication = { field: string; ruleIndex: number };

type Decimal = { sign: -1 | 0 | 1; integer: string; fraction: string };

function decimal(value: string): Decimal | undefined {
  const match = /^([+-]?)([0-9]*)(?:\.([0-9]*))?$/.exec(value.trim());
  if (!match || !(match[2] || match[3])) return undefined;
  const integer = match[2]!.replace(/^0+/, '');
  const digits = match[3] ?? '';
  let end = digits.length;
  while (digits[end - 1] === '0') end--;
  const fraction = digits.slice(0, end);
  return { sign: integer || fraction ? match[1] === '-' ? -1 : 1 : 0, integer, fraction };
}

function compareDecimals(left: Decimal, right: Decimal): number {
  if (left.sign !== right.sign) return left.sign - right.sign;
  const compare = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
  const magnitude = left.integer.length - right.integer.length || compare(left.integer, right.integer) || compare(left.fraction, right.fraction);
  return left.sign * magnitude;
}

function prepareMatcher(operator: ConditionalOperator, operand: string | undefined): ((cell: string) => boolean) | undefined {
  if (operator === 'is-blank') return (cell) => !cell.trim();
  if (operator === 'is-not-blank') return (cell) => !!cell.trim();
  if (operand === undefined) return undefined;
  switch (operator) {
    case 'equals': return (cell) => cell === operand;
    case 'not-equals': return (cell) => cell !== operand;
    case 'contains': return (cell) => cell.includes(operand);
    case 'gte-number':
    case 'lte-number': {
      const threshold = decimal(operand);
      if (!threshold) return undefined;
      return (cell) => {
        const value = decimal(cell);
        if (!value) return false;
        const difference = compareDecimals(value, threshold);
        return operator === 'gte-number' ? difference >= 0 : difference <= 0;
      };
    }
  }
}

type TextPart = { literal: string } | { column: string };

function prepareText(value: string): TextPart[] | undefined {
  const parts: TextPart[] = [];
  let start = 0;
  for (const match of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const literal = value.slice(start, match.index);
    const column = match[1]!;
    if (literal.includes('{{') || literal.includes('}}')) return undefined;
    parts.push({ literal }, { column });
    start = match.index + match[0].length;
  }
  const tail = value.slice(start);
  if (tail.includes('{{') || tail.includes('}}')) return undefined;
  parts.push({ literal: tail });
  return parts;
}

export function conditionalRuleColumns({ column, action }: ConditionalFieldRule): string[] {
  const parts = action.type === 'set-text' ? prepareText(action.value) : undefined;
  return [...new Set([column, ...(parts ?? []).flatMap((part) => 'column' in part ? [part.column] : [])])];
}

export function readConditionalRules(value: unknown): ConditionalFieldRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rules: ConditionalFieldRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const { field, column, operator, operand, action } = item as Record<string, unknown>;
    if (typeof field !== 'string' || !field.trim() || typeof column !== 'string' || !column.trim()
      || !['field', 'column', 'operator', 'action'].every((key) => Object.hasOwn(item, key))) return undefined;
    const unary = operator === 'is-blank' || operator === 'is-not-blank';
    if (unary) {
      if (Object.keys(item).length !== 4 || Object.hasOwn(item, 'operand')) return undefined;
    } else if ((operator !== 'equals' && operator !== 'not-equals' && operator !== 'contains' && operator !== 'gte-number' && operator !== 'lte-number')
      || typeof operand !== 'string' || !Object.hasOwn(item, 'operand') || Object.keys(item).length !== 5) return undefined;

    if (!action || typeof action !== 'object' || Array.isArray(action) || !Object.hasOwn(action, 'type')) return undefined;
    const { type, value: literal, checked } = action as Record<string, unknown>;
    const actionKeys = Object.keys(action).length;
    let parsedAction: ConditionalAction;
    if (type === 'clear-field' && actionKeys === 1) parsedAction = { type };
    else if (type === 'set-checkbox' && typeof checked === 'boolean' && actionKeys === 2 && Object.hasOwn(action, 'checked')) parsedAction = { type, checked };
    else if ((type === 'set-text' || type === 'set-choice') && typeof literal === 'string' && actionKeys === 2 && Object.hasOwn(action, 'value')) {
      parsedAction = { type, value: literal };
    } else return undefined;
    rules.push({ field, column, operator, ...(!unary && { operand: operand as string }), action: parsedAction });
  }
  return rules;
}

export interface ConditionalFieldEvaluation {
  values: Record<string, string>;
  ruleApplied: RuleApplication[];
  diagnostics: FieldDiagnostic[];
}

type ConditionalTarget = Pick<FieldMetadata, 'name' | 'kind' | 'readOnly' | 'widgets' | 'choices'>;

export function prepareConditionalFields(rules: readonly ConditionalFieldRule[], columns: readonly string[], fields: readonly ConditionalTarget[]) {
  const knownColumns = new Set(columns);
  const byName = new Map(fields.map((field) => [field.name, field]));
  const prepared = rules.map(({ field, column, operator, operand, action }, position) => {
    const ruleIndex = position + 1;
    const target = byName.get(field);
    const pageNumbers = target ? [...new Set(target.widgets.filter(({ pageIndex }) => pageIndex >= 0)
      .map(({ pageIndex }) => pageIndex + 1))].sort((a, b) => a - b) : [];
    const invalid = { field, code: 'invalid-conditional-rule', pageNumbers, ruleIndex } as const;
    const matches = prepareMatcher(operator, operand);
    if (!target || target.readOnly || !knownColumns.has(column) || !matches) return { invalid };

    let parts: TextPart[];
    if (action.type === 'set-text' && target.kind === 'text') {
      const text = prepareText(action.value);
      if (!text || text.some((part) => 'column' in part && !knownColumns.has(part.column))) return { invalid };
      parts = text;
    } else if (action.type === 'set-choice' && (target.kind === 'dropdown' || target.kind === 'radio') && target.choices?.length) {
      if (matchChoice(target.choices, action.value) === undefined) {
        return { invalid, issue: { ...invalid, code: 'invalid-choice', choices: target.choices } satisfies FieldDiagnostic };
      }
      parts = [{ literal: action.value }];
    } else if (action.type === 'set-checkbox' && target.kind === 'checkbox') parts = [{ literal: String(action.checked) }];
    else if (action.type === 'clear-field' && (target.kind === 'text' || target.kind === 'checkbox')) parts = [{ literal: '' }];
    else return { invalid };
    return { invalid, column, matches, parts };
  });

  return (values: Record<string, string>, sourceRow: Readonly<Record<string, string>>): ConditionalFieldEvaluation => {
    const ruleApplied: RuleApplication[] = [];
    const diagnostics: FieldDiagnostic[] = [];
    const updates = new Map<string, string>();
    for (const { invalid, issue, column, matches, parts } of prepared) {
      const { field, ruleIndex } = invalid;
      if (column === undefined || !Object.hasOwn(values, field) || !Object.hasOwn(sourceRow, column)
        || parts.some((part) => 'column' in part && !Object.hasOwn(sourceRow, part.column))) {
        diagnostics.push(issue && Object.hasOwn(values, field) ? issue : invalid);
      } else if (!updates.has(field) && matches(sourceRow[column]!)) {
        updates.set(field, parts.map((part) => 'literal' in part ? part.literal : sourceRow[part.column]!).join(''));
        ruleApplied.push({ field, ruleIndex });
      }
    }
    return { values: updates.size ? { ...values, ...Object.fromEntries(updates) } : values, ruleApplied, diagnostics };
  };
}
