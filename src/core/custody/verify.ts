import { MERGED_CUSTODY_FILENAME, sha256, type CustodyEntry, type CustodySources } from '../audit/custody';
import { isSafeGroupedPdfPath } from '../export/grouping';
import { filenameKey, isSafePdfFilename } from '../roster/filenames';
import { custodyBatchDigestPrefix, parseCustodyQrPayload, type CustodyQrRecord } from './records';

interface ReceiptPdf { filename: string; path?: string; sha256: string; bytes?: number }
export interface VerifiedCustodyManifest {
  readonly sources: Readonly<CustodySources>;
  readonly outputs: readonly Readonly<ReceiptPdf>[];
  readonly qrRecords: readonly Readonly<CustodyQrRecord>[];
  readonly batchDigestPrefix?: string;
}

export interface PdfCustodyVerdict {
  status: 'VERIFIED_EXACT_MATCH' | 'TAMPERED_BYTE_MISMATCH' | 'UNMATCHED_UNKNOWN';
  filename: string;
  sha256: string;
  expectedSha256: string[];
}

export interface QrCustodyVerdict {
  status: 'VERIFIED_QR_RECORD' | 'UNMATCHED_UNKNOWN';
  payload: string;
  rowNumber?: number;
  batchDigestPrefix?: string;
}

const invalid = (): never => { throw new Error('custody-invalid-manifest'); };
const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) && value.length === 64;
const isPositiveInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));

function checkDuplicateKeys(json: string) {
  // The caller has already checked JSON syntax. Tokenize strings as a unit so
  // braces and key-like text in an escaped filename or group cell are inert.
  const objects: Set<string>[] = [];
  for (const [, quoted, property, brace] of json.matchAll(/("(?:[^"\\]|\\.)*")(\s*:)?|([{}])/g)) {
    if (brace === '{') objects.push(new Set());
    else if (brace === '}') objects.pop();
    else if (property) {
      const name = JSON.parse(quoted!) as string;
      const keys = objects.at(-1)!;
      if (keys.has(name)) invalid();
      keys.add(name);
    }
  }
}

function rowNumbers(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((row, index) => isPositiveInt(row) && (index === 0 || row > value[index - 1]))) {
    return invalid();
  }
  return value;
}

const entryKeys = ['filename', 'sha256', 'bytes', 'zipPath'] as const;

function receiptEntry(entry: unknown): CustodyEntry {
  if (!isObject(entry) || typeof entry.filename !== 'string' || !isSafePdfFilename(entry.filename)
    || !isDigest(entry.sha256) || !isPositiveInt(entry.bytes)
    || (entry.zipPath !== undefined && typeof entry.zipPath !== 'string')) return invalid();
  return { filename: entry.filename, sha256: entry.sha256.toLowerCase(), bytes: entry.bytes, zipPath: entry.zipPath };
}

export async function parseCustodyManifest(json: string): Promise<VerifiedCustodyManifest> {
  let data: unknown;
  try {
    data = JSON.parse(json.replace(/^\uFEFF/, ''));
    checkDuplicateKeys(json);
  } catch {
    return invalid();
  }
  if (!isObject(data) || !hasOnlyKeys(data, ['version', 'templateSha256', 'rosterSha256', 'sheetName', 'exportScope', 'selectedRowNumbers',
    'entries', 'mergedPdfSha256', 'groupByColumn', 'groups', 'qrRecords'])) return invalid();
  const { version, templateSha256, rosterSha256, sheetName, exportScope, selectedRowNumbers, entries, mergedPdfSha256, groupByColumn, groups, qrRecords } = data;
  if (version !== 1 || !isDigest(templateSha256) || !isDigest(rosterSha256)
    || (sheetName !== undefined && (typeof sheetName !== 'string' || !sheetName.length || /[\p{Cc}\p{Cs}]/u.test(sheetName)))
    || (groupByColumn !== undefined && (typeof groupByColumn !== 'string' || !groupByColumn.trim()))) return invalid();
  const sources: CustodySources = { templateSha256: templateSha256.toLowerCase(), rosterSha256: rosterSha256.toLowerCase(), sheetName };
  if (exportScope !== 'all-ready' && exportScope !== 'selected-subset' && exportScope !== undefined
    || (selectedRowNumbers === undefined) !== (exportScope === undefined)) return invalid();
  const selected = selectedRowNumbers === undefined ? undefined : rowNumbers(selectedRowNumbers);
  const selectedSet = new Set(selected);
  const outputs: ReceiptPdf[] = [];
  const paths = new Set<string>();
  const sizes = new Map<string, number>();
  const addEntry = (entry: CustodyEntry) => {
    const { filename, sha256, bytes, zipPath: path } = entry;
    const pathKey = filenameKey(path ?? filename);
    if (paths.has(pathKey) || (sizes.has(sha256) && sizes.get(sha256) !== bytes)) invalid();
    paths.add(pathKey);
    sizes.set(sha256, bytes);
    outputs.push({ filename, path, sha256, bytes });
  };

  if (entries !== undefined) {
    if (!Array.isArray(entries)) return invalid();
    let grouped: boolean | undefined;
    for (const candidate of entries) {
      if (!isObject(candidate) || !hasOnlyKeys(candidate, entryKeys)) return invalid();
      const entry = receiptEntry(candidate);
      const { zipPath } = entry;
      if (zipPath !== undefined && (!isSafeGroupedPdfPath(zipPath) || zipPath.split('/')[1] !== entry.filename)
        || grouped !== undefined && grouped !== (zipPath !== undefined)) return invalid();
      grouped = zipPath !== undefined;
      addEntry(entry);
    }
    if (selected && entries.length !== selected.length) return invalid();
  }
  if (groups !== undefined) {
    if (!Array.isArray(groups) || !groups.length || groupByColumn === undefined || !selected) return invalid();
    const coveredRows = new Set<number>();
    const groupValues = new Set<string | null>();
    for (const candidate of groups) {
      if (!isObject(candidate) || !hasOnlyKeys(candidate, [...entryKeys, 'groupValue', 'folder', 'rowNumbers'])) return invalid();
      const { groupValue, folder } = candidate;
      const entry = receiptEntry(candidate);
      const members = rowNumbers(candidate.rowNumbers);
      if (!(groupValue === null || (typeof groupValue === 'string' && groupValue.trim())) || groupValues.has(groupValue)
        || typeof folder !== 'string' || !isSafeGroupedPdfPath(`${folder}/proof.pdf`)
        || entry.filename !== `${folder}-merged.pdf` || entry.zipPath !== entry.filename || !members.length) return invalid();
      groupValues.add(groupValue);
      for (const row of members) {
        if (!selectedSet.has(row) || coveredRows.has(row)) return invalid();
        coveredRows.add(row);
      }
      addEntry(entry);
    }
    if (coveredRows.size !== selected.length) return invalid();
  }
  if (mergedPdfSha256 !== undefined) {
    if (!isDigest(mergedPdfSha256)) return invalid();
    outputs.push({ filename: MERGED_CUSTODY_FILENAME, sha256: mergedPdfSha256.toLowerCase() });
  }

  let batchDigestPrefix: string | undefined;
  const records: CustodyQrRecord[] = [];
  if (qrRecords !== undefined) {
    if (!Array.isArray(qrRecords) || !qrRecords.length || !outputs.length || !selected || qrRecords.length !== selected.length) return invalid();
    batchDigestPrefix = await custodyBatchDigestPrefix(sources);
    for (const [index, record] of qrRecords.entries()) {
      if (!isObject(record) || !hasOnlyKeys(record, ['rowNumber', 'payload']) || record.rowNumber !== selected[index]
        || typeof record.payload !== 'string') return invalid();
      const parsed = parseCustodyQrPayload(record.payload);
      if (!parsed || parsed.batchDigestPrefix !== batchDigestPrefix || parsed.rowNumber !== record.rowNumber) return invalid();
      records.push({ rowNumber: parsed.rowNumber, payload: record.payload });
    }
  }
  return { sources, outputs, qrRecords: records, batchDigestPrefix };
}

export async function verifyCustodyPdf(receipt: VerifiedCustodyManifest, { filename, bytes }: {
  filename: string; bytes: Uint8Array | ArrayBuffer;
}): Promise<PdfCustodyVerdict> {
  const digest = await sha256(bytes);
  const name = filenameKey(filename);
  const named = filename.includes('/') ? receipt.outputs.filter(({ path }) => path !== undefined && filenameKey(path) === name)
    : receipt.outputs.filter(({ filename }) => filenameKey(filename) === name);
  const matched = (named.length ? named : receipt.outputs).find(({ sha256 }) => sha256 === digest);
  if (matched?.bytes !== undefined && matched.bytes !== bytes.byteLength) return invalid();
  return {
    status: matched ? 'VERIFIED_EXACT_MATCH' : named.length ? 'TAMPERED_BYTE_MISMATCH' : 'UNMATCHED_UNKNOWN',
    filename, sha256: digest, expectedSha256: [...new Set(named.length ? named.map(({ sha256 }) => sha256) : matched ? [matched.sha256] : [])],
  };
}

export function verifyCustodyQr(receipt: VerifiedCustodyManifest, payload: string): QrCustodyVerdict {
  const parsed = parseCustodyQrPayload(payload);
  const listed = parsed && parsed.batchDigestPrefix === receipt.batchDigestPrefix
    && receipt.qrRecords.some((record) => record.rowNumber === parsed.rowNumber && record.payload === payload);
  return { status: listed ? 'VERIFIED_QR_RECORD' : 'UNMATCHED_UNKNOWN', payload, ...parsed };
}
