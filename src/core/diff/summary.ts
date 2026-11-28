import { PDFDocument, rgb } from 'pdf-lib';
import { copyBundledFont } from '../pdf/bundled-fonts';
import { addCoverText, createCoverTextLayout } from '../pdf/merge-cover';
import type { FontBytes } from '../pdf/shaping';
import { key } from '../pdf/template';
import type { BatchDiffAudit } from './batch-diff';

export const DELTA_SUMMARY_FILENAME = 'delta-reprint-summary.pdf';
const PAPER: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const WIDTH = PAPER[0] - MARGIN * 2;
const GUTTER = 24;
const COLUMN_WIDTH = (WIDTH - GUTTER) / 2;
const RULE = rgb(0.62, 0.67, 0.65);

export async function buildBatchDiffSummary({ counts, reprint }: Pick<BatchDiffAudit, 'counts' | 'reprint'>,
  fonts: FontBytes): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle('Delta Reprint Summary');
  const page = doc.addPage(PAPER);
  const [arabic, latin] = await Promise.all([
    copyBundledFont(doc, fonts, 'arabic', 'ArabiFormDeltaArabic'),
    copyBundledFont(doc, fonts, 'latin', 'ArabiFormDeltaLatin'),
  ]);
  const resources = {
    arabic: { name: 'ArabiFormDeltaArabic', ref: arabic },
    latin: { name: 'ArabiFormDeltaLatin', ref: latin },
  };
  for (const { name, ref } of Object.values(resources)) page.node.setFontDictionary(key(name), ref);
  const layout = createCoverTextLayout(fonts);
  const draw = (english: string, arabic: string, top: number, size: number, bandHeight: number) => {
    for (const [text, direction, x] of [
      [english, 'ltr', MARGIN],
      [arabic, 'rtl', MARGIN + COLUMN_WIDTH + GUTTER],
    ] as const) {
      const line = layout(text, size, COLUMN_WIDTH, direction);
      if (line.height > bandHeight || top - line.height < MARGIN) throw new Error('summary-layout-overflow');
      addCoverText(page, line, x, top, COLUMN_WIDTH, direction, resources);
    }
  };
  const rule = (y: number) => page.drawLine({
    start: { x: MARGIN, y }, end: { x: PAPER[0] - MARGIN, y }, thickness: 0.75, color: RULE,
  });
  draw('Delta Reprint Summary', 'مُلَخَّصُ إِعَادَةِ الطِّبَاعَةِ', 778, 20, 42);
  rule(724);
  const rows = [
    ['Unchanged', 'دون تغيير', counts.unchanged],
    ['Modified', 'مُعدَّلة', counts.modified],
    ['Added', 'مُضافة', counts.added],
    ['Removed', 'محذوفة', counts.removed],
    ['New batch sheets', 'أوراق الدفعة الجديدة', reprint.fullPages],
    ['Reprint sheets', 'أوراق إعادة الطباعة', reprint.deltaPages],
    ['Sheets saved', 'الأوراق المُوفَّرة', reprint.savedPages],
  ] as const;
  for (const [index, [en, ar, value]] of rows.entries()) draw(`${en}: ${value}`, `${ar}: ${value}`, 694 - index * 49, 14, 38);
  rule(356);
  const percent = reprint.savingsPercent === null ? null : Number(reprint.savingsPercent.toFixed(2));
  draw(`Reprint savings: ${percent === null ? 'n/a' : percent + '%'}`,
    `التوفير في الطباعة: ${percent === null ? 'غير متاح' : percent + '٪'}`, 320, 17, 48);
  draw('One PDF page per sheet.', 'كل صفحة من الملف تُطبع على ورقة واحدة.', 255, 11, 42);
  return doc.save({ updateFieldAppearances: false });
}
