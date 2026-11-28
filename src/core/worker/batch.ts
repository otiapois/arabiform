import { hashCustodySources, sha256, type CustodySources } from '../audit/custody';
import { createCustodyQrRecords } from '../custody/records';
import { validateGroupingPlan } from '../export/grouping';
import type { preparePrintJobEstimator } from '../export/print-estimator';
import { planCombinedPrint, planSplitPrint } from '../export/print-job';
import { preflightRow, prepareTemplatePreflight } from '../pdf';
import { createGeneratedZip, createMergedPrint, createSplitMergedZip, createStampedPreview } from '../pdf/exports';
import type { inspectImpositionCompatibility } from '../pdf/imposition';
import type { PrintPreflightReceipt } from '../pdf/print-certificate';
import { validateBatchQrPrintRequest, type BatchQrPrintRequest, type QrPrintRequest } from '../pdf/qr-settings';
import { selectBoundaryRows } from '../preflight/spotlight';
import { localVirtualDate } from '../roster/virtual-columns';
import { prepareConditionalFields } from '../rules/conditional-fields';
import type { BatchCommand, BatchInput, BatchPreflightResult, BatchProgress, BatchResult, BatchRowResult } from './protocol';
import { resolveRowSelection } from './row-selection';

export const BATCH_CHUNK_SIZE = 25;
type ProgressListener = (progress: BatchProgress) => void;

type RowInputs = Omit<BatchInput, 'roster' | 'sheetName'>;

async function preflightBatch(input: RowInputs, progress: (completed: number, total: number) => void) {
  const { rows, template, options, conditional } = input;
  const results: BatchRowResult[] = [];
  progress(0, rows.length);
  if (!rows.length) return { rows: results, spotlight: {}, renderRows: rows };
  const { check, fields } = await prepareTemplatePreflight(template, options);
  if (conditional?.rules.length && conditional.rows.length !== rows.length) throw new Error('conditional-row-count-mismatch');
  const evaluate = conditional?.rules.length ? prepareConditionalFields(conditional.rules, conditional.columns, fields) : undefined;
  const evaluatedRows = evaluate ? conditional!.rows.map((row, index) => evaluate(rows[index]!, row)) : undefined;
  const renderRows = evaluatedRows?.map(({ values }) => values) ?? rows;
  for (let start = 0; start < rows.length; start += BATCH_CHUNK_SIZE) {
    const end = Math.min(start + BATCH_CHUNK_SIZE, rows.length);
    for (let index = start; index < end; index++) results.push(await check(renderRows[index]!, evaluatedRows?.[index]));
    progress(results.length, rows.length);
    if (results.length < rows.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { rows: results, spotlight: selectBoundaryRows(renderRows, results, fields), renderRows };
}

async function selectPrintQr(qr: BatchQrPrintRequest | undefined, rowCount: number, custody: CustodySources, rowNumbers: readonly number[]) {
  if (qr === undefined) return {};
  const request = validateBatchQrPrintRequest(qr, rowCount);
  const qrRecords = 'custodyRecord' in request ? await createCustodyQrRecords(custody, rowNumbers) : undefined;
  const { placement, sizePt } = request;
  const qrStamp: QrPrintRequest = { placement, sizePt,
    payloads: 'payloads' in request ? rowNumbers.map((number) => request.payloads[number - 1]!) : qrRecords!.map(({ payload }) => payload) };
  return { qrStamp, qrRecords };
}

export function createBatchProcessor() {
  let preflightStarted = false;
  let retained: { input: RowInputs; checked: BatchPreflightResult } | undefined;
  let printSource: Awaited<ReturnType<typeof inspectImpositionCompatibility>> | undefined;
  let estimatePrint: ReturnType<typeof preparePrintJobEstimator> | undefined;
  let lastMergedReceipt: PrintPreflightReceipt | undefined;
  let pending: Promise<unknown> = Promise.resolve();

  async function handle(command: BatchCommand, notify: ProgressListener): Promise<BatchResult> {
    const { phase } = command;
    const progress = (completed: number, total: number) => {
      if (phase !== 'preview' && phase !== 'estimate' && phase !== 'certificate') notify({ phase, completed, total });
    };
    if (phase === 'preflight') {
      if (preflightStarted) throw new Error('batch-already-started');
      preflightStarted = true;
      const { roster, sheetName, ...input } = command.input;
      const { renderRows, ...preflight } = await preflightBatch(input, progress);
      const custody = await hashCustodySources(input.template, roster, sheetName);
      const checked = { ...preflight, custody };
      retained = { input: { template: input.template, options: input.options, rows: renderRows }, checked };
      return checked;
    }
    if (!retained) throw new Error('batch-not-ready');
    if (phase === 'merged') lastMergedReceipt = undefined;
    const { input, checked: { rows: results, custody } } = retained;
    if (phase === 'certificate') {
      if (!lastMergedReceipt) throw new Error('print-certificate-unavailable');
      if (lastMergedReceipt.mergedPdfSha256 !== command.merged.mergedPdfSha256) throw new Error('print-certificate-output-mismatch');
      const { createPrintCertificate } = await import('../pdf/print-certificate');
      return createPrintCertificate(command.merged.bytes, lastMergedReceipt, command.names, input.options.fonts);
    }
    if (phase === 'estimate') {
      const { preparePrintJobEstimator } = await import('../export/print-estimator');
      printSource ??= await (await import('../pdf/imposition')).inspectImpositionCompatibility(input.template);
      estimatePrint ??= preparePrintJobEstimator(input.options);
      return estimatePrint({
        ...command, ...printSource, rows: results, custody, exportedAt: localVirtualDate(new Date()),
      });
    }
    const getPdfBytes = async (index: number) => {
      const { pdfBytes } = await preflightRow(input.template, input.rows[index]!, input.options);
      if (!pdfBytes) throw new Error('batch-render-failed');
      return pdfBytes;
    };
    const approvalSeal = command.approvalSeal === undefined ? undefined : { settings: command.approvalSeal, fonts: input.options.fonts };
    if (phase === 'preview') {
      if (results[command.rowIndex]?.status !== 'pass') return undefined;
      if (!approvalSeal) return getPdfBytes(command.rowIndex);
      const { qrStamp } = await selectPrintQr(command.qrStamp, results.length, custody, [command.rowIndex + 1]);
      return createStampedPreview(await getPdfBytes(command.rowIndex), approvalSeal, qrStamp);
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
    const outputRows = (rowNumbers: readonly number[], names: readonly string[]) =>
      rowNumbers.map((number, index) => ({ filename: names[index]!, getPdfBytes: () => getPdfBytes(number - 1) }));
    const watermark = command.watermark && { settings: command.watermark, fonts: input.options.fonts };
    const { qrStamp, qrRecords } = await selectPrintQr(phase !== 'zip' || command.flattenZip ? command.qrStamp : undefined,
      results.length, custody, selectedRowNumbers);
    if (phase === 'zip') {
      const paths = grouping && selectedRowNumbers.map((number) => grouping.rows[number - 1]!.zipPath);
      const ready = outputRows(selectedRowNumbers,
        selectedRowNumbers.map((number) => grouping?.rows[number - 1]?.filename ?? command.filenames[number - 1] ?? ''));
      const zip = await createGeneratedZip(ready, progress, command.flattenZip, watermark, qrStamp, paths, approvalSeal);
      return { ...zip, ...(grouping && { groupByColumn: grouping.groupByColumn }), ...(qrRecords && { qrRecords }) };
    }
    const context = { rows: results, rowNumbers: selectedRowNumbers, coverSheet, exportedAt: new Date(), preflight: input.options, custody };
    if (phase === 'split') {
      const groups = planSplitPrint(context, command.grouping).map(({ filenames, ...group }) => ({
        ...group, rows: outputRows(group.rowNumbers, filenames),
      }));
      return createSplitMergedZip(groups, custody, scope, command.grouping.groupByColumn, progress, watermark, qrStamp, command.imposition, qrRecords, approvalSeal, command.fourUp);
    }
    const combined = planCombinedPrint(context);
    const imposition = command.imposition ?? '1-up';
    const { bytes, coverPages, pageCount, recordScales } = await createMergedPrint(outputRows(combined.rowNumbers, combined.filenames),
      progress, combined.cover, watermark, qrStamp, imposition, approvalSeal, command.fourUp);
    const mergedPdfSha256 = await sha256(bytes);
    let minimum = Infinity;
    let mappedInkOutsidePrint = false;
    for (const [index, rowNumber] of selectedRowNumbers.entries()) {
      const { smallestInkFontSizePt, mappedInkOutsidePrint: outside } = results[rowNumber - 1]!;
      if (smallestInkFontSizePt !== undefined) minimum = Math.min(minimum, smallestInkFontSizePt * (recordScales?.[index] ?? 1));
      if (outside) mappedInkOutsidePrint = true;
    }
    lastMergedReceipt = { sources: custody, mergedPdfSha256, readyCount: selectedRowNumbers.length, excludedCount: results.length - selectedRowNumbers.length,
      exportScope: scope.exportScope, imposition, pageCount, coverPages, mappedInkOutsidePrint,
      ...(Number.isFinite(minimum) && { minimumMappedFontPt: minimum }) };
    return { bytes, mergedPdfSha256, ...(qrRecords && { qrRecords }) };
  }

  return (command: BatchCommand, notify: ProgressListener) => {
    // Serialize requests so previews, estimates and exports share one prepared batch.
    const current = pending.then(() => handle(command, notify));
    pending = current.then(() => undefined, () => undefined);
    return current;
  };
}
