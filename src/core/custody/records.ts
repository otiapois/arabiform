import { CUSTODY_PREFIX_LENGTH, sha256, type CustodySources } from '../audit/custody';

export interface CustodyQrRecord {
  rowNumber: number;
  payload: string;
}

export async function custodyBatchDigestPrefix({ templateSha256, rosterSha256, sheetName }: CustodySources): Promise<string> {
  const identity = JSON.stringify(['ArabiForm custody QR v1', templateSha256, rosterSha256, sheetName ?? null]);
  return (await sha256(new TextEncoder().encode(identity))).slice(0, CUSTODY_PREFIX_LENGTH);
}

export async function createCustodyQrRecords(sources: CustodySources, rowNumbers: readonly number[]): Promise<CustodyQrRecord[]> {
  const prefix = await custodyBatchDigestPrefix(sources);
  return rowNumbers.map((rowNumber) => ({ rowNumber, payload: `ARABIFORM:1:${prefix}:${rowNumber}` }));
}

export function parseCustodyQrPayload(payload: string) {
  const match = /^ARABIFORM:1:([a-f0-9]{12}):([1-9][0-9]{0,15})$/.exec(payload);
  const rowNumber = Number(match?.[2]);
  // A scan must match the entire canonical string, including its line ending.
  return match && match[0] === payload && Number.isSafeInteger(rowNumber)
    ? { rowNumber, batchDigestPrefix: match[1]! } : undefined;
}
