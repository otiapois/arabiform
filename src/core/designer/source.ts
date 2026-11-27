import { PDFArray, PDFDict, PDFName, PDFNumber, PDFStream, type PDFPage } from 'pdf-lib';
import { sha256 } from '../audit/custody';
import { assertUnsignedAcroForm, collectPageWidgets, inspectAcroFormCatalog, intersectPageBounds, key, loadPdf, PdfIntakeError, rotationOf, type RectangleBounds } from '../pdf/template';
import type { DesignerPage } from './geometry';
import { DesignerError } from './spec';

export interface FlatPdfMetadata {
  readonly sourceSha256: string;
  readonly pages: readonly DesignerPage[];
}

function orderedBounds(array: PDFArray): RectangleBounds {
  if (array.size() !== 4) throw new DesignerError('invalid-page-geometry');
  const x = array.lookup(0, PDFNumber).asNumber();
  const y = array.lookup(1, PDFNumber).asNumber();
  const right = array.lookup(2, PDFNumber).asNumber();
  const top = array.lookup(3, PDFNumber).asNumber();
  if (![x, y, right, top].every(Number.isFinite) || !(right > x && top > y)) throw new DesignerError('invalid-page-geometry');
  return [x, y, right, top];
}

function readPageGeometry(page: PDFPage): DesignerPage {
  const { node, doc } = page;
  const rawCrop = node.getInheritableAttribute(key('CropBox'));
  const rawRotate = node.getInheritableAttribute(key('Rotate'));
  const media = orderedBounds(node.MediaBox());
  const crop = rawCrop === undefined ? undefined : orderedBounds(doc.context.lookup(rawCrop, PDFArray));
  const rawUnit = node.get(key('UserUnit'));
  const userUnit = rawUnit === undefined ? 1 : doc.context.lookup(rawUnit, PDFNumber).asNumber();
  const rotation = rawRotate === undefined ? 0 : rotationOf(doc.context.lookup(rawRotate, PDFNumber).asNumber());
  if (!Number.isFinite(userUnit) || userUnit <= 0 ||
    (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270)) {
    throw new DesignerError('invalid-page-geometry');
  }
  const bounds = crop ? intersectPageBounds(media, crop) : media;
  if (!bounds) throw new DesignerError('invalid-page-geometry');
  const [x, y, right, top] = bounds;
  const width = right - x;
  const height = top - y;
  if (!(width > 0 && height > 0 && Number.isFinite(width * userUnit) && Number.isFinite(height * userUnit))) {
    throw new DesignerError('invalid-page-geometry');
  }
  return { visibleBox: { x, y, width, height }, rotation, userUnit };
}

export async function openFlatPdf(bytes: Uint8Array | ArrayBuffer) {
  try {
    const doc = await loadPdf(bytes);
    const rawForm = inspectAcroFormCatalog(doc);
    const pdfPages = doc.getPages();
    if (!pdfPages.length) throw new DesignerError('invalid-pdf');
    const widgets = collectPageWidgets(pdfPages);
    const fields = assertUnsignedAcroForm(doc, rawForm, widgets.keys());
    const sigFlags = rawForm?.lookupMaybe(key('SigFlags'), PDFNumber)?.asNumber() ?? 0;
    const dictionaries = doc.context.enumerateIndirectObjects()
      .flatMap(([, object]) => object instanceof PDFDict ? [object] : []);
    // A signature or field object can survive without an AcroForm or page annotation reference.
    if (sigFlags || dictionaries.some((dict) => dict.get(key('FT')) === key('Sig') ||
        dict.get(key('Type')) === key('DocTimeStamp') || (dict.has(key('ByteRange')) && dict.has(key('Contents'))))) {
      throw new DesignerError('signed-pdf-warning');
    }
    if (fields?.size() || widgets.size || dictionaries.some((dict) =>
      dict.has(key('FT')) || dict.lookup(key('Subtype')) === key('Widget'))) {
      throw new DesignerError('existing-form-fields');
    }
    if ((doc.catalog.has(key('AcroForm')) && !rawForm) || (rawForm && !fields)) throw new DesignerError('invalid-pdf');
    const resources = rawForm?.lookupMaybe(key('DR'), PDFDict);
    resources?.lookupMaybe(key('Font'), PDFDict);
    const pages = pdfPages.map((page) => {
      const contents = page.node.get(key('Contents'));
      if (contents !== undefined) {
        const stream = doc.context.lookup(contents);
        if (stream instanceof PDFArray) {
          for (let index = 0; index < stream.size(); index++) stream.lookup(index, PDFStream);
        } else if (!(stream instanceof PDFStream)) throw new DesignerError('invalid-pdf');
      }
      const annotations = page.node.get(key('Annots'));
      const annots = annotations === undefined ? undefined : doc.context.lookup(annotations, PDFArray);
      for (let index = 0; annots && index < annots.size(); index++) annots.lookup(index, PDFDict).lookup(key('Subtype'), PDFName);
      return readPageGeometry(page);
    });
    return { doc, pdfPages, pages };
  } catch (error) {
    if (error instanceof DesignerError) throw error;
    const code = error instanceof PdfIntakeError && error.code !== 'flat-scanned-no-fields' ? error.code : 'invalid-pdf';
    throw new DesignerError(code, { cause: error });
  }
}

export async function inspectFlatPdf(bytes: Uint8Array | ArrayBuffer): Promise<FlatPdfMetadata> {
  const source = bytes instanceof ArrayBuffer ? bytes.slice(0) : Uint8Array.from(bytes);
  const { pages } = await openFlatPdf(source);
  return { sourceSha256: await sha256(source), pages };
}
