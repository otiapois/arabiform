import { hashCustodySources, sha256 } from '../audit/custody';
import { createCustodyQrRecords, type CustodyQrRecord } from '../custody/records';
import { validateGroupingPlan } from '../export/grouping';
import type { preparePrintJobEstimator } from '../export/print-estimator';
import { planCombinedPrint, planSplitPrint } from '../export/print-job';
import { createMergedPdf, preflightRow, prepareTemplatePreflight } from '../pdf';
import { createGeneratedZip, createSplitMergedZip } from '../pdf/exports';
import { validateBatchQrPrintRequest, type QrPrintRequest } from '../pdf/qr-settings';
import { hasUnsupportedPrintAnnotation, openTemplate } from '../pdf/template';
import { selectBoundaryRows } from '../preflight/spotlight';
import { localVirtualDate } from '../roster/virtual-columns';
import type { BatchCommand, BatchInput, BatchPreflightResult, BatchProgress, BatchResult, BatchRowResult } from './protocol';
import { resolveRowSelection } from './row-selection';

export const BATCH_CHUNK_SIZE = 25;
type ProgressListener = (progress: BatchProgress) => void;

type RowInputs = Omit<BatchInput, 'roster' | 'sheetName'>;

async function preflightBatch(input: RowInputs, progress: (completed: number, total: number) => void) {
  const { rows, template, options } = input;
  const results: BatchRowResult[] = [];
  progress(0, rows.length);
  if (!rows.length) return { rows: results, spotlight: {} };
  const { check, fields } = await prepareTemplatePreflight(template, options);
  for (let start = 0; start < rows.length; start += BATCH_CHUNK_SIZE) {
    for (const row of rows.slice(start, start + BATCH_CHUNK_SIZE)) results.push(await check(row));
    progress(results.length, rows.length);
    if (results.length < rows.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { rows: results, spotlight: selectBoundaryRows(rows, results, fields) };
}

async function inspectPrintSource(template: RowInputs['template']) {
  const { doc, pages } = await openTemplate(template);
  const templatePagesPerRecord = pages.length;
  if (templatePagesPerRecord !== 1) return { templatePagesPerRecord };
  if (hasUnsupportedPrintAnnotation(doc.getPage(0))) {
    return { templatePagesPerRecord, twoUpUnavailableReason: 'imposition-unsupported-print-annotation' as const };
  }
  const { hasValidImpositionGeometry } = await import('../pdf/imposition');
  return { templatePagesPerRecord, twoUpUnavailableReason: hasValidImpositionGeometry(pages[0]!) ? undefined
    : 'imposition-invalid-page-geometry' as const };
}

export function createBatchProcessor() {
  let preflightStarted = false;
  let retained: { input: RowInputs; checked: BatchPreflightResult } | undefined;
  let printSource: Awaited<ReturnType<typeof inspectPrintSource>> | undefined;
  let estimatePrint: ReturnType<typeof preparePrintJobEstimator> | undefined;
  let pending: Promise<unknown> = Promise.resolve();

  async function handle(command: BatchCommand, notify: ProgressListener): Promise<BatchResult> {
    const { phase } = command;
    const progress = (completed: number, total: number) => {
      if (phase !== 'preview' && phase !== 'estimate') notify({ phase, completed, total });
    };
    if (phase === 'preflight') {
      if (preflightStarted) throw new Error('batch-already-started');
      preflightStarted = true;
      const { roster, sheetName, ...input } = command.input;
      const preflight = await preflightBatch(input, progress);
      const custody = await hashCustodySources(input.template, roster, sheetName);
      const checked = { ...preflight, custody };
      retained = { input, checked };
      return checked;
    }
    if (!retained) throw new Error('batch-not-ready');
    const { input, checked: { rows: results, custody } } = retained;
    if (phase === 'estimate') {
      const { preparePrintJobEstimator } = await import('../export/print-estimator');
      printSource ??= await inspectPrintSource(input.template);
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
    const outputRows = (rowNumbers: readonly number[], names: readonly string[]) =>
      rowNumbers.map((number, index) => ({ filename: names[index]!, getPdfBytes: () => getPdfBytes(number - 1) }));
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
      const ready = outputRows(selectedRowNumbers,
        selectedRowNumbers.map((number) => grouping?.rows[number - 1]?.filename ?? command.filenames[number - 1] ?? ''));
      const zip = await createGeneratedZip(ready, progress, command.flattenZip, watermark, qrStamp, paths);
      return { ...zip, ...(grouping && { groupByColumn: grouping.groupByColumn }), ...(qrRecords && { qrRecords }) };
    }
    const context = { rows: results, rowNumbers: selectedRowNumbers, coverSheet, exportedAt: new Date(), preflight: input.options, custody };
    if (phase === 'split') {
      const groups = planSplitPrint(context, command.grouping).map(({ filenames, ...group }) => ({
        ...group, rows: outputRows(group.rowNumbers, filenames),
      }));
      return createSplitMergedZip(groups, custody, scope, command.grouping.groupByColumn, progress, watermark, qrStamp, command.imposition, qrRecords);
    }
    const combined = planCombinedPrint(context);
    const bytes = await createMergedPdf(outputRows(combined.rowNumbers, combined.filenames), progress, combined.cover, watermark, qrStamp, command.imposition);
    return { bytes, mergedPdfSha256: await sha256(bytes), ...(qrRecords && { qrRecords }) };
  }

  return (command: BatchCommand, notify: ProgressListener) => {
    // Serialize requests so previews, estimates and exports share one prepared batch.
    const current = pending.then(() => handle(command, notify));
    pending = current.then(() => undefined, () => undefined);
    return current;
  };
}
