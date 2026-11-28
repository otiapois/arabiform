import { createCustodyManifest, hashCustodySources, sha256, type CustodySources } from '../audit/custody';
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
import { maskText } from '../shaping/redaction';
import { prepareRosterSchema } from '../validation/roster-schema';
import type { BatchCommand, BatchInput, BatchPreflightResult, BatchProgress, BatchResult, BatchRowResult } from './protocol';
import { resolveRowSelection } from './row-selection';

export const BATCH_CHUNK_SIZE = 25;
type ProgressListener = (progress: BatchProgress) => void;

type RowInputs = Omit<BatchInput, 'roster' | 'sheetName'>;

async function preflightBatch(input: RowInputs, progress: (completed: number, total: number) => void) {
  const { rows, template, options, conditional, schema } = input;
  const { maskPolicies } = options;
  const results: BatchRowResult[] = [];
  progress(0, rows.length);
  if (!rows.length) return { rows: results, spotlight: {}, renderRows: rows };
  if (schema?.rules.length && schema.rows.length !== rows.length) throw new Error('schema-row-count-mismatch');
  const validate = schema?.rules.length ? prepareRosterSchema(schema.rules, schema.columns) : undefined;
  const { check, fields } = await prepareTemplatePreflight(template, options);
  if (conditional?.rules.length && conditional.rows.length !== rows.length) throw new Error('conditional-row-count-mismatch');
  const evaluate = conditional?.rules.length ? prepareConditionalFields(conditional.rules, conditional.columns, fields) : undefined;
  const evaluatedRows = evaluate ? conditional!.rows.map((row, index) => evaluate(rows[index]!, row)) : undefined;
  const renderRows = evaluatedRows?.map(({ values }) => values) ?? rows;
  for (let start = 0; start < rows.length; start += BATCH_CHUNK_SIZE) {
    const end = Math.min(start + BATCH_CHUNK_SIZE, rows.length);
    for (let index = start; index < end; index++) {
      const schemaDiagnostics = validate?.(schema!.rows[index]!, index + 1);
      if (schemaDiagnostics?.length) {
        results.push({ status: 'flagged', diagnostics: [], pageNumbers: [], fontSizes: {}, schemaDiagnostics });
      } else {
        results.push(await check(renderRows[index]!, evaluatedRows?.[index]));
      }
    }
    progress(results.length, rows.length);
    if (results.length < rows.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const spotlightRows = maskPolicies ? renderRows.map((row) => Object.fromEntries(Object.entries(row).map(([field, value]) =>
    [field, maskText(value, Object.hasOwn(maskPolicies, field) ? maskPolicies[field] : undefined)]))) : renderRows;
  return { rows: results, spotlight: selectBoundaryRows(spotlightRows, results, fields), renderRows };
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

    const individualZip = phase === 'zip' || phase === 'dispatch';
    const coverSheet = individualZip ? undefined : command.coverSheet;
    const filenames = individualZip ? command.filenames : coverSheet?.filenames;
    if (filenames && filenames.length !== results.length) {
      throw new Error(individualZip ? 'batch-filename-count-mismatch' : 'cover-sheet-invalid-metadata');
    }
    const grouping = phase === 'merged' ? undefined : command.grouping;
    const scope = resolveRowSelection(results, command.rowSelection);
    const { selectedRowNumbers } = scope;
    if (!selectedRowNumbers.length) throw new Error('empty-export');
    const fields = [...new Set(selectedRowNumbers.flatMap((number) => results[number - 1]!.redactedFields ?? []))];
    const redactedFields = fields.length ? fields : undefined;
    const dispatch = phase === 'dispatch' && await import('../dispatch/eml-pack');
    let prepared: ReturnType<typeof import('../dispatch/eml-pack')['prepareDispatchRows']> | undefined;
    if (phase === 'dispatch' && dispatch) {
      if (command.rows.length !== results.length) throw new Error('dispatch-row-count-mismatch');
      const unsafe = new Set(command.unsafeFilenameRows);
      const protectedColumns = new Set(command.protectedColumns);
      if (grouping && protectedColumns.has(grouping.groupByColumn)) return { status: 'blocked',
        issues: selectedRowNumbers.map((rowNumber) => ({ rowNumber, code: 'protected-column', field: 'attachment' })) };
      prepared = dispatch.prepareDispatchRows(command.settings, selectedRowNumbers.map((rowNumber) => ({
        rowNumber, values: command.rows[rowNumber - 1]!,
        filename: grouping?.rows[rowNumber - 1]?.filename ?? command.filenames[rowNumber - 1]!,
        zipPath: grouping?.rows[rowNumber - 1]?.zipPath, unsafeFilename: unsafe.has(rowNumber),
      })), protectedColumns);
      if (prepared.status === 'blocked') return prepared;
    }
    if (grouping) validateGroupingPlan(grouping, results.length);
    const outputRows = (rowNumbers: readonly number[], names: readonly string[]) =>
      rowNumbers.map((number, index) => ({ filename: names[index]!, getPdfBytes: () => getPdfBytes(number - 1) }));
    const watermark = command.watermark && { settings: command.watermark, fonts: input.options.fonts };
    const { qrStamp, qrRecords } = await selectPrintQr(!individualZip || command.flattenZip ? command.qrStamp : undefined,
      results.length, custody, selectedRowNumbers);
    if (individualZip) {
      const paths = grouping && selectedRowNumbers.map((number) => grouping.rows[number - 1]!.zipPath);
      const ready = outputRows(selectedRowNumbers,
        selectedRowNumbers.map((number) => grouping?.rows[number - 1]?.filename ?? command.filenames[number - 1] ?? ''));
      const zip = await createGeneratedZip(ready, progress, command.flattenZip, watermark, qrStamp, paths, approvalSeal);
      const pdfZip = { ...zip, ...(grouping && { groupByColumn: grouping.groupByColumn }), ...(qrRecords && { qrRecords }),
        ...(redactedFields && { redactedFields }) };
      if (phase !== 'dispatch' || !dispatch || !prepared) return pdfZip;
      const custodyManifest = createCustodyManifest(custody, {
        ...(command.flattenZip ? { attachmentVariant: 'flattened', flattenedEntries: zip.entries }
          : { attachmentVariant: 'editable', entries: zip.entries }),
        groupByColumn: grouping?.groupByColumn, qrRecords, redactedFields,
      }, scope);
      const pack = await dispatch.createDispatchPack(prepared, zip, { redactedFields, custodyManifest });
      return pack.status === 'ready' && command.includePdfZip ? { ...pack, pdfZip } : pack;
    }
    const context = { rows: results, rowNumbers: selectedRowNumbers, coverSheet, exportedAt: new Date(), preflight: input.options, custody };
    if (phase === 'split') {
      const groups = planSplitPrint(context, command.grouping).map(({ filenames, ...group }) => ({
        ...group, rows: outputRows(group.rowNumbers, filenames),
      }));
      return createSplitMergedZip(groups, custody, scope, command.grouping.groupByColumn, progress, watermark, qrStamp, command.imposition, qrRecords, approvalSeal, command.fourUp, redactedFields);
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
    return { bytes, mergedPdfSha256, ...(qrRecords && { qrRecords }), ...(redactedFields && { redactedFields }) };
  }

  return (command: BatchCommand, notify: ProgressListener) => {
    // Serialize requests so previews, estimates and exports share one prepared batch.
    const current = pending.then(() => handle(command, notify));
    pending = current.then(() => undefined, () => undefined);
    return current;
  };
}
