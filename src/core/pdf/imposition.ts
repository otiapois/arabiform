import { grayscale, PDFDocument, PDFObjectCopier, PDFStream, type PDFPage } from 'pdf-lib';
import { key, type TemplateMetadata } from './template';
import { RECORDS_PER_TWO_UP_SHEET } from './two-up-sheets';

const shortSide = 595.28;
const longSide = 841.89;
const margin = 18;
const gutter = 18;
const cutGap = 2;
const cutLength = 5;
const cutWeight = 0.35;

const layouts = [
  { width: longSide, height: shortSide, sideBySide: true },
  { width: shortSide, height: longSide, sideBySide: false },
  { width: shortSide, height: longSide, sideBySide: true },
  { width: longSide, height: shortSide, sideBySide: false },
] as const;

type Layout = typeof layouts[number];

function fitRecord(layout: Layout, width: number, height: number, slot: number) {
  const availableWidth = layout.width - 2 * margin;
  const availableHeight = layout.height - 2 * margin;
  const cellWidth = layout.sideBySide ? (availableWidth - gutter) / 2 : availableWidth;
  const cellHeight = layout.sideBySide ? availableHeight : (availableHeight - gutter) / 2;
  const scale = Math.min(cellWidth / width, cellHeight / height);
  const recordWidth = width * scale;
  const recordHeight = height * scale;
  return {
    x: margin + (layout.sideBySide ? slot * (cellWidth + gutter) : 0) + (cellWidth - recordWidth) / 2,
    y: margin + (layout.sideBySide ? 0 : (1 - slot) * (cellHeight + gutter)) + (cellHeight - recordHeight) / 2,
    width: recordWidth, height: recordHeight, scale,
  };
}

function checkedFit(record: ReturnType<typeof fitRecord>) {
  const { x, y, width, height, scale } = record;
  const right = x + width;
  const top = y + height;
  // A tiny dimension can round away when added to its position on the sheet.
  if (!Number.isFinite(scale) || !Number.isFinite(right) || !Number.isFinite(top)
    || !(scale > 0 && right > x && top > y)) throw new Error('imposition-invalid-page-geometry');
  return record;
}

export function impositionLayout(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('imposition-invalid-page-geometry');
  }
  const layout = layouts.reduce((best, candidate) =>
    fitRecord(candidate, width, height, 0).scale > fitRecord(best, width, height, 0).scale ? candidate : best);
  return { layout, slots: [checkedFit(fitRecord(layout, width, height, 0)), checkedFit(fitRecord(layout, width, height, 1))] as const };
}

function drawCutMarks(page: PDFPage, { x, y, width, height }: ReturnType<typeof fitRecord>) {
  const color = grayscale(0.35);
  for (const horizontal of [-1, 1] as const) {
    const cornerX = horizontal === -1 ? x : x + width;
    const innerX = cornerX + horizontal * cutGap;
    for (const vertical of [-1, 1] as const) {
      const cornerY = vertical === -1 ? y : y + height;
      const innerY = cornerY + vertical * cutGap;
      page.drawLine({ start: { x: innerX, y: cornerY }, end: { x: innerX + horizontal * cutLength, y: cornerY }, color, thickness: cutWeight });
      page.drawLine({ start: { x: cornerX, y: innerY }, end: { x: cornerX, y: innerY + vertical * cutLength }, color, thickness: cutWeight });
    }
  }
}

function pageGeometry({ printBounds, rotation, userUnit }: TemplateMetadata['pages'][number]) {
  const [left, bottom, right, top] = printBounds;
  const transformations: Record<number, [number, number, number, number, number, number]> = {
    0: [1, 0, 0, 1, -left, -bottom],
    90: [0, -1, 1, 0, -bottom, right],
    180: [-1, 0, 0, -1, right, top],
    270: [0, 1, -1, 0, top, -left],
  };
  const matrix = transformations[rotation];
  if (!matrix) throw new Error('imposition-invalid-page-geometry');
  const quarterTurn = rotation % 180 !== 0;
  return { box: { left, bottom, right, top }, matrix, userUnit,
    width: (quarterTurn ? top - bottom : right - left) * userUnit,
    height: (quarterTurn ? right - left : top - bottom) * userUnit };
}

export function hasValidImpositionGeometry(page: TemplateMetadata['pages'][number]): boolean {
  try {
    const { width, height, userUnit } = pageGeometry(page);
    const { slots } = impositionLayout(width, height);
    const scale = slots[0].scale * userUnit;
    return Number.isFinite(scale) && scale > 0;
  } catch (error) {
    if (error instanceof Error && error.message === 'imposition-invalid-page-geometry') return false;
    throw error;
  }
}

export async function imposeRecordPages(source: PDFDocument, pages: TemplateMetadata['pages']) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const sourcePages = source.getPages();
  const geometry = pages.map(pageGeometry);
  for (const page of sourcePages) {
    page.node.delete(key('Annots'));
    if (!page.node.Contents()) page.pushOperators();
  }
  await source.flush();
  // One copier retains resources shared across records, including watermark fonts.
  const embedded = await doc.embedPages(sourcePages, geometry.map(({ box }) => box), geometry.map(({ matrix }) => matrix));
  const copy = PDFObjectCopier.for(source.context, doc.context);
  let current: { page: PDFPage; layout: Layout } | undefined;
  for (const [index, content] of embedded.entries()) {
    const { width, height, userUnit } = geometry[index]!;
    const slot = index % RECORDS_PER_TWO_UP_SHEET;
    let record;
    if (!slot) {
      const { layout, slots: [first] } = impositionLayout(width, height);
      current = { page: doc.addPage([layout.width, layout.height]), layout };
      record = first;
    } else {
      record = checkedFit(fitRecord(current!.layout, width, height, slot));
    }
    const { page } = current!;
    const scale = record.scale * userUnit;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('imposition-invalid-page-geometry');
    const group = sourcePages[index]!.node.get(key('Group'));
    if (group) {
      await content.embed();
      doc.context.lookup(content.ref, PDFStream).dict.set(key('Group'), copy.copy(group));
    }
    // The form matrix restores crop origin and clockwise page rotation.
    // Use equal scales in native units to retain the vector source geometry.
    page.drawPage(content, { x: record.x, y: record.y, xScale: scale, yScale: scale });
    drawCutMarks(page, record);
  }
  return doc;
}
