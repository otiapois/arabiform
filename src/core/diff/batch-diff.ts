import Papa from 'papaparse';
import { PDFArray, PDFName, PDFNull } from 'pdf-lib';
import { sha256 } from '../audit/custody';
import { decodeText, invalidPdf, radioOption, readSavedFields } from '../pdf/saved-fields';
import { loadPdf, PdfIntakeError } from '../pdf/template';
import { escapeSpreadsheetCell } from '../roster/spreadsheet-csv';
import { BatchDiffError } from './errors';
import { readBatchZip, writeDeltaZip } from './zip';

export { BatchDiffError, type BatchDiffCode } from './errors';
export { MAX_BATCH_ZIP_BYTES } from './zip';
export const DELTA_ZIP_FILENAME = 'delta-reprint-pdfs.zip';
export const BATCH_DIFF_CSV_FILENAME = 'batch-diff-audit.csv';
export const BATCH_DIFF_JSON_FILENAME = 'batch-diff-audit.json';

export type BatchDiffStatus = 'unchanged' | 'modified' | 'added' | 'removed';
export type BatchDiffValue = string | string[] | null;

export interface BatchDiffFieldChange {
  field: string;
  oldValue: BatchDiffValue;
  newValue: BatchDiffValue;
  oldNativeValue?: string;
  newNativeValue?: string;
}

export interface BatchDiffEntry {
  path: string;
  previousPath: string | null;
  nextPath: string | null;
  status: BatchDiffStatus;
  reason: 'visual-or-flattened-change' | 'field-value-change' | null;
  fieldChanges: BatchDiffFieldChange[];
  previousSha256: string | null;
  nextSha256: string | null;
  previousPages: number | null;
  nextPages: number | null;
}

export interface BatchDiffAudit {
  version: 1;
  hashes: { previousSha256: string; nextSha256: string; deltaSha256: string };
  counts: Record<BatchDiffStatus, number>;
  reprint: { fullPages: number; deltaPages: number; savedPages: number; savingsPercent: number | null; sheetsPerPage: 1 };
  entries: BatchDiffEntry[];
}

export interface BatchDiffResult extends BatchDiffAudit {
  deltaZip: Uint8Array;
  auditCsv: Uint8Array;
  auditJson: Uint8Array;
}

type SavedValue = { value: BatchDiffValue; native?: string };
type PdfMember = { path: string; bytes: Uint8Array; pages: number; hash: string; fields: Map<string, SavedValue> };
const encoder = new TextEncoder();
const ascii = new TextDecoder('ascii');
const absent: SavedValue = { value: null };

function checkPdfEnvelope(bytes: Uint8Array) {
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\x00\t\n\f\r ]/.test(ascii.decode(bytes.subarray(0, 12)))) invalidPdf();
  let end = bytes.length;
  while (end && [0, 9, 10, 12, 13, 32].includes(bytes[end - 1]!)) end--;
  const trailer = ascii.decode(bytes.subarray(Math.max(0, end - 128), end));
  const lastXref = /(?:^|[\r\n])startxref[\t\r\n ]+(\d+)[\t\r\n ]+%%EOF$/.exec(trailer);
  if (!lastXref) return invalidPdf();
  const offset = Number(lastXref[1]);
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= end
    || !/^(?:xref[\t\r\n ]|\d+[\t ]+\d+[\t ]+obj[\t\r\n ])/.test(ascii.decode(bytes.subarray(offset, offset + 48)))) invalidPdf();
}

async function inspectBatch(bytes: Uint8Array, batch: BatchDiffError['batch']): Promise<Map<string, PdfMember>> {
  const verified = new Map<string, PdfMember>();
  for (const member of readBatchZip(bytes, batch)) {
    const { path, key, bytes } = member;
    try {
      const doc = await loadPdf(bytes);
      checkPdfEnvelope(bytes);
      const fields = new Map<string, SavedValue>();
      for (const { name, kind, value, options, widgets } of readSavedFields(doc, true)) {
        if (value === undefined || value === PDFNull) {
          fields.set(name, absent);
        } else if (kind === 'checkbox' || kind === 'radio') {
          if (!(value instanceof PDFName)) return invalidPdf();
          const native = value.decodeText();
          const exported = kind === 'radio' && native !== 'Off' && options !== undefined ? radioOption(value, options, widgets).value : native;
          fields.set(name, { value: exported, ...(exported !== native && { native }) });
        } else {
          const decoded = kind !== 'text' && value instanceof PDFArray
            ? Array.from({ length: value.size() }, (_, index) => decodeText(value.lookup(index)))
            : decodeText(value);
          fields.set(name, { value: decoded });
        }
      }
      const pages = doc.getPages();
      if (!pages.length) invalidPdf();
      for (const page of pages) {
        const { width, height } = page.getSize();
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) invalidPdf();
      }
      verified.set(key, { path, bytes, pages: pages.length, fields, hash: await sha256(bytes) });
    } catch (cause) {
      const code = cause instanceof PdfIntakeError && cause.code !== 'flat-scanned-no-fields' ? cause.code : 'invalid-pdf';
      throw new BatchDiffError(batch, code, path, cause);
    }
  }
  return verified;
}

function compareFields(previous: PdfMember, next: PdfMember): BatchDiffFieldChange[] {
  if (!previous.fields.size || !next.fields.size) return [];
  const names = [...new Set([...previous.fields.keys(), ...next.fields.keys()])].sort();
  return names.flatMap((field) => {
    const { value: oldValue, native: oldNativeValue } = previous.fields.get(field) ?? absent;
    const { value: newValue, native: newNativeValue } = next.fields.get(field) ?? absent;
    if (JSON.stringify(oldValue) === JSON.stringify(newValue) && oldNativeValue === newNativeValue) return [];
    return [{ field, oldValue, newValue,
      ...(oldNativeValue !== undefined && { oldNativeValue }), ...(newNativeValue !== undefined && { newNativeValue }) }];
  });
}

function serializeCsv({ entries, hashes, counts, reprint }: BatchDiffAudit): Uint8Array {
  const rows = [[
    'record_type', 'path', 'previous_path', 'next_path', 'status', 'reason', 'field',
    'old_value_type', 'old_value', 'new_value_type', 'new_value', 'old_native_value', 'new_native_value',
    'previous_pdf_sha256', 'next_pdf_sha256', 'previous_pages', 'next_pages',
    'previous_zip_sha256', 'next_zip_sha256', 'delta_zip_sha256', 'unchanged', 'modified', 'added', 'removed',
    'full_pages', 'delta_pages', 'saved_pages', 'savings_percent', 'sheets_per_page',
  ]];
  rows.push(['summary', ...Array<string>(16).fill(''), hashes.previousSha256, hashes.nextSha256, hashes.deltaSha256,
    ...[counts.unchanged, counts.modified, counts.added, counts.removed,
      reprint.fullPages, reprint.deltaPages, reprint.savedPages].map(String), reprint.savingsPercent?.toString() ?? '', '1']);
  for (const entry of entries) {
    const changes = entry.fieldChanges.length ? entry.fieldChanges : [null];
    const valueCells = (value: BatchDiffValue): string[] => value === null ? ['null', ''] : Array.isArray(value)
      ? ['array', JSON.stringify(value)] : ['string', value];
    for (const change of changes) {
      rows.push(['pdf', entry.path, entry.previousPath ?? '', entry.nextPath ?? '', entry.status, entry.reason ?? '',
        ...(change ? [change.field, ...valueCells(change.oldValue), ...valueCells(change.newValue),
          change.oldNativeValue ?? '', change.newNativeValue ?? ''] : Array<string>(7).fill('')),
        entry.previousSha256 ?? '', entry.nextSha256 ?? '', entry.previousPages?.toString() ?? '', entry.nextPages?.toString() ?? '',
        ...Array<string>(12).fill('')]);
    }
  }
  return encoder.encode(Papa.unparse(rows.map((row) => row.map(escapeSpreadsheetCell)), { newline: '\r\n' }) + '\r\n');
}

export async function compareBatches(previous: Uint8Array, next: Uint8Array): Promise<BatchDiffResult> {
  // Validate each archive separately, including input members whose hashes match.
  const previousMembers = await inspectBatch(previous, 'previous');
  const nextMembers = await inspectBatch(next, 'next');
  const keys = [...new Set([...previousMembers.keys(), ...nextMembers.keys()])].sort();
  const entries: BatchDiffEntry[] = [];
  const deltaMembers = new Map<string, Uint8Array>();
  const counts = { unchanged: 0, modified: 0, added: 0, removed: 0 };
  let fullPages = 0;
  let deltaPages = 0;
  for (const key of keys) {
    const old = previousMembers.get(key);
    const current = nextMembers.get(key);
    const status = !old ? 'added' : !current ? 'removed' : old.hash === current.hash ? 'unchanged' : 'modified';
    counts[status]++;
    if (current) {
      fullPages += current.pages;
      if (status !== 'unchanged') {
        deltaPages += current.pages;
        deltaMembers.set(current.path, current.bytes);
      }
    }
    const fieldChanges = old && current && status === 'modified' ? compareFields(old, current) : [];
    entries.push({
      path: (current ?? old)!.path, previousPath: old?.path ?? null, nextPath: current?.path ?? null, status,
      reason: status === 'modified' ? fieldChanges.length ? 'field-value-change' : 'visual-or-flattened-change' : null,
      fieldChanges,
      previousSha256: old?.hash ?? null, nextSha256: current?.hash ?? null,
      previousPages: old?.pages ?? null, nextPages: current?.pages ?? null,
    });
  }
  const deltaZip = writeDeltaZip(deltaMembers);
  const [previousSha256, nextSha256, deltaSha256] = await Promise.all([sha256(previous), sha256(next), sha256(deltaZip)]);
  const savedPages = fullPages - deltaPages;
  const audit: BatchDiffAudit = {
    version: 1,
    hashes: { previousSha256, nextSha256, deltaSha256 },
    counts, reprint: { fullPages, deltaPages, savedPages, savingsPercent: fullPages ? 100 * savedPages / fullPages : null, sheetsPerPage: 1 },
    entries,
  };
  return { ...audit, deltaZip, auditCsv: serializeCsv(audit), auditJson: encoder.encode(JSON.stringify(audit, null, 2) + '\n') };
}
