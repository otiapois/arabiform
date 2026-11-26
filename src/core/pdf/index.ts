import fontkit from '@pdf-lib/fontkit';
import { PDFBool, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFRadioGroup, PDFString, PDFTextField } from 'pdf-lib';
import { explicitQuadding, type AlignOverride } from './alignment';
import { installAppearance, type AppearanceFont } from './appearances';
import { applyButton, parseCheckbox, planCheckbox, planRadio } from './buttons';
import { matchChoice, type FieldChoice } from './choice-match';
import { embedCustomFont, loadCustomFont } from './custom-font';
import { createShaper, DEFAULT_MIN_FONT_SIZE, fitText, MAX_FONT_SIZE, MIN_FONT_SIZE, textInputDiagnostic, type FontBytes, type FontKey, type Placement } from './shaping';
import { key, number, openTemplate, type TemplateMetadata, type WidgetTarget } from './template';

export type { AlignOverride } from './alignment';
export { createAudit, createFlattenedZip, createMergedPdf, createZip } from './exports';
export { matchChoice } from './choice-match';
export type { FieldChoice } from './choice-match';
export { inspectCustomFont, MAX_CUSTOM_FONT_BYTES } from './custom-font';
export type { AuditRow, PdfExportRow, PrintWatermarkOptions } from './exports';
export type { MergeCoverOptions } from './merge-cover';
export { PdfIntakeError } from './template';
export type { FieldMetadata, PdfIntakeCode, TemplateMetadata, WidgetMetadata } from './template';

export type DiagnosticCode = 'too-narrow' | 'too-low' | 'exceeds-maxlen' | 'unsupported-glyph' | 'widget-rotated-unsupported'
  | 'missing-required' | 'unknown-field' | 'no-widget' | 'readonly-field' | 'unsupported-field-mode' | 'unsupported-line-break'
  | 'unsupported-widget' | 'unsupported-bidi' | 'invalid-checkbox-value' | 'unsupported-checkbox-appearance' | 'missing-glyphs'
  | 'invalid-choice' | 'unsupported-radio-appearance';

export interface FieldDiagnostic {
  field: string;
  code: DiagnosticCode;
  pageNumbers: number[];
  choices?: FieldChoice[];
  widgetIndex?: number;
  requiredFontSizePt?: number;
  maxLengthExcess?: number;
}
export interface RowPreflightResult {
  status: 'pass' | 'flagged';
  diagnostics: FieldDiagnostic[];
  pageNumbers: number[];
  fontSizes: Record<string, number[]>;
  pdfBytes?: Uint8Array;
}

export interface PreflightOptions {
  fonts: FontBytes;
  minFontSize?: number;
  preferredFont?: 'auto' | keyof FontBytes;
  customFont?: Uint8Array;
  alignOverrides?: Readonly<Record<string, AlignOverride>>;
}

export async function inspectTemplate(bytes: Uint8Array | ArrayBuffer): Promise<TemplateMetadata> {
  const { fields, pages } = await openTemplate(bytes);
  return { fields: fields.map(({ meta }) => meta), pages };
}

type OpenTemplate = Awaited<ReturnType<typeof openTemplate>>;
type CheckedRow = Omit<RowPreflightResult, 'pdfBytes'>;

function layoutOptions({ fonts, minFontSize = DEFAULT_MIN_FONT_SIZE, preferredFont = 'auto', customFont, alignOverrides = {} }: PreflightOptions) {
  if (!Number.isFinite(minFontSize) || minFontSize < MIN_FONT_SIZE || minFontSize > MAX_FONT_SIZE) throw new Error('invalid-min-font-size');
  return { fonts, minFontSize, preferredFont, custom: customFont && loadCustomFont(customFont), alignOverrides };
}

function planRow(
  { fields }: OpenTemplate, valuesByField: Record<string, string>,
  { fonts, minFontSize, preferredFont, custom, alignOverrides }: ReturnType<typeof layoutOptions>,
) {
  let shaper: ReturnType<typeof createShaper> | undefined;
  const knownFields = new Set(fields.map(({ meta }) => meta.name));
  const diagnostics: FieldDiagnostic[] = Object.keys(valuesByField).filter((field) => !knownFields.has(field))
    .map((field) => ({ field, code: 'unknown-field', pageNumbers: [] }));
  const plans: {
    field: PDFTextField | PDFDropdown;
    canonicalValue: PDFString | PDFHexString;
    choiceIndex?: number;
    quadding?: number;
    placed: { widget: WidgetTarget; placement: Placement }[];
  }[] = [];
  const buttonPlans: { canonical: PDFDict; widgets: WidgetTarget[]; state: PDFName; selectedIndex?: number }[] = [];
  const sizes: [string, number[]][] = [];
  const fontKeys = new Set<FontKey>();
  const customGlyphIds = new Set<number>();

  for (const { field, widgets, meta, alignment, completeWidgetList, pageNumbers, dropdownOptions } of fields) {
    const { name } = meta;
    const mapped = Object.hasOwn(valuesByField, name);
    let value = mapped ? valuesByField[name]! : meta.value;
    const canonical = field.acroField.dict;
    const flag = (issue: Omit<FieldDiagnostic, 'field' | 'pageNumbers'>) => {
      const widgetPage = issue.widgetIndex === undefined ? undefined : widgets[issue.widgetIndex]!.meta.pageIndex;
      diagnostics.push({ field: name, ...issue, pageNumbers: widgetPage === undefined ? pageNumbers : widgetPage < 0 ? [] : [widgetPage + 1] });
    };
    if (mapped && meta.readOnly) {
      flag({ code: 'readonly-field' });
      continue;
    }
    if (field instanceof PDFCheckBox && mapped) {
      const checked = parseCheckbox(value);
      if (checked === undefined) flag({ code: 'invalid-checkbox-value' });
      else if (!completeWidgetList) flag({ code: 'unsupported-checkbox-appearance' });
      else if (!pageNumbers.length) flag({ code: 'no-widget' });
      else {
        const { problems, state } = planCheckbox(canonical, widgets, checked);
        if (problems.length) {
          for (const widgetIndex of problems) flag({ widgetIndex, code: 'unsupported-checkbox-appearance' });
        } else buttonPlans.push({ canonical, widgets, state: state! });
      }
      continue;
    }
    if (field instanceof PDFTextField && meta.required && !value.trim()) {
      flag({ code: 'missing-required' });
      continue;
    }
    if (!mapped) continue;
    if (field instanceof PDFRadioGroup) {
      if (!completeWidgetList) {
        flag({ code: 'unsupported-radio-appearance' });
        continue;
      }
      if (!pageNumbers.length) {
        flag({ code: 'no-widget' });
        continue;
      }
      const { states, problems, consistent } = planRadio(canonical, widgets);
      if (!consistent) flag({ code: 'unsupported-radio-appearance' });
      for (const widgetIndex of problems) flag({ code: 'unsupported-radio-appearance', widgetIndex });
      if (!consistent || problems.length) continue;
      const choices = meta.choices!;
      const selectedIndex = matchChoice(choices, value);
      if (!choices.length) flag({ code: 'unsupported-radio-appearance' });
      else if (selectedIndex === undefined) flag({ code: 'invalid-choice', choices });
      else buttonPlans.push({ canonical, widgets, state: states[selectedIndex]!, selectedIndex });
      continue;
    }
    let canonicalValue: PDFString | PDFHexString;
    let choiceIndex: number | undefined;
    if (field instanceof PDFDropdown) {
      if (field.isMultiselect() || !dropdownOptions?.length) {
        flag({ code: 'unsupported-field-mode' });
        continue;
      }
      const choices = meta.choices!;
      const index = matchChoice(choices, value);
      if (index === undefined) {
        flag({ code: 'invalid-choice', choices });
        continue;
      }
      const selected = dropdownOptions[index]!;
      value = selected.label;
      canonicalValue = selected.exportString;
      // Keep the index in sync if the template uses it or two labels share an export value.
      if (canonical.has(key('I')) || widgets.some(({ widget }) => widget.dict.has(key('I')))
        || choices.some((choice, ordinal) => ordinal !== index && choice.value === selected.value)) choiceIndex = index;
    } else if (field instanceof PDFTextField) {
      const excess = meta.maxLength === undefined ? 0 : Array.from(value).length - meta.maxLength;
      const unsupportedMode = !meta.supportsTextCapacity;
      if (excess > 0) flag({ code: 'exceeds-maxlen', maxLengthExcess: excess });
      if (unsupportedMode) flag({ code: 'unsupported-field-mode' });
      if (excess > 0 || unsupportedMode) continue;
      canonicalValue = PDFHexString.fromText(value);
    } else continue;
    const reason = textInputDiagnostic(value) ?? (!completeWidgetList ? 'unsupported-widget' : !pageNumbers.length ? 'no-widget' : undefined);
    if (reason) {
      flag({ code: reason });
      continue;
    }

    const alignOverride = field instanceof PDFTextField && Object.hasOwn(alignOverrides, name) ? alignOverrides[name] : undefined;
    const quadding = alignOverride && alignOverride !== 'auto' ? explicitQuadding[alignOverride] : undefined;
    const placed: { widget: WidgetTarget; placement: Placement }[] = [];
    for (const [widgetIndex, widget] of widgets.entries()) {
      const { rotation, defaultFontSize, innerWidth, innerHeight, usable } = widget.meta;
      const { padding } = widget;
      let placement;
      try {
        placement = !usable || !Number.isFinite(padding) ? { code: 'unsupported-widget' as const }
          : rotation % 90 !== 0 ? { code: 'widget-rotated-unsupported' as const }
          : fitText(shaper ??= createShaper(fonts, preferredFont, custom?.face), value, meta.multiline, {
            innerWidth: innerWidth!, innerHeight: innerHeight!,
            padding, alignment, alignOverride, min: minFontSize, max: defaultFontSize,
          });
      } catch (cause) {
        if (custom) throw new Error('invalid-custom-font', { cause });
        throw cause;
      }
      if ('code' in placement) flag({ widgetIndex, ...placement });
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
    plans.push({ field, canonicalValue, choiceIndex, quadding, placed });
  }

  const fontSizes = Object.fromEntries(sizes);
  const pageNumbers = [...new Set(diagnostics.flatMap((issue) => issue.pageNumbers))].sort((first, second) => first - second);
  const result: CheckedRow = { status: diagnostics.length ? 'flagged' : 'pass', diagnostics, pageNumbers, fontSizes };
  return { result, plans, buttonPlans, fontKeys, customGlyphIds };
}

export async function prepareRowPreflight(bytes: Uint8Array | ArrayBuffer, options: PreflightOptions) {
  const template = await openTemplate(bytes);
  const layout = layoutOptions(options);
  return async (valuesByField: Record<string, string>): Promise<CheckedRow> => {
    const { result, customGlyphIds } = planRow(template, valuesByField, layout);
    if (result.status === 'pass' && customGlyphIds.size) {
      // The custom subset encoder reads parts of untrusted fonts lazily, after layout.
      // Exercise that exact encoder with a scratch document and no row PDF serialization.
      try {
        const scratch = await PDFDocument.create();
        await embedCustomFont(scratch, layout.custom!, 'ArabiFormCustomPreflight', customGlyphIds);
      } catch (cause) {
        throw new Error('invalid-custom-font', { cause });
      }
    }
    return result;
  };
}

export async function preflightRow(
  bytes: Uint8Array | ArrayBuffer, valuesByField: Record<string, string>, options: PreflightOptions,
): Promise<RowPreflightResult> {
  const template = await openTemplate(bytes);
  const layout = layoutOptions(options);
  const { result, plans, buttonPlans, fontKeys, customGlyphIds } = planRow(template, valuesByField, layout);
  if (result.status === 'flagged') return result;
  if (!plans.length && !buttonPlans.length) {
    return { ...result, pdfBytes: bytes instanceof Uint8Array ? Uint8Array.from(bytes) : new Uint8Array(bytes.slice(0)) };
  }
  const { doc, rawForm } = template;
  const { custom, fonts } = layout;

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
  for (const { canonical, widgets, state, selectedIndex } of buttonPlans) applyButton(canonical, widgets, state, selectedIndex);
  for (const { field, canonicalValue, choiceIndex, quadding, placed } of plans) {
    const canonical = field.acroField.dict;
    canonical.set(key('V'), canonicalValue);
    if (quadding !== undefined) canonical.set(key('Q'), number(quadding));
    const choiceIndices = choiceIndex === undefined ? undefined : doc.context.obj([choiceIndex]);
    if (choiceIndices) canonical.set(key('I'), choiceIndices);
    for (const { widget, placement } of placed) {
      const dict = widget.widget.dict;
      if (dict !== canonical && dict.has(key('V'))) dict.set(key('V'), canonicalValue);
      if (quadding !== undefined && dict !== canonical && dict.has(key('Q'))) dict.set(key('Q'), number(quadding));
      if (choiceIndices && dict !== canonical && dict.has(key('I'))) dict.set(key('I'), choiceIndices);
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
  return { ...result, pdfBytes: await doc.save({ updateFieldAppearances: false }) };
}
