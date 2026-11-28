import { PDFArray, PDFDict, PDFName, PDFNumber, type PDFObject } from 'pdf-lib';
import { sha256 } from '../audit/custody';
import { decodeText, invalidPdf, optionLabels, radioOption, readSavedFields } from '../pdf/saved-fields';
import { key, loadPdf, PdfIntakeError } from '../pdf/template';
import { makeSpreadsheets } from './spreadsheets';

export interface ExtractInput {
  filename: string;
  bytes: Uint8Array | ArrayBuffer;
}

export type ExtractFieldKind = 'text' | 'checkbox' | 'dropdown' | 'radio' | 'listbox';
export type ExtractStatus = 'extracted' | 'warning-schema-mismatch' | 'blocked-invalid' | 'blocked-flat'
  | 'blocked-encrypted' | 'blocked-xfa' | 'blocked-signed';

export interface ExtractColumn {
  name: string;
  kind: ExtractFieldKind;
}

export interface ExtractFieldValue {
  kind: ExtractFieldKind;
  value: string;
  nativeValue?: string;
  displayLabel?: string;
  selectedValues?: string[];
}

export interface ExtractRow {
  filename: string;
  sourceSha256: string;
  status: ExtractStatus;
  fields: Record<string, ExtractFieldValue>;
  schema?: {
    missing: string[];
    extra: string[];
    typeChanged: { name: string; expected: ExtractFieldKind; actual: ExtractFieldKind }[];
  };
}

export interface ExtractBatchResult {
  columns: ExtractColumn[];
  rows: ExtractRow[];
  artifacts: { csv: Uint8Array; xlsx: Uint8Array; audit: Uint8Array };
}

type FieldEntry = readonly [string, ExtractFieldValue];

const statuses = {
  'invalid-pdf': 'blocked-invalid',
  'encrypted-pdf': 'blocked-encrypted',
  'xfa-unsupported': 'blocked-xfa',
  'signed-pdf-warning': 'blocked-signed',
  'flat-scanned-no-fields': 'blocked-flat',
} as const;

const encoder = new TextEncoder();
function choiceValue(kind: 'dropdown' | 'listbox', raw: PDFObject | undefined, options: PDFObject | undefined, indices: PDFObject | undefined): ExtractFieldValue {
  const selected = raw instanceof PDFArray
    ? Array.from({ length: raw.size() }, (_, index) => decodeText(raw.lookup(index)))
    : raw === undefined ? [] : [decodeText(raw)];
  const choices = optionLabels(options);
  const resolved = selected.map((native, index) => {
    const byValue = choices.filter(({ value }) => value === native);
    const byLabel = byValue.length ? byValue : choices.filter(({ label }) => label === native);
    if (!byLabel.length) return { value: native, label: native };
    const fromIndex = indices instanceof PDFArray ? indices.lookup(index) : undefined;
    if (fromIndex instanceof PDFNumber) {
      const indexed = choices[fromIndex.asNumber()];
      if (indexed && byLabel.includes(indexed)) return indexed;
    }
    const first = byLabel[0]!;
    if (byLabel.some(({ value, label }) => value !== first.value || label !== first.label)) invalidPdf();
    return first;
  });
  const values = resolved.map(({ value }) => value);
  const labels = resolved.map(({ label }) => label);
  const multiple = kind === 'listbox' || resolved.length > 1;
  const cell = (entries: string[]) => multiple ? JSON.stringify(entries) : entries[0] ?? '';
  return {
    kind, value: cell(values),
    ...(raw instanceof PDFArray || multiple ? { selectedValues: values } : {}),
    ...(values.some((value, index) => value !== selected[index]) ? { nativeValue: cell(selected) } : {}),
    ...(labels.some((label, index) => label !== values[index]) ? { displayLabel: cell(labels) } : {}),
  };
}

function buttonValue(kind: 'checkbox' | 'radio', raw: PDFObject | undefined, options: PDFObject | undefined, widgets: readonly PDFDict[]): ExtractFieldValue {
  if (raw !== undefined && !(raw instanceof PDFName)) return invalidPdf();
  const state = raw ?? key('Off');
  const nativeValue = state.decodeText();
  if (kind === 'checkbox') return { kind, value: state === key('Off') ? 'unchecked' : 'checked', nativeValue };
  if (state === key('Off')) return { kind, value: '', nativeValue };
  if (options === undefined) return { kind, value: nativeValue };

  const option = radioOption(state, options, widgets);
  return {
    kind, value: option.value,
    ...(nativeValue === option.value ? {} : { nativeValue }),
    ...(option.label === option.value ? {} : { displayLabel: option.label }),
  };
}

async function readFields(bytes: Uint8Array): Promise<FieldEntry[]> {
  // pdf-lib can recover the form from a partial file without its final EOF.
  let end = bytes.length;
  while (end && [0, 9, 10, 12, 13, 32].includes(bytes[end - 1]!)) end--;
  if (end < 5 || ![37, 37, 69, 79, 70].every((byte, index) => bytes[end - 5 + index] === byte)) invalidPdf();
  const doc = await loadPdf(bytes);
  const fields = readSavedFields(doc).map(({ name, kind, value, options, indices, widgets }): FieldEntry => {
    if (kind === 'text') return [name, { kind, value: value === undefined ? '' : decodeText(value) }];
    if (kind === 'checkbox' || kind === 'radio') return [name, buttonValue(kind, value, options, widgets)];
    return [name, choiceValue(kind, value, options, indices)];
  });
  if (!fields.length) throw new PdfIntakeError('flat-scanned-no-fields');
  return fields;
}

export async function extractBatch(
  inputs: readonly ExtractInput[], onProgress?: (completed: number, total: number) => void,
): Promise<ExtractBatchResult> {
  const total = inputs.length;
  if (total < 1 || total > 200) throw new Error('extract-batch-size');
  const columns = new Map<string, ExtractFieldKind>();
  let primary: Map<string, ExtractFieldKind> | undefined;
  const rows: ExtractRow[] = [];
  for (const input of inputs) {
    const bytes = input.bytes instanceof ArrayBuffer ? new Uint8Array(input.bytes.slice(0)) : Uint8Array.from(input.bytes);
    const row: ExtractRow = {
      filename: input.filename, sourceSha256: await sha256(bytes), status: 'extracted', fields: Object.create(null),
    };
    try {
      const fields = await readFields(bytes);
      const current = new Map(fields.map(([name, field]) => [name, field.kind]));
      const baseline = primary ??= current;
      const missing = [...baseline.keys()].filter((name) => !current.has(name));
      const extra = [...current.keys()].filter((name) => !baseline.has(name));
      const typeChanged = [...baseline].flatMap(([name, expected]) => {
        const actual = current.get(name);
        return actual && actual !== expected ? [{ name, expected, actual }] : [];
      });
      if (missing.length || extra.length || typeChanged.length) {
        row.status = 'warning-schema-mismatch';
        row.schema = { missing, extra, typeChanged };
      }
      for (const [name, field] of fields) {
        if (!columns.has(name)) columns.set(name, field.kind);
        row.fields[name] = field;
      }
    } catch (error) {
      row.status = error instanceof PdfIntakeError ? statuses[error.code] : 'blocked-invalid';
    }
    rows.push(row);
    onProgress?.(rows.length, total);
  }
  const ordered = [...columns].map(([name, kind]) => ({ name, kind }));
  const { csv, xlsx, spreadsheetColumns } = makeSpreadsheets(ordered, rows);
  const [csvSha256, xlsxSha256] = await Promise.all([sha256(csv), sha256(xlsx)]);
  const audit = encoder.encode(JSON.stringify({
    version: 1, columns: ordered, spreadsheetColumns, rows, csvSha256, xlsxSha256,
  }, null, 2) + '\n');
  return { columns: ordered, rows, artifacts: { csv, xlsx, audit } };
}
