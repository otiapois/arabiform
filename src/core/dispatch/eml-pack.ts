import { unzipSync, zipSync } from 'fflate';
import Papa from 'papaparse';
import { sha256, type CustodyEntry } from '../audit/custody';
import { isSafeGroupedPdfPath } from '../export/grouping';
import { DEFAULT_FILENAME_PATTERN, isSafePdfFilename, physicalFilenameColumns } from '../roster/filenames';
import { escapeSpreadsheetCell } from '../roster/spreadsheet-csv';

export const DISPATCH_ZIP_FILENAME = 'arabiform-email-drafts.zip';
export const DISPATCH_CSV_FILENAME = 'dispatch-ledger.csv';
export const DISPATCH_JSON_FILENAME = 'dispatch-ledger.json';

type Cells = Readonly<Record<string, string>>;
type Field = 'to' | 'cc' | 'subject' | 'body' | 'attachment';

export interface DispatchSettings {
  recipientColumn: string;
  ccColumn?: string;
  subjectTemplate: string;
  bodyTemplate: string;
}

export interface DispatchIssue {
  rowNumber: number;
  code: 'invalid-recipient' | 'invalid-cc' | 'invalid-header' | 'missing-token' | 'invalid-attachment' | 'attachment-mismatch' | 'protected-column';
  field: Field;
}

interface DispatchMessage {
  recipient: string;
  cc?: string;
  subject: string;
  body: string;
}

export type DispatchPreview = ({ status: 'ready' } & DispatchMessage) | { status: 'blocked'; issue: DispatchIssue };

export interface DispatchTarget {
  rowNumber: number;
  values: Cells;
  filename: string;
  zipPath?: string;
  unsafeFilename?: boolean;
}

type PreparedDraft = DispatchMessage & Pick<DispatchTarget, 'rowNumber' | 'filename' | 'zipPath'>;

export interface DispatchLedgerEntry {
  rowNumber: number;
  recipient: string;
  cc?: string;
  pdfFilename: string;
  pdfZipPath: string;
  pdfSha256: string;
  emlFilename: string;
  emlSha256: string;
}

export type DispatchPackResult =
  | { status: 'ready'; bytes: Uint8Array; ledgerCsv: string; ledgerJson: string; entries: DispatchLedgerEntry[];
    pdfEntries: CustodyEntry[]; redactedFields?: string[] }
  | { status: 'blocked'; issues: DispatchIssue[] };

const CRLF = '\r\n';
const encoder = new TextEncoder();
const headerControl = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u;
const lineBreak = /[\r\n]/;
const dotAtom = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isRecipient(value: string): boolean {
  if (value.length > 254 || headerControl.test(value)) return false;
  const [local, domain, extra] = value.split('@');
  if (local === undefined || domain === undefined || extra !== undefined || local.length > 64 || !dotAtom.test(local)) return false;
  const labels = domain.split('.');
  return labels.length > 1 && /[a-z]/i.test(labels.at(-1)!) && labels.every((label) => dnsLabel.test(label));
}

function interpolate(template: string, values: Cells, protectedColumns: ReadonlySet<string> | undefined) {
  let start = 0;
  let text = '';
  for (const match of template.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const prefix = template.slice(start, match.index);
    const column = match[1]!;
    if (/\{\{|\}\}/.test(prefix) || !Object.hasOwn(values, column)) return { issue: 'missing-token' } as const;
    if (protectedColumns?.has(column)) return { issue: 'protected-column' } as const;
    text += prefix + values[column]!;
    start = match.index + match[0].length;
  }
  const tail = template.slice(start);
  return /\{\{|\}\}/.test(tail) ? { issue: 'missing-token' } as const : { text: text + tail };
}

export function previewDispatch(settings: DispatchSettings, values: Cells, rowNumber: number, protectedColumns?: ReadonlySet<string>): DispatchPreview {
  const { recipientColumn, ccColumn, subjectTemplate, bodyTemplate } = settings;
  const block = (code: DispatchIssue['code'], field: Field): DispatchPreview => ({ status: 'blocked', issue: { rowNumber, code, field } });
  const recipient = Object.hasOwn(values, recipientColumn) ? values[recipientColumn] : undefined;
  if (protectedColumns?.has(recipientColumn)) return block('protected-column', 'to');
  if (recipient === undefined || lineBreak.test(recipientColumn) || !isRecipient(recipient)) return block('invalid-recipient', 'to');
  const cc = ccColumn === undefined ? '' : Object.hasOwn(values, ccColumn) ? values[ccColumn] : undefined;
  if (ccColumn !== undefined && protectedColumns?.has(ccColumn)) return block('protected-column', 'cc');
  if (cc === undefined || ccColumn !== undefined && lineBreak.test(ccColumn) || cc !== '' && !isRecipient(cc)) return block('invalid-cc', 'cc');
  if (headerControl.test(subjectTemplate)) return block('invalid-header', 'subject');
  const subject = interpolate(subjectTemplate, values, protectedColumns);
  if (subject.issue) return block(subject.issue, 'subject');
  if (headerControl.test(subject.text)) return block('invalid-header', 'subject');
  const body = interpolate(bodyTemplate, values, protectedColumns);
  if (body.issue) return block(body.issue, 'body');
  return { status: 'ready', recipient, ...(cc && { cc }), subject: subject.text, body: body.text };
}

export function unsafeDispatchFilenameRows(rows: readonly Cells[], pattern = DEFAULT_FILENAME_PATTERN, groupByColumn?: string | null): number[] {
  const columns = physicalFilenameColumns(pattern);
  if (groupByColumn != null) columns.push(groupByColumn);
  const literalHasLineBreak = lineBreak.test(pattern);
  return rows.flatMap((cells, index) => literalHasLineBreak
    || columns.some((column) => Object.hasOwn(cells, column) && lineBreak.test(cells[column]!)) ? [index + 1] : []);
}

export function prepareDispatchRows(settings: DispatchSettings, targets: readonly DispatchTarget[], protectedColumns?: ReadonlySet<string>) {
  const drafts: PreparedDraft[] = [];
  const issues: DispatchIssue[] = [];
  const seen = new Set<number>();
  for (const { rowNumber, values, filename, zipPath, unsafeFilename } of targets) {
    if (seen.has(rowNumber) || !Number.isSafeInteger(rowNumber) || rowNumber <= 0) throw new Error('dispatch-invalid-row');
    seen.add(rowNumber);
    if (unsafeFilename || !isSafePdfFilename(filename) || zipPath !== undefined
      && (!isSafeGroupedPdfPath(zipPath) || zipPath.split('/')[1] !== filename)) {
      issues.push({ rowNumber, code: 'invalid-attachment', field: 'attachment' });
      continue;
    }
    const preview = previewDispatch(settings, values, rowNumber, protectedColumns);
    if (preview.status === 'blocked') issues.push(preview.issue);
    else drafts.push({ rowNumber, filename, zipPath, recipient: preview.recipient, cc: preview.cc, subject: preview.subject, body: preview.body });
  }
  return issues.length ? { status: 'blocked', issues } as const : { status: 'ready', drafts } as const;
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function wrapBase64(bytes: Uint8Array): string {
  const lines: string[] = [];
  // 57 input bytes become a 76-character MIME transfer line (RFC 2045).
  for (let offset = 0; offset < bytes.length; offset += 57) lines.push(base64(bytes.subarray(offset, offset + 57)));
  return lines.join(CRLF);
}

function subjectHeader(subject: string): string {
  if (subject.length <= 67 && /^[\x20-\x7E]*$/.test(subject) && subject.trim() === subject && !subject.includes('=?')) {
    return 'Subject: ' + subject;
  }
  // Limit the first encoded line including "Subject: " to 76 characters.
  // Encode whole Unicode code points so adjacent words decode independently.
  const words: string[] = [];
  let bytes: number[] = [];
  const word = () => '=?UTF-8?B?' + base64(Uint8Array.from(bytes)) + '?=';
  for (const character of subject) {
    const encoded = encoder.encode(character);
    if (bytes.length + encoded.length > 39) {
      words.push(word());
      bytes = [];
    }
    bytes.push(...encoded);
  }
  if (bytes.length) words.push(word());
  return 'Subject: ' + words.join(CRLF + ' ');
}

function attachmentHeader(filename: string, rowNumber: number): string {
  const fallback = 'filename="row-' + rowNumber + '.pdf"';
  if (filename.length <= 62 && /^[\x20-\x7E]+$/.test(filename)) {
    // The ZIP filename gate already rejects quotes and backslashes.
    return 'Content-Disposition: attachment;' + CRLF + ' filename="' + filename + '"';
  }
  // Percent-encode each full code point and fold at RFC 2231 parameter boundaries.
  const segments: string[] = [];
  let segment = '';
  for (const character of filename) {
    const encoded = /^[A-Za-z0-9._~-]$/.test(character)
      ? character : Array.from(encoder.encode(character), (byte) => '%' + byte.toString(16).toUpperCase().padStart(2, '0')).join('');
    if (segment.length + encoded.length > 51) {
      segments.push(segment);
      segment = '';
    }
    segment += encoded;
  }
  segments.push(segment);
  const parameters = segments.length === 1 ? ["filename*=UTF-8''" + segments[0]] : segments.map((part, index) =>
    'filename*' + index + '*=' + (index === 0 ? "UTF-8''" : '') + part);
  return ['Content-Disposition: attachment', ...parameters, fallback].join(';' + CRLF + ' ');
}

function createDraft(draft: PreparedDraft, bytes: Uint8Array, date: string) {
  const { rowNumber, filename, recipient, cc, subject, body } = draft;
  // "-" and "." are outside the base64 alphabet, so this delimiter cannot occur in either body.
  const boundary = 'ArabiForm.Draft-' + rowNumber;
  return encoder.encode([
    'Date: ' + date,
    'From: ArabiForm Local Draft <draft@arabiform.invalid>',
    'To: ' + recipient,
    ...(cc !== undefined && cc !== '' ? ['Cc: ' + cc] : []),
    subjectHeader(subject),
    'MIME-Version: 1.0',
    'X-Unsent: 1',
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(encoder.encode(body.replace(/\r\n|\r|\n/g, CRLF))),
    '--' + boundary,
    'Content-Type: application/pdf',
    attachmentHeader(filename, rowNumber),
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(bytes),
    '--' + boundary + '--',
    '',
  ].join(CRLF));
}

export async function createDispatchPack(
  prepared: ReturnType<typeof prepareDispatchRows>,
  pdfZip: { bytes: Uint8Array; entries: CustodyEntry[] },
  options: { date?: Date; redactedFields?: string[]; custodyManifest?: string } = {},
): Promise<DispatchPackResult> {
  if (prepared.status === 'blocked') return prepared;
  const { drafts } = prepared;
  if (!drafts.length) throw new Error('empty-export');
  const mismatch = (rowNumber: number): DispatchIssue => ({ rowNumber, code: 'attachment-mismatch', field: 'attachment' });
  let members: Record<string, Uint8Array>;
  try {
    members = unzipSync(pdfZip.bytes);
  } catch {
    return { status: 'blocked', issues: drafts.map(({ rowNumber }) => mismatch(rowNumber)) };
  }
  if (drafts.length !== pdfZip.entries.length || drafts.length !== Object.keys(members).length) {
    return { status: 'blocked', issues: drafts.map(({ rowNumber }) => mismatch(rowNumber)) };
  }
  const issues: DispatchIssue[] = [];
  const seen = new Set<string>();
  for (const [index, { rowNumber, filename, zipPath }] of drafts.entries()) {
    const path = zipPath ?? filename;
    const entry = pdfZip.entries[index]!;
    const bytes = Object.hasOwn(members, path) ? members[path] : undefined;
    if (!bytes?.length || seen.has(path) || entry.filename !== filename || entry.zipPath !== zipPath
      || entry.bytes !== bytes.length || entry.sha256 !== await sha256(bytes)) issues.push(mismatch(rowNumber));
    seen.add(path);
  }
  if (issues.length) return { status: 'blocked', issues };
  const date = (options.date ?? new Date()).toUTCString().replace('GMT', '+0000');
  const files: Record<string, Uint8Array> = Object.create(null);
  const entries: DispatchLedgerEntry[] = [];
  for (const [index, draft] of drafts.entries()) {
    const { rowNumber, filename: pdfFilename, zipPath = pdfFilename, recipient, cc } = draft;
    const emlFilename = 'row-' + String(rowNumber).padStart(4, '0') + '.eml';
    const eml = createDraft(draft, members[zipPath]!, date);
    files[emlFilename] = eml;
    entries.push({ rowNumber, recipient, ...(cc && { cc }), pdfFilename, pdfZipPath: zipPath,
      pdfSha256: pdfZip.entries[index]!.sha256, emlFilename, emlSha256: await sha256(eml) });
  }
  const ledgerCsv = Papa.unparse({
    fields: ['rowNumber', 'recipient', 'cc', 'pdfFilename', 'pdfZipPath', 'pdfSha256', 'emlFilename', 'emlSha256'],
    data: entries.map(({ rowNumber, recipient, cc = '', pdfFilename, pdfZipPath, pdfSha256, emlFilename, emlSha256 }) => [
      rowNumber, ...[recipient, cc, pdfFilename, pdfZipPath].map(escapeSpreadsheetCell), pdfSha256, emlFilename, emlSha256,
    ]),
  }) + CRLF;
  const { redactedFields } = options;
  const review = redactedFields?.length ? { redactedReview: true, redactedFields } : undefined;
  const ledgerJson = JSON.stringify({ version: 1, ...review, entries }, null, 2) + '\n';
  files[DISPATCH_CSV_FILENAME] = encoder.encode(ledgerCsv);
  files[DISPATCH_JSON_FILENAME] = encoder.encode(ledgerJson);
  if (options.custodyManifest !== undefined) files['custody-manifest.json'] = encoder.encode(options.custodyManifest);
  return { status: 'ready', bytes: zipSync(files, { level: 1, mtime: new Date(2000, 0, 1, 12) }),
    ledgerCsv, ledgerJson, entries, pdfEntries: pdfZip.entries, ...(review && { redactedFields }) };
}
