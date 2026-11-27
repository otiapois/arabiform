import type { Locator, Page, TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, rgb, StandardFonts } from 'pdf-lib';
import { expect, noOverflow, test } from './browser';
import { auditPage } from './m10-accessibility';

const eastern = '٠٠١٢٣', mixed = '۰0١۲3', sentinel = 'KEEP 00109';
const labels = { labelEn: 'Training Office', labelAr: 'مكتب التدريب', issueDate: '2026-11-28' };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const key = PDFName.of;
const row = (page: Page, field: string) => page.locator('[data-mapping-field="' + field + '"]');
const seal = (page: Page, control: string) => page.getByTestId('approval-seal-' + control);

async function specimen() {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date('2026-11-28T00:00:00Z'));
  doc.setModificationDate(new Date('2026-11-28T00:00:00Z'));
  const page = doc.addPage([540, 340]), rotated = doc.addPage([340, 540]);
  rotated.setRotation(degrees(90));
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(.10, .30, .24), lightGreen = rgb(.88, .93, .90);
  page.drawRectangle({ x: 0, y: 335, width: 540, height: 5, color: green });
  page.drawText('Training attendance', { x: 26, y: 237, size: 29, font: bold, color: green });
  page.drawText('Synthetic Sample   /   Local print proof', { x: 27, y: 215, size: 12, color: green });
  page.drawLine({ start: { x: 26, y: 196 }, end: { x: 514, y: 196 }, thickness: 1, color: lightGreen });
  page.drawText('Attendance notes', { x: 27, y: 169, size: 13, font: bold, color: green });
  page.drawText('Record ID', { x: 367, y: 169, size: 13, font: bold, color: green });
  const form = doc.getForm();
  for (const [name, x, y, width, height] of [
    ['Sentinel', 15, 294, 112, 24], ['Notes', 26, 83, 319, 76], ['ID', 366, 112, 147, 47],
  ] as const) {
    const field = form.createTextField(name);
    if (name === 'Notes') field.enableMultiline();
    if (name === 'Sentinel') field.setText(sentinel);
    field.addToPage(page, { x, y, width, height, borderWidth: 1, borderColor: green });
    field.setFontSize(name === 'Sentinel' ? 11 : 21);
  }
  rotated.drawText('Synthetic Sample / Continuation', { x: 170, y: 150, size: 16, rotate: degrees(90), color: green });
  return Buffer.from(await doc.save());
}

async function download(page: Page, button: Locator, folder: string, name: string) {
  await mkdir(folder, { recursive: true });
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(file.suggestedFilename()).toBe(name);
  const path = join(folder, name);
  await file.saveAs(path);
  expect(await file.failure()).toBeNull();
  return readFile(path);
}

function pdfInZip(bytes: Uint8Array) {
  const entries = Object.entries(unzipSync(bytes)).filter(([name]) => name.endsWith('.pdf'));
  expect(entries).toHaveLength(1);
  return entries[0]!;
}

function appearance(doc: PDFDocument, name: string) {
  const field = doc.getForm().getTextField(name);
  const widget = field.acroField.getWidgets()[0]!;
  const dict = widget.dict.lookup(key('AP'), PDFDict);
  const stream = dict.lookup(key('N'));
  if (!(stream instanceof PDFRawStream)) throw new Error(name + ' lacks a normal appearance stream');
  const program = Buffer.from(decodePDFRawStream(stream).decode()).toString('ascii');
  return { value: field.getText(), raw: field.acroField.dict.get(key('V'))!.toString(),
    ap: dict.toString(), compressed: sha(stream.getContents()), bbox: stream.dict.lookup(key('BBox'), PDFArray).asRectangle(),
    text: [...program.matchAll(/\/ActualText <([0-9A-F]+)>/g)].map(m => PDFHexString.of(m[1]!).decodeText()),
    lines: program.split(/\bBT\b/).slice(1).map(part => {
      const m = /1 0 0 1 ([.\d-]+) ([.\d-]+) Tm/.exec(part)!;
      return { x: Number(m[1]), y: Number(m[2]) };
    }) };
}

function pageMarks(doc: PDFDocument) {
  return doc.getPages().map(page => {
    const contents = page.node.Contents()!;
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => doc.context.lookup(ref)) : [contents];
    const programs = streams.map(stream => {
      expect(stream).toBeInstanceOf(PDFRawStream);
      return Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString('ascii');
    });
    const marked = programs.filter(program => program.includes('/ActualText ' + PDFHexString.fromText(labels.labelEn)));
    const sealProgram = marked.join('\n');
    return { rotation: page.getRotation().angle, sealPrograms: marked.length,
      text: [...sealProgram.matchAll(/\/ActualText <([\dA-F]+)>/g)].map(m => PDFHexString.of(m[1]!).decodeText()),
      strokes: (sealProgram.match(/\bre\s+S\b/g) ?? []).length,
      filledRectangles: (programs.join('\n').match(/\bre\b/g) ?? []).length };
  });
}

// The bottom-right corner on page one is deliberately blank in the source.
async function cornerPixels(canvas: Locator) {
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const { width, height } = el;
    const pixels = el.getContext('2d')!.getImageData(0, 0, width, height).data;
    const left = Math.floor(width * (540 - 138) / 540), top = Math.floor(height * (340 - 56) / 340);
    let ink = 0;
    for (let y = top; y < height; y++) for (let x = left; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] === 255 && Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) < 205) ink++;
    }
    return { ink, width, height };
  });
}

async function capture(page: Page, info: TestInfo, name: string) {
  const dir = process.env.ARABIFORM_CAPTURE_M20_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m20') : info.outputPath('screenshots');
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const canvas = page.locator('.preview-bed canvas');
  await page.locator('#preview-heading').evaluate(el => {
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -15, behavior: 'instant' });
  });
  await expect(canvas).toBeInViewport({ ratio: .98 });
  await page.screenshot({ path: join(dir, name), animations: 'disabled' });
}

for (const locale of ['en', 'ar'] as const) {
  test('M20 ' + locale + ' converts field values, spaces real multiline ink and prints a collision-checked bilingual seal', async ({ page }, info) => {
    const ar = locale === 'ar';
    const requests: string[] = [];
    page.context().on('request', req => requests.push(new URL(req.url()).pathname));
    await page.goto(ar ? '/ar/pdf-mail-merge' : '/', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
    const idle = [...requests];
    expect(idle.filter(path => /\.m?js$/i.test(path))).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
    await noOverflow(page);
    const source = await specimen();
    const roster = Buffer.from('Notes,ID,Group\r\n"00123\n' + mixed + '",0۰1٢3,Training\r\n');
    await mkdir(info.outputDir, { recursive: true });
    await writeFile(info.outputPath('template.pdf'), source);
    await writeFile(info.outputPath('roster.csv'), roster);
    await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic training form.pdf', mimeType: 'application/pdf', buffer: source });
    await page.getByTestId('roster-upload').setInputFiles({ name: 'Synthetic training roster.csv', mimeType: 'text/csv', buffer: roster });
    await expect(page.getByTestId('ready-count')).toHaveText('1');
    const notes = row(page, 'Notes'), id = row(page, 'ID');
    for (const field of [notes, id]) {
      await field.getByTestId('field-formatting-toggle').click();
      await expect(field.getByTestId('digits-policy')).toHaveValue('preserve');
    }
    await notes.getByTestId('digits-policy').selectOption('eastern-arabic');
    await id.getByTestId('digits-policy').selectOption('western-ascii');
    await notes.getByTestId('padding-pt').selectOption('2');
    const zip = page.getByTestId('download-zip'), flat = page.getByTestId('flatten-zip');
    const grabZip = (variant: string) => download(page, zip, info.outputPath(variant), 'arabiform-clean.zip');
    const tightDoc = await PDFDocument.load(pdfInZip(await grabZip('spacing-reference'))[1]);
    const reference = appearance(tightDoc, 'Notes');
    await notes.getByTestId('line-height-scale').selectOption('1.3');
    await notes.getByTestId('padding-pt').selectOption('6');
    await page.getByTestId('group-by-column').selectOption('Group');
    const pattern = page.locator('input.pattern-input:not([data-testid="qr-stamp-pattern"])');
    await pattern.fill('source-{{ID}}.pdf');
    const canvas = page.locator('.preview-bed canvas');
    if (info.project.name === 'desktop') await page.getByRole('combobox', { name: ar ? 'تكبير المعاينة' : 'Preview zoom' }).selectOption('1');
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    const blank = await cornerPixels(canvas);
    expect(blank.ink).toBe(0);
    await page.getByTestId('qr-stamp-toggle').click();
    await page.getByTestId('qr-stamp-placement').selectOption('bottom-left');
    await page.getByTestId('qr-stamp-pattern').fill('training-{{ID}}');
    await expect(page.getByTestId('qr-stamp-preview')).toBeVisible();
    await seal(page, 'toggle').click();
    await seal(page, 'enabled').check();
    await seal(page, 'label-en').fill(labels.labelEn);
    await seal(page, 'label-ar').fill(labels.labelAr);
    await seal(page, 'issue-date').fill(labels.issueDate);
    const merged = page.getByRole('button', { name: ar ? 'نزّل ملف PDF مدمجًا للطباعة' : 'Download Merged Printable PDF', exact: true });
    const split = page.getByTestId('download-split');
    await expect(merged).toBeEnabled();
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await expect.poll(async () => (await cornerPixels(canvas)).ink).toBeGreaterThan(100);
    for (const [corner, code] of [['top-left', 'approval-seal-widget-overlap'], ['bottom-left', 'approval-seal-qr-overlap']]) {
      await seal(page, 'corner').selectOption(corner!);
      await expect(seal(page, 'status')).toHaveAttribute('data-code', code!);
      if (corner === 'top-left') await expect(seal(page, 'status')).toContainText('Sentinel');
      await expect(canvas).toBeHidden();
      await expect(merged).toBeDisabled();
      await expect(split).toBeDisabled();
      await expect(zip).toBeEnabled();
      await flat.check();
      await expect(zip).toBeDisabled();
      await flat.uncheck();
    }
    await seal(page, 'corner').selectOption('bottom-right');
    await expect(merged).toBeEnabled();
    await expect(split).toBeEnabled();
    await expect(seal(page, 'status')).toHaveText('');
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await expect(canvas).toBeVisible();
    await expect.poll(async () => (await cornerPixels(canvas)).ink).toBeGreaterThan(100);
    const stamped = await cornerPixels(canvas);
    const accessibility = await auditPage(page, 'workbench');
    await noOverflow(page);
    if (info.project.name === 'desktop' || ar) {
      await capture(page, info, info.project.name === 'desktop' ? 'desktop-m20-numerals-seal-' + locale + '.png' : 'mobile-m20-seal.png');
    }
    const [filename, member] = pdfInZip(await grabZip('editable'));
    expect(filename).toBe('Training/source-0۰1٢3.pdf');
    const editable = await PDFDocument.load(member), sourceDoc = await PDFDocument.load(source);
    const appearanceNotes = appearance(editable, 'Notes'), appearanceId = appearance(editable, 'ID');
    expect(appearanceNotes.value).toBe(eastern + '\n' + eastern);
    expect(appearanceNotes.raw).toBe(PDFHexString.fromText(appearanceNotes.value!).toString());
    expect(appearanceNotes.text).toEqual([eastern, eastern]);
    expect(appearanceId.value).toBe('00123');
    expect(appearanceId.text).toEqual(['00123']);
    expect(appearance(editable, 'Sentinel')).toEqual(appearance(sourceDoc, 'Sentinel'));
    expect(appearanceNotes.bbox).toEqual(reference.bbox);
    expect(appearanceNotes.lines).toHaveLength(2);
    expect(reference.lines).toHaveLength(2);
    const span = (lines: typeof reference.lines) => Math.abs(lines[0]!.y - lines[1]!.y);
    expect(span(appearanceNotes.lines) / span(reference.lines)).toBeCloseTo(1.3, 4);
    expect(Math.abs(appearanceNotes.lines[0]!.x - reference.lines[0]!.x)).toBeCloseTo(4, 2);
    expect(pageMarks(editable).map(p => p.sealPrograms)).toEqual([0, 0]);
    const preset = await download(page, page.getByTestId('preset-download'), info.outputPath('saved'), 'arabiform-mapping-preset.json');
    const saved = JSON.parse(preset.toString('utf8'));
    expect(saved).toMatchObject({ version: 10, approvalSeal: { ...labels, placement: 'bottom-right' },
      fieldTypography: { Notes: { numeralPolicy: 'eastern-arabic', lineHeightScale: 1.3, paddingPt: 6 }, ID: { numeralPolicy: 'western-ascii' } } });
    await flat.check();
    const flatBytes = pdfInZip(await grabZip('flat'))[1];
    const mergedBytes = await download(page, merged, info.outputPath('combined'), 'arabiform-merged.pdf');
    const splitBytes = pdfInZip(await download(page, split, info.outputPath('group'), 'arabiform-split-merged.zip'))[1];
    const prints = [];
    for (const bytes of [flatBytes, mergedBytes, splitBytes]) {
      const printed = await PDFDocument.load(bytes);
      expect(printed.catalog.has(key('AcroForm'))).toBe(false);
      const pages = pageMarks(printed);
      expect(pages.map(p => p.rotation)).toEqual([0, 90]);
      for (const mark of pages) {
        expect(mark.sealPrograms).toBe(1);
        expect(mark.text).toEqual(expect.arrayContaining(Object.values(labels)));
        expect(mark.strokes).toBeGreaterThanOrEqual(2);
        expect(mark.filledRectangles).toBeGreaterThan(35);
      }
      prints.push(pages);
    }
    await seal(page, 'clear').click();
    await expect(seal(page, 'enabled')).not.toBeChecked();
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await expect.poll(async () => (await cornerPixels(canvas)).ink).toBe(0);
    const upload = page.getByTestId('preset-upload');
    for (let version = 1; version <= 9; version++) {
      const filenamePattern = 'v' + version + '-{{ID}}.pdf';
      const legacy = { version, filenamePattern, mapping: { ID: 'ID', Notes: 'Notes' }, minFontSize: 8, font: 'auto',
        ...(version >= 2 && { flattenZip: false }), ...(version >= 3 && { includeCoverSheet: false }),
        ...(version >= 4 && { alignOverrides: {} }), ...(version >= 5 && { watermark: { kind: 'none' } }),
        ...(version >= 6 && { virtualMappings: {} }), ...(version >= 7 && { qrStamp: { placement: 'none' }, coverLanguage: 'auto' }),
        ...(version >= 8 && { imposition: '1-up' }), ...(version >= 9 && { groupByColumn: null }) };
      await upload.setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
      await expect(pattern).toHaveValue(filenamePattern);
      if (!(await notes.getByTestId('digits-policy').isVisible())) await notes.getByTestId('field-formatting-toggle').click();
      await expect(notes.getByTestId('digits-policy')).toHaveValue('preserve');
      await expect(notes.getByTestId('line-height-scale')).toHaveValue('1');
      await expect(notes.getByTestId('padding-pt')).toHaveValue('');
    }
    await upload.setInputFiles({ name: 'restored.json', mimeType: 'application/json', buffer: preset });
    await expect(pattern).toHaveValue(saved.filenamePattern);
    await expect(merged).toBeEnabled();
    await expect.poll(async () => (await cornerPixels(canvas)).ink).toBe(stamped.ink);
    const restored = await download(page, page.getByTestId('preset-download'), info.outputPath('restored'), 'arabiform-mapping-preset.json');
    expect(JSON.parse(restored.toString('utf8'))).toEqual(saved);
    await noOverflow(page);
    await writeFile(info.outputPath('typography-seal.json'), JSON.stringify({ idle, sourceSha256: sha(source), rosterSha256: sha(roster),
      reference, appearanceNotes, appearanceId, sentinel: appearance(editable, 'Sentinel'), filename, blank, stamped, accessibility, prints,
      oldPresetVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9], restoredPreset: saved }, null, 2));
  });
}
