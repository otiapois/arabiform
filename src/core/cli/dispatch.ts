import Papa from 'papaparse';
import { createCustodyManifest, MERGED_CUSTODY_FILENAME, type CustodyVariant } from '../audit/custody';
import { DISPATCH_CSV_FILENAME, DISPATCH_JSON_FILENAME, DISPATCH_ZIP_FILENAME, unsafeDispatchFilenameRows } from '../dispatch/eml-pack';
import { parseCustodyManifest, verifyCustodyPdf, verifyCustodyQr } from '../custody/verify';
import { isRecord, validateMappingPreset } from '../draft/mapping-preset';
import { planGroupedOutput } from '../export/grouping';
import { extractBatch, type ExtractInput } from '../extractor/extract';
import { createAudit, inspectTemplate } from '../pdf';
import { ApprovalSealError, type ApprovalSealProblem } from '../pdf/approval-seal-settings';
import { resolveQrPayload } from '../pdf/qr-encoder';
import { DEFAULT_QR_SIZE_PT, type BatchQrPrintRequest } from '../pdf/qr-settings';
import type { FontBytes } from '../pdf/shaping';
import { PACKET_MANIFEST_FILENAME, PACKET_ZIP_FILENAME, preflightPacket, type PacketInput } from '../packet/assembler';
import { PdfIntakeError } from '../pdf/template';
import { autoMap, inspectRosterWorkbook, planFilenames, readRoster, type RosterSheet } from '../roster';
import { filenameKey, physicalFilenameColumns } from '../roster/filenames';
import { resolveVirtualMapping } from '../roster/virtual-columns';
import { reviewFilenamePattern, reviewSourceColumns } from '../shaping/redaction';
import { generateStudioTemplate } from '../studio/templates';
import { buildTemplateMigrationReport, inspectTemplateDiff, migrateTemplatePreset,
  MIGRATED_PRESET_FILENAME, serializeTemplateMigrationReportCsv, TEMPLATE_MIGRATION_CSV_FILENAME,
  TEMPLATE_MIGRATION_JSON_FILENAME, TemplateDiffIntakeError } from '../template/diff-migrator';
import { createBatchProcessor } from '../worker/batch';
import type { BatchDispatchResult, BatchMergedResult, BatchPreflightResult, BatchZipResult } from '../worker/protocol';
import { resolveRowSelection } from '../worker/row-selection';
import { cliWatermark, type BatchCommandLine, type CliCommand } from './arguments';

type BatchSources = {
  template: Uint8Array;
  roster: Uint8Array;
  templateName: string;
  rosterName: string;
  presetJson?: string;
  fonts: FontBytes;
  date: string;
};

export type CliJob =
  | (({ mode: 'preflight' } | { mode: 'fill' }) & { command: BatchCommandLine; sources: BatchSources })
  | { mode: 'packet'; input: PacketInput; mappingsJson?: string }
  | { mode: 'diff-template'; old: Uint8Array; new: Uint8Array; presetJson?: string; renameMapJson?: string }
  | { mode: 'extract'; inputs: readonly ExtractInput[] }
  | { mode: 'verify'; manifestJson: string; source: { qrPayload: string } | {
    inputs: readonly (ExtractInput & { parentFolder?: string })[];
    variant?: CustodyVariant;
  } }
  | { mode: 'studio'; template: Extract<CliCommand, { mode: 'studio' }>['template']; fonts: FontBytes };

type CliArtifact = { name: string; data: string | Uint8Array };
type CliResult = { exitCode: 0 | 1 | 2; report: { status: string } & Record<string, unknown>; artifacts: CliArtifact[]; diagnostic?: boolean };

const idle = () => {};
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

async function runTemplateDiff(job: Extract<CliJob, { mode: 'diff-template' }>): Promise<CliResult> {
  let preset: unknown;
  let renameMap: unknown;
  try {
    if (job.presetJson !== undefined) preset = JSON.parse(job.presetJson);
    if (job.renameMapJson !== undefined) {
      renameMap = JSON.parse(job.renameMapJson);
      // JSON.parse keeps only the last duplicate key. Count separators outside quoted strings
      // in the flat map so duplicate source keys cannot silently replace an explicit choice.
      if (isRecord(renameMap) && Object.values(renameMap).every((value) => typeof value === 'string')) {
        const separators = [...job.renameMapJson.matchAll(/"(?:[^"\\]|\\[\s\S])*"|:/g)].filter(([token]) => token === ':');
        if (separators.length !== Object.keys(renameMap).length) renameMap = null;
      }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { exitCode: 1, report: { status: 'usage-error', message: 'Use valid JSON for --preset and --rename-map.' }, artifacts: [], diagnostic: true };
  }
  let diff: Awaited<ReturnType<typeof inspectTemplateDiff>>;
  try {
    diff = await inspectTemplateDiff(job.old, job.new);
  } catch (error) {
    if (!(error instanceof TemplateDiffIntakeError)) throw error;
    return { exitCode: 2, report: { status: 'blocked', issues: [{ side: error.side, code: error.code }] },
      artifacts: [], diagnostic: true };
  }
  const migration = job.presetJson === undefined ? undefined : migrateTemplatePreset(diff, preset, renameMap);
  const report = buildTemplateMigrationReport(diff, migration);
  const artifacts: CliArtifact[] = [
    { name: TEMPLATE_MIGRATION_CSV_FILENAME, data: serializeTemplateMigrationReportCsv(report) },
    { name: TEMPLATE_MIGRATION_JSON_FILENAME, data: json(report) },
  ];
  if (migration?.preset) artifacts.push({ name: MIGRATED_PRESET_FILENAME, data: json(migration.preset) });
  return { exitCode: report.status === 'clean' ? 0 : 2, report, artifacts };
}

async function runPacket(input: PacketInput, mappingsJson?: string): Promise<CliResult> {
  if (mappingsJson !== undefined) {
    let mappings: unknown;
    try {
      mappings = JSON.parse(mappingsJson);
    } catch {
      // Return the same usage error for invalid JSON and invalid mapping structure.
    }
    if (!Array.isArray(mappings) || mappings.length !== input.templates.length ||
      mappings.some((mapping) => mapping !== null && (typeof mapping !== 'object' || Array.isArray(mapping)
        || Object.entries(mapping).some(([field, header]) => !field.trim() || typeof header !== 'string' || !header.trim())))) {
      return { exitCode: 1, report: { status: 'usage-error', message: 'Use a JSON array with one field-to-header object or null per template.' },
        artifacts: [], diagnostic: true };
    }
    input = { ...input, templates: input.templates.map((template, index) => ({ ...template, mapping: mappings[index] ?? undefined })) };
  }
  const checked = await preflightPacket(input);
  if (checked.status === 'blocked') {
    return { exitCode: 2, report: { ...checked, ready: 0, flagged: 0 }, artifacts: [], diagnostic: true };
  }
  const { ready, flagged, rows } = checked;
  const report = { status: flagged ? 'flagged' : 'clean', ready, flagged, ...(flagged > 0 && { rows }) };
  if (!ready) return { exitCode: 2, report, artifacts: [], diagnostic: true };
  const { zipBytes, manifestJson } = await checked.assemble();
  return { exitCode: flagged ? 2 : 0, report, artifacts: [
    { name: PACKET_ZIP_FILENAME, data: zipBytes }, { name: PACKET_MANIFEST_FILENAME, data: manifestJson },
  ] };
}

function blockedBatch(mode: BatchCommandLine['mode'], code: string, message: string, detail?: Omit<ApprovalSealProblem, 'code'>): CliResult {
  const report = { status: 'blocked', ready: 0, flagged: 0, issues: [{ code, message, ...detail }] };
  return { exitCode: 2, report, diagnostic: mode === 'fill', artifacts: mode === 'preflight' ? [
    { name: 'arabiform-preflight.csv', data: Papa.unparse([['status', 'code', 'message'], ['blocked', code, message]], { escapeFormulae: true }) + '\r\n' },
    { name: 'arabiform-preflight.json', data: json(report) },
  ] : [] };
}

async function runBatch(command: BatchCommandLine, sources: BatchSources): Promise<CliResult> {
  const { mode, files } = command;
  let preset: ReturnType<typeof validateMappingPreset>;
  if (sources.presetJson !== undefined) {
    try {
      preset = validateMappingPreset(JSON.parse(sources.presetJson));
    } catch {
      // Fall through to the same usage error for invalid JSON and invalid preset structure.
    }
    if (!preset) return { exitCode: 1, report: { status: 'usage-error', message: 'Invalid mapping preset. Export a mapping preset (v1–v12) from ArabiForm.' }, artifacts: [], diagnostic: true };
  }

  let template: Awaited<ReturnType<typeof inspectTemplate>>;
  try {
    template = await inspectTemplate(sources.template);
  } catch (error) {
    if (!(error instanceof PdfIntakeError)) throw error;
    return blockedBatch(mode, error.code, 'Use an unsigned, unencrypted AcroForm PDF with supported editable fields.');
  }
  const xlsx = /\.xlsx$/i.test(sources.rosterName);
  let sheet: RosterSheet;
  try {
    if (xlsx) {
      const workbook = inspectRosterWorkbook(sources.roster);
      const name = files.sheet ?? workbook.sheetNames[0]!;
      if (!workbook.sheetNames.includes(name)) return blockedBatch(mode, 'unknown-sheet', 'Choose an exact visible worksheet name. Available sheets: ' + workbook.sheetNames.join(', '));
      if (/[\p{Cc}\p{Cs}]/u.test(name)) return blockedBatch(mode, 'invalid-sheet-name', 'The worksheet name contains unsupported characters.');
      sheet = workbook.readSheet(name);
    } else {
      sheet = (await readRoster(sources.roster, sources.rosterName)).sheets[0]!;
    }
  } catch (error) {
    return blockedBatch(mode, errorMessage(error), 'Check the roster format, headers, and selected worksheet.');
  }
  const { rows, headers } = sheet;
  if (!rows.length) return blockedBatch(mode, 'empty-roster', 'Add at least one data row to the selected roster.');
  const fields = new Map(template.fields.filter((field) =>
    !field.readOnly && (field.kind === 'text' || field.kind === 'checkbox' || Boolean(field.choices?.length)))
    .map((field) => [field.name, field]));
  const automaticFields = [...fields].flatMap(([name, { kind }]) => kind === 'text' || kind === 'checkbox' ? [name] : []);
  const actualMappings = Object.entries(preset?.mapping ?? autoMap(automaticFields, headers)).filter(([, column]) => column);
  const virtualMappings = Object.entries(preset && 'virtualMappings' in preset ? preset.virtualMappings : {});
  const alignOverrides = preset && 'alignOverrides' in preset ? preset.alignOverrides : undefined;
  const fieldTypography = preset && 'fieldTypography' in preset ? preset.fieldTypography : undefined;
  const conditionalRules = preset && 'conditionalRules' in preset && preset.conditionalRules.length ? preset.conditionalRules : undefined;
  const mismatches = [
    ...actualMappings.filter(([field, column]) => !fields.has(field) || !headers.includes(column)).map(([field, column]) => JSON.stringify([field, column])),
    ...virtualMappings.filter(([field]) => fields.get(field)?.kind !== 'text').map(([field]) => JSON.stringify(field)),
    ...Object.keys(alignOverrides ?? {}).filter((field) => fields.get(field)?.kind !== 'text').map((field) => JSON.stringify(field)),
    ...Object.keys(fieldTypography ?? {}).filter((field) => fields.get(field)?.kind !== 'text').map((field) => JSON.stringify(field)),
  ];
  if (mismatches.length) return blockedBatch(mode, 'preset-source-mismatch', 'Update the preset mappings or choose matching files: ' + mismatches.join(', '));
  if (!actualMappings.length && !virtualMappings.length) return blockedBatch(mode, 'no-mapping', 'Supply a preset or use matching template field names and roster headers.');

  const { maskPolicies } = command;
  const mapped = new Set([...actualMappings, ...virtualMappings].map(([field]) => field));
  if (Object.keys(maskPolicies ?? {}).some((field) => fields.get(field)?.kind !== 'text' || !mapped.has(field))) {
    return blockedBatch(mode, 'invalid-redaction-field', 'Redaction requires an exact mapped editable text field.');
  }
  const protectedColumns = reviewSourceColumns(maskPolicies ?? {}, actualMappings, conditionalRules);
  const groupBy = files.groupBy ?? (preset && 'groupByColumn' in preset ? preset.groupByColumn : null);
  if (groupBy != null && !headers.includes(groupBy)) return blockedBatch(mode, 'invalid-grouping-column', 'Choose an exact roster header for grouping: ' + groupBy);
  if (groupBy != null && protectedColumns.has(groupBy)) {
    return blockedBatch(mode, 'redaction-protected-group', 'Choose a grouping column outside the redacted fields.');
  }
  const missingFilenameColumns = preset
    ? [...new Set(physicalFilenameColumns(preset.filenamePattern))].filter((column) => !headers.includes(column)) : [];
  const localDate = files.date ?? sources.date;
  const filenamePattern = reviewFilenamePattern(preset?.filenamePattern, protectedColumns);
  const grouping = groupBy == null ? undefined : planGroupedOutput(rows, groupBy, filenamePattern, { localDate });
  const filenamePlans = planFilenames(rows, filenamePattern, { localDate });
  const run = createBatchProcessor();
  const checked = await run({ phase: 'preflight', input: {
    template: sources.template, roster: sources.roster, sheetName: files.sheet,
    rows: rows.map(({ values }, index) => Object.fromEntries([
      ...actualMappings.map(([field, column]) => [field, values[column]!]),
      ...virtualMappings.map(([field, binding]) => [field, resolveVirtualMapping(binding, index + 1, localDate)]),
    ])),
    ...(conditionalRules && { conditional: { rules: conditionalRules, columns: headers, rows: rows.map(({ values }) => values) } }),
    options: { fonts: sources.fonts, minFontSize: preset?.minFontSize, preferredFont: preset?.font, alignOverrides, fieldTypography, maskPolicies },
  } }, idle) as BatchPreflightResult;
  const scope = resolveRowSelection(checked.rows);
  const ready = scope.selectedRowNumbers.length;
  const flagged = rows.length - ready;
  const reportedRows = checked.rows.map((result, index) => ({
    ...result, rowNumber: index + 1, filename: (grouping?.rows[index] ?? filenamePlans[index]!).filename,
    ...(grouping && { zipPath: grouping.rows[index]!.zipPath }),
    sourceWarnings: rows[index]!.warnings,
  }));
  const report = {
    status: flagged ? 'flagged' : 'clean', ready, flagged, ...(xlsx && { sheet: sheet.name }),
    ...(missingFilenameColumns.length && { warnings: [{ code: 'missing-filename-columns', columns: missingFilenameColumns }] }),
    ...(mode === 'preflight' || flagged > 0 || conditionalRules ? { rows: reportedRows } : {}),
  };
  const exitCode = flagged ? 2 : 0;
  if (mode === 'preflight') {
    const { csv } = createAudit(reportedRows);
    return { exitCode, report, artifacts: [
      { name: 'arabiform-preflight.csv', data: csv }, { name: 'arabiform-preflight.json', data: json(report) },
    ] };
  }
  if (!ready || command.strict && flagged) {
    return { exitCode: 2, report: { ...report, message: 'Correct the flagged rows and rerun preflight before exporting.' }, artifacts: [], diagnostic: true };
  }

  const imposition = command.imposition ?? (preset && 'imposition' in preset ? preset.imposition : '1-up');
  if (imposition !== '1-up') {
    const { inspectImpositionCompatibility } = await import('../pdf/imposition');
    const { twoUpUnavailableReason, fourUpUnavailableReason } = await inspectImpositionCompatibility(sources.template);
    const reason = imposition === '4-up' ? fourUpUnavailableReason : twoUpUnavailableReason;
    if (reason) return blockedBatch(mode, reason, imposition + ' requires a compatible single-page printable template. Choose --imposition 1-up.');
  }
  const fourUp = imposition === '4-up' && preset?.version === 12 ? { fourUpOrder: preset.fourUpOrder, centerCutGuides: preset.centerCutGuides } : undefined;
  const watermark = command.watermark === undefined ? (preset && 'watermark' in preset ? preset.watermark : undefined) : cliWatermark(command.watermark);
  const approvalSeal = preset && 'approvalSeal' in preset ? preset.approvalSeal ?? undefined : undefined;
  const qr = preset && 'qrStamp' in preset ? preset.qrStamp : undefined;
  const activeQr = qr?.placement === 'none' ? undefined : qr;
  let qrStamp: BatchQrPrintRequest | undefined;
  if (command.qr || activeQr?.custodyRecord) {
    qrStamp = { placement: activeQr?.placement ?? 'bottom-right', sizePt: activeQr?.sizePt ?? DEFAULT_QR_SIZE_PT, custodyRecord: true };
  } else if (activeQr) {
    if (physicalFilenameColumns(activeQr.pattern).some((column) => protectedColumns.has(column))) {
      return blockedBatch(mode, 'redaction-protected-qr', 'Choose a QR pattern outside the redacted fields or use --qr.');
    }
    const payloads: (string | null)[] = Array(rows.length).fill(null);
    for (const number of scope.selectedRowNumbers) {
      try {
        payloads[number - 1] = resolveQrPayload(activeQr.pattern, rows[number - 1]!.values, number, localDate);
      } catch (error) {
        return blockedBatch(mode, errorMessage(error), 'Check the preset QR payload on roster row ' + String(number) + '.');
      }
    }
    qrStamp = { placement: activeQr.placement, sizePt: activeQr.sizePt, payloads };
  }
  const filenames = filenamePlans.map(({ filename }) => filename);
  const coverSheet = command.cover || preset && 'includeCoverSheet' in preset && preset.includeCoverSheet ? {
    filenames, templateName: sources.templateName, locale: 'en' as const, exportedAt: localDate,
    coverLanguage: preset && 'coverLanguage' in preset ? preset.coverLanguage : 'auto' as const,
  } : undefined;
  try {
    let dispatch: BatchDispatchResult | undefined;
    let editable: BatchZipResult;
    if (command.dispatch) {
      const cells = rows.map(({ values }) => values);
      dispatch = await run({ phase: 'dispatch', filenames, grouping, rows: cells, settings: command.dispatch, includePdfZip: true,
        unsafeFilenameRows: unsafeDispatchFilenameRows(cells, preset?.filenamePattern, groupBy),
        protectedColumns: [...protectedColumns] }, idle) as BatchDispatchResult;
      if (dispatch.status === 'blocked') {
        return { exitCode: 2, report: { status: 'blocked', issues: dispatch.issues }, artifacts: [], diagnostic: true };
      }
      editable = dispatch.pdfZip!;
    } else {
      editable = await run({ phase: 'zip', filenames, grouping }, idle) as BatchZipResult;
    }
    const flattened = await run({ phase: 'zip', filenames, grouping, flattenZip: true, watermark, qrStamp, approvalSeal }, idle) as BatchZipResult;
    const merged = await run({ phase: 'merged', coverSheet, imposition, watermark, qrStamp, approvalSeal, fourUp }, idle) as BatchMergedResult;
    const manifest = createCustodyManifest(checked.custody, {
      entries: editable.entries, flattenedEntries: flattened.entries, mergedPdfSha256: merged.mergedPdfSha256,
      groupByColumn: grouping?.groupByColumn, qrRecords: merged.qrRecords, redactedFields: editable.redactedFields,
    }, scope);
    const artifacts: CliArtifact[] = [
      { name: 'arabiform-editable.zip', data: editable.bytes },
      { name: 'arabiform-flattened.zip', data: flattened.bytes },
      { name: MERGED_CUSTODY_FILENAME, data: merged.bytes },
      { name: 'custody-manifest.json', data: manifest },
    ];
    if (dispatch) artifacts.push(
      { name: DISPATCH_ZIP_FILENAME, data: dispatch.bytes },
      { name: DISPATCH_CSV_FILENAME, data: dispatch.ledgerCsv },
      { name: DISPATCH_JSON_FILENAME, data: dispatch.ledgerJson },
    );
    if (command.printCertificate) {
      const { PRINT_CERTIFICATE_FILENAME } = await import('../pdf/print-certificate');
      const { templateName, rosterName } = sources;
      const certificate = await run({ phase: 'certificate', merged, names: { templateName, rosterName, outputName: MERGED_CUSTODY_FILENAME } }, idle) as Uint8Array;
      artifacts.push({ name: PRINT_CERTIFICATE_FILENAME, data: certificate });
    }
    return { exitCode, report, artifacts };
  } catch (error) {
    const code = errorMessage(error);
    if (error instanceof ApprovalSealError) return blockedBatch(mode, error.code,
      'Review the approval seal placement or labels and run fill again.', { pageNumber: error.pageNumber, fieldName: error.fieldName });
    if (!/^(?:watermark-[\w-]+|qr-stamp-[\w-]+|imposition-[\w-]+|unflattenable-widget|cover-sheet-[\w-]+|print-certificate-[\w-]+)$/.test(code)) throw error;
    return blockedBatch(mode, code, 'Review the reported PDF export restriction and adjust the template or selected print options.');
  }
}

export async function dispatchCli(job: CliJob): Promise<CliResult> {
  if (job.mode === 'preflight' || job.mode === 'fill') return runBatch(job.command, job.sources);
  if (job.mode === 'packet') return runPacket(job.input, job.mappingsJson);
  if (job.mode === 'diff-template') return runTemplateDiff(job);
  if (job.mode === 'studio') {
    const { pdfBytes, csv, filename, csvFilename } = await generateStudioTemplate(job.template, {}, job.fonts);
    return { exitCode: 0, report: { status: 'clean', template: job.template }, artifacts: [
      { name: filename, data: pdfBytes }, { name: csvFilename, data: csv },
    ] };
  }
  if (job.mode === 'extract') {
    const { rows, artifacts } = await extractBatch(job.inputs);
    const flagged = rows.filter(({ status }) => status !== 'extracted').length;
    return { exitCode: flagged ? 2 : 0, report: { status: flagged ? 'flagged' : 'clean', flagged, total: rows.length }, artifacts: [
      { name: 'arabiform-extracted.csv', data: artifacts.csv }, { name: 'arabiform-extracted.xlsx', data: artifacts.xlsx },
      { name: 'extraction-audit.json', data: artifacts.audit },
    ] };
  }
  // Parse through the same receipt reader and verifier as the offline UI.
  let receipt: Awaited<ReturnType<typeof parseCustodyManifest>>;
  try {
    receipt = await parseCustodyManifest(job.manifestJson);
  } catch (error) {
    if (errorMessage(error) !== 'custody-invalid-manifest') throw error;
    return { exitCode: 1, report: { status: 'usage-error', message: 'Invalid custody manifest.' }, artifacts: [], diagnostic: true };
  }
  const { source } = job;
  if ('qrPayload' in source) {
    const verdict = verifyCustodyQr(receipt, source.qrPayload);
    return { exitCode: verdict.status === 'VERIFIED_QR_RECORD' ? 0 : 2, report: { ...verdict }, artifacts: [] };
  }
  if (source.variant && !receipt.outputs.some(({ variant }) => variant)) {
    return { exitCode: 1, report: { status: 'usage-error', message: '--variant requires a v2 CLI custody manifest.' }, artifacts: [], diagnostic: true };
  }
  const folders = new Set(receipt.outputs.flatMap(({ variant, path }) => variant && path?.includes('/') ? [filenameKey(path.split('/')[0]!)] : []));
  const verdicts = await Promise.all(source.inputs.map(({ bytes, filename, parentFolder }) => verifyCustodyPdf(receipt, {
    bytes, variant: source.variant,
    filename: parentFolder && folders.has(filenameKey(parentFolder)) ? parentFolder + '/' + filename : filename,
  })));
  const exitCode = verdicts.every(({ status }) => status === 'VERIFIED_EXACT_MATCH') ? 0 : 2;
  return { exitCode, report: { status: verdicts.length === 1 ? verdicts[0]!.status : exitCode ? 'flagged' : 'clean', verdicts }, artifacts: [] };
}
