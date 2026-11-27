import type { QrPrintRequest } from '../core/pdf/qr-settings';
import type { BatchProgress, BatchRowResult } from '../core/worker/client';
import type { ExportScope } from '../core/worker/row-selection';
import { errorCode } from './resources';
import type { BatchSettings, BatchWorker, ExportKind, OutputSettings } from './useBatch';

export async function buildDownload(
  kind: ExportKind,
  client: Pick<BatchWorker, 'zip' | 'merged'>,
  onProgress: (progress: BatchProgress) => void,
  { rows, localDate }: Pick<BatchSettings, 'rows' | 'localDate'>,
  results: BatchRowResult[],
  { filenamePlans, flattenZip, cover, watermark, rowSelection, qrStamp, imposition }: OutputSettings,
  scope: ExportScope,
  isCurrent: () => boolean,
) {
  if (kind === 'csv' || kind === 'json') {
    const { createAudit } = await import('../core/pdf');
    const audit = createAudit(results.map((result, index) => ({
      rowNumber: index + 1,
      filename: filenamePlans[index]!.filename,
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
  const { bytes, ...digests } = await (isZip
    ? client.zip(filenames, onProgress, flattenZip, flattenZip ? watermark : undefined, rowSelection, qrRequest)
    : client.merged(onProgress, cover ? { ...cover, filenames } : undefined, watermark, rowSelection, qrRequest, imposition));
  return { data: bytes, filename: isZip ? 'arabiform-clean.zip' : 'arabiform-merged.pdf', mime: isZip ? 'application/zip' : 'application/pdf', digests };
}
