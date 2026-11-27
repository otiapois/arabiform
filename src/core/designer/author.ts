import { AnnotationFlags, PDFDict, PDFHexString, PDFTextField, PDFWidgetAnnotation, type PDFArray } from 'pdf-lib';
import { explicitQuadding } from '../pdf/alignment';
import { key } from '../pdf/template';
import { openFlatPdf } from './source';
import { validateFieldSpecs, type FieldDraftSpec } from './spec';

export { inspectFlatPdf, type FlatPdfMetadata } from './source';
export { DesignerError, type DesignerErrorCode, type FieldDraftSpec } from './spec';

export async function authorFlatPdf(bytes: Uint8Array | ArrayBuffer, fields: readonly FieldDraftSpec[]): Promise<Uint8Array> {
  const { doc, pdfPages, pages } = await openFlatPdf(bytes);
  const drafts = validateFieldSpecs(fields, pages);
  const form = doc.getForm();
  const font = drafts.some(({ kind }) => kind === 'text') ? form.getDefaultFont() : undefined;
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
  for (const draft of drafts) {
    const { name, kind, pageIndex, alignment, multiline, maxLen, fontSize = 12 } = draft;
    const [x, y, width, height] = draft.rectPdf;
    const targetPage = pdfPages[pageIndex]!;
    const field = kind === 'text' ? form.createTextField(name) : form.createCheckBox(name);
    const widget = PDFWidgetAnnotation.create(doc.context, field.ref);
    widget.setRectangle({ x, y, width, height });
    widget.setP(targetPage.ref);
    widget.setFlag(AnnotationFlags.Print);
    widget.getOrCreateAppearanceCharacteristics().setRotation(pages[pageIndex]!.rotation);
    widget.getOrCreateBorderStyle().setWidth(kind === 'checkbox' ? 1 / pages[pageIndex]!.userUnit : 0);
    const ref = doc.context.register(widget.dict);
    field.acroField.addWidget(ref);
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
    } else {
      field.updateAppearances();
      field.uncheck();
    }
  }
  return doc.save({ updateFieldAppearances: false });
}
