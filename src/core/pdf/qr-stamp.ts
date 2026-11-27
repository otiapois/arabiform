import { PDFArray, PDFDict, PDFName, PDFNumber, PDFOperator, PDFOperatorNames as Op, type PDFPage } from 'pdf-lib';
import { PRINT_MARGIN_THRESHOLD_PT } from './margin-preflight';
import { encodeQr } from './qr-encoder';
import { type QrCorner, type QrPrintRequest } from './qr-settings';
import { key, number, readBounds, rotationOf, widgetFlags, type RectangleBounds } from './template';

const QUIET_MODULES = 4;
const op = PDFOperator.of;

export function qrStampLayout(
  media: RectangleBounds, crop: RectangleBounds, angle: number, userUnit: number, placement: QrCorner, sizePt: number,
) {
  const left = Math.max(media[0], crop[0]);
  const bottom = Math.max(media[1], crop[1]);
  const right = Math.min(media[2], crop[2]);
  const top = Math.min(media[3], crop[3]);
  const rotation = rotationOf(angle);
  const margin = PRINT_MARGIN_THRESHOLD_PT / userUnit;
  const side = sizePt / userUnit;
  const width = right - left;
  const height = top - bottom;
  const required = side + 2 * margin;
  if (![...media, ...crop, rotation, width, height, required].every(Number.isFinite)
    || rotation % 90 !== 0 || !(margin > 0 && side > 0 && width >= required && height >= required)) {
    throw new Error('qr-stamp-does-not-fit');
  }
  const quarterTurn = rotation % 180 === 90;
  const x = placement.endsWith('right') ? (quarterTurn ? height : width) - margin - side : margin;
  const y = placement.startsWith('top') ? (quarterTurn ? width : height) - margin - side : margin;
  // Local stamp coordinates have their origin at the displayed lower-left.
  // /Rotate turns the page clockwise, so map back to native page coordinates.
  const matrix = rotation === 90 ? [0, 1, -1, 0, right - y, bottom + x] as const
    : rotation === 180 ? [-1, 0, 0, -1, right - x, top - y] as const
    : rotation === 270 ? [0, -1, 1, 0, left + y, top - x] as const
    : [1, 0, 0, 1, left + x, bottom + y] as const;
  const [a, b, c, d, originX, originY] = matrix;
  const oppositeX = originX + (a + c) * side;
  const oppositeY = originY + (b + d) * side;
  const bounds: RectangleBounds = [
    Math.min(originX, oppositeX), Math.min(originY, oppositeY), Math.max(originX, oppositeX), Math.max(originY, oppositeY),
  ];
  // Very large coordinates can quantize away module-sized offsets even
  // when the page width itself remains representable.
  if (bounds[0] <= left || bounds[1] <= bottom || bounds[2] >= right || bounds[3] >= top
    || Math.max(...bounds.map(Math.abs)) * Number.EPSILON >= side / (64 * (41 + 2 * QUIET_MODULES))) {
    throw new Error('qr-stamp-does-not-fit');
  }
  return { side, matrix, bounds };
}

function pageLayout(page: PDFPage, placement: QrCorner, sizePt: number) {
  const media = page.node.MediaBox();
  const crop = page.node.CropBox() ?? media;
  const unit = page.node.lookup(key('UserUnit'));
  const angle = page.node.Rotate();
  if (media.size() !== 4 || crop.size() !== 4
    || page.node.has(key('UserUnit')) && !(unit instanceof PDFNumber)
    || page.node.getInheritableAttribute(key('Rotate')) && !(angle instanceof PDFNumber)) {
    throw new Error('qr-stamp-does-not-fit');
  }
  const layout = qrStampLayout(readBounds(media), readBounds(crop), angle?.asNumber() ?? 0,
    unit instanceof PDFNumber ? unit.asNumber() : 1, placement, sizePt);
  const [left, bottom, right, top] = layout.bounds;
  const annots = page.node.Annots();
  for (let i = 0; annots && i < annots.size(); i++) {
    const widget = annots.lookup(i, PDFDict);
    if (widget.lookupMaybe(key('Subtype'), PDFName) !== key('Widget') || widgetFlags(widget) & (1 | 2 | 32)) continue;
    const rect = widget.lookupMaybe(key('Rect'), PDFArray);
    if (!rect || rect.size() !== 4) throw new Error('qr-stamp-does-not-fit');
    const bounds = readBounds(rect);
    if (!bounds.every(Number.isFinite)) throw new Error('qr-stamp-does-not-fit');
    const [x0, y0, x1, y1] = bounds;
    if (Math.min(right, x1) > Math.max(left, x0) && Math.min(top, y1) > Math.max(bottom, y0)) {
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
    return (outputs: readonly PDFPage[]) => {
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
  };
}
