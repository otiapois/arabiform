export type PdfRect = readonly [x: number, y: number, width: number, height: number];
export type NormalizedRect = readonly [x: number, y: number, width: number, height: number];

interface PageFrame {
  readonly visibleBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly rotation: number;
}

export interface DesignerPage extends PageFrame {
  readonly rotation: 0 | 90 | 180 | 270;
  readonly userUnit: number;
}

// PDF.js flips the y-axis and rotates clockwise. Scale and UserUnit cancel in the ratios.
export function sourceToDisplay([x, y, width, height]: PdfRect, page: PageFrame): NormalizedRect {
  const box = page.visibleBox;
  const left = (x - box.x) / box.width;
  const bottom = (y - box.y) / box.height;
  const w = width / box.width;
  const h = height / box.height;
  const rightGap = (box.x + box.width - (x + width)) / box.width;
  const topGap = (box.y + box.height - (y + height)) / box.height;
  switch (page.rotation) {
    case 90: return [bottom, left, h, w];
    case 180: return [rightGap, bottom, w, h];
    case 270: return [topGap, rightGap, h, w];
    default: return [left, topGap, w, h];
  }
}

export function displayToSource([x, y, width, height]: NormalizedRect, page: DesignerPage): PdfRect {
  const box = page.visibleBox;
  switch (page.rotation) {
    case 90: return [box.x + y * box.width, box.y + x * box.height, height * box.width, width * box.height];
    case 180: return [box.x + (1 - (x + width)) * box.width, box.y + y * box.height, width * box.width, height * box.height];
    case 270: return [box.x + (1 - (y + height)) * box.width, box.y + (1 - (x + width)) * box.height, height * box.width, width * box.height];
    default: return [box.x + x * box.width, box.y + (1 - (y + height)) * box.height, width * box.width, height * box.height];
  }
}
