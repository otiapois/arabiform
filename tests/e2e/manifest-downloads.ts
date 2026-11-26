import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { expect } from './browser';
import { choicesFixture, riyadh } from './choices-downloads';
import { download } from './downloads';

export async function verifyManifestDownload(page: Page, dir: string, language: 'en' | 'ar') {
  const en = language === 'en';
  const mergeButton = en ? 'Download Merged Printable PDF' : 'نزّل ملف PDF مدمجًا للطباعة';
  const cover = page.getByTestId('include-cover-sheet');
  await expect(cover).toHaveAccessibleName(en ? 'Include printable cover sheet in Merged PDF' : 'أدرج صفحة غلاف قابلة للطباعة في ملف PDF المدمج');
  await expect(cover).not.toBeChecked();
  await expect(page.getByTestId('flatten-zip')).not.toBeChecked();
  const employees = ['مُحَمَّد 00123', 'Layla 00007'];
  const filenames = employees.map(name => name.normalize('NFC') + '.pdf');
  const queue = page.getByTestId('queue-row');
  await expect(queue).toHaveCount(3);
  for (const [index, name] of filenames.entries()) {
    await expect(queue.nth(index + 1)).toHaveAttribute('data-row', String(index + 2));
    await expect(queue.nth(index + 1).locator('.filename')).toHaveText(name);
  }
  const zip = await download(page, en ? 'Download Clean PDFs (.zip)' : 'نزّل ملفات PDF الجاهزة (ZIP)', dir, 'arabiform-clean.zip');
  const members = unzipSync(await readFile(zip));
  expect(Object.keys(members)).toEqual(filenames);
  const cases = [];
  for (const [index, filename] of filenames.entries()) {
    const bytes = members[filename]!;
    await writeFile(join(dir, filename), bytes);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getForm().getTextField('Employee').getText()).toBe(employees[index]);
    const isSecondRow = index === 0;
    const checkbox = isSecondRow ? 'Off' : 'Yes';
    const clinic = isSecondRow ? 'RIY' : 'JED';
    const contact = isSecondRow ? 'MAIL' : 'CALL';
    cases.push({
      before: choicesFixture('pdf'), after: filename,
      values: { Employee: employees[index], Acknowledged: checkbox, Clinic: clinic, Contact: contact },
      checkboxes: { Acknowledged: checkbox }, dropdowns: { Clinic: { label: isSecondRow ? riyadh : 'Jeddah Clinic' } },
      radios: { Contact: { state: isSecondRow ? '1' : '0', widgets: isSecondRow ? ['Off', '1'] : ['0', 'Off'] } },
    });
  }
  const plain = await download(page, mergeButton, join(dir, 'plain'), 'arabiform-merged.pdf');
  expect((await PDFDocument.load(await readFile(plain))).getPageCount()).toBe(4);
  await cover.check();
  const presetPath = await download(page, en ? 'Export mapping preset' : 'صدّر إعدادات الربط', dir, 'arabiform-mapping-preset.json');
  expect(JSON.parse(await readFile(presetPath, 'utf8'))).toMatchObject({ version: 3, includeCoverSheet: true, flattenZip: false });
  await cover.uncheck();
  await page.getByTestId('preset-upload').setInputFiles(presetPath);
  await expect(cover).toBeChecked();
  await expect(page.getByTestId('ready-count')).toHaveText('2');
  // Collect the browser's local calendar date, including the real export if it spans midnight.
  const localDate = () => page.evaluate(() => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  let date = await localDate();
  let covered = await download(page, mergeButton, join(dir, 'covered'), 'arabiform-merged.pdf');
  const afterExport = await localDate();
  if (date !== afterExport) {
    date = afterExport;
    covered = await download(page, mergeButton, join(dir, 'covered'), 'arabiform-merged.pdf');
  }
  const printed = await PDFDocument.load(await readFile(covered));
  expect(printed.getPageCount()).toBe(5);
  expect(printed.catalog.has(PDFName.of('AcroForm'))).toBe(false);
  const fonts = printed.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
  for (const [key, source] of [['ArabiFormCoverArabic', 'NotoNaskhArabic-Regular.ttf'], ['ArabiFormCoverLatin', 'NotoSans-Regular.ttf']] as const) {
    const font = fonts.lookup(PDFName.of(key), PDFDict).lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const stream = font.lookup(PDFName.of('FontDescriptor'), PDFDict).lookup(PDFName.of('FontFile2'));
    if (!(stream instanceof PDFRawStream)) throw new Error(key + ' does not contain an embedded font stream');
    expect(Buffer.from(decodePDFRawStream(stream).decode()).equals(await readFile(resolve('public/fonts', source)))).toBe(true);
  }
  const manifest = join(dir, 'manifest.json');
  const expectedText = {
    title: en ? 'ArabiForm · Batch Print Manifest' : 'ArabiForm · سجل طباعة الدفعة',
    headings: en ? ['#', 'Row', 'Filename', 'Pages'] : ['#', 'الصف', 'اسم الملف', 'الصفحات'],
    details: en ? ['Export date', date, 'Template', 'multi-page-hr-choices.pdf',
      'Ready: 2   ·   Flagged: 1   ·   Skipped: 1', 'Min font size: 8 pt   ·   Font mode: Auto']
      : ['تاريخ التصدير', date, 'القالب', 'multi-page-hr-choices.pdf',
        'جاهز: 2   ·   يحتاج إلى مراجعة: 1   ·   تم تخطيه: 1', 'الحد الأدنى لحجم الخط: 8 نقطة   ·   وضع الخط: تلقائي'],
    filenames, rowNumbers: [2, 3], wrappedFilenames: [],
  };
  await writeFile(manifest, JSON.stringify({ cases, coveredMerged: [{ pdf: covered, plainPdf: plain, rows: filenames, coverPages: 1, expectedText }] }, null, 2));
  const receipt = execFileSync('python', ['scripts/verify-pdf-pixels.py', manifest], { encoding: 'utf8', windowsHide: true });
  expect(receipt).toContain('1 covers with 0 clipped pixels, 2 exact index rows, 4 identical form pages with and without a cover');
}
