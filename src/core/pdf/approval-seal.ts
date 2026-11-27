import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFOperator, PDFOperatorNames as Op, PDFString,
  type PDFPage } from 'pdf-lib';
import { ApprovalSealError, type ApprovalSealSettings } from './approval-seal-settings';
import { appendPositionedText, type AppearanceFont } from './appearances';
import { copyBundledFont } from './bundled-fonts';
import { boundsOverlap, cornerStampLayout, readStampPageGeometry } from './corner-stamp';
import { createShaper, fitText, type FontBytes, type FontKey } from './shaping';
import { key, number, readBounds, widgetFlags, type RectangleBounds } from './template';

const widthPt = 126;
const heightPt = 44;
const ink = [0.12, 0.23, 0.29].map(number);
const op = PDFOperator.of;

export function approvalSealLayout(
  media: RectangleBounds, crop: RectangleBounds, angle: number, userUnit: number, placement: ApprovalSealSettings['placement'],
) {
  const layout = cornerStampLayout(media, crop, angle, userUnit, placement, widthPt, heightPt);
  if (!layout || Math.max(...layout.bounds.map(Math.abs)) * Number.EPSILON >= 0.4 / (64 * userUnit)) return undefined;
  const [a, b, c, d, x, y] = layout.matrix;
  return { bounds: layout.bounds, matrix: [a / userUnit, b / userUnit, c / userUnit, d / userUnit, x, y] as const };
}

function widgetName(widget: PDFDict): string | undefined {
  const parts: string[] = [];
  const visited = new Set<PDFDict>();
  for (let node: PDFDict | undefined = widget; node && !visited.has(node); node = node.lookupMaybe(key('Parent'), PDFDict)) {
    visited.add(node);
    const name = node.lookup(key('T'));
    if (name instanceof PDFString || name instanceof PDFHexString) parts.unshift(name.decodeText());
  }
  return parts.length ? parts.join('.') : undefined;
}

function planPage(page: PDFPage, pageNumber: number, placement: ApprovalSealSettings['placement'], qrFootprint?: RectangleBounds) {
  const geometry = readStampPageGeometry(page);
  const layout = geometry && approvalSealLayout(geometry.media, geometry.crop, geometry.angle, geometry.userUnit, placement);
  if (!layout) throw new ApprovalSealError({ code: 'approval-seal-page-too-small', pageNumber });
  const annots = page.node.Annots();
  for (let index = 0; annots && index < annots.size(); index++) {
    const widget = annots.lookup(index, PDFDict);
    if (widget.lookupMaybe(key('Subtype'), PDFName) !== key('Widget')) continue;
    const flags = widgetFlags(widget);
    // NoView widgets can still print. Hidden and Invisible widgets never occupy printable space.
    if (flags & (1 | 2) || flags & 32 && !(flags & 4)) continue;
    const rect = widget.lookupMaybe(key('Rect'), PDFArray);
    if (!rect || rect.size() !== 4) throw new ApprovalSealError({ code: 'approval-seal-page-too-small', pageNumber });
    const bounds = readBounds(rect);
    if (!bounds.every(Number.isFinite)) throw new ApprovalSealError({ code: 'approval-seal-page-too-small', pageNumber });
    if (boundsOverlap(layout.bounds, bounds)) {
      throw new ApprovalSealError({ code: 'approval-seal-widget-overlap', pageNumber, fieldName: widgetName(widget) });
    }
  }
  if (qrFootprint && boundsOverlap(layout.bounds, qrFootprint)) throw new ApprovalSealError({ code: 'approval-seal-qr-overlap', pageNumber });
  return layout.matrix;
}

export function prepareApprovalSeal(settings: ApprovalSealSettings, fonts: FontBytes) {
  const shaper = createShaper(fonts, 'auto');
  const textBands = [
    { text: settings.labelEn, bottom: 29, top: 39, max: 10 },
    { text: settings.labelAr, bottom: 14, top: 29, max: 13 },
    { text: settings.issueDate, bottom: 5, top: 13, max: 8 },
  ];
  const labels = textBands.map(({ text, bottom, top, max }) => {
    const placement = fitText(shaper, text, false, { innerWidth: widthPt - 14, innerHeight: top - bottom, padding: 7,
      min: 6, max, alignOverride: 'center' });
    if ('code' in placement || !placement.lines[0]?.line.painted) throw new ApprovalSealError({ code: 'approval-seal-text-unrenderable' });
    const lines = placement.lines.map((line) => ({ ...line, baseline: line.baseline + bottom - 7 }));
    return { text, lines, size: placement.size };
  });
  const families = new Set(labels.flatMap(({ lines }) => lines.flatMap(({ line }) => line.glyphs.map(({ font }) => font))));
  return {
    layout: (pages: readonly PDFPage[], qrFootprints?: readonly RectangleBounds[]) =>
      pages.map((page, index) => planPage(page, index + 1, settings.placement, qrFootprints?.[index])),
    async paint(doc: PDFDocument, matrices: readonly ReturnType<typeof planPage>[]) {
      const refs = await Promise.all([...families].map(async (family) => [family,
        await copyBundledFont(doc, fonts, family === 'arabic' ? 'arabic' : 'latin', 'ArabiFormApprovalSeal')] as const));
      for (const [index, page] of doc.getPages().entries()) {
        const pageFonts = new Map<FontKey, AppearanceFont>(refs.map(([family, ref]) => [family, {
          ref, name: page.node.newFontDictionary('ArabiFormApprovalSeal', ref).decodeText(),
        }]));
        const operators = [op(Op.PushGraphicsState), op(Op.ConcatTransformationMatrix, matrices[index]!.map(number)),
          op(Op.StrokingColorRgb, ink), op(Op.NonStrokingColorRgb, ink)];
        for (const [inset, weight] of [[0.6, 0.75], [2.7, 0.4]] as const) {
          operators.push(op(Op.SetLineWidth, [number(weight)]),
            op(Op.AppendRectangle, [inset, inset, widthPt - 2 * inset, heightPt - 2 * inset].map(number)), op(Op.StrokePath));
        }
        for (const { text, lines, size } of labels) appendPositionedText(operators, text, lines, size, (family) => pageFonts.get(family)!);
        page.pushOperators(...operators, op(Op.PopGraphicsState));
      }
    },
  };
}
