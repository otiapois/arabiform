import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFOperator, PDFOperatorNames as Op, type PDFPage } from 'pdf-lib';
import { CUSTODY_PREFIX_LENGTH, type CustodySources } from '../audit/custody';
import { localVirtualDate } from '../roster/virtual-columns';
import { appendPositionedText } from './appearances';
import { createShaper, DEFAULT_MIN_FONT_SIZE, textInputDiagnostic, type PlacedLine } from './shaping';
import { key, number } from './template';
import type { PreflightOptions } from './index';

export interface MergeCoverOptions {
  locale: 'en' | 'ar';
  templateName: string;
  exportedAt: Date;
  preflight: PreflightOptions;
  rowNumbers: readonly number[];
  flagged: number;
  skipped: number;
  custody?: CustodySources;
}

const PAGE_SIZE: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const WIDTH = PAGE_SIZE[0] - 2 * MARGIN;
const TOP = PAGE_SIZE[1] - MARGIN;
const CELL_PADDING = 6;
const TABLE_HEADER = 24;
const FILE_COLUMN = 2;
const COLUMNS = [36, 56, WIDTH - 36 - 56 - 82, 82];
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const labels = {
  en: {
    title: 'ArabiForm · Batch Print Manifest', date: 'Export date', template: 'Template',
    ready: 'Ready', flagged: 'Flagged', skipped: 'Skipped', minimum: 'Min font size', font: 'Font mode',
    auto: 'Auto', arabic: 'Arabic', latin: 'Latin', custom: 'Custom', points: 'pt',
    columns: ['#', 'Row', 'Filename', 'Pages'],
  },
  ar: {
    title: 'ArabiForm · سجل طباعة الدفعة', date: 'تاريخ التصدير', template: 'القالب',
    ready: 'جاهز', flagged: 'يحتاج إلى مراجعة', skipped: 'تم تخطيه', minimum: 'الحد الأدنى لحجم الخط', font: 'وضع الخط',
    auto: 'تلقائي', arabic: 'عربي', latin: 'لاتيني', custom: 'مخصص', points: 'نقطة',
    columns: ['#', 'الصف', 'اسم الملف', 'الصفحات'],
  },
};

class CoverSheetError extends Error {}

interface CoverRowGeometry { height: number; pageCount: number }
interface CoverRowPosition { index: number; top: number; startPage: number; endPage: number }

export function paginateCoverRows(rows: readonly CoverRowGeometry[], firstTop: number, nextTop: number, bottom: number) {
  const pages: CoverRowPosition[][] = [[]];
  let top = firstTop;
  let precedingPages = 0;
  for (const [index, row] of rows.entries()) {
    if (top - row.height < bottom) {
      pages.push([]);
      top = nextTop;
    }
    if (top - row.height < bottom) throw new CoverSheetError('cover-sheet-layout-overflow');
    pages.at(-1)!.push({ index, top, startPage: precedingPages + 1, endPage: precedingPages + row.pageCount });
    top -= row.height;
    precedingPages += row.pageCount;
  }
  return pages.map((page) => page.map((row) => ({
    ...row, startPage: row.startPage + pages.length, endPage: row.endPage + pages.length,
  })));
}

type BaseDirection = 'ltr' | 'rtl';
type Shaper = ReturnType<typeof createShaper>;
interface CoverText { text: string; lines: PlacedLine[]; size: number; height: number }

function layoutText(shaper: Shaper, text: string, size: number, width: number, mode: BaseDirection | 'filename'): CoverText {
  if (!text.trim() || textInputDiagnostic(text) || /[\r\n\t\p{Zl}\p{Zp}]/u.test(text)) {
    throw new CoverSheetError('cover-sheet-unsupported-text');
  }
  const shape = (value: string) => {
    const line = mode === 'filename' ? shaper.filenameLine(value) : shaper.line(value, mode);
    if (!line) throw new CoverSheetError('cover-sheet-unsupported-text');
    return line;
  };
  const fits = (line: ReturnType<typeof shape>) => (line.bounds.maxX - line.bounds.minX) * size <= width;
  const lines: PlacedLine[] = [];
  let remaining = text;
  let height = 0;
  while (remaining) {
    let line = shape(remaining);
    if (!fits(line)) {
      if (mode !== 'filename') throw new CoverSheetError('cover-sheet-layout-overflow');
      const segments = [...graphemes.segment(remaining)];
      const extension = /\.pdf$/iu.exec(remaining)?.index ?? remaining.length;
      const breaks = segments.map(({ segment, index }) => index + segment.length).filter((end) => end <= extension);
      let low = 0;
      let high = breaks.length - 1;
      let fitting: typeof line | undefined;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = shape(remaining.slice(0, breaks[middle]));
        if (fits(candidate)) {
          fitting = candidate;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (!fitting) throw new CoverSheetError('cover-sheet-layout-overflow');
      line = fitting;
      const space = segments.findLast(({ segment, index }) => /^\s$/u.test(segment) && index + segment.length <= line.text.length);
      if (space) {
        const atSpace = shape(remaining.slice(0, space.index + space.segment.length));
        if (atSpace.painted && fits(atSpace)) line = atSpace;
      }
    }
    const baseline = -height - line.bounds.maxY * size;
    lines.push({ line, origin: -line.bounds.minX * size, baseline });
    height += Math.max(size, (line.bounds.maxY - line.bounds.minY) * size) + 2;
    remaining = remaining.slice(line.text.length);
  }
  if (!lines.some(({ line }) => line.painted)) throw new CoverSheetError('cover-sheet-unsupported-text');
  return { text, lines, size, height: height - 2 };
}

function addText(page: PDFPage, text: CoverText, left: number, top: number, width: number, align: BaseDirection | 'center',
  fonts: Record<'arabic' | 'latin', { name: string; ref: PDFPage['ref'] }>) {
  const lines = text.lines.map(({ line, origin, baseline }) => {
    const remaining = width - (line.bounds.maxX - line.bounds.minX) * text.size;
    return { line, origin: left + origin + (align === 'rtl' ? remaining : align === 'center' ? remaining / 2 : 0), baseline: top + baseline };
  });
  const operators: PDFOperator[] = [];
  appendPositionedText(operators, text.text, lines, text.size, (family) => fonts[family === 'arabic' ? 'arabic' : 'latin']);
  page.pushOperators(...operators);
}

export async function prependMergeCover(
  doc: PDFDocument, entries: readonly { filename: string; pageCount: number }[], options: MergeCoverOptions,
) {
  const { locale, templateName, exportedAt, preflight, rowNumbers, flagged, skipped, custody } = options;
  if ((locale !== 'en' && locale !== 'ar') || rowNumbers.length !== entries.length || !Number.isFinite(exportedAt.getTime())) {
    throw new CoverSheetError('cover-sheet-invalid-metadata');
  }
  try {
    const copy = labels[locale];
    const direction = locale === 'ar' ? 'rtl' : 'ltr';
    const { fonts, minFontSize = DEFAULT_MIN_FONT_SIZE, preferredFont = 'auto', customFont } = preflight;
    const shaper = createShaper(fonts, 'auto');
    const title = layoutText(shaper, copy.title, 22, WIDTH, direction);
    const footer = custody && layoutText(shaper,
      `Template SHA-256 ${custody.templateSha256.slice(0, CUSTODY_PREFIX_LENGTH)}   ·   Roster SHA-256 ${custody.rosterSha256.slice(0, CUSTODY_PREFIX_LENGTH)}`,
      8, WIDTH, 'ltr');
    const details = ([
      { label: copy.date, value: localVirtualDate(exportedAt), mode: 'ltr' },
      { label: copy.template, value: templateName, mode: 'filename' },
    ] as const).map(({ label, value, mode }) => ({
      label: layoutText(shaper, label, 10, 110, direction),
      value: layoutText(shaper, value, 10, WIDTH - 120, mode),
    }));
    const summary = layoutText(shaper, `${copy.ready}: ${entries.length}   ·   ${copy.flagged}: ${flagged}   ·   ${copy.skipped}: ${skipped}`, 10, WIDTH, direction);
    const settings = layoutText(shaper, `${copy.minimum}: ${minFontSize} ${copy.points}   ·   ${copy.font}: ${copy[customFont ? 'custom' : preferredFont]}`, 10, WIDTH, direction);
    const headings = copy.columns.map((label, index) => layoutText(shaper, label, 10, COLUMNS[index]! - 2 * CELL_PADDING, direction));
    const rows = entries.map(({ filename, pageCount }) => {
      const text = layoutText(shaper, filename, 10, COLUMNS[FILE_COLUMN]! - 2 * CELL_PADDING, 'filename');
      return { text, pageCount, height: Math.max(23, text.height + 2 * CELL_PADDING) };
    });
    const afterTitle = TOP - title.height - 18;
    const afterDetails = afterTitle - details.reduce((height, { label, value }) => height + Math.max(label.height, value.height) + 8, 0);
    const firstTable = afterDetails - summary.height - settings.height - 22;
    const bottom = MARGIN + (footer ? footer.height + 9 : 1);
    if (firstTable - TABLE_HEADER <= bottom) throw new CoverSheetError('cover-sheet-layout-overflow');
    const pages = paginateCoverRows(rows, firstTable - TABLE_HEADER, afterTitle - TABLE_HEADER, bottom);

    doc.registerFontkit(fontkit);
    const [arabic, latin] = await Promise.all([
      doc.embedFont(fonts.arabic, { subset: false, customName: 'NotoNaskhArabic-Regular' }),
      doc.embedFont(fonts.latin, { subset: false, customName: 'NotoSans-Regular' }),
    ]);
    const resources = {
      arabic: { name: 'ArabiFormCoverArabic', ref: arabic.ref },
      latin: { name: 'ArabiFormCoverLatin', ref: latin.ref },
    };
    const xAt = (offset: number, width: number) => MARGIN + (direction === 'rtl' ? WIDTH - offset - width : offset);
    for (const [pageIndex, positioned] of pages.entries()) {
      const page = doc.insertPage(pageIndex, PAGE_SIZE);
      for (const { name, ref } of Object.values(resources)) page.node.setFontDictionary(key(name), ref);
      const draw = (text: CoverText, offset: number, top: number, width: number, align: BaseDirection = direction) =>
        addText(page, text, xAt(offset, width), top, width, align, resources);
      const rule = (y: number) => page.pushOperators(
        PDFOperator.of(Op.StrokingColorGray, [number(0.72)]),
        PDFOperator.of(Op.SetLineWidth, [number(0.45)]),
        PDFOperator.of(Op.MoveTo, [number(MARGIN), number(y)]),
        PDFOperator.of(Op.LineTo, [number(MARGIN + WIDTH), number(y)]),
        PDFOperator.of(Op.StrokePath),
      );
      const cell = (text: CoverText, index: number, top: number, height: number, align: BaseDirection | 'center') => {
        const offset = COLUMNS.slice(0, index).reduce((sum, width) => sum + width, 0);
        const width = COLUMNS[index]! - 2 * CELL_PADDING;
        addText(page, text, xAt(offset + CELL_PADDING, width), top - (height - text.height) / 2, width, align, resources);
      };
      draw(title, 0, TOP, WIDTH);
      if (!pageIndex) {
        let top = afterTitle;
        for (const { label, value } of details) {
          draw(label, 0, top, 110);
          draw(value, 120, top, WIDTH - 120);
          top -= Math.max(label.height, value.height) + 8;
        }
        draw(summary, 0, top, WIDTH);
        draw(settings, 0, top - summary.height - 8, WIDTH);
      }
      const table = pageIndex ? afterTitle : firstTable;
      rule(table);
      headings.forEach((text, index) => cell(text, index, table, TABLE_HEADER, index === FILE_COLUMN ? direction : 'center'));
      rule(table - TABLE_HEADER);
      for (const { index, top, startPage, endPage } of positioned) {
        const { text, height } = rows[index]!;
        const pages = startPage === endPage ? String(startPage) : `${startPage}–${endPage}`;
        const values = [String(index + 1), String(rowNumbers[index]), text.text, pages];
        values.forEach((value, column) => {
          const content = column === FILE_COLUMN ? text : layoutText(shaper, value, 10, COLUMNS[column]! - 2 * CELL_PADDING, 'ltr');
          cell(content, column, top, height, column === FILE_COLUMN ? direction : 'center');
        });
        rule(top - height);
      }
      if (footer) addText(page, footer, MARGIN, MARGIN + footer.height, WIDTH, 'center', resources);
    }
  } catch (cause) {
    if (cause instanceof CoverSheetError) throw cause;
    throw new CoverSheetError('cover-sheet-export-failed', { cause });
  }
}
