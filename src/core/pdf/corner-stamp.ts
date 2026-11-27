import { PDFNumber, type PDFPage } from 'pdf-lib';
import { PRINT_MARGIN_THRESHOLD_PT } from './margin-preflight';
import type { QrCorner } from './qr-settings';
import { intersectPageBounds, key, readBounds, rotationOf, type RectangleBounds } from './template';

export function readStampPageGeometry(page: PDFPage) {
  const media = page.node.MediaBox();
  const crop = page.node.CropBox() ?? media;
  const unit = page.node.lookup(key('UserUnit'));
  const angle = page.node.Rotate();
  if (media.size() !== 4 || crop.size() !== 4
    || page.node.has(key('UserUnit')) && !(unit instanceof PDFNumber)
    || page.node.getInheritableAttribute(key('Rotate')) && !(angle instanceof PDFNumber)) return undefined;
  return { media: readBounds(media), crop: readBounds(crop), angle: angle?.asNumber() ?? 0,
    userUnit: unit instanceof PDFNumber ? unit.asNumber() : 1 };
}

export function cornerStampLayout(
  media: RectangleBounds, crop: RectangleBounds, angle: number, userUnit: number, placement: QrCorner,
  widthPt: number, heightPt: number,
) {
  const visible = intersectPageBounds(media, crop);
  if (!visible) return undefined;
  const [left, bottom, right, top] = visible;
  const rotation = rotationOf(angle);
  const margin = PRINT_MARGIN_THRESHOLD_PT / userUnit;
  const stampWidth = widthPt / userUnit;
  const stampHeight = heightPt / userUnit;
  const quarterTurn = rotation % 180 === 90;
  const width = quarterTurn ? top - bottom : right - left;
  const height = quarterTurn ? right - left : top - bottom;
  if (![...media, ...crop, rotation, width, height, margin, stampWidth, stampHeight].every(Number.isFinite)
    || rotation % 90 !== 0 || !(margin > 0 && stampWidth > 0 && stampHeight > 0)
    || width < stampWidth + 2 * margin || height < stampHeight + 2 * margin) return undefined;

  const x = placement.endsWith('right') ? width - margin - stampWidth : margin;
  const y = placement.startsWith('top') ? height - margin - stampHeight : margin;
  // Map displayed lower-left stamp coordinates to the PDF's native axes.
  const matrix = rotation === 90 ? [0, 1, -1, 0, right - y, bottom + x] as const
    : rotation === 180 ? [-1, 0, 0, -1, right - x, top - y] as const
    : rotation === 270 ? [0, -1, 1, 0, left + y, top - x] as const
    : [1, 0, 0, 1, left + x, bottom + y] as const;
  const [a, b, c, d, originX, originY] = matrix;
  const oppositeX = originX + a * stampWidth + c * stampHeight;
  const oppositeY = originY + b * stampWidth + d * stampHeight;
  const bounds: RectangleBounds = [
    Math.min(originX, oppositeX), Math.min(originY, oppositeY), Math.max(originX, oppositeX), Math.max(originY, oppositeY),
  ];
  if (bounds[0] <= left || bounds[1] <= bottom || bounds[2] >= right || bounds[3] >= top
    || !(bounds[2] > bounds[0] && bounds[3] > bounds[1])) return undefined;
  return { matrix, bounds, stampWidth };
}

export function boundsOverlap([left, bottom, right, top]: RectangleBounds, [x0, y0, x1, y1]: RectangleBounds) {
  return Math.min(right, x1) > Math.max(left, x0) && Math.min(top, y1) > Math.max(bottom, y0);
}
