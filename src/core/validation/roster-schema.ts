import { isSingleMailbox } from './mailbox';

type SimpleRuleKind = 'required' | 'iban-mod97' | 'iso-date' | 'email-format';
export type RosterSchemaRule = { column: string } & (
  | { kind: SimpleRuleKind }
  | { kind: 'exact-digits'; digits: number }
  | { kind: 'allowed-values'; values: string[]; match?: 'exact' | 'trimmed' }
);

const reasons = {
  'missing-column': { en: 'This column is missing from the roster.', ar: 'هذا العمود غير موجود في القائمة.' },
  required: { en: 'Enter a nonblank value.', ar: 'أدخل قيمة غير فارغة.' },
  'iban-format': { en: 'Use the registered IBAN format with uppercase Latin letters, ASCII digits and optional ordinary spaces.', ar: 'استخدم صيغة الآيبان المسجَّلة بحروف لاتينية كبيرة وأرقام من 0 إلى 9. يمكن استخدام مسافات عادية.' },
  'iban-country': { en: 'This IBAN country code is outside the supported list.', ar: 'رمز بلد الآيبان هذا خارج قائمة البلدان المدعومة.' },
  'iban-length': { en: 'Check the registered IBAN length for this country.', ar: 'تحقّق من طول الآيبان المسجَّل لهذا البلد.' },
  'iban-checksum': { en: 'IBAN check digits do not match. Compare every character with the original.', ar: 'رقما التحقّق في الآيبان غير مطابقين. قارن كل حرف ورقم بالمصدر الأصلي.' },
  'iban-ambiguous-transposition': { en: 'Swapping two neighboring characters also passes the checksum. Verify the original IBAN before proceeding.', ar: 'يظل المجموع الاختباري صحيحًا عند تبديل رمزين متجاورين. راجع الآيبان في المصدر الأصلي قبل المتابعة.' },
  'iso-date': { en: 'Enter a real Gregorian date in YYYY-MM-DD format.', ar: 'أدخل تاريخًا ميلاديًا صالحًا بالصيغة YYYY-MM-DD.' },
  'exact-digits': { en: 'Enter the configured number of ASCII digits (0–9). Keep leading zeros.', ar: 'أدخل العدد المحدّد من الأرقام من 0 إلى 9، مع إبقاء الأصفار البادئة.' },
  'email-format': { en: 'Enter one email address without spaces, display names or line breaks.', ar: 'أدخل عنوان بريد إلكتروني واحدًا دون مسافات أو اسم عرض أو فواصل أسطر.' },
  'allowed-values': { en: 'Choose a value from the configured list. Case matters.', ar: 'اختر قيمة من القائمة المحدَّدة. يُراعى الفرق بين الحروف اللاتينية الكبيرة والصغيرة.' },
};

export interface RosterSchemaDiagnostic {
  code: 'schema-validation-failed';
  column: string;
  rule: RosterSchemaRule['kind'];
  reasonCode: keyof typeof reasons;
  reason: { en: string; ar: string };
  rowNumber: number;
}

// SWIFT ISO 13616 IBAN Registry, release 103, September 2026.
// Each expression describes the national BBAN after the four-character IBAN prefix.
const ibanFormats: ReadonlyMap<string, readonly [number, RegExp]> = /* @__PURE__ */ new Map([
  ['SA', [24, /^[0-9]{2}[A-Z0-9]{18}$/]], ['AE', [23, /^[0-9]{19}$/]],
  ['QA', [29, /^[A-Z]{4}[A-Z0-9]{21}$/]], ['KW', [30, /^[A-Z]{4}[A-Z0-9]{22}$/]],
  ['BH', [22, /^[A-Z]{4}[A-Z0-9]{14}$/]], ['OM', [23, /^[0-9]{3}[A-Z0-9]{16}$/]],
  ['EG', [29, /^[0-9]{25}$/]], ['JO', [30, /^[A-Z]{4}[0-9]{4}[A-Z0-9]{18}$/]],
  ['LB', [28, /^[0-9]{4}[A-Z0-9]{20}$/]], ['TN', [24, /^[0-9]{20}$/]],
  ['GB', [22, /^[A-Z]{4}[0-9]{14}$/]], ['DE', [22, /^[0-9]{18}$/]],
  ['FR', [27, /^[0-9]{10}[A-Z0-9]{11}[0-9]{2}$/]], ['NL', [18, /^[A-Z]{4}[0-9]{10}$/]],
  ['ES', [24, /^[0-9]{20}$/]], ['IT', [27, /^[A-Z][0-9]{10}[A-Z0-9]{12}$/]],
]);

function ibanStructureIssue(iban: string) {
  if (!/^[A-Z]{2}[0-9]{2}/.test(iban) || /[^A-Z0-9]/.test(iban)) return 'iban-format';
  const format = ibanFormats.get(iban.slice(0, 2));
  if (!format) return 'iban-country';
  if (iban.length !== format[0]) return 'iban-length';
  if (!format[1].test(iban.slice(4))) return 'iban-format';
  const checkDigits = iban.slice(2, 4);
  if (checkDigits < '02' || checkDigits > '98') return 'iban-checksum';
}

function ibanRemainder(iban: string): bigint {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  return BigInt(rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55))) % 97n;
}

function ibanIssue(value: string) {
  const iban = value.replaceAll(' ', '');
  const structureIssue = ibanStructureIssue(iban);
  if (structureIssue) return structureIssue;
  if (ibanRemainder(iban) !== 1n) return 'iban-checksum';
  // Letter/digit pairs can expand to the same decimal sequence (B1 and 1B
  // both become 111). A swapped pair crossing the check-digit boundary also
  // moves apart when the prefix is rotated. Hold either valid alternative.
  // Other same-width swaps change the residue: the factors 9 and 99 and the
  // character differences are all nonzero modulo 97.
  for (let index = 0; index < iban.length - 1; index++) {
    const left = iban[index]!;
    const right = iban[index + 1]!;
    if (left === right || (index !== 3 && (left >= 'A') === (right >= 'A'))) continue;
    const swapped = iban.slice(0, index) + right + left + iban.slice(index + 2);
    if (!ibanStructureIssue(swapped) && ibanRemainder(swapped) === 1n) return 'iban-ambiguous-transposition';
  }
}

function realIsoDate(value: string): boolean {
  if (value.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthDays[month - 1]!;
}

export function readRosterSchemaRules(value: unknown): RosterSchemaRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rules: RosterSchemaRule[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Object.getPrototypeOf(item) !== Object.prototype) return undefined;
    const { column, kind, digits, match, values } = item as Record<string, unknown>;
    const keys = Object.keys(item).length;
    if (typeof column !== 'string' || !column.trim() || !Object.hasOwn(item, 'column') || !Object.hasOwn(item, 'kind')) return undefined;
    switch (kind) {
      case 'required':
      case 'iban-mod97':
      case 'iso-date':
      case 'email-format':
        if (keys !== 2) return undefined;
        rules.push({ column, kind });
        break;
      case 'exact-digits':
        if (keys !== 3 || !Object.hasOwn(item, 'digits') || typeof digits !== 'number'
          || !Number.isInteger(digits) || digits < 1 || digits > 32) return undefined;
        rules.push({ column, kind, digits });
        break;
      case 'allowed-values': {
        const hasMatch = Object.hasOwn(item, 'match');
        if (keys !== (hasMatch ? 4 : 3) || (hasMatch && match !== 'exact' && match !== 'trimmed')
          || !Object.hasOwn(item, 'values') || !Array.isArray(values) || !values.length) return undefined;
        const literals: string[] = [];
        for (const literal of values) {
          if (typeof literal !== 'string') return undefined;
          literals.push(literal);
        }
        rules.push({ column, kind, values: literals, ...(match === 'exact' || match === 'trimmed' ? { match } : {}) });
        break;
      }
      default:
        return undefined;
    }
  }
  return rules;
}

type RuleCheck = (value: string) => RosterSchemaDiagnostic['reasonCode'] | undefined;

function prepareRule(rule: RosterSchemaRule): RuleCheck {
  switch (rule.kind) {
    case 'required': return (value) => value.trim() ? undefined : 'required';
    case 'iban-mod97': return ibanIssue;
    case 'iso-date': return (value) => realIsoDate(value) ? undefined : 'iso-date';
    case 'email-format': return (value) => isSingleMailbox(value) ? undefined : 'email-format';
    case 'exact-digits': return (value) => value.length === rule.digits && !/[^0-9]/.test(value) ? undefined : 'exact-digits';
    case 'allowed-values': {
      const trimmed = rule.match === 'trimmed';
      const allowed = new Set(trimmed ? rule.values.map((value) => value.trim()) : rule.values);
      return (value) => allowed.has(trimmed ? value.trim() : value) ? undefined : 'allowed-values';
    }
  }
}

export function prepareRosterSchema(rules: readonly RosterSchemaRule[], columns: readonly string[]) {
  const headers = new Set(columns);
  const checks = rules.map((rule) => ({ column: rule.column, kind: rule.kind, check: headers.has(rule.column) ? prepareRule(rule) : undefined }));
  return (cells: Readonly<Record<string, string>>, rowNumber: number): RosterSchemaDiagnostic[] => {
    const diagnostics: RosterSchemaDiagnostic[] = [];
    for (const { column, kind, check } of checks) {
      const reasonCode = check ? check(Object.hasOwn(cells, column) ? cells[column]! : '') : 'missing-column';
      if (reasonCode) diagnostics.push({ code: 'schema-validation-failed', column, rule: kind, reasonCode, reason: { ...reasons[reasonCode] }, rowNumber });
    }
    return diagnostics;
  };
}
