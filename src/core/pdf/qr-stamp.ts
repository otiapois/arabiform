import { PDFArray, PDFDict, PDFName, PDFOperator, PDFOperatorNames as Op, type PDFPage } from 'pdf-lib';
import { boundsOverlap, cornerStampLayout, readStampPageGeometry } from './corner-stamp';
import { encodeQr } from './qr-encoder';
import { type QrCorner, type QrPrintRequest } from './qr-settings';
import { key, number, readBounds, widgetFlags, type RectangleBounds } from './template';

const QUIET_MODULES = 4;
const op = PDFOperator.of;

export function qrStampLayout(
  media: RectangleBounds, crop: RectangleBounds, angle: number, userUnit: number, placement: QrCorner, sizePt: number,
) {
  const layout = cornerStampLayout(media, crop, angle, userUnit, placement, sizePt, sizePt);
  if (!layout) throw new Error('qr-stamp-does-not-fit');
  const { stampWidth: side, matrix, bounds } = layout;
  // Very large coordinates can quantize away module-sized offsets even
  // when the page width itself remains representable.
  if (Math.max(...bounds.map(Math.abs)) * Number.EPSILON >= side / (64 * (41 + 2 * QUIET_MODULES))) {
    throw new Error('qr-stamp-does-not-fit');
  }
  return { side, matrix, bounds };
}

function pageLayout(page: PDFPage, placement: QrCorner, sizePt: number) {
  const geometry = readStampPageGeometry(page);
  if (!geometry) throw new Error('qr-stamp-does-not-fit');
  const layout = qrStampLayout(geometry.media, geometry.crop, geometry.angle, geometry.userUnit, placement, sizePt);
  const annots = page.node.Annots();
  for (let i = 0; annots && i < annots.size(); i++) {
    const widget = annots.lookup(i, PDFDict);
    if (widget.lookupMaybe(key('Subtype'), PDFName) !== key('Widget') || widgetFlags(widget) & (1 | 2 | 32)) continue;
    const rect = widget.lookupMaybe(key('Rect'), PDFArray);
    if (!rect || rect.size() !== 4) throw new Error('qr-stamp-does-not-fit');
    const bounds = readBounds(rect);
    if (!bounds.every(Number.isFinite)) throw new Error('qr-stamp-does-not-fit');
    if (boundsOverlap(layout.bounds, bounds)) {
      throw new Error('qr-stamp-widget-overlap');
    }
  }
  return layout;
}

function rectangle(x: number, y: number, width: number, height: number) {
  return op(Op.AppendRectangle, [x, y, width, height].map(number));
}

export function prepareQrStamp({ placement, sizePt, payloads }: QrPrintRequest) {
  const symbols = new Map<string, ReturnType<typeof encodeQr>>();
  const matrices = payloads.map((payload) => {
    if (payload === null) throw new Error('qr-stamp-invalid-payload');
    const cached = symbols.get(payload);
    if (cached) return cached;
    const symbol = encodeQr(payload);
    symbols.set(payload, symbol);
    return symbol;
  });
  return (sources: readonly PDFPage[], index: number) => {
    const matrix = matrices[index]!;
    const layouts = sources.map((page) => pageLayout(page, placement, sizePt));
    const paint = (outputs: readonly PDFPage[]) => {
      for (const [pageIndex, { side, matrix: transform }] of layouts.entries()) {
        const unit = side / (matrix.size + 2 * QUIET_MODULES);
        const ops = [
          op(Op.PushGraphicsState), op(Op.ConcatTransformationMatrix, transform.map(number)),
          op(Op.NonStrokingColorGray, [number(1)]), rectangle(0, 0, side, side), op(Op.FillNonZero),
          op(Op.NonStrokingColorGray, [number(0)]),
        ];
        for (const [row, modules] of matrix.modules.entries()) {
          let start = -1;
          for (let x = 0; x <= matrix.size; x++) {
            if (modules[x]) {
              if (start < 0) start = x;
            } else if (start >= 0) {
              ops.push(rectangle((start + QUIET_MODULES) * unit, (matrix.size + QUIET_MODULES - row - 1) * unit, (x - start) * unit, unit));
              start = -1;
            }
          }
        }
        outputs[pageIndex]!.pushOperators(...ops, op(Op.FillNonZero), op(Op.PopGraphicsState));
      }
    };
    return { paint, footprints: layouts.map(({ bounds }) => bounds) };
  };
}
