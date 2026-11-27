import { PDFDocument } from 'pdf-lib';
import { sha256 } from '../audit/custody';
import { planGroupedOutput, validateGroupingPlan } from '../export/grouping';
import { PdfIntakeError, preflightRow, preparePacketFormPreflight } from '../pdf';
import { appendFlattenedForm, createGeneratedZip } from '../pdf/exports';
import { autoMap, inspectRosterWorkbook, planFilenames, readRoster, type RosterRow, type RosterSheet } from '../roster';
import { physicalFilenameColumns } from '../roster/filenames';
import { localVirtualDate, virtualFilenameToken } from '../roster/virtual-columns';
import { createPacketCover } from './cover';
import type { PacketDocument, PacketInput, PacketIssue, PacketManifest, PacketPreflightResult, PacketRow, PacketRunOptions } from './types';

export type * from './types';

export const PACKET_ZIP_FILENAME = 'arabiform-packets.zip';
export const PACKET_MANIFEST_FILENAME = 'packet-custody-manifest.json';

const unsafeText = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const snapshot = (bytes: Uint8Array | ArrayBuffer) => bytes instanceof Uint8Array ? Uint8Array.from(bytes) : new Uint8Array(bytes.slice(0));
const yieldToHost = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function readPacketRoster({ bytes, name, sheetName }: PacketInput['roster']): Promise<RosterSheet> {
  if (!name.trim() || unsafeText.test(name)) throw new Error('invalid-roster-name');
  if (/\.xlsx$/i.test(name)) {
    const workbook = inspectRosterWorkbook(bytes);
    const selected = sheetName ?? workbook.sheetNames[0]!;
    if (!workbook.sheetNames.includes(selected)) throw new Error('unknown-sheet');
    if (unsafeText.test(selected)) throw new Error('invalid-sheet-name');
    return workbook.readSheet(selected);
  }
  if (sheetName !== undefined) throw new Error('sheet-requires-xlsx');
  return (await readRoster(bytes, name)).sheets[0]!;
}

function planDocuments(sources: PacketManifest['sources']['templates'], cover: boolean): PacketDocument[] {
  let startPage = cover ? 2 : 1;
  return sources.map(({ templateIndex, title, pageCount }) => {
    const document = { templateIndex, title, startPage, pageCount };
    startPage += pageCount;
    return document;
  });
}

export async function preflightPacket(input: PacketInput, options: PacketRunOptions = {}): Promise<PacketPreflightResult> {
  const { templates, groupByColumn, includeCover = false, fonts, localDate = localVirtualDate(new Date()) } = input;
  const { signal, onProgress } = options;
  signal?.throwIfAborted();
  if (templates.length < 2 || templates.length > 4) {
    return { status: 'blocked', issues: [{ code: 'packet-template-count', message: 'Supply 2 to 4 ordered AcroForm templates.' }] };
  }
  const roster = { ...input.roster, bytes: snapshot(input.roster.bytes) };
  const initial = templates.map((template, index) => ({
    bytes: snapshot(template.bytes), templateIndex: index + 1, name: template.name,
    title: template.title ?? template.name.replace(/\.pdf$/i, ''), mapping: template.mapping && Object.entries(template.mapping),
  }));
  const setupIssues: PacketIssue[] = [];
  const forms: {
    bytes: Uint8Array;
    source: PacketManifest['sources']['templates'][number];
    mapping: [string, string][] | undefined;
    scope: { templateIndex: number; templateName: string };
    form: Awaited<ReturnType<typeof preparePacketFormPreflight>>;
  }[] = [];
  for (const { bytes, templateIndex, name, title, mapping } of initial) {
    signal?.throwIfAborted();
    const scope = { templateIndex, templateName: name };
    if (!/\.pdf$/i.test(name) || unsafeText.test(name)) {
      setupIssues.push({ ...scope, code: 'invalid-template-name', message: 'Use a PDF filename without control characters.' });
      continue;
    }
    if (!title.trim() || unsafeText.test(title)) {
      setupIssues.push({ ...scope, code: 'invalid-template-title', message: 'Use a nonblank document title without control characters.' });
      continue;
    }
    try {
      const form = await preparePacketFormPreflight(bytes, { fonts });
      const source = { templateIndex, name, title, bytes: bytes.byteLength, sha256: await sha256(bytes), pageCount: form.pageCount };
      forms.push({ bytes, source, mapping, scope, form });
    } catch (error) {
      if (!(error instanceof PdfIntakeError)) throw error;
      setupIssues.push({ ...scope, code: error.code, message: 'Use an unsigned, unencrypted AcroForm PDF with supported editable fields.' });
    }
  }
  signal?.throwIfAborted();
  if (setupIssues.length) return { status: 'blocked', issues: setupIssues };

  let sheet: RosterSheet;
  try {
    sheet = await readPacketRoster(roster);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'invalid-roster';
    return { status: 'blocked', issues: [{ code, message: 'Check the roster file and selected worksheet.' }] };
  }
  const { rows, headers } = sheet;
  if (!rows.length) return { status: 'blocked', issues: [{ code: 'empty-roster', message: 'Add at least one data row to the selected roster.' }] };
  const headerSet = new Set(headers);
  if (groupByColumn !== undefined && !headerSet.has(groupByColumn)) {
    return { status: 'blocked', issues: [{ code: 'invalid-grouping-column', columnName: groupByColumn, message: 'Choose an exact roster header for grouping.' }] };
  }
  const pattern = input.filenamePattern ?? (headerSet.has('ID') ? '{{ID}}-packet.pdf' : `${virtualFilenameToken('ROW_INDEX')}-packet.pdf`);
  for (const columnName of new Set(physicalFilenameColumns(pattern))) {
    if (!headerSet.has(columnName)) setupIssues.push({ code: 'invalid-filename-column', columnName, message: 'Use an exact roster header in the filename pattern.' });
  }
  const prepared = forms.map(({ mapping, form, ...entry }) => {
    const editableFields = new Set(form.fields.filter((field) => !field.readOnly &&
      (field.kind === 'text' || field.kind === 'checkbox' || field.choices?.length)).map(({ name }) => name));
    const automaticFields = form.fields.filter(({ name, kind }) => editableFields.has(name) && (kind === 'text' || kind === 'checkbox')).map(({ name }) => name);
    const bindings = mapping ?? Object.entries(autoMap(automaticFields, headers));
    if (!bindings.length) setupIssues.push({ ...entry.scope, code: 'no-mapping', message: 'Map at least one editable field to a roster column.' });
    for (const [fieldName, columnName] of bindings) {
      if (!editableFields.has(fieldName) || !headerSet.has(columnName)) setupIssues.push({
        ...entry.scope, code: 'packet-mapping-mismatch', fieldName, columnName,
        message: 'Choose an exact editable field and an exact roster header.',
      });
    }
    return { ...entry, form, values: (row: RosterRow) => Object.fromEntries(bindings.map(([field, column]) => [field, row.values[column]!])) };
  });
  if (setupIssues.length) return { status: 'blocked', issues: setupIssues };

  const documents = planDocuments(forms.map(({ source }) => source), includeCover);
  let cover: PDFDocument | undefined;
  if (includeCover) {
    try {
      cover = await createPacketCover(documents, fonts);
    } catch (error) {
      if (!(error instanceof Error) || !/^cover-sheet-/.test(error.message)) throw error;
      return { status: 'blocked', issues: [{ code: error.message, message: 'Review the cover document titles and run preflight again.' }] };
    }
  }
  const grouping = groupByColumn === undefined ? undefined : planGroupedOutput(rows, groupByColumn, pattern, { localDate });
  if (grouping) validateGroupingPlan(grouping, rows.length);
  const filenames = grouping?.rows ?? planFilenames(rows, pattern, { localDate });
  const checked: PacketRow[] = [];
  const readyRows: { row: RosterRow; rowNumber: number; filename: string; path: string }[] = [];
  const total = rows.length * prepared.length;
  let completed = 0;
  onProgress?.({ phase: 'preflight', completed, total });
  if (onProgress) await yieldToHost();
  for (const [index, row] of rows.entries()) {
    const issues: PacketIssue[] = [];
    for (const { form, scope, values } of prepared) {
      signal?.throwIfAborted();
      const { diagnostics, printProblems } = form.check(values(row));
      issues.push(...diagnostics.map(({ field, code, ...detail }) => ({ ...scope, ...detail, code, message: code, fieldName: field })));
      issues.push(...printProblems.map((detail) => ({
        ...scope, ...detail, code: 'unflattenable-widget', message: 'The widget has no reusable printable appearance.',
      })));
      completed++;
    }
    const filename = filenames[index]!.filename;
    const path = grouping?.rows[index]!.zipPath ?? filename;
    const rowNumber = index + 1;
    if (!issues.length) readyRows.push({ row, rowNumber, filename, path });
    checked.push({ rowNumber, filename, path, status: issues.length ? 'flagged' : 'ready', issues, sourceWarnings: row.warnings });
    if (index === 0 || rowNumber % 25 === 0 || completed === total) {
      onProgress?.({ phase: 'preflight', completed, total });
      if (completed < total && (onProgress || signal)) await yieldToHost();
    }
  }
  signal?.throwIfAborted();
  const rosterSource = { name: roster.name, bytes: roster.bytes.byteLength, sha256: await sha256(roster.bytes),
    ...(/\.xlsx$/i.test(roster.name) && { sheetName: sheet.name }) };
  signal?.throwIfAborted();

  return {
    status: 'checked', rows: checked, ready: readyRows.length, flagged: checked.length - readyRows.length,
    async assemble({ onProgress, signal }: PacketRunOptions = {}) {
      signal?.throwIfAborted();
      if (!readyRows.length) throw new Error('empty-export');
      const pageCount = documents.reduce((sum, document) => sum + document.pageCount, includeCover ? 1 : 0);
      const progress = (completed: number, total: number) => onProgress?.({ phase: 'assemble', completed, total });
      const zip = await createGeneratedZip(readyRows.map(({ row, filename }) => ({
        filename,
        async getPdfBytes() {
          if (onProgress || signal) await yieldToHost();
          signal?.throwIfAborted();
          const packet = await PDFDocument.create({ updateMetadata: false });
          if (cover) packet.addPage((await packet.copyPages(cover, [0]))[0]!);
          for (const { bytes, values, source } of prepared) {
            signal?.throwIfAborted();
            const { pdfBytes } = await preflightRow(bytes, values(row), { fonts });
            if (!pdfBytes) throw new Error('packet-render-failed');
            if (await appendFlattenedForm(packet, pdfBytes) !== source.pageCount) throw new Error('packet-page-count-mismatch');
          }
          return packet.save({ updateFieldAppearances: false });
        },
      })), progress, false, undefined, undefined, grouping && readyRows.map(({ path }) => path));
      signal?.throwIfAborted();
      const manifest: PacketManifest = {
        version: 1, kind: 'arabiform-packet-custody',
        sources: { templates: forms.map(({ source }) => ({ ...source })), roster: { ...rosterSource } },
        ...(groupByColumn !== undefined && { groupByColumn }),
        outputs: zip.entries.map(({ bytes, sha256 }, index) => {
          const { rowNumber, filename, path } = readyRows[index]!;
          return { rowNumber, filename, path, bytes, sha256, pageCount, documents: documents.map((document) => ({ ...document })) };
        }),
      };
      return { zipBytes: zip.bytes, manifest, manifestJson: `${JSON.stringify(manifest, null, 2)}\n` };
    },
  };
}
