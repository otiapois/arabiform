import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFOperator, PDFOperatorNames as Op, PDFRef, PDFStream, PDFString, PDFWidgetAnnotation } from 'pdf-lib';
import { Zip, ZipPassThrough } from 'fflate';
import Papa from 'papaparse';
import { filenameKey, isSafePdfFilename } from '../roster/filenames';
import { key, number, openTemplate, widgetFlags } from './template';
import type { FieldDiagnostic, RowPreflightResult } from './index';

export interface PdfExportRow { filename: string; pdfBytes: Uint8Array }
export interface AuditRow {
  rowNumber: number;
  filename: string;
  status: RowPreflightResult['status'];
  diagnostics: FieldDiagnostic[];
  fontSizes: Record<string, number[]>;
}

type ExportProgress = (completed: number, total: number) => void;

export function createZip(rows: readonly PdfExportRow[], onProgress?: ExportProgress): Uint8Array {
  const filenames = new Set<string>();
  for (const { filename } of rows) {
    const normalized = filenameKey(filename);
    if (!isSafePdfFilename(filename) || filenames.has(normalized)) throw new Error('invalid-export-filename');
    filenames.add(normalized);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const zip = new Zip((error, data) => {
    if (error) throw error;
    chunks.push(data);
    size += data.length;
  });
  onProgress?.(0, rows.length);
  for (const [index, { filename, pdfBytes }] of rows.entries()) {
    const entry = new ZipPassThrough(filename);
    entry.mtime = new Date(2000, 0, 1, 12);
    zip.add(entry);
    entry.push(pdfBytes, true);
    onProgress?.(index + 1, rows.length);
  }
  zip.end();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function activeAppearance(widget: PDFDict) {
  const appearances = widget.lookupMaybe(key('AP'), PDFDict);
  const normal = appearances?.lookup(key('N'));
  if (normal instanceof PDFStream) return { stream: normal, ref: appearances!.get(key('N')) };
  if (!(normal instanceof PDFDict)) return undefined;
  const state = widget.lookupMaybe(key('AS'), PDFName) ?? key('Off');
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
      if (!appearance) {
        const parent = annot.lookupMaybe(key('Parent'), PDFDict);
        const value = annot.lookup(key('V')) ?? parent?.lookup(key('V'));
        if ((value instanceof PDFString || value instanceof PDFHexString) && value.decodeText()) throw new Error('unflattenable-widget');
        if (value instanceof PDFName && value !== key('Off')) throw new Error('unflattenable-widget');
        continue;
      }
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

export async function createMergedPdf(rows: readonly PdfExportRow[], onProgress?: ExportProgress): Promise<Uint8Array> {
  if (!rows.length) throw new Error('empty-export');
  const merged = await PDFDocument.create();
  onProgress?.(0, rows.length);
  for (const [index, row] of rows.entries()) {
    const { doc: source } = await openTemplate(row.pdfBytes);
    flattenWidgets(source);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
    onProgress?.(index + 1, rows.length);
  }
  return merged.save({ updateFieldAppearances: false });
}

function escapeSpreadsheetCell(value: string): string {
  return /^[\t\r\n]|^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(value.normalize('NFKC')) ? `'${value}` : value;
}

export function createAudit(rows: readonly AuditRow[]): { json: string; csv: string } {
  const ordered = rows.map(({ rowNumber, filename, status, diagnostics, fontSizes }) => ({
    rowNumber, filename, status, diagnostics, fontSizes: Object.fromEntries(Object.keys(fontSizes).sort().map((field) => [field, fontSizes[field]])),
  }));
  const data = ordered.map(({ rowNumber, filename, status, diagnostics, fontSizes }) => [rowNumber, ...[filename, status, JSON.stringify(diagnostics), JSON.stringify(fontSizes)].map(escapeSpreadsheetCell)]);
  return { json: `${JSON.stringify(ordered, null, 2)}\n`, csv: `${Papa.unparse({ fields: ['rowNumber', 'filename', 'status', 'diagnostics', 'fontSizes'], data })}\r\n` };
}
