import type { BatchQrPrintRequest, QrStampSettings } from '../core/pdf/qr-settings';
import type { BatchProgress, BatchRowResult } from '../core/worker/client';
import type { ExportScope } from '../core/worker/row-selection';
import { mergeCoverRequest } from './merge-cover-request';
import { errorCode } from './resources';
import type { BatchSettings, BatchWorker, ExportKind, OutputSettings } from './useBatch';

export async function makeQrPrintRequest(
  { rows, localDate }: Pick<BatchSettings, 'rows' | 'localDate'>,
  qrStamp: Exclude<QrStampSettings, { placement: 'none' }> | undefined,
  rowNumbers: readonly number[],
): Promise<BatchQrPrintRequest | undefined> {
  if (!qrStamp) return;
  const { placement, sizePt, pattern } = qrStamp;
  if (qrStamp.custodyRecord) return { placement, sizePt, custodyRecord: true };
  const { resolveQrPayload } = await import('../core/pdf/qr-encoder');
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
  client: Pick<BatchWorker, 'zip' | 'merged' | 'split'>,
  onProgress: (progress: BatchProgress) => void,
  roster: Pick<BatchSettings, 'rows' | 'localDate'>,
  results: BatchRowResult[],
  { filenamePlans, flattenZip, cover, watermark, rowSelection, qrStamp, approvalSeal, imposition, grouping }: OutputSettings,
  scope: ExportScope,
  isCurrent: () => boolean,
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
    })), scope);
    return { data: audit[kind], filename: `arabiform-preflight.${kind}`, mime: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' };
  }

  const isZip = kind === 'zip';
  const prints = !isZip || flattenZip;
  const qrRequest = prints && qrStamp ? await makeQrPrintRequest(roster, qrStamp, scope.selectedRowNumbers) : undefined;
  if (!isCurrent()) return;
  const filenames = isZip ? filenamePlans.map(({ filename }) => filename) : [];
  const coverSheet = !isZip ? mergeCoverRequest(cover, filenamePlans) : undefined;
  if (kind === 'split') {
    const { bytes, ...digests } = await client.split(grouping!, onProgress, coverSheet, watermark, rowSelection, qrRequest, imposition, approvalSeal);
    return { data: bytes, filename: 'arabiform-split-merged.zip', mime: 'application/zip', digests };
  }
  const zipArgs = [filenames, onProgress, flattenZip, flattenZip ? watermark : undefined, rowSelection, qrRequest] as const;
  const { bytes, ...digests } = await (isZip
    ? client.zip(...zipArgs, grouping, prints ? approvalSeal : undefined)
    : client.merged(onProgress, coverSheet, watermark, rowSelection, qrRequest, imposition, approvalSeal));
  return { data: bytes, filename: isZip ? 'arabiform-clean.zip' : 'arabiform-merged.pdf', mime: isZip ? 'application/zip' : 'application/pdf', digests };
}
