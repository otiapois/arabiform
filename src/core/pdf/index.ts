import fontkit from '@pdf-lib/fontkit';
import { PDFBool, PDFCheckBox, PDFDict, PDFHexString, PDFName, PDFTextField } from 'pdf-lib';
import { borderWidth, installAppearance, type AppearanceFont } from './appearances';
import { applyCheckbox, parseCheckbox, planCheckbox } from './checkbox';
import { embedCustomFont, loadCustomFont } from './custom-font';
import { createShaper, fitText, MAX_FONT_SIZE, MIN_FONT_SIZE, textInputDiagnostic, type FontBytes, type FontKey, type Placement } from './shaping';
import { key, openTemplate, type TemplateMetadata, type WidgetTarget } from './template';

export { createAudit, createMergedPdf, createZip } from './exports';
export { inspectCustomFont, MAX_CUSTOM_FONT_BYTES } from './custom-font';
export type { AuditRow, PdfExportRow } from './exports';
export { PdfIntakeError } from './template';
export type { FieldMetadata, PdfIntakeCode, TemplateMetadata, WidgetMetadata } from './template';

export type DiagnosticCode = 'too-narrow' | 'too-low' | 'exceeds-maxlen' | 'unsupported-glyph' | 'widget-rotated-unsupported'
  | 'missing-required' | 'unknown-field' | 'no-widget' | 'readonly-field' | 'unsupported-field-mode' | 'unsupported-line-break'
  | 'unsupported-widget' | 'unsupported-bidi' | 'invalid-checkbox-value' | 'unsupported-checkbox-appearance' | 'missing-glyphs';

export interface FieldDiagnostic {
  field: string;
  code: DiagnosticCode;
  widgetIndex?: number;
  requiredFontSizePt?: number;
  maxLengthExcess?: number;
}
export interface RowPreflightResult {
  status: 'pass' | 'flagged';
  diagnostics: FieldDiagnostic[];
  fontSizes: Record<string, number[]>;
  pdfBytes?: Uint8Array;
}

export interface PreflightOptions {
  fonts: FontBytes;
  minFontSize?: number;
  preferredFont?: 'auto' | keyof FontBytes;
  customFont?: Uint8Array;
}

export async function inspectTemplate(bytes: Uint8Array | ArrayBuffer): Promise<TemplateMetadata> {
  const { fields, pages } = await openTemplate(bytes);
  return { fields: fields.map(({ meta }) => meta), pages };
}

export async function preflightRow(
  bytes: Uint8Array | ArrayBuffer,
  valuesByField: Record<string, string>,
  { fonts, minFontSize = 8, preferredFont = 'auto', customFont }: PreflightOptions,
): Promise<RowPreflightResult> {
  if (!Number.isFinite(minFontSize) || minFontSize < MIN_FONT_SIZE || minFontSize > MAX_FONT_SIZE) throw new Error('invalid-min-font-size');
  const { doc, rawForm, fields } = await openTemplate(bytes);
  const custom = customFont && loadCustomFont(customFont);
  let shaper: ReturnType<typeof createShaper> | undefined;
  const knownFields = new Set(fields.map(({ meta }) => meta.name));
  const diagnostics: FieldDiagnostic[] = Object.keys(valuesByField).filter((field) => !knownFields.has(field)).map((field) => ({ field, code: 'unknown-field' }));
  const plans = [];
  const checkboxPlans: { canonical: PDFDict; widgets: WidgetTarget[]; state: PDFName }[] = [];
  const sizes: [string, number[]][] = [];
  const fontKeys = new Set<FontKey>();
  const customGlyphIds = new Set<number>();

  for (const { field, widgets, meta, alignment, completeWidgetList } of fields) {
    const { name } = meta;
    const mapped = Object.hasOwn(valuesByField, name);
    const value = mapped ? valuesByField[name]! : meta.value;
    if (mapped && meta.readOnly) {
      diagnostics.push({ field: name, code: 'readonly-field' });
      continue;
    }
    if (field instanceof PDFCheckBox && mapped) {
      const checked = parseCheckbox(value);
      if (checked === undefined) diagnostics.push({ field: name, code: 'invalid-checkbox-value' });
      else if (!widgets.length || widgets.every(({ meta }) => meta.pageIndex < 0)) diagnostics.push({ field: name, code: 'no-widget' });
      else if (!completeWidgetList) diagnostics.push({ field: name, code: 'unsupported-checkbox-appearance' });
      else {
        const canonical = field.acroField.dict;
        const { problems, state } = planCheckbox(canonical, widgets, checked);
        if (problems.length) {
          for (const widgetIndex of problems) diagnostics.push({ field: name, widgetIndex, code: 'unsupported-checkbox-appearance' });
        } else checkboxPlans.push({ canonical, widgets, state: state! });
      }
      continue;
    }
    if (!(field instanceof PDFTextField)) continue;
    if (meta.required && !value.trim()) {
      diagnostics.push({ field: name, code: 'missing-required' });
      continue;
    }
    if (!mapped) continue;
    const firstDiagnostic = diagnostics.length;
    const excess = meta.maxLength === undefined ? 0 : Array.from(value).length - meta.maxLength;
    if (excess > 0) diagnostics.push({ field: name, code: 'exceeds-maxlen', maxLengthExcess: excess });
    if (field.isCombed() || field.isPassword() || field.isFileSelector() || field.isRichFormatted()) diagnostics.push({ field: name, code: 'unsupported-field-mode' });
    if (diagnostics.length > firstDiagnostic) continue;
    const reason = textInputDiagnostic(value) ?? (!widgets.length || widgets.every(({ meta }) => meta.pageIndex < 0) ? 'no-widget' : undefined);
    if (reason) {
      diagnostics.push({ field: name, code: reason });
      continue;
    }

    const placed: { widget: WidgetTarget; placement: Placement }[] = [];
    for (const [widgetIndex, widget] of widgets.entries()) {
      const { width, height, rotation, defaultFontSize } = widget.meta;
      const padding = 1.6 + borderWidth(widget);
      const quarterTurn = rotation === 90 || rotation === 270;
      let placement;
      try {
        placement = !widget.usable || !Number.isFinite(padding) ? { code: 'unsupported-widget' as const }
          : rotation % 90 !== 0 ? { code: 'widget-rotated-unsupported' as const }
          : fitText(shaper ??= createShaper(fonts, preferredFont, custom?.face), value, meta.multiline, {
            innerWidth: (quarterTurn ? height : width) - 2 * padding,
            innerHeight: (quarterTurn ? width : height) - 2 * padding,
            padding, alignment, min: minFontSize, max: defaultFontSize,
          });
      } catch (cause) {
        if (custom) throw new Error('invalid-custom-font', { cause });
        throw cause;
      }
      if ('code' in placement) diagnostics.push({ field: name, widgetIndex, ...placement });
      else placed.push({ widget, placement });
    }
    if (placed.length !== widgets.length) continue;
    sizes.push([name, placed.map(({ placement }) => placement.size)]);
    for (const { placement } of placed) {
      for (const { line } of placement.lines) {
        for (const glyph of line.glyphs) {
          fontKeys.add(glyph.font);
          if (glyph.font === 'custom') customGlyphIds.add(glyph.id);
        }
      }
    }
    plans.push({ field, value, placed });
  }

  const fontSizes = Object.fromEntries(sizes);
  if (diagnostics.length) return { status: 'flagged', diagnostics, fontSizes };
  if (!plans.length && !checkboxPlans.length) return { status: 'pass', diagnostics, fontSizes, pdfBytes: new Uint8Array(bytes) };

  doc.registerFontkit(fontkit);
  const embedded: Partial<Record<FontKey, AppearanceFont>> = {};
  const globalResources = rawForm.lookupMaybe(key('DR'), PDFDict)?.clone(doc.context) ?? doc.context.obj({});
  const globalFonts = globalResources.lookupMaybe(key('Font'), PDFDict)?.clone(doc.context) ?? doc.context.obj({});
  for (const family of fontKeys) {
    // Keep original glyph IDs. PDF appearance streams use fontkit's shaped CID sequence and offsets.
    const prefix = family === 'custom' ? 'ArabiFormCustom' : family === 'arabic' ? 'ArabiFormNaskh' : 'ArabiFormSans';
    let name = doc.context.addRandomSuffix(prefix, 8);
    while (globalFonts.has(key(name))) name = doc.context.addRandomSuffix(prefix, 8);
    if (family === 'custom') {
      try {
        embedded[family] = await embedCustomFont(doc, custom!, name, customGlyphIds);
      } catch (cause) {
        throw new Error('invalid-custom-font', { cause });
      }
    } else {
      const font = await doc.embedFont(fonts[family], { subset: false, customName: name });
      embedded[family] = { name, ref: font.ref };
    }
    globalFonts.set(key(name), embedded[family].ref);
  }
  if (fontKeys.size) {
    globalResources.set(key('Font'), globalFonts);
    rawForm.set(key('DR'), globalResources);
  }
  rawForm.set(key('NeedAppearances'), PDFBool.False);
  for (const { canonical, widgets, state } of checkboxPlans) applyCheckbox(canonical, widgets, state);
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
