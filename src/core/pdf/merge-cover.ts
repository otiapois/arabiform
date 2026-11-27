import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFOperator, PDFOperatorNames as Op, type PDFPage } from 'pdf-lib';
import { CUSTODY_PREFIX_LENGTH, type CustodySources } from '../audit/custody';
import { localVirtualDate } from '../roster/virtual-columns';
import { appendPositionedText } from './appearances';
import { twoUpSheetCount } from './two-up-sheets';
import type { Imposition } from './exports';
import { createShaper, DEFAULT_MIN_FONT_SIZE, textInputDiagnostic, type PlacedLine } from './shaping';
import { key, number } from './template';
import type { PreflightOptions } from './index';

export interface MergeCoverOptions {
  locale: 'en' | 'ar' | 'bilingual';
  templateName: string;
  exportedAt: Date | string;
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
const BILINGUAL_GUTTER = 28;
const TABLE_HEADER = 24;
const FILE_COLUMN = 2;
const COLUMNS = [36, 56, WIDTH - 36 - 56 - 82, 82];
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const labels = {
  en: {
    title: 'ArabiForm · Batch Print Manifest', date: 'Export date', template: 'Template',
    ready: 'Ready', flagged: 'Flagged', skipped: 'Skipped', minimum: 'Min font size', font: 'Font mode',
    auto: 'Auto', arabic: 'Arabic', latin: 'Latin', custom: 'Custom', points: 'pt',
    columns: ['#', 'Row', 'Filename', 'Pages'], sheets: 'Sheets',
  },
  ar: {
    title: 'ArabiForm · سجل طباعة الدفعة', date: 'تاريخ التصدير', template: 'القالب',
    ready: 'جاهز', flagged: 'يحتاج إلى مراجعة', skipped: 'تم تخطيه', minimum: 'الحد الأدنى لحجم الخط', font: 'وضع الخط',
    auto: 'تلقائي', arabic: 'عربي', latin: 'لاتيني', custom: 'مخصص', points: 'نقطة',
    columns: ['#', 'الصف', 'اسم الملف', 'الصفحات'], sheets: 'الأوراق',
  },
};

class CoverSheetError extends Error {}

interface CoverRowGeometry { height: number; pageCount: number }
interface CoverRowPosition { index: number; top: number; startPage: number; endPage: number }

export function paginateCoverRows(rows: readonly CoverRowGeometry[], firstTop: number, nextTop: number, bottom: number, imposition: Imposition = '1-up') {
  const pages: CoverRowPosition[][] = [[]];
  let top = firstTop;
  let precedingPages = 0;
  for (const [index, row] of rows.entries()) {
    if (top - row.height < bottom) {
      pages.push([]);
      top = nextTop;
    }
    if (top - row.height < bottom) throw new CoverSheetError('cover-sheet-layout-overflow');
    const sheet = twoUpSheetCount(index + 1);
    pages.at(-1)!.push({ index, top, startPage: imposition === '2-up' ? sheet : precedingPages + 1,
      endPage: imposition === '2-up' ? sheet : precedingPages + row.pageCount });
    top -= row.height;
    precedingPages += row.pageCount;
  }
  return pages.map((page) => page.map((row) => ({
    ...row, startPage: row.startPage + pages.length, endPage: row.endPage + pages.length,
  })));
}

interface CoverPanelHeights {
  title: number;
  details: readonly number[];
  summary: number;
  settings: number;
}

export function coverTableLayout(panels: readonly CoverPanelHeights[], footerHeight?: number) {
  const afterTitle = TOP - Math.max(...panels.map(({ title }) => title)) - 18;
  const detailHeights = [0, 1].map((index) => Math.max(...panels.map(({ details }) => details[index]!)) + 8);
  const afterDetails = afterTitle - detailHeights.reduce((sum, height) => sum + height, 0);
  const summaryHeight = Math.max(...panels.map(({ summary }) => summary));
  const firstTable = afterDetails - summaryHeight - Math.max(...panels.map(({ settings }) => settings)) - 22;
  const bottom = MARGIN + (footerHeight === undefined ? 1 : footerHeight + 9);
  const tableHeader = panels.length > 1 ? 34 : TABLE_HEADER;
  if (firstTable - tableHeader <= bottom) throw new CoverSheetError('cover-sheet-layout-overflow');
  return { afterTitle, detailHeights, afterDetails, summaryHeight, firstTable, bottom, tableHeader };
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

type CoverEntry = { filename: string; pageCount: number };

function planMergeCover(entries: readonly CoverEntry[], options: MergeCoverOptions, imposition: Imposition) {
  const { locale, templateName, exportedAt, preflight, rowNumbers, flagged, skipped, custody } = options;
  const dateLabel = typeof exportedAt === 'string' ? exportedAt : localVirtualDate(exportedAt);
  if ((locale !== 'en' && locale !== 'ar' && locale !== 'bilingual') || rowNumbers.length !== entries.length
    || (typeof exportedAt === 'string' ? !/^\d{4}-\d{2}-\d{2}$/.test(exportedAt) : !Number.isFinite(exportedAt.getTime()))) {
    throw new CoverSheetError('cover-sheet-invalid-metadata');
  }
  try {
    const bilingual = locale === 'bilingual';
    const copy = labels[locale === 'ar' ? 'ar' : 'en'];
    const direction: BaseDirection = locale === 'ar' ? 'rtl' : 'ltr';
    const panelLocales = bilingual ? ['en', 'ar'] as const : [locale];
    const panelWidth = bilingual ? (WIDTH - BILINGUAL_GUTTER) / 2 : WIDTH;
    const labelWidth = bilingual ? 70 : 110;
    const valueWidth = panelWidth - labelWidth - 10;
    const { fonts, minFontSize = DEFAULT_MIN_FONT_SIZE, preferredFont = 'auto', customFont } = preflight;
    const shaper = createShaper(fonts, 'auto');
    const footer = custody && layoutText(shaper,
      `Template SHA-256 ${custody.templateSha256.slice(0, CUSTODY_PREFIX_LENGTH)}   ·   Roster SHA-256 ${custody.rosterSha256.slice(0, CUSTODY_PREFIX_LENGTH)}`,
      8, WIDTH, 'ltr');
    const panels = panelLocales.map((language, index) => {
      const panel = labels[language === 'ar' ? 'ar' : 'en'];
      const direction = language === 'ar' ? 'rtl' as const : 'ltr' as const;
      const size = bilingual ? 9 : 10;
      const title = layoutText(shaper, panel.title, bilingual ? 15 : 22, panelWidth, direction);
      const details = ([
        { label: panel.date, value: dateLabel, mode: 'ltr' },
        { label: panel.template, value: templateName, mode: 'filename' },
      ] as const).map(({ label, value, mode }) => ({
        label: layoutText(shaper, label, size, labelWidth, direction),
        value: layoutText(shaper, value, size, valueWidth, mode),
      }));
      const summary = layoutText(shaper, `${panel.ready}: ${entries.length}   ·   ${panel.flagged}: ${flagged}   ·   ${panel.skipped}: ${skipped}`, size, panelWidth, direction);
      const settings = layoutText(shaper, `${panel.minimum}: ${minFontSize} ${panel.points}   ·   ${panel.font}: ${panel[customFont ? 'custom' : preferredFont]}`, size, panelWidth, direction);
      return { left: MARGIN + index * (panelWidth + BILINGUAL_GUTTER), direction, title, details, summary, settings };
    });
    const heading = (language: typeof copy, label: string, index: number) => index === 3 && imposition === '2-up' ? language.sheets : label;
    const headings = copy.columns.map((label, index) => layoutText(shaper, heading(copy, label, index), 10, COLUMNS[index]! - 2 * CELL_PADDING, direction));
    const translatedHeadings = bilingual && labels.ar.columns.slice(1).map((label, index) =>
      layoutText(shaper, heading(labels.ar, label, index + 1), 9, COLUMNS[index + 1]! - 2 * CELL_PADDING, 'rtl'));
    const rows = entries.map(({ filename, pageCount }) => {
      const text = layoutText(shaper, filename, 10, COLUMNS[FILE_COLUMN]! - 2 * CELL_PADDING, 'filename');
      return { text, pageCount, height: Math.max(23, text.height + 2 * CELL_PADDING) };
    });
    const { afterTitle, detailHeights, afterDetails, summaryHeight, firstTable, bottom, tableHeader } = coverTableLayout(
      panels.map(({ title, details, summary, settings }) => ({
        title: title.height, details: details.map(({ label, value }) => Math.max(label.height, value.height)),
        summary: summary.height, settings: settings.height,
      })), footer?.height,
    );
    const pages = paginateCoverRows(rows, firstTable - tableHeader, afterTitle - tableHeader, bottom, imposition)
      .map((page) => page.map(({ index, top, startPage, endPage }) => {
        const { text, height } = rows[index]!;
        const range = startPage === endPage ? String(startPage) : `${startPage}–${endPage}`;
        const values = [String(index + 1), String(rowNumbers[index]), text.text, range];
        const cells = values.map((value, column) => column === FILE_COLUMN ? text
          : layoutText(shaper, value, 10, COLUMNS[column]! - 2 * CELL_PADDING, 'ltr'));
        return { top, height, cells };
      }));
    return {
      pages, fonts, footer, panels, headings, translatedHeadings, direction, bilingual, panelWidth, labelWidth, valueWidth,
      afterTitle, detailHeights, afterDetails, summaryHeight, firstTable, tableHeader,
    };
  } catch (cause) {
    if (cause instanceof CoverSheetError) throw cause;
    throw new CoverSheetError('cover-sheet-export-failed', { cause });
  }
}

export function countMergeCoverPages(entries: readonly CoverEntry[], options: MergeCoverOptions, imposition: Imposition): number {
  return planMergeCover(entries, options, imposition).pages.length;
}

export async function prependMergeCover(
  doc: PDFDocument, entries: readonly CoverEntry[], options: MergeCoverOptions, imposition: Imposition = '1-up',
) {
  const {
    pages, fonts, footer, panels, headings, translatedHeadings, direction, bilingual, panelWidth, labelWidth, valueWidth,
    afterTitle, detailHeights, afterDetails, summaryHeight, firstTable, tableHeader,
  } = planMergeCover(entries, options, imposition);
  try {
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
      const drawPanel = ({ left, direction }: typeof panels[number], text: CoverText, offset: number, top: number, width: number) => {
        const x = left + (direction === 'rtl' ? panelWidth - offset - width : offset);
        addText(page, text, x, top, width, direction, resources);
      };
      for (const panel of panels) drawPanel(panel, panel.title, 0, TOP, panelWidth);
      if (!pageIndex) {
        for (const panel of panels) {
          let top = afterTitle;
          for (const [index, { label, value }] of panel.details.entries()) {
            drawPanel(panel, label, 0, top, labelWidth);
            drawPanel(panel, value, labelWidth + 10, top, valueWidth);
            top -= detailHeights[index]!;
          }
          drawPanel(panel, panel.summary, 0, afterDetails, panelWidth);
          drawPanel(panel, panel.settings, 0, afterDetails - summaryHeight - 8, panelWidth);
        }
      }
      const table = pageIndex ? afterTitle : firstTable;
      rule(table);
      headings.forEach((text, index) => cell(text, index, table, bilingual && index ? tableHeader / 2 : tableHeader,
        index === FILE_COLUMN ? direction : 'center'));
      if (translatedHeadings) translatedHeadings.forEach((text, index) =>
        cell(text, index + 1, table - tableHeader / 2, tableHeader / 2, index + 1 === FILE_COLUMN ? 'ltr' : 'center'));
      rule(table - tableHeader);
      for (const { top, height, cells } of positioned) {
        cells.forEach((content, column) => cell(content, column, top, height, column === FILE_COLUMN ? direction : 'center'));
        rule(top - height);
      }
      if (footer) addText(page, footer, MARGIN, MARGIN + footer.height, WIDTH, 'center', resources);
    }
  } catch (cause) {
    if (cause instanceof CoverSheetError) throw cause;
    throw new CoverSheetError('cover-sheet-export-failed', { cause });
  }
}
