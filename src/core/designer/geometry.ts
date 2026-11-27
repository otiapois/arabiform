import type { NormalizedRect } from '../pdf/page-geometry';

export { displayToSource, sourceToDisplay, type DesignerPage, type NormalizedRect, type PdfRect } from '../pdf/page-geometry';

export function clampDisplayRect([x, y, width, height]: NormalizedRect): NormalizedRect {
  const left = Math.min(1, Math.max(0, x));
  const top = Math.min(1, Math.max(0, y));
  const right = Math.min(1, x + width);
  const bottom = Math.min(1, y + height);
  return [left, top, Math.max(0, right - left), Math.max(0, bottom - top)];
}
