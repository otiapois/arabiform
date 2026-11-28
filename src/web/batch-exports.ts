import type { BatchQrPrintRequest, QrStampSettings } from '../core/pdf/qr-settings';
import type { BatchProgress, BatchRowResult } from '../core/worker/client';
import type { BatchMergedResult } from '../core/worker/protocol';
import type { ExportScope } from '../core/worker/row-selection';
import { mergeCoverRequest } from './merge-cover-request';
import { errorCode } from './resources';
import type { BatchSettings, BatchWorker, ExportKind, OutputSettings } from './useBatch';

export type MergedPrintCache = { merged?: BatchMergedResult };
const mergedFilename = 'arabiform-merged.pdf';

export async function makeQrPrintRequest(
  { rows, localDate }: Pick<BatchSettings, 'rows' | 'localDate'>,
  qrStamp: Exclude<QrStampSettings, { placement: 'none' }> | undefined,
  rowNumbers: readonly number[],
  isCurrent?: () => boolean,
): Promise<BatchQrPrintRequest | undefined> {
  if (!qrStamp) return;
  const { placement, sizePt, pattern } = qrStamp;
  if (qrStamp.custodyRecord) return { placement, sizePt, custodyRecord: true };
  const { resolveQrPayload } = await import('../core/pdf/qr-encoder');
  if (isCurrent && !isCurrent()) return;
  const payloads = Array<string | null>(rows.length).fill(null);
  for (const rowNumber of rowNumbers) {
    try {
      payloads[rowNumber - 1] = resolveQrPayload(pattern, rows[rowNumber - 1]!.values, rowNumber, localDate);
    } catch (error) {
      throw Object.assign(new Error(errorCode(error, 'qr-stamp-invalid-payload')), { rowNumber });
    }
  }
  return { placement, sizePt, payloads };
}

export async function buildDownload(
  kind: ExportKind,
  client: Pick<BatchWorker, 'zip' | 'merged' | 'split' | 'certificate'>,
  onProgress: (progress: BatchProgress) => void,
  roster: Pick<BatchSettings, 'rows' | 'localDate'>,
  results: BatchRowResult[],
  { filenamePlans, flattenZip, cover, watermark, rowSelection, qrStamp, approvalSeal, imposition, fourUp, grouping }: OutputSettings,
  scope: ExportScope,
  isCurrent: () => boolean,
  mergedCache?: MergedPrintCache,
  names?: Omit<Parameters<BatchWorker['certificate']>[1], 'outputName'>,
) {
  if (kind === 'csv' || kind === 'json') {
    const { createAudit } = await import('../core/pdf');
    const audit = createAudit(results.map((result, index) => ({
      rowNumber: index + 1,
      filename: (grouping?.rows[index] ?? filenamePlans[index]!).filename,
      ...(grouping && { zipPath: grouping.rows[index]!.zipPath }),
      status: result.status,
      diagnostics: result.diagnostics,
      fontSizes: result.fontSizes,
      ...(result.ruleApplied && { ruleApplied: result.ruleApplied }),
    })), scope);
    return { data: audit[kind], filename: `arabiform-preflight.${kind}`, mime: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' };
  }

  const needsMerged = kind === 'merged' || kind === 'certificate';
  if (kind === 'certificate' && !scope.selectedRowNumbers.length) return;
  let merged = needsMerged ? mergedCache?.merged : undefined;
  const isZip = kind === 'zip';
  const prints = !merged && (!isZip || flattenZip);
  const qrRequest = prints && qrStamp ? await makeQrPrintRequest(roster, qrStamp, scope.selectedRowNumbers, isCurrent) : undefined;
  if (!isCurrent()) return;
  const coverSheet = prints && !isZip ? mergeCoverRequest(cover, filenamePlans) : undefined;
  const printArgs = [onProgress, coverSheet, watermark, rowSelection, qrRequest, imposition] as const;
  const extraPrintArgs: [seal?: typeof approvalSeal, grid?: typeof fourUp] = imposition === '4-up' && fourUp
    ? [approvalSeal, fourUp] : approvalSeal ? [approvalSeal] : [];
  if (kind === 'split') {
    const { bytes, ...digests } = await client.split(grouping!, ...printArgs, ...extraPrintArgs);
    return { data: bytes, filename: 'arabiform-split-merged.zip', mime: 'application/zip', digests };
  }
  if (isZip) {
    const filenames = filenamePlans.map(({ filename }) => filename);
    const zipArgs = [filenames, onProgress, flattenZip, flattenZip ? watermark : undefined, rowSelection, qrRequest] as const;
    const { bytes, ...digests } = await (flattenZip && approvalSeal ? client.zip(...zipArgs, grouping, approvalSeal)
      : grouping ? client.zip(...zipArgs, grouping) : client.zip(...zipArgs));
    return { data: bytes, filename: 'arabiform-clean.zip', mime: 'application/zip', digests };
  }
  merged ??= await client.merged(...printArgs, ...extraPrintArgs);
  if (!isCurrent()) return;
  if (mergedCache) mergedCache.merged = merged;
  if (kind === 'certificate') {
    if (!names) throw new Error('exportError');
    const data = await client.certificate(merged, { ...names, outputName: mergedFilename });
    if (isCurrent()) return { data, filename: 'print-shop-certificate.pdf', mime: 'application/pdf' };
    return;
  }
  const { bytes, ...digests } = merged;
  return { data: bytes, filename: mergedFilename, mime: 'application/pdf', digests };
}
