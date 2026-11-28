import { PDFArray, PDFDict, PDFDocument, PDFFont, PDFHexString, PDFOperator, PDFOperatorNames as Op } from 'pdf-lib';
import { key, number, type WidgetTarget } from './template';
import type { FontKey, PlacedLine, Placement } from './shaping';

const operator = PDFOperator.of;
const fillColor = { 1: Op.NonStrokingColorGray, 3: Op.NonStrokingColorRgb, 4: Op.NonStrokingColorCmyk };
const strokeColor = { 1: Op.StrokingColorGray, 3: Op.StrokingColorRgb, 4: Op.StrokingColorCmyk };

export interface AppearanceFont { name: string; ref: PDFFont['ref']; cids?: Map<number, number> }

export function widgetTextMatrix(rotation: number, width: number, height: number) {
  return (rotation === 90 ? [0, 1, -1, 0, width, 0] : rotation === 180 ? [-1, 0, 0, -1, width, height]
    : rotation === 270 ? [0, -1, 1, 0, 0, height] : [1, 0, 0, 1, 0, 0]) as [number, number, number, number, number, number];
}

export function appendPositionedText(
  operators: PDFOperator[], text: string, lines: readonly PlacedLine[], size: number, fontFor: (key: FontKey) => AppearanceFont,
) {
  const actualText = `<< /ActualText ${PDFHexString.fromText(text).toString()} >>`;
  operators.push(operator(Op.BeginMarkedContentSequence, [key('Span'), actualText]));
  for (const { line, origin, baseline } of lines) {
    if (!line.painted) continue;
    operators.push(operator(Op.BeginText));
    let current: FontKey | undefined;
    for (const glyph of line.glyphs) {
      const font = fontFor(glyph.font);
      if (glyph.font !== current) {
        operators.push(operator(Op.SetFontAndSize, [key(font.name), number(size)]));
        current = glyph.font;
      }
      const cid = font.cids ? font.cids.get(glyph.id)! : glyph.id;
      operators.push(operator(Op.SetTextMatrix, [1, 0, 0, 1, origin + glyph.x * size, baseline + glyph.y * size].map(number)),
        operator(Op.ShowText, [PDFHexString.of(cid.toString(16).padStart(4, '0'))]));
    }
    operators.push(operator(Op.EndText));
  }
  operators.push(operator(Op.EndMarkedContent));
}

function color(values: number[] | undefined, stroking = false) {
  if (!values || (values.length !== 1 && values.length !== 3 && values.length !== 4) || values.some((value) => !Number.isFinite(value))) return undefined;
  return operator((stroking ? strokeColor : fillColor)[values.length], values.map((value) => number(Math.min(1, Math.max(0, value)))));
}

function textColor(appearance: string) {
  const last = [...appearance.matchAll(/((?:[-+]?(?:\d+\.?\d*|\.\d+)\s+){1,4})(g|rg|k)\b/g)].at(-1);
  return color(last?.[1]?.trim().split(/\s+/).map(Number)) ?? operator(Op.NonStrokingColorGray, [number(0)]);
}

export function installAppearance(doc: PDFDocument, target: WidgetTarget, placement: Placement, fonts: Partial<Record<FontKey, AppearanceFont>>) {
  const { width, height, rotation } = target.meta;
  const operators = [operator(Op.PushGraphicsState)];
  const mk = target.widget.getAppearanceCharacteristics();
  const background = color(mk?.getBackgroundColor());
  if (background) operators.push(background, operator(Op.AppendRectangle, [0, 0, width, height].map(number)), operator(Op.FillNonZero));
  const stroke = color(mk?.getBorderColor(), true);
  const { border } = target;
  if (stroke && border > 0 && border < Math.min(width, height)) {
    operators.push(stroke, operator(Op.SetLineWidth, [number(border)]));
    const style = target.widget.BS();
    if (style?.get(key('S')) === key('D')) {
      const dash = style.lookupMaybe(key('D'), PDFArray) ?? doc.context.obj([3]);
      operators.push(operator(Op.SetLineDashPattern, [dash, number(0)]));
    }
    if (style?.get(key('S')) === key('U')) {
      operators.push(operator(Op.MoveTo, [0, border / 2].map(number)), operator(Op.LineTo, [width, border / 2].map(number)));
    } else {
      operators.push(operator(Op.AppendRectangle, [border / 2, border / 2, width - border, height - border].map(number)));
    }
    operators.push(operator(Op.StrokePath));
  }

  const matrix = widgetTextMatrix(rotation, width, height);
  operators.push(operator(Op.ConcatTransformationMatrix, matrix.map(number)), textColor(target.appearance));
  operators.push(operator(Op.BeginMarkedContent, [key('Tx')]));
  const resources: Record<string, PDFFont['ref']> = {};
  for (const placed of placement.lines) {
    if (!placed.line.painted) continue;
    appendPositionedText(operators, placed.line.text, [placed], placement.size, (family) => {
      const font = fonts[family]!;
      resources[font.name] = font.ref;
      return font;
    });
  }
  operators.push(operator(Op.EndMarkedContent), operator(Op.PopGraphicsState));
  const stream = doc.context.formXObject(operators, { BBox: [0, 0, width, height], Resources: { Font: resources } });
  // Copy the AP dictionary before replacing /N because input widgets may share AP resources.
  const dictionary = target.widget.dict.lookupMaybe(key('AP'), PDFDict)?.clone(doc.context) ?? doc.context.obj({});
  dictionary.set(key('N'), doc.context.register(stream));
  target.widget.dict.set(key('AP'), dictionary);
}
