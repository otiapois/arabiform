import { AnnotationFlags, defaultRadioGroupAppearanceProvider, normalizeAppearance, PDFCheckBox, PDFDict, PDFDropdown, PDFHexString, PDFRadioGroup,
  PDFTextField, PDFWidgetAnnotation, type PDFArray, type PDFName, type PDFOperator } from 'pdf-lib';
import { explicitQuadding } from '../pdf/alignment';
import { key } from '../pdf/template';
import { openFlatPdf } from './source';
import { validateFieldSpecs, type FieldDraftSpec } from './spec';

export { inspectFlatPdf, type FlatPdfMetadata } from './source';
export { DesignerError, type DesignerErrorCode, type FieldDraftSpec } from './spec';

function writeRadioAppearance(field: PDFRadioGroup, widget: PDFWidgetAnnotation, onValue: PDFName) {
  const { context } = widget.dict;
  const { width, height } = widget.getRectangle();
  const { normal, down } = normalizeAppearance(defaultRadioGroupAppearanceProvider(field, widget));
  const states = ({ on, off }: { on: PDFOperator[]; off: PDFOperator[] }) => {
    const bbox = [0, 0, width, height];
    const appearance = context.obj({ Off: context.register(context.formXObject(off, { BBox: bbox })) });
    appearance.set(onValue, context.register(context.formXObject(on, { BBox: bbox })));
    return appearance;
  };
  widget.setNormalAppearance(states(normal));
  if (down) widget.setDownAppearance(states(down));
  widget.setAppearanceState(key('Off'));
}

export async function authorFlatPdf(bytes: Uint8Array | ArrayBuffer, fields: readonly FieldDraftSpec[]): Promise<Uint8Array> {
  const { doc, pdfPages, pages } = await openFlatPdf(bytes);
  const drafts = validateFieldSpecs(fields, pages);
  const form = doc.getForm();
  const font = drafts.some(({ kind }) => kind === 'text' || kind === 'dropdown') ? form.getDefaultFont() : undefined;
  const acroForm = form.acroForm.dict;
  acroForm.delete(key('NeedAppearances'));
  if (font) {
    // The form's default resources make /DA usable in PDF editors that regenerate appearances.
    const resources = acroForm.lookupMaybe(key('DR'), PDFDict)?.clone(doc.context) ?? doc.context.obj({});
    const fonts = resources.lookupMaybe(key('Font'), PDFDict)?.clone(doc.context) ?? doc.context.obj({});
    fonts.set(key(font.name), font.ref);
    resources.set(key('Font'), fonts);
    acroForm.set(key('DR'), resources);
  }

  const pageAnnotations = new Map<number, PDFArray>();
  const radios = new Map<string, PDFRadioGroup>();
  for (const draft of drafts) {
    const { name, kind, pageIndex, alignment, multiline, maxLen, fontSize = 12 } = draft;
    const [x, y, width, height] = draft.rectPdf;
    const targetPage = pdfPages[pageIndex]!;
    const field = kind === 'text' ? form.createTextField(name) : kind === 'checkbox' ? form.createCheckBox(name)
      : kind === 'dropdown' ? form.createDropdown(name) : radios.get(name) ?? form.createRadioGroup(name);
    const widget = PDFWidgetAnnotation.create(doc.context, field.ref);
    widget.setRectangle({ x, y, width, height });
    widget.setP(targetPage.ref);
    widget.setFlag(AnnotationFlags.Print);
    widget.getOrCreateAppearanceCharacteristics().setRotation(pages[pageIndex]!.rotation);
    widget.getOrCreateBorderStyle().setWidth(kind === 'checkbox' || kind === 'radio' ? 1 / pages[pageIndex]!.userUnit : 0);
    const ref = doc.context.register(widget.dict);
    if (field instanceof PDFRadioGroup) {
      radios.set(name, field);
      const onValue = field.acroField.addWidgetWithOpt(ref, PDFHexString.fromText(draft.exportValue!), false);
      writeRadioAppearance(field, widget, onValue);
    } else field.acroField.addWidget(ref);
    // addAnnot() normalizes and wraps the source page's content streams. Append only the annotation.
    let annotations = pageAnnotations.get(pageIndex);
    if (!annotations) {
      annotations = targetPage.node.Annots()?.clone(doc.context) ?? doc.context.obj([]);
      pageAnnotations.set(pageIndex, annotations);
      targetPage.node.set(key('Annots'), annotations);
    }
    annotations.push(ref);

    if (field instanceof PDFTextField) {
      if (alignment && alignment !== 'auto') field.setAlignment(explicitQuadding[alignment]);
      if (multiline) field.enableMultiline();
      if (maxLen !== undefined) field.setMaxLength(maxLen);
      field.acroField.setValue(PDFHexString.fromText(''));
      field.acroField.setDefaultAppearance(`${key(font!.name)} ${fontSize} Tf\n0 g`);
      field.updateAppearances(font!);
    } else if (field instanceof PDFDropdown) {
      field.setOptions(draft.options!);
      field.acroField.setDefaultAppearance(`${key(font!.name)} ${fontSize} Tf\n0 g`);
      field.updateAppearances(font!);
    } else if (field instanceof PDFCheckBox) {
      field.updateAppearances();
      field.uncheck();
    }
  }
  for (const radio of radios.values()) radio.clear();
  return doc.save({ updateFieldAppearances: false });
}
