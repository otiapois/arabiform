import { PDFDocument } from 'pdf-lib';
import { copyBundledFont } from '../pdf/bundled-fonts';
import { addCoverText, createCoverTextLayout } from '../pdf/merge-cover';
import type { FontBytes } from '../pdf/shaping';
import { key } from '../pdf/template';
import type { PacketDocument } from './types';

const PAPER: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const WIDTH = PAPER[0] - 2 * MARGIN;
const PAGE_COLUMN = 108;
const TITLE_COLUMN = WIDTH - PAGE_COLUMN - 20;

export async function createPacketCover(documents: readonly PacketDocument[], fonts: FontBytes) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(PAPER);
  const arabic = await copyBundledFont(doc, fonts, 'arabic', 'ArabiFormPacketArabic');
  const latin = await copyBundledFont(doc, fonts, 'latin', 'ArabiFormPacketLatin');
  const resources = {
    arabic: { name: 'ArabiFormPacketArabic', ref: arabic },
    latin: { name: 'ArabiFormPacketLatin', ref: latin },
  };
  for (const { name, ref } of Object.values(resources)) page.node.setFontDictionary(key(name), ref);

  const layout = createCoverTextLayout(fonts);
  const titleEn = layout('Packet Document Index', 20, WIDTH / 2, 'ltr');
  const titleAr = layout('فِهْرِسُ مُسْتَنَدَاتِ الحُزْمَةِ', 20, WIDTH / 2, 'rtl');
  const documentEn = layout('Document', 11, TITLE_COLUMN, 'ltr');
  const documentAr = layout('المستند', 11, TITLE_COLUMN, 'rtl');
  const pageEn = layout('Start page', 11, PAGE_COLUMN, 'ltr');
  const pageAr = layout('صفحة البداية', 11, PAGE_COLUMN, 'rtl');
  addCoverText(page, titleEn, MARGIN, 776, WIDTH / 2, 'ltr', resources);
  addCoverText(page, titleAr, MARGIN + WIDTH / 2, 776, WIDTH / 2, 'rtl', resources);
  addCoverText(page, documentEn, MARGIN, 714, TITLE_COLUMN, 'ltr', resources);
  addCoverText(page, documentAr, MARGIN, 695, TITLE_COLUMN, 'ltr', resources);
  addCoverText(page, pageEn, MARGIN + WIDTH - PAGE_COLUMN, 714, PAGE_COLUMN, 'center', resources);
  addCoverText(page, pageAr, MARGIN + WIDTH - PAGE_COLUMN, 695, PAGE_COLUMN, 'center', resources);

  let top = 655;
  for (const { title, startPage } of documents) {
    const label = layout(title, 12, TITLE_COLUMN, 'filename');
    const number = layout(String(startPage), 12, PAGE_COLUMN, 'ltr');
    const height = Math.max(label.height, number.height);
    if (top - height < MARGIN) throw new Error('cover-sheet-layout-overflow');
    addCoverText(page, label, MARGIN, top, TITLE_COLUMN, 'ltr', resources);
    addCoverText(page, number, MARGIN + WIDTH - PAGE_COLUMN, top, PAGE_COLUMN, 'center', resources);
    top -= height + 18;
  }
  return doc;
}
