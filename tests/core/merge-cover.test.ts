import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFStream, type PDFPage } from 'pdf-lib';
import { beforeAll, expect, it } from 'vitest';
import { createMergedPdf, type MergeCoverOptions } from '../../src/core/pdf';
import { createCustodyManifest, sha256 } from '../../src/core/audit/custody';
import { impositionLayout } from '../../src/core/pdf/imposition';
import { createBatchProcessor } from '../../src/core/worker/batch';

const key = PDFName.of;
const decoder = new TextDecoder();
const templateName = 'نَمُوذَج 00123.pdf';
const longName = `00123-${'يَاسِين'.repeat(14)}-${'W'.repeat(50)}.pdf`;
let preflight: MergeCoverOptions['preflight'];
let sources: Uint8Array[];

beforeAll(async () => {
  const assets = process.env.ARABIFORM_ASSET_ROOT ?? '.';
  preflight = { minFontSize: 7.25, preferredFont: 'arabic', fonts: {
    arabic: await readFile(resolve(assets, 'public/fonts/NotoNaskhArabic-Regular.ttf')),
    latin: await readFile(resolve(assets, 'public/fonts/NotoSans-Regular.ttf')),
  } };
  sources = await Promise.all([1, 2, 3].map(async (numPages) => {
    const doc = await PDFDocument.create();
    const first = doc.addPage([160, 120]);
    const field = doc.getForm().createTextField('ID');
    field.addToPage(first, { x: 40, y: 60, width: 80, height: 20 });
    field.setText('00123');
    for (let index = 1; index < numPages; index++) doc.addPage([160 + index, 120]);
    return doc.save();
  }));
});

function readCover(page: PDFPage) {
  const contents = page.node.lookup(key('Contents'), PDFArray);
  const text = contents.asArray().map((ref) => {
    const stream = page.doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) throw new Error('Missing cover stream');
    return decoder.decode(decodePDFRawStream(stream).decode());
  }).join('\n');
  return [...text.matchAll(/\/ActualText <([0-9A-F]+)> >> BDC\n([\s\S]*?)\nEMC/g)].map(([, hex, operators]) => ({
    text: PDFHexString.of(hex!).decodeText(), lines: operators!.match(/\bBT\n/g)?.length ?? 0,
    fontRuns: [...operators!.matchAll(/\/(ArabiFormCover\w+) \d+ Tf/g)].map((match) => match[1]),
  }));
}

function fullFontSize(page: PDFPage, resource: string) {
  const fonts = page.node.Resources()!.lookup(key('Font'), PDFDict);
  const descriptor = fonts.lookup(key(resource), PDFDict).lookup(key('DescendantFonts'), PDFArray)
    .lookup(0, PDFDict).lookup(key('FontDescriptor'), PDFDict);
  const file = descriptor.lookup(key('FontFile2'));
  if (!(file instanceof PDFRawStream)) throw new Error('Missing cover font');
  return decodePDFRawStream(file).decode().length;
}

it('packs selected rows in roster order, shares a physical sheet in the bilingual index and fingerprints the exact worksheet', async () => {
  const template = sources[0]!;
  const roster = await readFile('fixtures/m13/multi-sheet-roster.xlsx');
  const batch = createBatchProcessor();
  const rows = ['00123', '00007', '00042', '00009', '00025'].map((ID) => ({ ID }));
  const checked = await batch({ phase: 'preflight', input: { template, roster, rows, sheetName: 'Roster_AR', options: preflight } }, () => {});
  expect(checked && 'custody' in checked && JSON.parse(createCustodyManifest(checked.custody))).toEqual({
    version: 1, templateSha256: await sha256(template), rosterSha256: await sha256(roster), sheetName: 'Roster_AR',
  });
  const filenames = rows.map(({ ID }) => `${ID}.pdf`);
  const result = await batch({ phase: 'merged', imposition: '2-up', rowSelection: [5, 2, 4, 5],
    coverSheet: { templateName, locale: 'en', coverLanguage: 'bilingual', filenames } }, () => {});
  if (!result || !('bytes' in result)) throw new Error('Missing batch output');
  const pdf = await PDFDocument.load(result.bytes);
  expect(pdf.getPageCount()).toBe(3);
  expect(readCover(pdf.getPage(0)).map(({ text }) => text).slice(-12)).toEqual([
    '1', '2', '00007.pdf', '2', '2', '4', '00009.pdf', '2', '3', '5', '00025.pdf', '3',
  ]);
  expect(readCover(pdf.getPage(0)).map(({ text }) => text)).toEqual(expect.arrayContaining(['Sheets', 'الأوراق']));
  expect(pdf.catalog.has(key('AcroForm'))).toBe(false);
  for (const [index, page] of pdf.getPages().slice(1).entries()) {
    expect(page.getRotation().angle).toBe(0);
    expect(page.node.Annots()?.size() ?? 0).toBe(0);
    const records = page.node.Resources()!.lookup(key('XObject'), PDFDict);
    expect(records.keys()).toHaveLength(2 - index);
    expect(records.keys().every((name) => records.lookup(name, PDFStream).dict.get(key('Subtype')) === key('Form'))).toBe(true);
  }
});

it('checks the extreme aspect ratio candidates and only permits 2-up for printable single-page records', async () => {
  expect(impositionLayout(1000, 250).layout).toEqual({ width: 841.89, height: 595.28, sideBySide: false });
  expect(impositionLayout(250, 1000).layout).toEqual({ width: 595.28, height: 841.89, sideBySide: true });
  const rows = [{ filename: 'record.pdf', pdfBytes: sources[1]! }];
  expect((await PDFDocument.load(await createMergedPdf(rows))).getPageCount()).toBe(2);
  await expect(createMergedPdf(rows, undefined, undefined, undefined, undefined, '2-up')).rejects.toThrow('imposition-requires-single-page');

  const annotated = await PDFDocument.load(sources[0]!);
  annotated.getPage(0).node.addAnnot(annotated.context.register(annotated.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 20, 20], F: 4,
  })));
  const annotatedRows = [{ filename: 'annotated.pdf', pdfBytes: await annotated.save() }];
  expect((await PDFDocument.load(await createMergedPdf(annotatedRows))).getPage(0).node.Annots()?.size()).toBe(1);
  await expect(createMergedPdf(annotatedRows, undefined, undefined, undefined, undefined, '2-up')).rejects.toThrow('imposition-unsupported-print-annotation');
});

it.each([1, 25, 80])('creates a complete printable index for %i mixed-page rows', async (count) => {
  const rows = Array.from({ length: count }, (_, index) => ({
    filename: `${index + 1}-${longName}`, pdfBytes: sources[index % 3]!,
  }));
  const rowNumbers = rows.map((_, index) => 2 * index + 2);
  const onProgress: [number, number][] = [];
  const en = count === 1;
  const pdf = await PDFDocument.load(await createMergedPdf(rows, (complete, total) => onProgress.push([complete, total]), {
    locale: en ? 'en' : 'ar', templateName, rowNumbers, flagged: count, skipped: count,
    exportedAt: new Date(2026, 10, 27, 23, 59),
    preflight: en ? preflight : { ...preflight, customFont: preflight.fonts.latin },
  }));
  const coverPages = pdf.getPages().filter((page) => page.getSize().width === 595.28);
  expect(coverPages.length).toBeGreaterThanOrEqual(en ? 1 : count === 25 ? 2 : 3);
  expect(pdf.getPages().slice(0, coverPages.length)).toEqual(coverPages);
  expect(pdf.catalog.has(key('AcroForm'))).toBe(false);
  expect(onProgress).toEqual(Array.from({ length: count + 1 }, (_, complete) => [complete, count]));
  const title = en ? 'ArabiForm · Batch Print Manifest' : 'ArabiForm · سجل طباعة الدفعة';
  const headings = en ? ['#', 'Row', 'Filename', 'Pages'] : ['#', 'الصف', 'اسم الملف', 'الصفحات'];
  const firstMetadata = en ? ['Export date', '2026-11-27', 'Template', templateName,
    'Ready: 1   ·   Flagged: 1   ·   Skipped: 1', 'Min font size: 7.25 pt   ·   Font mode: Arabic']
    : ['تاريخ التصدير', '2026-11-27', 'القالب', templateName,
      `جاهز: ${count}   ·   يحتاج إلى مراجعة: ${count}   ·   تم تخطيه: ${count}`, 'الحد الأدنى لحجم الخط: 7.25 نقطة   ·   وضع الخط: مخصص'];
  let nextRow = 0;
  let nextPage = coverPages.length + 1;
  for (const [index, page] of coverPages.entries()) {
    expect(page.getSize().height).toBe(841.89);
    const spans = readCover(page);
    const header = [title, ...(index ? [] : firstMetadata), ...headings];
    expect(spans.slice(0, header.length).map(({ text }) => text)).toEqual(header);
    if (!index) expect(spans.find(({ text }) => text === templateName)?.fontRuns).toEqual(['ArabiFormCoverArabic', 'ArabiFormCoverLatin']);
    const cells = spans.slice(header.length);
    expect(cells.length % 4).toBe(0);
    for (let index = 0; index < cells.length; index += 4) {
      const endPage = nextPage + (nextRow % 3);
      expect(cells.slice(index, index + 4).map(({ text }) => text)).toEqual([
        String(nextRow + 1), String(rowNumbers[nextRow]), rows[nextRow]!.filename,
        nextPage === endPage ? String(nextPage) : `${nextPage}–${endPage}`,
      ]);
      expect(cells[index + 2]!.lines).toBeGreaterThan(1);
      nextRow++;
      nextPage = endPage + 1;
    }
    expect(fullFontSize(page, 'ArabiFormCoverArabic')).toBe(preflight.fonts.arabic.length);
    expect(fullFontSize(page, 'ArabiFormCoverLatin')).toBe(preflight.fonts.latin.length);
  }
  expect(nextRow).toBe(count);
  expect(pdf.getPageCount()).toBe(nextPage - 1);
  for (const page of pdf.getPages().slice(coverPages.length)) expect(page.node.Annots()?.size() ?? 0).toBe(0);
}, 40_000);

it('fails the optional cover safely when its text cannot be rendered', async () => {
  const options: MergeCoverOptions = {
    locale: 'en', templateName, exportedAt: new Date(), preflight, rowNumbers: [1], flagged: 0, skipped: 0,
  };
  const rows = [{ filename: '🙂.pdf', pdfBytes: sources[0]! }];
  await expect(createMergedPdf(rows, undefined, options)).rejects.toThrow(/^cover-sheet-unsupported-text$/);
  await expect(createMergedPdf([{ ...rows[0]!, filename: 'file.pdf' }], undefined, {
    ...options, templateName: 'private\u202ename.pdf',
  })).rejects.toThrow(/^cover-sheet-unsupported-text$/);
  await expect(createMergedPdf(rows, undefined, { ...options, rowNumbers: [] })).rejects.toThrow(/^cover-sheet-invalid-metadata$/);
  expect((await PDFDocument.load(await createMergedPdf(rows))).getPageCount()).toBe(1);
});
