import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFOperator, PDFOperatorNames as Op, type PDFPage, type PDFRef } from 'pdf-lib';
import { appendPositionedText, type AppearanceFont } from './appearances';
import { createShaper, type FontBytes, type FontKey } from './shaping';
import { key, number, rotationOf } from './template';
import type { WatermarkSettings } from './watermark-settings';

type ActiveWatermark = Exclude<WatermarkSettings, { kind: 'none' }>;
type InkLine = NonNullable<ReturnType<ReturnType<typeof createShaper>['line']>>;
type PageBox = ReturnType<PDFPage['getCropBox']>;

const presetText = { draft: 'DRAFT', confidential: 'CONFIDENTIAL', 'draft-ar': 'مسودة', 'confidential-ar': 'سري' };
const op = PDFOperator.of;

export function watermarkLayout(line: InkLine, box: PageBox, pageRotation: number, angle: ActiveWatermark['angle']) {
  const rotation = rotationOf(pageRotation);
  if (![box.x, box.y, box.width, box.height, rotation].every(Number.isFinite) || rotation % 90 !== 0
    || box.width <= 0 || box.height <= 0 || !line.painted) throw new Error('watermark-does-not-fit');
  const quarterTurn = rotation % 180 !== 0;
  const displayedWidth = quarterTurn ? box.height : box.width;
  const displayedHeight = quarterTurn ? box.width : box.height;
  const margin = Math.max(4, Math.min(32, Math.min(displayedWidth, displayedHeight) * 0.08));
  const [left, right] = line.inkX;
  const { minY, maxY } = line.bounds;
  const inkWidth = right - left;
  const inkHeight = maxY - minY;
  const radians = angle * Math.PI / 180;
  const c = Math.abs(Math.cos(radians));
  const s = Math.abs(Math.sin(radians));
  const size = Math.min(84, (displayedWidth - 2 * margin) / (c * inkWidth + s * inkHeight),
    (displayedHeight - 2 * margin) / (s * inkWidth + c * inkHeight));
  if (!Number.isFinite(size) || size < 6) throw new Error('watermark-does-not-fit');
  // /Rotate is clockwise in the viewer. Counter-rotate the content so the
  // selected angle is relative to the displayed sheet, including landscape.
  const adjusted = (angle + rotation) * Math.PI / 180;
  const cos = Math.cos(adjusted);
  const sin = Math.sin(adjusted);
  return {
    size, origin: -(left + right) * size / 2, baseline: -(minY + maxY) * size / 2, margin,
    matrix: [cos, sin, -sin, cos, box.x + box.width / 2, box.y + box.height / 2] as const,
  };
}

function effectiveCropBox(page: PDFPage): PageBox {
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  const x = Math.max(crop.x, media.x);
  const y = Math.max(crop.y, media.y);
  return { x, y, width: Math.min(crop.x + crop.width, media.x + media.width) - x,
    height: Math.min(crop.y + crop.height, media.y + media.height) - y };
}

export function preparePrintStamp(settings: ActiveWatermark, fonts: FontBytes) {
  const text = settings.kind === 'custom' ? settings.text : presetText[settings.kind];
  const line = createShaper(fonts, 'auto').line(text);
  if (!line?.painted) throw new Error('watermark-missing-glyph');
  return (doc: PDFDocument) => stampPrintPages(doc, settings, fonts, line);
}

async function stampPrintPages(doc: PDFDocument, settings: ActiveWatermark, fonts: FontBytes, line: InkLine) {
  doc.registerFontkit(fontkit);
  const refs = new Map<FontKey, PDFRef>();
  for (const family of new Set(line.glyphs.map(({ font }) => font))) {
    const bundled = family === 'arabic' ? 'arabic' : 'latin';
    const name = bundled === 'arabic' ? 'ArabiFormWatermarkNaskh' : 'ArabiFormWatermarkSans';
    refs.set(family, (await doc.embedFont(fonts[bundled], { subset: false, customName: name })).ref);
  }
  const graphics = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: settings.opacity }));
  for (const page of doc.getPages()) {
    const { size, origin, baseline, matrix } = watermarkLayout(line, effectiveCropBox(page), page.getRotation().angle, settings.angle);
    const fonts = new Map<FontKey, AppearanceFont>();
    for (const [family, ref] of refs) fonts.set(family, { ref, name: page.node.newFontDictionary('ArabiFormWatermark', ref).decodeText() });
    const state = page.node.newExtGState('ArabiFormWatermark', graphics);
    const operators = [
      op(Op.PushGraphicsState), op(Op.SetGraphicsStateParams, [state]), op(Op.NonStrokingColorGray, [number(0)]),
      op(Op.ConcatTransformationMatrix, matrix.map(number)),
    ];
    appendPositionedText(operators, line.text, [{ line, origin, baseline }], size, (family) => fonts.get(family)!);
    page.pushOperators(...operators, op(Op.PopGraphicsState));
  }
}
