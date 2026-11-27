import { hashCustodySources, sha256 } from '../audit/custody';
import { createMergedPdf, preflightRow, prepareRowPreflight } from '../pdf';
import { createGeneratedZip } from '../pdf/exports';
import { isCoverLanguage, validateQrPrintRequest, type QrPrintRequest } from '../pdf/qr-settings';
import type { BatchCommand, BatchInput, BatchPreflightResult, BatchProgress, BatchResult, BatchRowResult } from './protocol';
import { resolveRowSelection } from './row-selection';

export const BATCH_CHUNK_SIZE = 25;
type ProgressListener = (progress: BatchProgress) => void;

type RowInputs = Omit<BatchInput, 'roster'>;

async function preflightBatch(input: RowInputs, progress: (completed: number, total: number) => void) {
  const { rows, template, options } = input;
  const results: BatchRowResult[] = [];
  progress(0, rows.length);
  if (!rows.length) return results;
  const check = await prepareRowPreflight(template, options);
  for (let start = 0; start < rows.length; start += BATCH_CHUNK_SIZE) {
    for (const row of rows.slice(start, start + BATCH_CHUNK_SIZE)) results.push(await check(row));
    progress(results.length, rows.length);
    if (results.length < rows.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return results;
}

export function createBatchProcessor() {
  let preflightStarted = false;
  let retained: { input: RowInputs; checked: BatchPreflightResult } | undefined;
  let pending: Promise<unknown> = Promise.resolve();

  async function handle(command: BatchCommand, notify: ProgressListener): Promise<BatchResult> {
    const { phase } = command;
    const progress = (completed: number, total: number) => {
      if (phase !== 'preview') notify({ phase, completed, total });
    };
    if (phase === 'preflight') {
      if (preflightStarted) throw new Error('batch-already-started');
      preflightStarted = true;
      const { roster, ...input } = command.input;
      const rows = await preflightBatch(input, progress);
      const custody = await hashCustodySources(input.template, roster);
      const checked = { rows, custody };
      retained = { input, checked };
      return checked;
    }
    if (!retained) throw new Error('batch-not-ready');
    const { input, checked: { rows: results, custody } } = retained;
    const getPdfBytes = async (index: number) => {
      const { pdfBytes } = await preflightRow(input.template, input.rows[index]!, input.options);
      if (!pdfBytes) throw new Error('batch-render-failed');
      return pdfBytes;
    };
    if (phase === 'preview') {
      if (results[command.rowIndex]?.status === 'pass') return getPdfBytes(command.rowIndex);
      return undefined;
    }

    const coverSheet = phase === 'merged' ? command.coverSheet : undefined;
    const filenames = phase === 'zip' ? command.filenames : coverSheet?.filenames;
    if (filenames && filenames.length !== results.length) {
      throw new Error(phase === 'zip' ? 'batch-filename-count-mismatch' : 'cover-sheet-invalid-metadata');
    }
    const { selectedRowNumbers } = resolveRowSelection(results, command.rowSelection);
    if (!selectedRowNumbers.length) throw new Error('empty-export');
    const ready = selectedRowNumbers.map((rowNumber) => {
      const index = rowNumber - 1;
      return { filename: filenames?.[index] ?? '', getPdfBytes: () => getPdfBytes(index) };
    });
    const watermark = command.watermark && { settings: command.watermark, fonts: input.options.fonts };
    let qrStamp: QrPrintRequest | undefined;
    if (command.qrStamp !== undefined && (phase === 'merged' || command.flattenZip)) {
      const { placement, sizePt, payloads } = validateQrPrintRequest(command.qrStamp, results.length);
      qrStamp = { placement, sizePt, payloads: selectedRowNumbers.map((number) => payloads[number - 1]!) };
    }
    if (phase === 'zip') return createGeneratedZip(ready, progress, command.flattenZip, watermark, qrStamp);
    const coverLanguage = coverSheet?.coverLanguage ?? 'auto';
    if (!isCoverLanguage(coverLanguage)) throw new Error('cover-sheet-invalid-metadata');
    const bytes = await createMergedPdf(ready, progress, coverSheet && {
      locale: coverLanguage === 'auto' ? coverSheet.locale : coverLanguage,
      templateName: coverSheet.templateName,
      exportedAt: new Date(),
      preflight: input.options,
      rowNumbers: selectedRowNumbers,
      flagged: results.filter(({ status }) => status === 'flagged').length,
      skipped: results.length - ready.length,
      custody: coverSheet.includeCustody ? custody : undefined,
    }, watermark, qrStamp);
    return { bytes, mergedPdfSha256: await sha256(bytes) };
  }

  return (command: BatchCommand, notify: ProgressListener) => {
    // Serialize requests so rapid preview clicks can't stage several output
    // PDFs or overlap generation with an export in the same worker.
    const current = pending.then(() => handle(command, notify));
    pending = current.then(() => undefined, () => undefined);
    return current;
  };
}
