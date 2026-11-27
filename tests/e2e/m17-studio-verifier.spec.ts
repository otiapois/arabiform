import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { proveQrMatrix } from '../core/qr-proof';
import { canvasInk, expect, noOverflow, test } from './browser';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const fields = {
  'hr-letter-bilingual': ['EmployeeName', 'EmployeeID', 'JobTitle', 'Department', 'StartDate', 'ActiveStatus'],
  'clinic-consent-bilingual': ['PatientName', 'NationalID', 'ClinicBranch', 'ConsentCheck', 'ContactPreference'],
  'visitor-badge-a6': ['VisitorName', 'Organization', 'BadgeID', 'AccessZone'],
  'certificate-bilingual': ['RecipientName', 'CourseTitle', 'IssueDate', 'CertificateID', 'HonorsCheck'],
};
const organization = 'مدرسة النور / Noor School';
const subtitle = 'Spring 2026 / ربيع';

async function save(page: Page, id: string, directory: string, filename: string) {
  await mkdir(directory, { recursive: true });
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId(id).click()]);
  expect(file.suggestedFilename()).toBe(filename);
  const path = join(directory, filename);
  await file.saveAs(path);
  expect(await file.failure()).toBeNull();
  return path;
}

async function capture(page: Page, info: TestInfo, name: string, anchor: Locator) {
  const directory = process.env.ARABIFORM_CAPTURE_M17_SCREENSHOTS === '1'
    ? resolve('docs/reports/screenshots/m17') : info.outputPath('screenshots');
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await anchor.evaluate(el => {
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -12, behavior: 'instant' });
  });
  await page.screenshot({ path: join(directory, name), animations: 'disabled' });
}

async function rangeOrder(control: Locator, expected: string) {
  const positions = await control.locator('bdi[dir=ltr]').evaluate(element => {
    const text = element.firstChild!;
    return Array.from(text.textContent!, (char, i) => {
      const range = document.createRange();
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const { left, top, width } = range.getBoundingClientRect();
      return { char, left, top, width };
    });
  });
  expect(positions.map(p => p.char).join('')).toBe(expected);
  expect(new Set(positions.map(p => p.top)).size).toBe(1);
  for (const [i, position] of positions.entries()) {
    expect(position.width).toBeGreaterThan(0);
    if (i) expect(position.left).toBeGreaterThan(positions[i - 1]!.left);
  }
  return positions;
}

async function canvasRaster(page: Page) {
  const canvas = page.getByTestId('studio-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  return canvas.evaluate(async (el: HTMLCanvasElement) => {
    const { width, height } = el;
    const data = el.getContext('2d')!.getImageData(0, 0, width, height);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data.data));
    return { width, height, sha256: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') };
  });
}

async function arabicControls(page: Page, directory: string) {
  await expect(page.getByRole('button', { name: 'نزّل ملفات PDF الجاهزة (ZIP)', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'نزّل تقرير الفحص (JSON)', exact: true })).toBeEnabled();
  await page.getByTestId('group-by-column').selectOption('Team');
  const folder = page.getByTestId('grouped-export-summary').locator('p bdi', { hasText: '_Ungrouped' });
  await expect(folder).toHaveAttribute('dir', 'ltr');
  const sentence = await folder.locator('..').evaluate(paragraph => {
    const range = document.createRange();
    const text = paragraph.firstChild!;
    const stop = text.textContent!.lastIndexOf('.');
    range.setStart(text, stop);
    range.setEnd(text, stop + 1);
    const dot = range.getBoundingClientRect().toJSON();
    const token = paragraph.querySelector('bdi')!;
    return { text: paragraph.textContent, dot, token: token.getBoundingClientRect().toJSON() };
  });
  expect(sentence.text).toMatch(/مجلد خاص\. اسم المجلد _Ungrouped$/);
  expect(sentence.dot.width).toBeGreaterThan(0);
  const onPreviousLine = sentence.token.top - sentence.dot.top > sentence.dot.height / 2;
  expect(onPreviousLine || sentence.dot.left > sentence.token.right).toBe(true);
  const layout = {
    split: await rangeOrder(page.getByTestId('download-split'), '(.zip)'),
    custody: await rangeOrder(page.getByTestId('custody-download'), '(.json)'),
    saveDraft: await rangeOrder(page.getByTestId('draft-download'), '(.json)'),
    loadDraft: await rangeOrder(page.getByTestId('draft-upload').locator('..'), '(.json)'),
    sentence,
  };
  await writeFile(join(directory, 'rtl-ranges.json'), JSON.stringify(layout, null, 2));
  await noOverflow(page);
  await page.getByTestId('group-by-column').selectOption('');
}

for (const ar of [false, true]) {
  test('M17 ' + (ar ? 'Arabic' : 'English') + ' local starter templates, printed custody QR and exact downloaded PDF verification', async ({ page }, info) => {
    const requested: string[] = [];
    page.context().on('request', request => requested.push(new URL(request.url()).pathname));
    await page.goto(ar ? '/ar/pdf-mail-merge' : '/', { waitUntil: 'networkidle' });
    expect(requested.filter(path => /\.m?js$/i.test(path))).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
    expect(requested.filter(path => /\.pdf$|\/assets\/[^/]*(?:pdf|qr|font)/i.test(path))).toEqual([]);
    const displayFonts = requested.filter(path => /\.(?:ttf|otf|woff2?)$|\/fonts\//i.test(path));
    expect(displayFonts.sort()).toEqual(ar ? ['/fonts/NotoNaskhArabic-Regular.ttf', '/fonts/NotoSans-Regular.ttf'] : []);
    const cold = [...requested];
    await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
    await expect(page.getByTestId('mode-fill')).toHaveAttribute('aria-pressed', 'true');
    await noOverflow(page);
    await page.getByTestId('mode-create').click();
    const dir = info.outputPath('downloads');
    await page.getByTestId('studio-organization').fill(organization);
    await page.getByTestId('studio-subtitle').fill(subtitle);
    await page.locator('input[name=studio-accent][value=navy]').check();
    const select = page.getByTestId('studio-template');
    const templateProof = [];
    for (const [id, names] of Object.entries(fields)) {
      await select.selectOption(id);
      const ink = await canvasInk(page);
      const path = await save(page, 'studio-download', dir, id + '.pdf');
      const csvPath = await save(page, 'studio-csv', dir, id + '-synthetic-sample.csv');
      const pdf = await PDFDocument.load(await readFile(path));
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getForm().getFields().map(field => field.getName()).sort()).toEqual([...names].sort());
      const parsed = Papa.parse(await readFile(csvPath, 'utf8'), { header: true, skipEmptyLines: true });
      expect(parsed.errors).toEqual([]);
      expect(parsed.meta.fields).toEqual(names);
      expect(parsed.data).toHaveLength(2);
      const contents = pdf.getPage(0).node.Contents()!;
      const streams = contents instanceof PDFArray ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
      const spans = streams.flatMap(stream => {
        expect(stream).toBeInstanceOf(PDFRawStream);
        const ops = Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString('latin1');
        return [...ops.matchAll(/\/ActualText <([0-9A-F]+)>/g)].map(m => new TextDecoder('utf-16be').decode(Buffer.from(m[1]!, 'hex')));
      });
      expect(spans).toEqual(expect.arrayContaining([organization, subtitle]));
      templateProof.push({ id, names, ink, sha256: sha(await readFile(path)) });
    }
    const certificateRaster = await canvasRaster(page);
    await noOverflow(page);
    if (info.project.name === 'desktop') {
      await capture(page, info, 'desktop-m17-template-studio-' + (ar ? 'ar' : 'en') + '.png', page.locator('#studio-heading'));
    } else if (ar) {
      await capture(page, info, 'mobile-m17-studio.png', page.getByTestId('studio-organization'));
    }
    await page.getByTestId('studio-use-fill').click();
    await expect(page.getByTestId('mode-fill')).toHaveAttribute('aria-pressed', 'true');
    const roster = Buffer.from(Papa.unparse([
      [...fields['certificate-bilingual'], 'Team'],
      ['لَيْلَى سَالِم', 'فَنُّ الخَطِّ', '2026-06-01', '00123', 'yes', 'Arts'],
      ['Maya Reed', 'Calligraphy', '2026-06-02', '00007', 'no', ''],
    ]));
    await writeFile(join(dir, 'certificate-class.csv'), roster);
    await page.getByTestId('roster-upload').setInputFiles({ name: 'certificate-class.csv', buffer: roster, mimeType: 'text/csv' });
    await expect(page.getByTestId('ready-count')).toHaveText('2');
    await page.locator('input.pattern-input').fill('{{CertificateID}}.pdf');
    if (ar) await arabicControls(page, dir);
    await page.getByTestId('qr-stamp-toggle').click();
    await page.getByTestId('qr-stamp-placement').selectOption('top-left');
    await page.getByTestId('qr-custody-record').check();
    await expect(page.getByTestId('qr-stamp-preview')).toBeVisible();
    await noOverflow(page);
    const editable = await save(page, 'download-zip', join(dir, 'editable'), 'arabiform-clean.zip');
    const oldReceiptPath = await save(page, 'custody-download', join(dir, 'editable'), 'arabiform-custody-manifest.json');
    const oldReceipt = JSON.parse(await readFile(oldReceiptPath, 'utf8'));
    expect(oldReceipt.qrRecords).toBeUndefined();
    const opened = unzipSync(await readFile(editable));
    const names = ['00123.pdf', '00007.pdf'];
    expect(Object.keys(opened)).toEqual(names);
    for (const [i, name] of names.entries()) {
      const form = (await PDFDocument.load(opened[name]!)).getForm();
      expect(form.getTextField('RecipientName').getText()).toBe(['لَيْلَى سَالِم', 'Maya Reed'][i]);
      expect(form.getTextField('CertificateID').getText()).toBe(name.slice(0, -4));
      expect(form.getCheckBox('HonorsCheck').isChecked()).toBe(i === 0);
    }
    await page.getByTestId('flatten-zip').check();
    const printed = await save(page, 'download-zip', join(dir, 'printed'), 'arabiform-clean.zip');
    const receiptPath = await save(page, 'custody-download', join(dir, 'printed'), 'arabiform-custody-manifest.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const members = unzipSync(await readFile(printed));
    const templateSha256 = sha(await readFile(join(dir, 'certificate-bilingual.pdf')));
    const rosterSha256 = sha(roster);
    const prefix = sha(JSON.stringify(['ArabiForm custody QR v1', templateSha256, rosterSha256, null])).slice(0, 12);
    const records = [1, 2].map(rowNumber => ({ rowNumber, payload: 'ARABIFORM:1:' + prefix + ':' + rowNumber }));
    expect(receipt).toMatchObject({ templateSha256, rosterSha256, selectedRowNumbers: [1, 2], qrRecords: records });
    expect(receipt.entries).toEqual(names.map(filename => ({ filename, bytes: members[filename]!.length, sha256: sha(members[filename]!) })));
    const symbols: (Parameters<typeof proveQrMatrix>[0] & { filename: string })[] = JSON.parse(execFileSync('python',
      ['-B', 'tests/e2e/m17-printed-qr.py', editable, printed], { encoding: 'utf8', windowsHide: true }));
    expect(symbols.map(symbol => symbol.filename)).toEqual(names);
    symbols.forEach((symbol, i) => proveQrMatrix(symbol, records[i]!.payload));
    await writeFile(join(dir, 'printed-qr-modules.json'), JSON.stringify(symbols));
    for (const filename of names) {
      expect((await PDFDocument.load(members[filename]!)).catalog.has(PDFName.of('AcroForm'))).toBe(false);
      await writeFile(join(dir, 'printed', filename), members[filename]!);
    }
    const original = Buffer.from(members[names[0]!]!);
    const changed = Buffer.from(original);
    const offset = Math.floor(changed.length / 2);
    changed[offset] = changed[offset]! ^ 1;
    await mkdir(join(dir, 'tampered'), { recursive: true });
    await writeFile(join(dir, 'tampered', names[0]!), changed);
    await page.getByTestId('mode-verify').click();
    await page.getByTestId('verify-manifest').setInputFiles(receiptPath);
    await page.getByTestId('verify-pdfs').setInputFiles([
      { name: names[0]!, mimeType: 'application/pdf', buffer: original },
      { name: names[0]!, mimeType: 'application/pdf', buffer: changed },
      { name: 'unlisted.pdf', mimeType: 'application/pdf', buffer: changed },
    ]);
    const scan = page.getByTestId('verify-qr');
    await scan.fill(records[0]!.payload);
    await page.getByTestId('verify-run').click();
    const cards = page.getByTestId('verify-result');
    const states = ['VERIFIED_EXACT_MATCH', 'TAMPERED_BYTE_MISMATCH', 'UNMATCHED_UNKNOWN', 'VERIFIED_QR_RECORD'];
    for (const [i, status] of states.entries()) await expect(cards.nth(i)).toHaveAttribute('data-status', status);
    await expect(cards.nth(0).getByTestId('verify-received-sha256')).toHaveText(sha(original));
    await expect(cards.nth(0).getByTestId('verify-expected-sha256')).toHaveText(sha(original));
    await expect(cards.nth(1).getByTestId('verify-received-sha256')).toHaveText(sha(changed));
    await expect(cards.nth(1).getByTestId('verify-expected-sha256')).toHaveText(sha(original));
    await expect(cards.nth(2).getByTestId('verify-expected-sha256')).toHaveCount(0);
    await expect(cards.nth(3)).toContainText(prefix);
    await noOverflow(page);
    if (!ar && info.project.name === 'desktop') await capture(page, info, 'desktop-m17-custody-verifier.png', page.locator('.verify-results'));
    await page.getByRole('button', { name: ar ? 'أزل ملفات PDF المختارة' : 'Clear delivered PDFs', exact: true }).click();
    const wrongPrefix = (prefix[0] === '0' ? '1' : '0') + prefix.slice(1);
    for (const invalid of ['ARABIFORM:1:' + prefix + ':3', 'ARABIFORM:1:' + wrongPrefix + ':1']) {
      await scan.fill(invalid);
      await expect(cards).toHaveCount(0);
      await page.getByTestId('verify-run').click();
      await expect(cards).toHaveCount(1);
      await expect(cards).toHaveAttribute('data-status', 'UNMATCHED_UNKNOWN');
    }
    await page.getByTestId('verify-manifest').setInputFiles(oldReceiptPath);
    await scan.fill(records[0]!.payload);
    await page.getByTestId('verify-run').click();
    await expect(cards).toHaveAttribute('data-status', 'UNMATCHED_UNKNOWN');
    if (ar) {
      // The certificate should have identical ink on English and Arabic pages, even though the settings panel changes sides.
      await page.goto('/');
      await page.getByTestId('mode-create').click();
      await page.getByTestId('studio-organization').fill(organization);
      await page.getByTestId('studio-subtitle').fill(subtitle);
      await page.locator('input[name=studio-accent][value=navy]').check();
      const english = await canvasRaster(page);
      await writeFile(join(dir, 'canvas-locale-parity.json'), JSON.stringify({ english, arabic: certificateRaster }, null, 2));
      expect(certificateRaster, 'exact desktop or mobile certificate pixels across LTR/RTL controls').toEqual(english);
    }
    await writeFile(join(dir, 'verification.json'), JSON.stringify({ cold, templateProof, templateSha256, rosterSha256,
      prefix, records, states, certificateRaster, original: sha(original), oneByteChanged: { offset, sha256: sha(changed) },
      wrongRowRejected: true, wrongPrefixRejected: true, editableQrRejected: true }, null, 2));
  });
}
