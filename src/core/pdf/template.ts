import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, PDFTextField, PDFWidgetAnnotation } from 'pdf-lib';

export const key = PDFName.of;
export const number = PDFNumber.of;
export const rotationOf = (angle: number): number => (angle % 360 + 360) % 360;

export interface WidgetMetadata {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  defaultFontSize: number;
}

export interface FieldMetadata {
  name: string;
  required: boolean;
  multiline: boolean;
  readOnly: boolean;
  maxLength?: number;
  defaultFontSize: number;
  value: string;
  widgets: WidgetMetadata[];
}

export interface TemplateMetadata {
  fields: FieldMetadata[];
  pages: { width: number; height: number; rotation: number }[];
}

export type PdfIntakeCode = 'invalid-pdf' | 'encrypted-pdf' | 'xfa-unsupported' | 'signed-pdf-warning' | 'flat-scanned-no-fields';

export class PdfIntakeError extends Error {
  constructor(readonly code: PdfIntakeCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'PdfIntakeError';
  }
}

export async function loadPdf(bytes: Uint8Array | ArrayBuffer): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    // Read the trailer without relying on pdf-lib's transpiled Error prototype.
    // The document is rejected before accessing pages or AcroForm if encryption is present.
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: true });
  } catch (error) {
    throw new PdfIntakeError('invalid-pdf', error);
  }
  if (doc.isEncrypted || doc.context.trailerInfo.Encrypt) throw new PdfIntakeError('encrypted-pdf');
  return doc;
}

export function widgetFlags(widget: PDFDict): number {
  return widget.lookupMaybe(key('F'), PDFNumber)?.asNumber() ?? 0;
}

function fieldAttributes(field: PDFDict, name: string) {
  for (let node: PDFDict | undefined = field; node; node = node.lookupMaybe(key('Parent'), PDFDict)) {
    if (node.has(key(name))) return node.lookup(key(name));
  }
  return undefined;
}

export function textValue(dict: PDFDict) {
  const value = fieldAttributes(dict, 'V');
  return value instanceof PDFHexString || value instanceof PDFString ? value.decodeText() : '';
}

function fontSize(appearance: string): number {
  const last = [...appearance.matchAll(/([-+]?(?:\d+\.?\d*|\.\d+))\s+Tf\b/g)].at(-1);
  const size = Number(last?.[1]);
  return Number.isFinite(size) && size > 0 ? size : 12;
}

export interface WidgetTarget {
  widget: PDFWidgetAnnotation;
  meta: WidgetMetadata;
  appearance: string;
  usable: boolean;
}

export async function openTemplate(bytes: Uint8Array | ArrayBuffer) {
  const doc = await loadPdf(bytes);
  try {
    const rawForm = doc.catalog.lookupMaybe(key('AcroForm'), PDFDict);
    if (rawForm?.has(key('XFA'))) throw new PdfIntakeError('xfa-unsupported');
    if (doc.catalog.has(key('Perms'))) {
      const permissions = doc.catalog.lookupMaybe(key('Perms'), PDFDict);
      if (permissions?.keys().some((name) => ['DocMDP', 'UR', 'UR3', 'FieldMDP'].includes(name.decodeText()))) {
        throw new PdfIntakeError('signed-pdf-warning');
      }
    }

    const pdfPages = doc.getPages();
    const pages = pdfPages.map((page) => ({ ...page.getSize(), rotation: rotationOf(page.getRotation().angle) }));
    const cropBoxes = pdfPages.map((page) => page.getCropBox());
    const widgetPages = new Map<PDFDict, number>();
    for (const [pageIndex, page] of pdfPages.entries()) {
      const annots = page.node.Annots();
      for (let index = 0; annots && index < annots.size(); index++) {
        const dict = annots.lookup(index, PDFDict);
        if (dict.lookupMaybe(key('Subtype'), PDFName) !== key('Widget')) continue;
        if (widgetPages.has(dict)) throw new PdfIntakeError('invalid-pdf');
        widgetPages.set(dict, pageIndex);
      }
    }

    // Inspect the raw field tree and signature dictionaries before pdf-lib's getForm can mutate XFA.
    const stack = [...widgetPages.keys()];
    const roots = rawForm?.lookupMaybe(key('Fields'), PDFArray);
    for (let index = 0; roots && index < roots.size(); index++) stack.push(roots.lookup(index, PDFDict));
    const visited = new Set<PDFDict>();
    while (stack.length) {
      const dict = stack.pop()!;
      if (visited.has(dict)) continue;
      visited.add(dict);
      if (dict.lookupMaybe(key('FT'), PDFName) === key('Sig')) throw new PdfIntakeError('signed-pdf-warning');
      const parent = dict.lookupMaybe(key('Parent'), PDFDict);
      const kids = dict.lookupMaybe(key('Kids'), PDFArray);
      if (parent) stack.push(parent);
      for (let index = 0; kids && index < kids.size(); index++) stack.push(kids.lookup(index, PDFDict));
    }
    if (doc.context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFDict && object.get(key('Type')) === key('Sig'))) {
      throw new PdfIntakeError('signed-pdf-warning');
    }
    if (!rawForm || !roots?.size()) throw new PdfIntakeError('flat-scanned-no-fields');

    const formFields = doc.getForm().getFields().filter((field): field is PDFTextField => field instanceof PDFTextField);
    if (formFields.every((field) => field.isReadOnly())) throw new PdfIntakeError('flat-scanned-no-fields');
    const seen = new Set<string>();
    const fields = formFields.map((field) => {
      const name = field.getName();
      if (seen.has(name)) throw new PdfIntakeError('invalid-pdf');
      seen.add(name);
      const canonical = field.acroField.dict;
      const defaultAppearance = fieldAttributes(canonical, 'DA') ?? rawForm.lookup(key('DA'));
      const appearance = defaultAppearance instanceof PDFString || defaultAppearance instanceof PDFHexString ? defaultAppearance.decodeText() : '';
      const widgets = field.acroField.getWidgets().map((widget): WidgetTarget => {
        const rect = widget.getRectangle();
        const pageIndex = widgetPages.get(widget.dict) ?? -1;
        const crop = cropBoxes[pageIndex];
        const pageRotation = pages[pageIndex]?.rotation ?? 0;
        const flags = widgetFlags(widget.dict);
        const rotation = rotationOf(widget.getAppearanceCharacteristics()?.getRotation() ?? 0);
        const da = widget.dict.lookup(key('DA'));
        const widgetAppearance = da instanceof PDFString || da instanceof PDFHexString ? da.decodeText() : appearance;
        const linked = widget.dict === canonical || widget.dict.lookupMaybe(key('Parent'), PDFDict) === canonical;
        const usable = Boolean(crop && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
          && rect.x >= crop.x - 0.01 && rect.y >= crop.y - 0.01
          && rect.x + rect.width <= crop.x + crop.width + 0.01 && rect.y + rect.height <= crop.y + crop.height + 0.01
          && linked && !(flags & (1 | 2 | 32)) && !(pageRotation && flags & 16) && pageRotation % 90 === 0);
        return { widget, appearance: widgetAppearance, usable, meta: { ...rect, pageIndex, rotation, defaultFontSize: fontSize(widgetAppearance) } };
      });
      const maxLenAttribute = fieldAttributes(canonical, 'MaxLen');
      const maxLength = maxLenAttribute instanceof PDFNumber ? maxLenAttribute.asNumber() : undefined;
      if (maxLength !== undefined && (!Number.isSafeInteger(maxLength) || maxLength < 0)) throw new PdfIntakeError('invalid-pdf');
      const alignment = fieldAttributes(canonical, 'Q');
      const meta: FieldMetadata = {
        name, required: field.isRequired(), readOnly: field.isReadOnly(), multiline: field.isMultiline(),
        maxLength,
        defaultFontSize: fontSize(appearance), value: textValue(canonical), widgets: widgets.map((entry) => entry.meta),
      };
      return { field, widgets, meta, alignment: alignment instanceof PDFNumber ? alignment.asNumber() : undefined };
    });
    return { doc, rawForm, pages, fields };
  } catch (error) {
    if (error instanceof PdfIntakeError) throw error;
    throw new PdfIntakeError('invalid-pdf', error);
  }
}
