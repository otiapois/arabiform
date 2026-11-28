import fontkit from '@pdf-lib/fontkit';
import { grayscale, PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, type PDFObject } from 'pdf-lib';
import { sha256, type CustodySources } from '../audit/custody';
import type { ExportScope } from '../worker/row-selection';
import type { Imposition } from './imposition-settings';
import { addCoverText, createCoverTextLayout } from './merge-cover';
import type { FontBytes } from './shaping';
import { key, loadPdf } from './template';

export const PRINT_CERTIFICATE_FILENAME = 'print-shop-certificate.pdf';

export interface PrintCertificateNames { templateName: string; rosterName: string; outputName: string }

export interface PrintPreflightReceipt {
  sources: CustodySources;
  mergedPdfSha256: string;
  readyCount: number;
  excludedCount: number;
  exportScope: ExportScope['exportScope'];
  imposition: Imposition;
  pageCount: number;
  coverPages: number;
  minimumMappedFontPt?: number;
  mappedInkOutsidePrint: boolean;
}

function embeddedFontNames(doc: PDFDocument) {
  const visited = new Set<PDFObject>();
  const names = new Set<string>();
  function visit(node: PDFObject | undefined) {
    const value = doc.context.lookup(node);
    if (!(value instanceof PDFDict || value instanceof PDFStream || value instanceof PDFArray) || visited.has(value)) return;
    visited.add(value);
    if (value instanceof PDFStream) visit(value.dict);
    else if (value instanceof PDFArray) value.asArray().forEach(visit);
    else {
      const descriptor = value.lookupMaybe(key('FontDescriptor'), PDFDict);
      const embedded = descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((name) => descriptor.lookup(key(name)) instanceof PDFStream);
      const type3 = value.get(key('Subtype')) === key('Type3') && value.lookup(key('CharProcs')) instanceof PDFDict;
      if (embedded || type3) {
        const name = value.lookupMaybe(key('BaseFont'), PDFName) ?? descriptor?.lookupMaybe(key('FontName'), PDFName)
          ?? value.lookupMaybe(key('Name'), PDFName);
        names.add(name?.decodeText().replace(/^[A-Z]{6}\+/, '') ?? '(unnamed embedded font)');
      }
      for (const [name, entry] of value.entries()) if (name !== key('Parent') && name !== key('P') && name !== key('Pages')) visit(entry);
    }
  }
  for (const page of doc.getPages()) {
    visit(page.node.Resources());
    visit(page.node.Annots());
  }
  return [...names].sort();
}

export async function createPrintCertificate(
  mergedBytes: Uint8Array, receipt: PrintPreflightReceipt, names: PrintCertificateNames, fonts: FontBytes,
): Promise<Uint8Array> {
  if (receipt.readyCount <= 0 || receipt.mappedInkOutsidePrint) throw new Error('print-certificate-unavailable');
  if (receipt.mergedPdfSha256 !== await sha256(mergedBytes)) throw new Error('print-certificate-output-mismatch');
  const merged = await loadPdf(mergedBytes);
  if (merged.getPageCount() !== receipt.pageCount || receipt.coverPages < 0 || receipt.coverPages >= receipt.pageCount || merged.catalog.has(key('AcroForm'))) {
    throw new Error('print-certificate-output-mismatch');
  }
  const inventory = embeddedFontNames(merged);

  const certificate = await PDFDocument.create({ updateMetadata: false });
  certificate.setTitle('ArabiForm Print-Shop Preflight Certificate');
  // Keep exact Unicode source names in the subject even when a bundled face cannot paint them.
  certificate.setSubject(JSON.stringify({ ...names, embeddedFonts: inventory }));
  certificate.registerFontkit(fontkit);
  const [arabic, latin] = await Promise.all([
    certificate.embedFont(fonts.arabic, { subset: false, customName: 'NotoNaskhArabic-Regular' }),
    certificate.embedFont(fonts.latin, { subset: false, customName: 'NotoSans-Regular' }),
  ]);
  const resources = { arabic: { name: 'CertificateArabic', ref: arabic.ref }, latin: { name: 'CertificateLatin', ref: latin.ref } };
  const page = certificate.addPage([595.28, 841.89]);
  for (const resource of Object.values(resources)) page.node.setFontDictionary(key(resource.name), resource.ref);
  const layout = createCoverTextLayout(fonts);
  const left = 36;
  const width = page.getWidth() - left * 2;
  let top = page.getHeight() - left;
  const paired = (en: string, ar: string, size: number, gap = 6) => {
    const english = layout(en, size, width / 2, 'ltr');
    const arabic = layout(ar, size, width / 2, 'rtl');
    addCoverText(page, english, left, top, width / 2, 'ltr', resources);
    addCoverText(page, arabic, left + width / 2, top, width / 2, 'rtl', resources);
    top -= Math.max(english.height, arabic.height) + gap;
  };
  const value = (text: string, size: number, mode: 'filename' | 'ltr' = 'ltr', fallback?: string) => {
    let measured;
    try {
      measured = layout(text, size, width, mode);
    } catch (error) {
      if (!fallback || !(error instanceof Error) || error.message !== 'cover-sheet-unsupported-text') throw error;
      measured = layout(fallback, size, width, 'ltr');
    }
    addCoverText(page, measured, left, top, width, 'ltr', resources);
    top -= measured.height + 5;
  };
  const divider = () => {
    top -= 6;
    page.drawLine({ start: { x: left, y: top }, end: { x: left + width, y: top }, color: grayscale(0.6), thickness: 0.45 });
    top -= 13;
  };
  const { sources, readyCount, excludedCount, exportScope, imposition, pageCount, coverPages, minimumMappedFontPt } = receipt;
  try {
    paired('ArabiForm', 'شهادة فحص المطبعة', 21, 8);
    paired('Print-Shop Preflight Certificate', 'فحص محلي للملف الجاهز للطباعة', 14);
    divider();
    paired('0 clipped fields verified', 'تم التحقق: ٠ حقول مقصوصة', 13);
    paired('Mapped text ink-fit preflight', 'فحص احتواء حبر النص في الحقول المعينة', 10);
    paired('Artwork, trim and press output excluded', 'لا يشمل الرسم أو القص أو ناتج المطبعة', 9);
    divider();
    for (const [en, ar, filename, digest] of [
      ['Source template', 'قالب المصدر', names.templateName, sources.templateSha256],
      ['Source roster', 'القائمة المصدرية', names.rosterName, sources.rosterSha256],
      ['Print-ready PDF', 'الملف الجاهز للطباعة', names.outputName, receipt.mergedPdfSha256],
    ] as const) {
      paired(en, ar, 11);
      value(filename, 11, 'filename', '[Filename cannot be displayed]');
      value(`SHA-256 ${digest}`, 10);
      top -= 9;
    }
    divider();
    paired(exportScope === 'all-ready' ? 'Scope: all ready rows' : 'Scope: selected ready rows',
      exportScope === 'all-ready' ? 'النطاق: كل الصفوف الجاهزة' : 'النطاق: الصفوف الجاهزة المحددة', 10);
    paired(`Ready: ${readyCount}  /  Excluded: ${excludedCount}`, `جاهزة: ${readyCount}  /  مستبعدة: ${excludedCount}`, 10);
    paired(`Imposition: ${imposition}`, 'توزيع السجلات على الورقة', 10);
    paired(`Physical sheets: ${pageCount}  /  Cover pages: ${coverPages}`, `الأوراق الفعلية: ${pageCount}  /  صفحات الغلاف: ${coverPages}`, 10);
    paired('Embedded font names', 'أسماء الخطوط المضمنة', 10);
    if (!inventory.length) paired('None', 'لا يوجد', 10);
    else for (const name of inventory) value(name, 9, 'filename', '[Embedded font name cannot be displayed]');
    paired('Minimum rendered mapped text', 'أصغر حجم للنص المعين بعد التوزيع', 10);
    if (minimumMappedFontPt === undefined) paired('No mapped text ink', 'لا يوجد حبر لنص معين', 10);
    else value(`${Number(minimumMappedFontPt.toFixed(4))} pt`, 11);
  } catch (error) {
    throw new Error('print-certificate-layout-overflow', { cause: error });
  }
  if (top < left) throw new Error('print-certificate-layout-overflow');
  return certificate.save({ updateFieldAppearances: false });
}
