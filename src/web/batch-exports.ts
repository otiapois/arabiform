import type { QrPrintRequest } from '../core/pdf/qr-settings';
import type { BatchProgress, BatchRowResult } from '../core/worker/client';
import type { ExportScope } from '../core/worker/row-selection';
import { errorCode } from './resources';
import type { BatchSettings, BatchWorker, ExportKind, OutputSettings } from './useBatch';

export async function buildDownload(
  kind: ExportKind,
  client: Pick<BatchWorker, 'zip' | 'merged' | 'split'>,
  onProgress: (progress: BatchProgress) => void,
  { rows, localDate }: Pick<BatchSettings, 'rows' | 'localDate'>,
  results: BatchRowResult[],
  { filenamePlans, flattenZip, cover, watermark, rowSelection, qrStamp, imposition, grouping }: OutputSettings,
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
  let qrRequest: QrPrintRequest | undefined;
  if (qrStamp && (!isZip || flattenZip)) {
    const { resolveQrPayload } = await import('../core/pdf/qr-encoder');
    if (!isCurrent()) return;
    const { placement, sizePt, pattern } = qrStamp;
    const payloads = Array<string | null>(rows.length).fill(null);
    for (const rowNumber of scope.selectedRowNumbers) {
      try {
        payloads[rowNumber - 1] = resolveQrPayload(pattern, rows[rowNumber - 1]!.values, rowNumber, localDate);
      } catch (error) {
        throw Object.assign(new Error(errorCode(error, 'qr-stamp-invalid-payload')), { rowNumber });
      }
    }
    qrRequest = { placement, sizePt, payloads };
  }
  const filenames = isZip || cover ? filenamePlans.map(({ filename }) => filename) : [];
  const coverSheet = cover ? { ...cover, filenames } : undefined;
  if (kind === 'split') {
    const { bytes, ...digests } = await client.split(grouping!, onProgress, coverSheet, watermark, rowSelection, qrRequest, imposition);
    return { data: bytes, filename: 'arabiform-split-merged.zip', mime: 'application/zip', digests };
  }
  const zipArgs = [filenames, onProgress, flattenZip, flattenZip ? watermark : undefined, rowSelection, qrRequest] as const;
  const { bytes, ...digests } = await (isZip
    ? grouping ? client.zip(...zipArgs, grouping) : client.zip(...zipArgs)
    : client.merged(onProgress, coverSheet, watermark, rowSelection, qrRequest, imposition));
  return { data: bytes, filename: isZip ? 'arabiform-clean.zip' : 'arabiform-merged.pdf', mime: isZip ? 'application/zip' : 'application/pdf', digests };
}
