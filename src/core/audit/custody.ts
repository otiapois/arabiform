import type { ExportScope } from '../worker/row-selection';

export interface CustodySources {
  templateSha256: string;
  rosterSha256: string;
}

export interface CustodyEntry {
  filename: string;
  sha256: string;
  bytes: number;
}

interface CustodyOutputs {
  entries?: readonly CustodyEntry[];
  mergedPdfSha256?: string;
}

export interface CustodyManifest extends CustodySources, CustodyOutputs, Partial<ExportScope> {
  version: 1;
}

export const CUSTODY_PREFIX_LENGTH = 12;

export async function sha256(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const input = bytes instanceof ArrayBuffer ? bytes : bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashCustodySources(template: Uint8Array | ArrayBuffer, roster: Uint8Array | ArrayBuffer): Promise<CustodySources> {
  const [templateSha256, rosterSha256] = await Promise.all([sha256(template), sha256(roster)]);
  return { templateSha256, rosterSha256 };
}

export function createCustodyManifest(
  { templateSha256, rosterSha256 }: CustodySources, { entries, mergedPdfSha256 }: CustodyOutputs = {},
  scope?: ExportScope,
): string {
  const manifest: CustodyManifest = {
    version: 1, templateSha256, rosterSha256,
    ...(scope && { exportScope: scope.exportScope, selectedRowNumbers: scope.selectedRowNumbers }),
    ...(entries && { entries: entries.map(({ filename, sha256, bytes }) => ({ filename, sha256, bytes })) }),
    ...(mergedPdfSha256 && { mergedPdfSha256 }),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
