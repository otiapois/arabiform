import { hashCustodySources, sha256 } from '../audit/custody';
import { createCustodyQrRecords, type CustodyQrRecord } from '../custody/records';
import { validateGroupingPlan } from '../export/grouping';
import { createMergedPdf, preflightRow, prepareRowPreflight } from '../pdf';
import { createGeneratedZip, createSplitMergedZip } from '../pdf/exports';
import { isCoverLanguage, validateBatchQrPrintRequest, type QrPrintRequest } from '../pdf/qr-settings';
import type { BatchCommand, BatchInput, BatchPreflightResult, BatchProgress, BatchResult, BatchRowResult } from './protocol';
import { resolveRowSelection } from './row-selection';

export const BATCH_CHUNK_SIZE = 25;
type ProgressListener = (progress: BatchProgress) => void;

type RowInputs = Omit<BatchInput, 'roster' | 'sheetName'>;

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
      const { roster, sheetName, ...input } = command.input;
      const rows = await preflightBatch(input, progress);
      const custody = await hashCustodySources(input.template, roster, sheetName);
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

    const coverSheet = phase === 'zip' ? undefined : command.coverSheet;
    const filenames = phase === 'zip' ? command.filenames : coverSheet?.filenames;
    if (filenames && filenames.length !== results.length) {
      throw new Error(phase === 'zip' ? 'batch-filename-count-mismatch' : 'cover-sheet-invalid-metadata');
    }
    const grouping = phase === 'merged' ? undefined : command.grouping;
    if (grouping) validateGroupingPlan(grouping, results.length);
    const scope = resolveRowSelection(results, command.rowSelection);
    const { selectedRowNumbers } = scope;
    if (!selectedRowNumbers.length) throw new Error('empty-export');
    const ready = selectedRowNumbers.map((rowNumber) => {
      const index = rowNumber - 1;
      return { filename: grouping?.rows[index]?.filename ?? filenames?.[index] ?? '', getPdfBytes: () => getPdfBytes(index) };
    });
    const watermark = command.watermark && { settings: command.watermark, fonts: input.options.fonts };
    let qrStamp: QrPrintRequest | undefined;
    let qrRecords: CustodyQrRecord[] | undefined;
    if (command.qrStamp !== undefined && (phase !== 'zip' || command.flattenZip)) {
      const request = validateBatchQrPrintRequest(command.qrStamp, results.length);
      if ('custodyRecord' in request) qrRecords = await createCustodyQrRecords(custody, selectedRowNumbers);
      const { placement, sizePt } = request;
      qrStamp = {
        placement, sizePt,
        payloads: 'payloads' in request ? selectedRowNumbers.map((number) => request.payloads[number - 1]!) : qrRecords!.map(({ payload }) => payload),
      };
    }
    if (phase === 'zip') {
      const paths = grouping && selectedRowNumbers.map((number) => grouping.rows[number - 1]!.zipPath);
      const zip = await createGeneratedZip(ready, progress, command.flattenZip, watermark, qrStamp, paths);
      return { ...zip, ...(grouping && { groupByColumn: grouping.groupByColumn }), ...(qrRecords && { qrRecords }) };
    }
    const coverLanguage = coverSheet?.coverLanguage ?? 'auto';
    if (!isCoverLanguage(coverLanguage)) throw new Error('cover-sheet-invalid-metadata');
    const cover = coverSheet && {
      locale: coverLanguage === 'auto' ? coverSheet.locale : coverLanguage,
      templateName: coverSheet.templateName,
      exportedAt: new Date(),
      preflight: input.options,
      rowNumbers: selectedRowNumbers,
      flagged: results.filter(({ status }) => status === 'flagged').length,
      skipped: results.length - ready.length,
      custody: coverSheet.includeCustody ? custody : undefined,
    };
    if (phase === 'split') {
      const byRow = new Map(selectedRowNumbers.map((number, index) => [number, ready[index]!]));
      const groups = command.grouping.groups.flatMap(({ groupValue, folder, rowNumbers }) => {
        const members = rowNumbers.filter((number) => byRow.has(number));
        if (!members.length) return [];
        return [{ groupValue, folder, rowNumbers: members, rows: members.map((number) => byRow.get(number)!), cover: cover && {
          ...cover, rowNumbers: members,
          flagged: rowNumbers.filter((number) => results[number - 1]!.status === 'flagged').length,
          skipped: rowNumbers.length - members.length,
        } }];
      });
      return createSplitMergedZip(groups, custody, scope, command.grouping.groupByColumn, progress, watermark, qrStamp, command.imposition, qrRecords);
    }
    const bytes = await createMergedPdf(ready, progress, cover, watermark, qrStamp, command.imposition);
    return { bytes, mergedPdfSha256: await sha256(bytes), ...(qrRecords && { qrRecords }) };
  }

  return (command: BatchCommand, notify: ProgressListener) => {
    // Serialize requests so rapid preview clicks can't stage several output
    // PDFs or overlap generation with an export in the same worker.
    const current = pending.then(() => handle(command, notify));
    pending = current.then(() => undefined, () => undefined);
    return current;
  };
}
