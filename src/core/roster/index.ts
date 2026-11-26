import Papa from 'papaparse';
import { readWorkbook } from './xlsx';

export type RosterWarningCode = 'excel-scientific-notation-warning' | 'excel-numeric-identifier-warning' | 'excel-formula-warning' | 'excel-cell-error-warning' | 'excel-number-format-warning';

export interface RosterRow {
  values: Record<string, string>;
  warnings: { column: string; code: RosterWarningCode }[];
}

export interface RosterSheet {
  name: string;
  headers: string[];
  rows: RosterRow[];
}

export interface Roster {
  sheets: RosterSheet[];
}

const aliases = [
  ['name', 'full name', 'employee name', 'student name', 'participant name', 'الاسم', 'الاسم الكامل', 'اسم الموظف', 'اسم الطالب'],
  ['id', 'number', 'id number', 'badge', 'badge number', 'employee id', 'student id', 'الرقم', 'رقم الهوية', 'رقم الموظف', 'رقم الطالب'],
  ['date', 'التاريخ', 'تاريخ'],
  ['title', 'course', 'course title', 'job title', 'الدورة', 'العنوان', 'المسمى الوظيفي'],
  ['notes', 'remarks', 'comments', 'description', 'ملاحظات', 'الملاحظات', 'الوصف'],
  ['email', 'e-mail', 'البريد الالكتروني', 'البريد الإلكتروني'],
  ['phone', 'telephone', 'mobile', 'phone number', 'الهاتف', 'رقم الهاتف', 'الجوال'],
  ['zip', 'zip code', 'postal code', 'الرمز البريدي'],
];

function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

const aliasGroups = aliases.map((group) => group.map(normalize));

function decodeCsv(bytes: Uint8Array): string {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] !== 0 && bytes[1] === 0 && bytes[3] === 0)) {
    return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function rosterHeaders(cells: readonly (string | undefined)[]): string[] {
  const headers = Array.from(cells, (value) => (value ?? '').trim());
  const normalized = headers.map(normalize);
  if (!headers.length || normalized.some((value) => !value) || new Set(normalized).size !== headers.length) {
    throw new Error('invalid-roster-headers');
  }
  return headers;
}

export async function readRoster(input: Uint8Array | ArrayBuffer, filename: string): Promise<Roster> {
  const bytes = new Uint8Array(input);
  if (/\.xlsx$/i.test(filename)) return { sheets: readWorkbook(bytes, rosterHeaders, aliasGroups, normalize) };
  if (!/\.csv$/i.test(filename)) throw new Error('unsupported-roster');
  const parsed = Papa.parse<string[]>(decodeCsv(bytes), { dynamicTyping: false, skipEmptyLines: true });
  // Papa reports delimiter uncertainty for legitimate single-column CSVs.
  if (parsed.errors.some((error) => error.code !== 'UndetectableDelimiter')) throw new Error('invalid-csv');
  const [first, ...data] = parsed.data;
  const headers = rosterHeaders(first ?? []);
  if (data.some((row) => row.length > headers.length)) throw new Error('invalid-csv');
  const rows = data.map((row) => ({ values: Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ''])), warnings: [] }));
  return { sheets: [{ name: 'CSV', headers, rows }] };
}

export function autoMap(fieldNames: readonly string[], headers: readonly string[]): Record<string, string> {
  const byNormalized = headers.map((header) => ({ header, normalized: normalize(header) }));
  const mapped = new Map<string, string>();
  for (const field of fieldNames) {
    const candidate = normalize(field);
    const exact = byNormalized.filter((header) => candidate === header.normalized);
    if (exact.length === 1) mapped.set(field, exact[0]!.header);
  }
  const available = byNormalized.filter(({ header }) => ![...mapped.values()].includes(header));
  const inferred = new Map<string, string>();
  for (const field of fieldNames) {
    if (mapped.has(field)) continue;
    const aliases = aliasGroups.find((group) => group.includes(normalize(field)));
    const candidates = available.filter((header) => aliases?.includes(header.normalized));
    if (candidates.length === 1) inferred.set(field, candidates[0]!.header);
  }
  for (const [field, header] of inferred) {
    if ([...inferred.values()].filter((value) => value === header).length === 1) mapped.set(field, header);
  }
  return Object.fromEntries(mapped);
}

export function makeFilenames(rows: readonly (Record<string, string> | RosterRow)[], pattern = '{{ID}}-{{Name}}.pdf'): string[] {
  const seen = new Set<string>();
  const encoder = new TextEncoder();
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return rows.map((row, index) => {
    const values = Array.isArray(row.warnings) ? (row as RosterRow).values : row as Record<string, string>;
    const stem = pattern.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, token: string) => Object.hasOwn(values, token) ? values[token] ?? '' : '')
      .replace(/\.pdf$/i, '').normalize('NFC').replace(/[\\/:*?"<>|\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, '')
      .replace(/^[.\s-]+|[.\s-]+$/g, '');
    let base = '';
    let length = 0;
    for (const { segment } of graphemes.segment(stem)) {
      length += encoder.encode(segment).length;
      if (length > 180) break;
      base += segment;
    }
    base = base.replace(/[.\s]+$/g, '') || `row-${index + 1}`;
    if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(base)) base = `_${base}`;
    let filename = `${base}.pdf`;
    let suffix = 2;
    while (seen.has(filename.toLowerCase())) filename = `${base}-${suffix++}.pdf`;
    seen.add(filename.toLowerCase());
    return filename;
  });
}
