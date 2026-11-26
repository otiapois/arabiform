import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFOperator, PDFOperatorNames as Op, PDFRef, PDFStream, PDFString, PDFWidgetAnnotation } from 'pdf-lib';
import { zipSync } from 'fflate';
import Papa from 'papaparse';
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

export function createZip(rows: readonly PdfExportRow[]): Uint8Array {
  const filenames = new Set<string>();
  for (const { filename } of rows) {
    const normalized = filename.normalize('NFC').toLowerCase();
    if (!/^.+\.pdf$/iu.test(filename) || /^[.\s]/u.test(filename) || /[\\/:*?"<>|\p{Cc}]/u.test(filename) || filenames.has(normalized)) {
      throw new Error('invalid-export-filename');
    }
    filenames.add(normalized);
  }
  const mtime = new Date(Date.UTC(2000, 0, 1, 12));
  return zipSync(Object.fromEntries(rows.map(({ filename, pdfBytes }) => [filename, [pdfBytes, { mtime }]])), { level: 0 });
}

function activeAppearance(widget: PDFDict) {
  const appearances = widget.lookupMaybe(key('AP'), PDFDict);
  const normal = appearances?.lookup(key('N'));
  if (normal instanceof PDFStream) return { stream: normal, ref: appearances!.get(key('N')) };
  if (!(normal instanceof PDFDict)) return undefined;
  const state = widget.lookupMaybe(key('AS'), PDFName) ?? key('Off');
  const stream = normal.lookup(state);
  return stream instanceof PDFStream ? { stream, ref: normal.get(state) } : undefined;
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
      const sx = width / (Math.max(...xs) - minX);
      const sy = height / (Math.max(...ys) - minY);
      if (!(sx > 0 && sy > 0 && Number.isFinite(sx) && Number.isFinite(sy))) throw new Error('unflattenable-widget');
      const resource = page.node.newXObject('ArabiFormWidget', ref instanceof PDFRef ? ref : doc.context.register(stream));
      paint.push(PDFOperator.of(Op.PushGraphicsState),
        PDFOperator.of(Op.ConcatTransformationMatrix, [sx, 0, 0, sy, x - sx * minX, y - sy * minY].map(number)),
        PDFOperator.of(Op.DrawObject, [resource]), PDFOperator.of(Op.PopGraphicsState));
    }
    if (paint.length) page.node.addContentStream(doc.context.register(doc.context.contentStream(paint)));
    for (const index of removed.reverse()) annots.remove(index);
  }
  doc.catalog.delete(key('AcroForm'));
}

export async function createMergedPdf(rows: readonly PdfExportRow[]): Promise<Uint8Array> {
  if (!rows.length) throw new Error('empty-export');
  const merged = await PDFDocument.create();
  for (const row of rows) {
    const { doc: source } = await openTemplate(row.pdfBytes);
    flattenWidgets(source);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save({ updateFieldAppearances: false });
}

export function createAudit(rows: readonly AuditRow[]): { json: string; csv: string } {
  const ordered = rows.map(({ rowNumber, filename, status, diagnostics, fontSizes }) => ({
    rowNumber, filename, status, diagnostics, fontSizes: Object.fromEntries(Object.keys(fontSizes).sort().map((field) => [field, fontSizes[field]])),
  }));
  const data = ordered.map(({ rowNumber, filename, status, diagnostics, fontSizes }) => [rowNumber, filename, status, JSON.stringify(diagnostics), JSON.stringify(fontSizes)]);
  return { json: `${JSON.stringify(ordered, null, 2)}\n`, csv: `${Papa.unparse({ fields: ['rowNumber', 'filename', 'status', 'diagnostics', 'fontSizes'], data }, { escapeFormulae: true })}\r\n` };
}
