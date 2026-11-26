import fontkit from '@pdf-lib/fontkit';
import { PDFBool, PDFDict, PDFHexString } from 'pdf-lib';
import { borderWidth, installAppearance, type AppearanceFont } from './appearances';
import { createShaper, fitText, type FontBytes, type FontKey, type Placement } from './shaping';
import { key, openTemplate, type TemplateMetadata, type WidgetTarget } from './template';

export { createAudit, createMergedPdf, createZip } from './exports';
export type { AuditRow, PdfExportRow } from './exports';
export { PdfIntakeError } from './template';
export type { FieldMetadata, PdfIntakeCode, TemplateMetadata, WidgetMetadata } from './template';

export type DiagnosticCode = 'too-narrow' | 'too-low' | 'exceeds-maxlen' | 'unsupported-glyph' | 'widget-rotated-unsupported'
  | 'missing-required' | 'unknown-field' | 'no-widget' | 'readonly-field' | 'unsupported-field-mode' | 'unsupported-line-break' | 'unsupported-widget';

export interface FieldDiagnostic { field: string; code: DiagnosticCode; widgetIndex?: number }
export interface RowPreflightResult {
  status: 'pass' | 'flagged';
  diagnostics: FieldDiagnostic[];
  fontSizes: Record<string, number[]>;
  pdfBytes?: Uint8Array;
}

export interface PreflightOptions {
  fonts: FontBytes;
  minFontSize?: number;
  preferredFont?: 'auto' | FontKey;
}

export async function inspectTemplate(bytes: Uint8Array | ArrayBuffer): Promise<TemplateMetadata> {
  const { fields, pages } = await openTemplate(bytes);
  return { fields: fields.map(({ meta }) => meta), pages };
}

export async function preflightRow(
  bytes: Uint8Array | ArrayBuffer,
  valuesByField: Record<string, string>,
  { fonts, minFontSize = 8, preferredFont = 'auto' }: PreflightOptions,
): Promise<RowPreflightResult> {
  if (!Number.isFinite(minFontSize) || minFontSize <= 0) throw new Error('invalid-min-font-size');
  const { doc, rawForm, fields } = await openTemplate(bytes);
  const shaper = createShaper(fonts, preferredFont);
  const knownFields = new Set(fields.map(({ meta }) => meta.name));
  const diagnostics: FieldDiagnostic[] = Object.keys(valuesByField).filter((field) => !knownFields.has(field)).map((field) => ({ field, code: 'unknown-field' }));
  const plans = [];
  const sizes: [string, number[]][] = [];
  const fontKeys = new Set<FontKey>();

  for (const { field, widgets, meta, alignment } of fields) {
    const { name } = meta;
    const mapped = Object.hasOwn(valuesByField, name);
    const value = mapped ? valuesByField[name]! : meta.value;
    let reason: DiagnosticCode | undefined;
    if (meta.required && !value.trim()) reason = 'missing-required';
    else if (!mapped) continue;
    else if (meta.readOnly) reason = 'readonly-field';
    else if (field.isCombed() || field.isPassword() || field.isFileSelector() || field.isRichFormatted()) reason = 'unsupported-field-mode';
    else if (meta.maxLength !== undefined && [...value].length > meta.maxLength) reason = 'exceeds-maxlen';
    else if (!widgets.length || widgets.every(({ meta }) => meta.pageIndex < 0)) reason = 'no-widget';
    if (reason) {
      diagnostics.push({ field: name, code: reason });
      continue;
    }

    const placed: { widget: WidgetTarget; placement: Placement }[] = [];
    for (const [widgetIndex, widget] of widgets.entries()) {
      const { width, height, rotation, defaultFontSize } = widget.meta;
      const padding = 1.6 + borderWidth(widget);
      const quarterTurn = rotation === 90 || rotation === 270;
      const placement = !widget.usable ? 'unsupported-widget' : rotation % 90 !== 0 ? 'widget-rotated-unsupported'
        : fitText(shaper, value, meta.multiline, {
          innerWidth: (quarterTurn ? height : width) - 2 * padding,
          innerHeight: (quarterTurn ? width : height) - 2 * padding,
          padding, alignment, min: minFontSize, max: defaultFontSize,
        });
      if (typeof placement === 'string') diagnostics.push({ field: name, code: placement, widgetIndex });
      else placed.push({ widget, placement });
    }
    if (placed.length !== widgets.length) continue;
    sizes.push([name, placed.map(({ placement }) => placement.size)]);
    for (const { placement } of placed) {
      for (const { line } of placement.lines) for (const glyph of line.glyphs) fontKeys.add(glyph.font);
    }
    plans.push({ field, value, placed });
  }

  const fontSizes = Object.fromEntries(sizes);
  if (diagnostics.length) return { status: 'flagged', diagnostics, fontSizes };
  if (!plans.length) return { status: 'pass', diagnostics, fontSizes, pdfBytes: new Uint8Array(bytes) };

  doc.registerFontkit(fontkit);
  const embedded: Partial<Record<FontKey, AppearanceFont>> = {};
  const globalResources = rawForm.lookupMaybe(key('DR'), PDFDict)?.clone(doc.context) ?? doc.context.obj({});
  const globalFonts = globalResources.lookupMaybe(key('Font'), PDFDict)?.clone(doc.context) ?? doc.context.obj({});
  for (const family of fontKeys) {
    // Keep original glyph IDs. PDF appearance streams use fontkit's shaped CID sequence and offsets.
    const prefix = family === 'arabic' ? 'ArabiFormNaskh' : 'ArabiFormSans';
    let name = doc.context.addRandomSuffix(prefix, 8);
    while (globalFonts.has(key(name))) name = doc.context.addRandomSuffix(prefix, 8);
    const font = await doc.embedFont(fonts[family], { subset: false, customName: name });
    embedded[family] = { name, ref: font.ref };
    globalFonts.set(key(name), font.ref);
  }
  globalResources.set(key('Font'), globalFonts);
  rawForm.set(key('DR'), globalResources);
  rawForm.set(key('NeedAppearances'), PDFBool.False);
  for (const { field, value, placed } of plans) {
    const canonicalValue = PDFHexString.fromText(value);
    field.acroField.setValue(canonicalValue);
    for (const { widget, placement } of placed) {
      if (widget.widget.dict !== field.acroField.dict && widget.widget.dict.has(key('V'))) widget.widget.dict.set(key('V'), canonicalValue);
      const mainGlyph = placement.lines.find(({ line }) => line.painted)?.line.glyphs[0];
      const mainFont = mainGlyph && embedded[mainGlyph.font];
      if (mainFont) widget.widget.setDefaultAppearance(`/${mainFont.name} ${placement.size} Tf 0 g`);
      installAppearance(doc, widget, placement, embedded);
    }
    const first = placed[0];
    const mainGlyph = first?.placement.lines.find(({ line }) => line.painted)?.line.glyphs[0];
    const mainFont = mainGlyph && embedded[mainGlyph.font];
    if (first && mainFont) field.acroField.setDefaultAppearance(`/${mainFont.name} ${first.placement.size} Tf 0 g`);
  }
  return { status: 'pass', diagnostics, fontSizes, pdfBytes: await doc.save({ updateFieldAppearances: false }) };
}
