import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFOperator, PDFOperatorNames as Op, PDFRef, PDFStream, PDFWidgetAnnotation } from 'pdf-lib';
import { Zip, ZipPassThrough } from 'fflate';
import Papa from 'papaparse';
import { createCustodyManifest, sha256, type CustodyEntry, type CustodySources, type GroupedCustodyEntry } from '../audit/custody';
import { isSafeGroupedPdfPath, SPLIT_CUSTODY_PATH, type OutputGroup } from '../export/grouping';
import { escapeSpreadsheetCell } from '../roster/spreadsheet-csv';
import { filenameKey, isSafePdfFilename } from '../roster/filenames';
import type { ExportScope } from '../worker/row-selection';
import { prependMergeCover, type MergeCoverOptions } from './merge-cover';
import { key, number, openTemplate, widgetFlags, type TemplateMetadata } from './template';
import type { FieldDiagnostic, RowPreflightResult } from './index';
import type { FontBytes } from './shaping';
import { validateQrPrintRequest, type QrPrintRequest } from './qr-settings';
import type { prepareQrStamp } from './qr-stamp';
import { validateWatermarkSettings, type WatermarkSettings } from './watermark-settings';

export interface PdfExportRow { filename: string; pdfBytes: Uint8Array }
export interface GeneratedPdfExportRow { filename: string; getPdfBytes: () => Promise<Uint8Array> }
export interface PrintWatermarkOptions { settings: WatermarkSettings; fonts: FontBytes }
export type Imposition = '1-up' | '2-up';
type ExportRow = PdfExportRow | GeneratedPdfExportRow;
type PrintStamp = (doc: PDFDocument) => Promise<void>;
type QrStamp = ReturnType<typeof prepareQrStamp>;
export interface AuditRow {
  rowNumber: number;
  filename: string;
  status: RowPreflightResult['status'];
  diagnostics: FieldDiagnostic[];
  fontSizes: Record<string, number[]>;
  zipPath?: string;
}

type ExportProgress = (completed: number, total: number) => void;

function openZip(paths: readonly string[], onProgress?: ExportProgress, copyOutput = false, mode: 'flat' | 'grouped' | 'split' = 'flat') {
  const members = [...paths];
  const filenames = new Set<string>();
  for (const path of members) {
    const normalized = filenameKey(path);
    const safe = mode === 'grouped' ? isSafeGroupedPdfPath(path) : isSafePdfFilename(path) || mode === 'split' && path === SPLIT_CUSTODY_PATH;
    if (!safe || filenames.has(normalized)) throw new Error('invalid-export-filename');
    filenames.add(normalized);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  let index = 0;
  let block = new Uint8Array(0);
  let used = 0;
  const zip = new Zip((error, data) => {
    if (error) throw error;
    size += data.length;
    if (!copyOutput) {
      chunks.push(data);
      return;
    }
    // Assemble final archive bytes without retaining the on-demand member
    // buffers. PDF streams are already compressed and ZIP can store them.
    for (let offset = 0; offset < data.length;) {
      if (used === block.length) {
        block = new Uint8Array(1024 * 1024);
        chunks.push(block);
        used = 0;
      }
      const length = Math.min(data.length - offset, block.length - used);
      block.set(data.subarray(offset, offset + length), used);
      used += length;
      offset += length;
    }
  });
  onProgress?.(0, members.length);
  return {
    add(pdfBytes: Uint8Array) {
      const entry = new ZipPassThrough(members[index]!);
      entry.mtime = new Date(2000, 0, 1, 12);
      zip.add(entry);
      entry.push(pdfBytes, true);
      index++;
      onProgress?.(index, members.length);
    },
    finish() {
      zip.end();
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        const length = Math.min(chunk.length, size - offset);
        bytes.set(chunk.subarray(0, length), offset);
        offset += length;
      }
      return bytes;
    },
  };
}

export function createZip(rows: readonly PdfExportRow[], onProgress?: ExportProgress): Uint8Array {
  const zip = openZip(rows.map(({ filename }) => filename), onProgress);
  for (const { pdfBytes } of rows) zip.add(pdfBytes);
  return zip.finish();
}

async function getPrintStamp(watermark: PrintWatermarkOptions | undefined): Promise<PrintStamp | undefined> {
  if (!watermark) return undefined;
  const settings = validateWatermarkSettings(watermark.settings);
  if (!settings) throw new Error('invalid-watermark');
  if (settings.kind === 'none') return undefined;
  const { preparePrintStamp } = await import('./watermark');
  return preparePrintStamp(settings, watermark.fonts);
}

async function getQrStamp(request: QrPrintRequest | undefined, rowCount: number): Promise<QrStamp | undefined> {
  if (request === undefined) return undefined;
  const safeRequest = validateQrPrintRequest(request, rowCount);
  const { prepareQrStamp } = await import('./qr-stamp');
  return prepareQrStamp(safeRequest);
}

export async function createFlattenedZip(
  rows: readonly PdfExportRow[], onProgress?: ExportProgress, watermark?: PrintWatermarkOptions, qrStamp?: QrPrintRequest,
): Promise<Uint8Array> {
  const zip = openZip(rows.map(({ filename }) => filename), onProgress);
  const stamp = await getPrintStamp(watermark);
  const qr = await getQrStamp(qrStamp, rows.length);
  for (const [index, row] of rows.entries()) {
    zip.add(await buildMergedPdf([row], undefined, undefined, stamp, qr && ((pages) => qr(pages, index))));
  }
  return zip.finish();
}

export async function createGeneratedZip(
  rows: readonly GeneratedPdfExportRow[], onProgress?: ExportProgress, flatten = false, watermark?: PrintWatermarkOptions, qrStamp?: QrPrintRequest,
  zipPaths?: readonly string[],
) {
  const paths = zipPaths ? [...zipPaths] : rows.map(({ filename }) => filename);
  if (zipPaths && (paths.length !== rows.length || paths.some((path, index) => path.split('/')[1] !== rows[index]!.filename))) {
    throw new Error('invalid-export-filename');
  }
  const zip = openZip(paths, onProgress, true, zipPaths ? 'grouped' : 'flat');
  const stamp = flatten ? await getPrintStamp(watermark) : undefined;
  const qr = flatten ? await getQrStamp(qrStamp, rows.length) : undefined;
  const entries: CustodyEntry[] = [];
  for (const [index, row] of rows.entries()) {
    const bytes = await (flatten
      ? buildMergedPdf([row], undefined, undefined, stamp, qr && ((pages) => qr(pages, index)))
      : row.getPdfBytes());
    const zipPath = zipPaths && paths[index]!;
    entries.push({ filename: row.filename, sha256: await sha256(bytes), bytes: bytes.byteLength, ...(zipPath !== undefined && { zipPath }) });
    zip.add(bytes);
  }
  return { bytes: zip.finish(), entries };
}

function activeAppearance(widget: PDFDict) {
  const appearances = widget.lookupMaybe(key('AP'), PDFDict);
  const normal = appearances?.lookup(key('N'));
  if (normal instanceof PDFStream) return { stream: normal, ref: appearances!.get(key('N')) };
  if (!(normal instanceof PDFDict)) return undefined;
  const state = widget.lookupMaybe(key('AS'), PDFName);
  if (!state) return undefined;
  const stream = normal.lookup(state);
  return stream instanceof PDFStream ? { stream, ref: normal.get(state), stateful: true } : undefined;
}

function flattenWidgets(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const paint: PDFOperator[] = [];
    const removed: number[] = [];
    for (let index = 0; index < annots.size(); index++) {
      const annot = annots.lookup(index, PDFDict);
      if (annot.lookupMaybe(key('Subtype'), PDFName) !== key('Widget')) continue;
      removed.push(index);
      const flags = widgetFlags(annot);
      if (flags & (1 | 2 | 32)) continue;
      if (page.getRotation().angle && flags & 16) throw new Error('unflattenable-widget');
      const appearance = activeAppearance(annot);
      // Viewers can synthesize appearances from /V or /MK. Dropping a visible
      // widget without a reusable active stream can remove printed content.
      if (!appearance) throw new Error('unflattenable-widget');
      const { stream, ref } = appearance;
      // PDF annotation renderers calculate stateful appearance placement with
      // single-precision rectangle coordinates. Retain that edge alignment.
      const round = 'stateful' in appearance ? Math.fround : (value: number) => value;
      const bbox = stream.dict.lookupMaybe(key('BBox'), PDFArray);
      const matrix = stream.dict.lookupMaybe(key('Matrix'), PDFArray);
      if (bbox?.size() !== 4 || (matrix && matrix.size() !== 6)) throw new Error('unflattenable-widget');
      const [left, bottom, right, top] = [0, 1, 2, 3].map((i) => bbox.lookup(i, PDFNumber).asNumber()) as [number, number, number, number];
      const [a, b, c, d, e, f] = matrix ? [0, 1, 2, 3, 4, 5].map((i) => matrix.lookup(i, PDFNumber).asNumber()) as [number, number, number, number, number, number] : [1, 0, 0, 1, 0, 0];
      const xs = [a * left + c * bottom + e, a * right + c * bottom + e, a * right + c * top + e, a * left + c * top + e];
      const ys = [b * left + d * bottom + f, b * right + d * bottom + f, b * right + d * top + f, b * left + d * top + f];
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const { x, y, width, height } = PDFWidgetAnnotation.fromDict(annot).getRectangle();
      const sx = round(round(round(x + width) - round(x)) / round(round(Math.max(...xs)) - round(minX)));
      const sy = round(round(round(y + height) - round(y)) / round(round(Math.max(...ys)) - round(minY)));
      if (!(sx > 0 && sy > 0 && Number.isFinite(sx) && Number.isFinite(sy))) throw new Error('unflattenable-widget');
      const resource = page.node.newXObject('ArabiFormWidget', ref instanceof PDFRef ? ref : doc.context.register(stream));
      paint.push(PDFOperator.of(Op.PushGraphicsState),
        PDFOperator.of(Op.ConcatTransformationMatrix, [sx, 0, 0, sy, round(round(x) - round(sx * minX)), round(round(y) - round(sy * minY))].map(number)),
        PDFOperator.of(Op.DrawObject, [resource]), PDFOperator.of(Op.PopGraphicsState));
    }
    if (paint.length) page.node.addContentStream(doc.context.register(doc.context.contentStream(paint)));
    for (const index of removed.reverse()) annots.remove(index);
  }
  doc.catalog.delete(key('AcroForm'));
}

export async function createMergedPdf(
  rows: readonly ExportRow[], onProgress?: ExportProgress, cover?: MergeCoverOptions, watermark?: PrintWatermarkOptions, qrStamp?: QrPrintRequest,
  imposition: Imposition = '1-up',
): Promise<Uint8Array> {
  if (!rows.length) throw new Error('empty-export');
  if (imposition !== '1-up' && imposition !== '2-up') throw new Error('invalid-imposition');
  return buildMergedPdf(rows, onProgress, cover, await getPrintStamp(watermark), await getQrStamp(qrStamp, rows.length), imposition);
}

type SplitPrintGroup = OutputGroup & { rows: readonly GeneratedPdfExportRow[]; cover?: MergeCoverOptions };

export async function createSplitMergedZip(
  groups: readonly SplitPrintGroup[], sources: CustodySources, scope: ExportScope, groupByColumn: string, onProgress?: ExportProgress,
  watermark?: PrintWatermarkOptions, qrStamp?: QrPrintRequest, imposition: Imposition = '1-up',
) {
  if (!groups.length) throw new Error('empty-export');
  if (imposition !== '1-up' && imposition !== '2-up') throw new Error('invalid-imposition');
  const paths = groups.map(({ folder }) => `${folder}-merged.pdf`);
  const zip = openZip([...paths, SPLIT_CUSTODY_PATH], undefined, true, 'split');
  const total = scope.selectedRowNumbers.length;
  const qr = await getQrStamp(qrStamp, total);
  const stamp = await getPrintStamp(watermark);
  const qrIndices = new Map(scope.selectedRowNumbers.map((number, index) => [number, index]));
  const entries: GroupedCustodyEntry[] = [];
  let completed = 0;
  for (const [index, { groupValue, folder, rowNumbers, rows, cover }] of groups.entries()) {
    const filename = paths[index]!;
    const bytes = await buildMergedPdf(rows, (count) => onProgress?.(completed + count, total), cover, stamp,
      qr && ((pages, ordinal) => qr(pages, qrIndices.get(rowNumbers[ordinal]!)!)), imposition);
    entries.push({ groupValue, folder, zipPath: filename, rowNumbers, filename, sha256: await sha256(bytes), bytes: bytes.byteLength });
    zip.add(bytes);
    completed += rows.length;
  }
  const receipt = createCustodyManifest(sources, { groupByColumn, groups: entries }, scope);
  zip.add(new TextEncoder().encode(receipt));
  return { bytes: zip.finish(), groupByColumn, groups: entries };
}

async function buildMergedPdf(
  rows: readonly ExportRow[], onProgress?: ExportProgress, cover?: MergeCoverOptions, stamp?: PrintStamp, qr?: QrStamp,
  imposition: Imposition = '1-up',
): Promise<Uint8Array> {
  let merged = await PDFDocument.create();
  const twoUp = imposition === '2-up';
  const recordGeometry: TemplateMetadata['pages'] = [];
  const coverEntries: { filename: string; pageCount: number }[] = [];
  const stampQr: (() => void)[] = [];
  onProgress?.(0, rows.length);
  for (const [index, row] of rows.entries()) {
    const { doc: source, pages: geometry } = await openTemplate('pdfBytes' in row ? row.pdfBytes : await row.getPdfBytes());
    const sourcePages = source.getPages();
    if (twoUp && sourcePages.length !== 1) throw new Error('imposition-requires-single-page');
    const paintQr = qr?.(sourcePages, index);
    flattenWidgets(source);
    if (twoUp) {
      const annots = sourcePages[0]!.node.Annots();
      for (let ordinal = 0; annots && ordinal < annots.size(); ordinal++) {
        const flags = widgetFlags(annots.lookup(ordinal, PDFDict));
        if (flags & 4 && !(flags & (1 | 2))) throw new Error('imposition-unsupported-print-annotation');
      }
      recordGeometry.push(geometry[0]!);
    }
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
    if (paintQr) stampQr.push(() => paintQr(pages));
    if (cover) coverEntries.push({ filename: row.filename, pageCount: sourcePages.length });
    onProgress?.(index + 1, rows.length);
  }
  await stamp?.(merged);
  stampQr.forEach((paint) => paint());
  if (twoUp) {
    const { imposeRecordPages } = await import('./imposition');
    merged = await imposeRecordPages(merged, recordGeometry);
  }
  if (cover) await prependMergeCover(merged, coverEntries, cover, imposition);
  return merged.save({ updateFieldAppearances: false });
}

export function createAudit(rows: readonly AuditRow[], scope?: ExportScope): { json: string; csv: string } {
  let included = rows;
  if (scope?.exportScope === 'selected-subset') {
    const selected = new Set(scope.selectedRowNumbers);
    included = rows.filter(({ rowNumber, status }) => status === 'pass' && selected.has(rowNumber));
    if (!included.length) throw new Error('empty-export');
  }
  const grouped = included.some(({ zipPath }) => zipPath !== undefined);
  const ordered = included.map(({ rowNumber, filename, status, diagnostics, fontSizes, zipPath }) => ({
    rowNumber, filename, status,
    diagnostics: diagnostics.map(({ pageNumbers, ...issue }) => issue),
    fontSizes: Object.fromEntries(Object.keys(fontSizes).sort().map((field) => [field, fontSizes[field]])),
    ...(zipPath !== undefined && { zipPath }),
  }));
  const fields = ['rowNumber', 'filename', 'status', 'diagnostics', 'fontSizes'];
  if (grouped) fields.push('zipPath');
  const data = ordered.map(({ rowNumber, filename, status, diagnostics, fontSizes, zipPath }) => [rowNumber,
    ...[filename, status, JSON.stringify(diagnostics), JSON.stringify(fontSizes), ...(grouped ? [zipPath ?? ''] : [])].map(escapeSpreadsheetCell)]);
  return { json: `${JSON.stringify(ordered, null, 2)}\n`, csv: `${Papa.unparse({ fields, data })}\r\n` };
}
