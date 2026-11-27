import { PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFNumber, PDFPage, PDFRadioGroup, PDFString, PDFTextField, PDFWidgetAnnotation } from 'pdf-lib';
import type { FieldChoice } from './choice-match';
import { dropdownChoices, radioChoices } from './choices';

export const key = PDFName.of;
export const number = PDFNumber.of;
export const rotationOf = (angle: number): number => (angle % 360 + 360) % 360;

export type RectangleBounds = readonly [left: number, bottom: number, right: number, top: number];

export interface WidgetMetadata {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  defaultFontSize: number;
  innerWidth: number | null;
  innerHeight: number | null;
  usable: boolean;
  visibleInPreview: boolean;
  printBounds?: RectangleBounds;
}

export interface FieldMetadata {
  name: string;
  kind: 'text' | 'checkbox' | 'radio' | 'dropdown';
  required: boolean;
  multiline: boolean;
  supportsTextCapacity: boolean;
  readOnly: boolean;
  maxLength?: number;
  defaultFontSize: number;
  value: string;
  widgets: WidgetMetadata[];
  choices?: FieldChoice[];
}

export interface TemplateMetadata {
  fields: FieldMetadata[];
  pages: {
    width: number;
    height: number;
    rotation: number;
    visibleBox: { x: number; y: number; width: number; height: number };
    printBounds: RectangleBounds;
    userUnit: number;
  }[];
}

export function readBounds(rect: PDFArray): RectangleBounds {
  const firstX = rect.lookup(0, PDFNumber).asNumber();
  const firstY = rect.lookup(1, PDFNumber).asNumber();
  const secondX = rect.lookup(2, PDFNumber).asNumber();
  const secondY = rect.lookup(3, PDFNumber).asNumber();
  return [Math.min(firstX, secondX), Math.min(firstY, secondY), Math.max(firstX, secondX), Math.max(firstY, secondY)];
}

function visiblePageBounds(media: RectangleBounds, crop: RectangleBounds): RectangleBounds {
  const left = Math.max(media[0], crop[0]);
  const bottom = Math.max(media[1], crop[1]);
  const right = Math.min(media[2], crop[2]);
  const top = Math.min(media[3], crop[3]);
  return right > left && top > bottom ? [left, bottom, right, top] : media;
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

export function fieldAttributes(field: PDFDict, name: string) {
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
  border: number;
  padding: number;
}

export function inspectAcroFormCatalog(doc: PDFDocument): PDFDict | undefined {
  const rawForm = doc.catalog.lookupMaybe(key('AcroForm'), PDFDict);
  if (rawForm?.has(key('XFA'))) throw new PdfIntakeError('xfa-unsupported');
  if (doc.catalog.has(key('Perms'))) {
    const permissions = doc.catalog.lookupMaybe(key('Perms'), PDFDict);
    if (permissions?.keys().some((name) => ['DocMDP', 'UR', 'UR3', 'FieldMDP'].includes(name.decodeText()))) {
      throw new PdfIntakeError('signed-pdf-warning');
    }
  }
  return rawForm;
}

export function collectPageWidgets(pdfPages: readonly PDFPage[]): Map<PDFDict, number> {
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
  return widgetPages;
}

export function requireUnsignedAcroForm(doc: PDFDocument, rawForm: PDFDict | undefined, widgets: Iterable<PDFDict>) {
  // Inspect the raw field tree and signature dictionaries before pdf-lib's getForm can mutate XFA.
  const stack = [...widgets];
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
  return { rawForm, roots };
}

export async function openTemplate(bytes: Uint8Array | ArrayBuffer) {
  const doc = await loadPdf(bytes);
  try {
    const rawForm = inspectAcroFormCatalog(doc);

    const pdfPages = doc.getPages();
    const cropBoxes = pdfPages.map((page) => page.getCropBox());
    const pages = pdfPages.map((page) => {
      const userUnit = page.node.lookup(key('UserUnit'));
      const unit = userUnit instanceof PDFNumber ? userUnit.asNumber() : 1;
      const media = readBounds(page.node.MediaBox());
      const crop = page.node.CropBox();
      const printBounds = crop ? visiblePageBounds(media, readBounds(crop)) : media;
      const [x, y, right, top] = printBounds;
      return {
        ...page.getSize(), rotation: rotationOf(page.getRotation().angle),
        visibleBox: { x, y, width: right - x, height: top - y }, printBounds,
        userUnit: Number.isFinite(unit) && unit > 0 ? unit : 1,
      };
    });
    const widgetPages = collectPageWidgets(pdfPages);
    const { rawForm: activeForm } = requireUnsignedAcroForm(doc, rawForm, widgetPages.keys());

    const linkedWidgets = new Map<PDFDict, Set<PDFDict>>();
    for (const widget of widgetPages.keys()) {
      const parent = widget.lookupMaybe(key('Parent'), PDFDict);
      if (!parent) continue;
      const siblings = linkedWidgets.get(parent) ?? new Set<PDFDict>();
      siblings.add(widget);
      linkedWidgets.set(parent, siblings);
    }
    const seen = new Set<string>();
    const fields = doc.getForm().getFields().flatMap((field) => {
      const kind = field instanceof PDFTextField ? 'text' : field instanceof PDFCheckBox ? 'checkbox'
        : field instanceof PDFRadioGroup ? 'radio' : field instanceof PDFDropdown ? 'dropdown' : undefined;
      if (!kind) return [];
      const name = field.getName();
      if (seen.has(name)) throw new PdfIntakeError('invalid-pdf');
      seen.add(name);
      const canonical = field.acroField.dict;
      const defaultAppearance = fieldAttributes(canonical, 'DA') ?? activeForm.lookup(key('DA'));
      const appearance = defaultAppearance instanceof PDFString || defaultAppearance instanceof PDFHexString ? defaultAppearance.decodeText() : '';
      const widgets = field.acroField.getWidgets().map((widget): WidgetTarget => {
        const rawRect = widget.Rect();
        const rect = rawRect?.asRectangle() ?? { x: 0, y: 0, width: 0, height: 0 };
        const pageIndex = widgetPages.get(widget.dict) ?? -1;
        const crop = cropBoxes[pageIndex];
        const pageRotation = pages[pageIndex]?.rotation ?? 0;
        const flags = widgetFlags(widget.dict);
        const rotation = rotationOf(widget.getAppearanceCharacteristics()?.getRotation() ?? 0);
        const da = widget.dict.lookup(key('DA'));
        const widgetAppearance = da instanceof PDFString || da instanceof PDFHexString ? da.decodeText() : appearance;
        const linked = widget.dict === canonical || widget.dict.lookupMaybe(key('Parent'), PDFDict) === canonical;
        const visibleInPreview = pageIndex >= 0 && linked && !(flags & (1 | 2 | 32));
        const usable = Boolean(crop && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
          && rect.x >= crop.x - 0.01 && rect.y >= crop.y - 0.01
          && rect.x + rect.width <= crop.x + crop.width + 0.01 && rect.y + rect.height <= crop.y + crop.height + 0.01
          && visibleInPreview && !(pageRotation && flags & 16) && pageRotation % 90 === 0);
        const legacyBorder = widget.dict.lookupMaybe(key('Border'), PDFArray);
        const border = Math.max(0, widget.getBorderStyle()?.getWidth()
          ?? (legacyBorder && legacyBorder.size() >= 3 ? Number(legacyBorder.get(2).toString()) : 0));
        const padding = 1.6 + border;
        const quarterTurn = rotation === 90 || rotation === 270;
        const supportedGeometry = rotation % 90 === 0 && [rect.width, rect.height, padding].every(Number.isFinite);
        const meta: WidgetMetadata = {
          ...rect, pageIndex, rotation, defaultFontSize: fontSize(widgetAppearance), usable, visibleInPreview,
          printBounds: rawRect && readBounds(rawRect),
          innerWidth: supportedGeometry ? Math.max(0, (quarterTurn ? rect.height : rect.width) - 2 * padding) : null,
          innerHeight: supportedGeometry ? Math.max(0, (quarterTurn ? rect.width : rect.height) - 2 * padding) : null,
        };
        return { widget, appearance: widgetAppearance, border, padding, meta };
      });
      const maxLenAttribute = kind === 'text' ? fieldAttributes(canonical, 'MaxLen') : undefined;
      const maxLength = maxLenAttribute instanceof PDFNumber ? maxLenAttribute.asNumber() : undefined;
      if (maxLength !== undefined && (!Number.isSafeInteger(maxLength) || maxLength < 0)) throw new PdfIntakeError('invalid-pdf');
      const alignment = fieldAttributes(canonical, 'Q');
      const current = fieldAttributes(canonical, 'V');
      const value = current instanceof PDFName ? current.decodeText() : current instanceof PDFArray
        ? current.asArray().map((item) => item instanceof PDFString || item instanceof PDFHexString ? item.decodeText() : '').join(', ')
        : textValue(canonical);
      const dropdownOptions = kind === 'dropdown' ? dropdownChoices(canonical) : undefined;
      const choices = dropdownOptions?.map(({ value, label }) => ({ value, label }))
        ?? (kind === 'radio' ? radioChoices(widgets, fieldAttributes(canonical, 'Opt')) : undefined);
      const supportsTextCapacity = field instanceof PDFTextField && !field.isReadOnly()
        && !field.isCombed() && !field.isPassword() && !field.isFileSelector() && !field.isRichFormatted();
      const meta: FieldMetadata = {
        name, kind, required: field.isRequired(), readOnly: field.isReadOnly(),
        multiline: field instanceof PDFTextField && field.isMultiline(), supportsTextCapacity, maxLength,
        defaultFontSize: fontSize(appearance), value, widgets: widgets.map((entry) => entry.meta), choices,
      };
      const declared = new Set(widgets.map(({ widget }) => widget.dict));
      const linked = [...(linkedWidgets.get(canonical) ?? [])];
      const completeWidgetList = declared.size === widgets.length && linked.every((widget) => declared.has(widget));
      const pageNumbers = [...new Set([...declared, ...linked].flatMap((widget) => {
        const page = widgetPages.get(widget);
        return page === undefined ? [] : [page + 1];
      }))].sort((first, second) => first - second);
      return [{ field, widgets, meta, dropdownOptions, completeWidgetList, pageNumbers,
        alignment: alignment instanceof PDFNumber ? alignment.asNumber() : undefined }];
    });
    if (fields.every(({ meta }) => meta.readOnly || meta.choices?.length === 0)) throw new PdfIntakeError('flat-scanned-no-fields');
    return { doc, rawForm: activeForm, pages, fields };
  } catch (error) {
    if (error instanceof PdfIntakeError) throw error;
    throw new PdfIntakeError('invalid-pdf', error);
  }
}
