import { grayscale, PDFDocument, PDFObjectCopier, PDFStream, type PDFPage } from 'pdf-lib';
import { key, hasUnsupportedPrintAnnotation, openTemplate, type TemplateMetadata } from './template';
import { recordAtSlot, recordsPerSheet, recordSheetCount, type FourUpOptions, type ImpositionUnavailableReason } from './imposition-settings';

const shortSide = 595.28;
const longSide = 841.89;
const margin = 18;
const gutter = 18;
const cutGap = 2;
const cutLength = 5;
export const TRIM_MARK_WEIGHT = 0.35;

const layouts = [
  { width: longSide, height: shortSide, sideBySide: true },
  { width: shortSide, height: longSide, sideBySide: false },
  { width: shortSide, height: longSide, sideBySide: true },
  { width: longSide, height: shortSide, sideBySide: false },
] as const;
const gridLayouts = [{ width: shortSide, height: longSide }, { width: longSide, height: shortSide }] as const;

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

export function trimMarkLines({ x, y, width, height }: Pick<ReturnType<typeof fitRecord>, 'x' | 'y' | 'width' | 'height'>) {
  const lines: { start: { x: number; y: number }; end: { x: number; y: number } }[] = [];
  for (const horizontal of [-1, 1] as const) {
    const cornerX = horizontal === -1 ? x : x + width;
    const innerX = cornerX + horizontal * cutGap;
    for (const vertical of [-1, 1] as const) {
      const cornerY = vertical === -1 ? y : y + height;
      const innerY = cornerY + vertical * cutGap;
      lines.push({ start: { x: innerX, y: cornerY }, end: { x: innerX + horizontal * cutLength, y: cornerY } },
        { start: { x: cornerX, y: innerY }, end: { x: cornerX, y: innerY + vertical * cutLength } });
    }
  }
  return lines;
}

function drawCutMarks(page: PDFPage, record: ReturnType<typeof fitRecord>) {
  for (const line of trimMarkLines(record)) page.drawLine({ ...line, color: grayscale(0.35), thickness: TRIM_MARK_WEIGHT });
}

export function fourUpLayout(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('imposition-invalid-page-geometry');
  const cell = (side: number) => (side - 2 * margin - gutter) / 2;
  const fit = (layout: typeof gridLayouts[number]) => Math.min(cell(layout.width) / width, cell(layout.height) / height);
  const [portrait, landscape] = gridLayouts;
  const layout = fit(landscape) > fit(portrait) ? landscape : portrait;
  const scale = fit(layout);
  const cellWidth = cell(layout.width);
  const cellHeight = cell(layout.height);
  const slot = (index: number, recordWidth: number, recordHeight: number) => {
    const width = recordWidth * scale;
    const height = recordHeight * scale;
    if (!(width > TRIM_MARK_WEIGHT && height > TRIM_MARK_WEIGHT)) throw new Error('imposition-invalid-page-geometry');
    return checkedFit({ x: margin + (index % 2) * (cellWidth + gutter) + (cellWidth - width) / 2,
      y: margin + (1 - Math.floor(index / 2)) * (cellHeight + gutter) + (cellHeight - height) / 2, width, height, scale });
  };
  return { layout, slots: [0, 1, 2, 3].map((index) => slot(index, width, height)), slot };
}

export function centerCutLines({ width, height }: typeof gridLayouts[number]) {
  return [
    { start: { x: width / 2, y: margin / 2 }, end: { x: width / 2, y: height - margin / 2 } },
    { start: { x: margin / 2, y: height / 2 }, end: { x: width - margin / 2, y: height / 2 } },
  ];
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

export function hasValidImpositionGeometry(page: TemplateMetadata['pages'][number], imposition: '2-up' | '4-up' = '2-up'): boolean {
  try {
    const { width, height, userUnit } = pageGeometry(page);
    const { slots } = imposition === '4-up' ? fourUpLayout(width, height) : impositionLayout(width, height);
    const scale = slots[0]!.scale * userUnit;
    return Number.isFinite(scale) && scale > 0;
  } catch (error) {
    if (error instanceof Error && error.message === 'imposition-invalid-page-geometry') return false;
    throw error;
  }
}

export async function inspectImpositionCompatibility(bytes: Uint8Array | ArrayBuffer) {
  const { doc, pages } = await openTemplate(bytes);
  const templatePagesPerRecord = pages.length;
  const shared: ImpositionUnavailableReason | undefined = templatePagesPerRecord !== 1 ? 'imposition-requires-single-page'
    : hasUnsupportedPrintAnnotation(doc.getPage(0)) ? 'imposition-unsupported-print-annotation' : undefined;
  return { templatePagesPerRecord,
    twoUpUnavailableReason: shared ?? (hasValidImpositionGeometry(pages[0]!) ? undefined : 'imposition-invalid-page-geometry' as const),
    fourUpUnavailableReason: shared ?? (hasValidImpositionGeometry(pages[0]!, '4-up') ? undefined : 'imposition-invalid-page-geometry' as const),
  };
}

export async function imposeRecordPages(source: PDFDocument, pages: TemplateMetadata['pages'], imposition: '2-up' | '4-up' = '2-up', fourUp?: FourUpOptions) {
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
  const sheetCount = recordSheetCount(embedded.length, imposition);
  const grid = imposition === '4-up' ? fourUpLayout(geometry.reduce((max, { width }) => Math.max(max, width), 0),
    geometry.reduce((max, { height }) => Math.max(max, height), 0)) : undefined;
  const recordScales: number[] = [];
  for (let sheet = 0; sheet < sheetCount; sheet++) {
    const first = recordAtSlot(sheet, 0, sheetCount, imposition, fourUp);
    const geometryFirst = geometry[first]!;
    const pair = grid ? undefined : impositionLayout(geometryFirst.width, geometryFirst.height);
    const layout = grid?.layout ?? pair!.layout;
    const page = doc.addPage([layout.width, layout.height]);
    for (let slot = 0; slot < recordsPerSheet(imposition); slot++) {
      const index = recordAtSlot(sheet, slot, sheetCount, imposition, fourUp);
      if (index >= embedded.length) continue;
      const content = embedded[index]!;
      const { width, height, userUnit } = geometry[index]!;
      const record = grid ? grid.slot(slot, width, height) : checkedFit(fitRecord(pair!.layout, width, height, slot));
      const scale = record.scale * userUnit;
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('imposition-invalid-page-geometry');
      recordScales[index] = record.scale;
      const group = sourcePages[index]!.node.get(key('Group'));
      if (group) {
        await content.embed();
        doc.context.lookup(content.ref, PDFStream).dict.set(key('Group'), copy.copy(group));
      }
      // The form matrix restores crop origin and clockwise page rotation.
      page.drawPage(content, { x: record.x, y: record.y, xScale: scale, yScale: scale });
      drawCutMarks(page, record);
    }
    if (grid && fourUp?.centerCutGuides) for (const line of centerCutLines(layout)) {
      page.drawLine({ ...line, color: grayscale(0.55), thickness: 0.25, dashArray: [3, 3] });
    }
  }
  return { doc, recordScales };
}
