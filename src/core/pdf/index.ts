import { PDFBool, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFRadioGroup, PDFString, PDFTextField } from 'pdf-lib';
import { applyNumeralPolicy } from '../shaping/numerals';
import type { ConditionalFieldEvaluation, RuleApplication } from '../rules/conditional-fields';
import { explicitQuadding, type AlignOverride } from './alignment';
import { installAppearance, type AppearanceFont } from './appearances';
import { applyButton, parseCheckbox, planCheckbox, planRadio } from './buttons';
import { copyBundledFont } from './bundled-fonts';
import { matchChoice, type FieldChoice } from './choice-match';
import { embedCustomFont, loadCustomFont } from './custom-font';
import { preparePrintWidgetCheck } from './exports';
import type { FieldTypographyMap } from './field-typography';
import { createShaper, DEFAULT_MIN_FONT_SIZE, fitText, MAX_FONT_SIZE, MIN_FONT_SIZE, textInputDiagnostic, type FontBytes, type FontKey, type Placement } from './shaping';
import { key, number, openTemplate, PdfIntakeError, type TemplateMetadata, type WidgetTarget } from './template';

export type { AlignOverride } from './alignment';
export { createAudit, createFlattenedZip, createMergedPdf, createZip } from './exports';
export { matchChoice } from './choice-match';
export type { FieldChoice } from './choice-match';
export { inspectCustomFont, MAX_CUSTOM_FONT_BYTES } from './custom-font';
export type { AuditRow, Imposition, PdfExportRow, PrintWatermarkOptions } from './exports';
export type { MergeCoverOptions } from './merge-cover';
export { PdfIntakeError } from './template';
export type { FieldMetadata, PdfIntakeCode, TemplateMetadata, WidgetMetadata } from './template';
export { getWidgetOverlays, type WidgetOverlay } from './widget-overlays';

export type DiagnosticCode = 'too-narrow' | 'too-low' | 'exceeds-maxlen' | 'unsupported-glyph' | 'widget-rotated-unsupported'
  | 'missing-required' | 'unknown-field' | 'no-widget' | 'readonly-field' | 'unsupported-field-mode' | 'unsupported-line-break'
  | 'unsupported-widget' | 'unsupported-bidi' | 'invalid-checkbox-value' | 'unsupported-checkbox-appearance' | 'missing-glyphs'
  | 'invalid-choice' | 'unsupported-radio-appearance' | 'invalid-conditional-rule';

export interface FieldDiagnostic {
  field: string;
  code: DiagnosticCode;
  pageNumbers: number[];
  choices?: FieldChoice[];
  ruleIndex?: number;
  widgetIndex?: number;
  requiredFontSizePt?: number;
  maxLengthExcess?: number;
}
export interface RowPreflightResult {
  status: 'pass' | 'flagged';
  diagnostics: FieldDiagnostic[];
  pageNumbers: number[];
  fontSizes: Record<string, number[]>;
  smallestInkFontSizePt?: number;
  inkClearancePt?: number;
  ruleApplied?: RuleApplication[];
  pdfBytes?: Uint8Array;
}

export interface PreflightOptions {
  fonts: FontBytes;
  minFontSize?: number;
  preferredFont?: 'auto' | keyof FontBytes;
  customFont?: Uint8Array;
  alignOverrides?: Readonly<Record<string, AlignOverride>>;
  fieldTypography?: FieldTypographyMap;
}

export async function inspectTemplate(bytes: Uint8Array | ArrayBuffer): Promise<TemplateMetadata> {
  const { fields, pages } = await openTemplate(bytes);
  return { fields: fields.map(({ meta }) => meta), pages };
}

type OpenTemplate = Awaited<ReturnType<typeof openTemplate>>;
type CheckedRow = Omit<RowPreflightResult, 'pdfBytes'>;
type AppliedRules = Pick<ConditionalFieldEvaluation, 'ruleApplied' | 'diagnostics'>;

function layoutOptions({ fonts, minFontSize = DEFAULT_MIN_FONT_SIZE, preferredFont = 'auto', customFont, alignOverrides = {}, fieldTypography = {} }: PreflightOptions) {
  if (!Number.isFinite(minFontSize) || minFontSize < MIN_FONT_SIZE || minFontSize > MAX_FONT_SIZE) throw new Error('invalid-min-font-size');
  return { fonts, minFontSize, preferredFont, custom: customFont && loadCustomFont(customFont), alignOverrides, fieldTypography };
}

function planRow(
  { fields, pages }: OpenTemplate, valuesByField: Record<string, string>,
  { fonts, minFontSize, preferredFont, custom, alignOverrides, fieldTypography }: ReturnType<typeof layoutOptions>,
  conditional?: AppliedRules,
) {
  let shaper: ReturnType<typeof createShaper> | undefined;
  const knownFields = new Set(fields.map(({ meta }) => meta.name));
  const blockedFields = conditional?.diagnostics.length ? new Set(conditional.diagnostics.map(({ field }) => field)) : undefined;
  const diagnostics: FieldDiagnostic[] = [
    ...(conditional?.diagnostics ?? []),
    ...Object.keys(valuesByField).filter((field) => !knownFields.has(field) && !blockedFields?.has(field))
      .map((field) => ({ field, code: 'unknown-field' as const, pageNumbers: [] })),
  ];
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
  let smallestInkFontSizePt = Infinity;
  let inkClearancePt = Infinity;

  for (const { field, widgets, meta, alignment, completeWidgetList, pageNumbers, dropdownOptions } of fields) {
    const { name } = meta;
    if (blockedFields?.has(name)) continue;
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
    const typography = field instanceof PDFTextField && Object.hasOwn(fieldTypography, name) ? fieldTypography[name] : undefined;
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
      value = applyNumeralPolicy(value, typography?.numeralPolicy);
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
      const { rotation, defaultFontSize, usable, width, height, pageIndex } = widget.meta;
      let { innerWidth, innerHeight } = widget.meta;
      let { padding } = widget;
      if (usable && typography?.paddingPt !== undefined) {
        padding = widget.border + typography.paddingPt / pages[pageIndex]!.userUnit;
        const quarterTurn = rotation % 180 !== 0;
        innerWidth = Math.max(0, (quarterTurn ? height : width) - 2 * padding);
        innerHeight = Math.max(0, (quarterTurn ? width : height) - 2 * padding);
      }
      let placement;
      try {
        placement = !usable || !Number.isFinite(padding) ? { code: 'unsupported-widget' as const }
          : rotation % 90 !== 0 ? { code: 'widget-rotated-unsupported' as const }
          : fitText(shaper ??= createShaper(fonts, preferredFont, custom?.face), value, meta.multiline, {
            innerWidth: innerWidth!, innerHeight: innerHeight!,
            padding, alignment, alignOverride, min: minFontSize, max: defaultFontSize, lineHeightScale: typography?.lineHeightScale,
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
    for (const { widget, placement: { size, lines } } of placed) {
      const { width, height, rotation, pageIndex } = widget.meta;
      const quarterTurn = rotation % 180 !== 0;
      const outerWidth = quarterTurn ? height : width;
      const outerHeight = quarterTurn ? width : height;
      const { userUnit } = pages[pageIndex]!;
      for (const { line, origin, baseline } of lines) {
        if (line.painted) {
          const [left, right] = line.inkX;
          const clearance = Math.min(origin + left * size, outerWidth - (origin + right * size),
            baseline + line.bounds.minY * size, outerHeight - (baseline + line.bounds.maxY * size));
          smallestInkFontSizePt = Math.min(smallestInkFontSizePt, size * userUnit);
          inkClearancePt = Math.min(inkClearancePt, clearance * userUnit);
        }
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
  const result: CheckedRow = { status: diagnostics.length ? 'flagged' : 'pass', diagnostics, pageNumbers, fontSizes,
    ...(conditional && { ruleApplied: conditional.ruleApplied }),
  };
  if (result.status === 'pass' && Number.isFinite(smallestInkFontSizePt) && Number.isFinite(inkClearancePt)) {
    result.smallestInkFontSizePt = smallestInkFontSizePt;
    result.inkClearancePt = inkClearancePt;
  }
  return { result, plans, buttonPlans, fontKeys, customGlyphIds };
}

export async function prepareRowPreflight(bytes: Uint8Array | ArrayBuffer, options: PreflightOptions) {
  return (await prepareTemplatePreflight(bytes, options)).check;
}

export async function prepareTemplatePreflight(bytes: Uint8Array | ArrayBuffer, options: PreflightOptions) {
  const template = await openTemplate(bytes);
  const layout = layoutOptions(options);
  const check = async (valuesByField: Record<string, string>, conditional?: AppliedRules): Promise<CheckedRow> => {
    const { result, customGlyphIds } = planRow(template, valuesByField, layout, conditional);
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
  return { check, fields: template.fields.map(({ meta }) => meta) };
}

export async function preparePacketFormPreflight(bytes: Uint8Array | ArrayBuffer, options: Pick<PreflightOptions, 'fonts'>) {
  const template = await openTemplate(bytes);
  const layout = layoutOptions(options);
  let checkPrint: ReturnType<typeof preparePrintWidgetCheck>;
  try {
    checkPrint = preparePrintWidgetCheck(template.doc);
  } catch (cause) {
    throw new PdfIntakeError('invalid-pdf', cause);
  }
  return {
    fields: template.fields.map(({ meta }) => meta),
    pageCount: template.pages.length,
    check(values: Record<string, string>) {
      const { result, plans, buttonPlans } = planRow(template, values, layout);
      const textWidgets = new Set(plans.flatMap(({ placed }) => placed.map(({ widget }) => widget.widget.dict)));
      const states = new Map(buttonPlans.flatMap(({ widgets, selectedIndex, state }) => widgets.map(({ widget }, index) =>
        [widget.dict, selectedIndex === undefined || index === selectedIndex ? state : key('Off')] as const)));
      return { diagnostics: result.diagnostics, printProblems: checkPrint(textWidgets, states) };
    },
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
      embedded[family] = { name, ref: await copyBundledFont(doc, fonts, family, prefix) };
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
