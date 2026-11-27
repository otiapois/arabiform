import type { ExportScope } from '../worker/row-selection';
import type { CustodyQrRecord } from '../custody/records';

export interface CustodySources {
  templateSha256: string;
  rosterSha256: string;
  sheetName?: string;
}

export interface CustodyEntry {
  filename: string;
  sha256: string;
  bytes: number;
  zipPath?: string;
}

export interface GroupedCustodyEntry extends CustodyEntry {
  groupValue: string | null;
  folder: string;
  zipPath: string;
  rowNumbers: number[];
}

interface CustodyOutputs {
  entries?: readonly CustodyEntry[];
  mergedPdfSha256?: string;
  groupByColumn?: string;
  groups?: readonly GroupedCustodyEntry[];
  qrRecords?: readonly CustodyQrRecord[];
}

export interface CustodyManifest extends CustodySources, CustodyOutputs, Partial<ExportScope> {
  version: 1;
}

export const CUSTODY_PREFIX_LENGTH = 12;
export const MERGED_CUSTODY_FILENAME = 'arabiform-merged.pdf';

export async function sha256(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const input = bytes instanceof ArrayBuffer ? bytes : bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashCustodySources(template: Uint8Array | ArrayBuffer, roster: Uint8Array | ArrayBuffer, sheetName?: string): Promise<CustodySources> {
  const [templateSha256, rosterSha256] = await Promise.all([sha256(template), sha256(roster)]);
  return { templateSha256, rosterSha256, ...(sheetName !== undefined && { sheetName }) };
}

export function createCustodyManifest(
  { templateSha256, rosterSha256, sheetName }: CustodySources, { entries, mergedPdfSha256, groupByColumn, groups, qrRecords }: CustodyOutputs = {},
  scope?: ExportScope,
): string {
  const manifest: CustodyManifest = {
    version: 1, templateSha256, rosterSha256,
    ...(sheetName !== undefined && { sheetName }),
    ...(scope && { exportScope: scope.exportScope, selectedRowNumbers: scope.selectedRowNumbers }),
    ...(entries && { entries: entries.map(({ filename, sha256, bytes, zipPath }) => ({ filename, sha256, bytes, ...(zipPath !== undefined && { zipPath }) })) }),
    ...(mergedPdfSha256 && { mergedPdfSha256 }),
    ...(groupByColumn !== undefined && { groupByColumn }),
    ...(groups && { groups: groups.map(({ groupValue, folder, rowNumbers, filename, zipPath, sha256, bytes }) =>
      ({ groupValue, folder, rowNumbers, filename, zipPath, sha256, bytes })) }),
    ...(qrRecords?.length && { qrRecords: qrRecords.map(({ rowNumber, payload }) => ({ rowNumber, payload })) }),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
