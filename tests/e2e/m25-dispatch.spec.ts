import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument } from 'pdf-lib';
import { canvasInk, expect, noOverflow, test } from './browser';
import { template } from './clinic-downloads';
import { auditPage } from './m10-accessibility';

const subjectLead = 'وثيقة العيادة · Clinic notification · نسخة للمراجعة · ';
const subjectTemplate = subjectLead + '{{Ticket}} · {{Ticket}}';
const bodyTemplate = 'مرحبًا / Hello\n{{Ticket}}\nReference: {{ID}}';
const reference = (rowNumber: number) => 'ticket ' + rowNumber + ' {{ID}}';
const addresses = ['one', 'two', 'three', 'four', 'five', 'six'];
const names = ['نسرين شريف', 'Nada', 'عائشة سالم', 'Lina', 'Salma', 'Omar'];
const stems = ['ملف/مشترك', 'Second', 'ملف?مشترك', 'Summary', 'Fifth', 'Sixth'];
const rows = names.map((Name, i) => ({
  Name, ID: '0051' + (8130 + i), Email: addresses[i] + '@example.test',
  Stem: stems[i], Ticket: reference(i + 1),
  BadAddress: ['one@example.test', 'incomplete', 'three@example.test', 'four@example.test', '', 'six\n@example.test'][i],
  BadSubject: i === 1 ? 'new\rline' : 'single line',
  BadStem: i === 4 ? 'two\nlines' : 'file' + i,
}));

async function open(page: Page, arabic: boolean) {
  const paths: string[] = [];
  page.context().on('request', request => paths.push(new URL(request.url()).pathname));
  await page.goto(arabic ? '/ar/pdf-mail-merge' : '/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('dir', arabic ? 'rtl' : 'ltr');
  const idle = [...paths];
  expect(idle.filter(path => /\.m?js$/i.test(path))).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
  expect(idle.filter(path => /\.(?:pdf|csv|xlsx)$/i.test(path))).toEqual([]);
  await noOverflow(page);
  await page.getByTestId('pdf-upload').setInputFiles(template);
  return idle;
}

async function upload(page: Page, values: object[]) {
  await page.getByTestId('roster-upload').setInputFiles({ name: 'Synthetic local contacts.csv', mimeType: 'text/csv',
    buffer: Buffer.from(Papa.unparse(values, { newline: '\r\n' }) + '\r\n') });
  await expect(page.getByTestId('ready-count')).toHaveText(String(values.length));
  await expect(page.getByTestId('flagged-count')).toHaveText('0');
}

async function save(page: Page, button: Locator, dir: string, filename: string) {
  await mkdir(dir, { recursive: true });
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(file.suggestedFilename()).toBe(filename);
  const path = join(dir, filename);
  await file.saveAs(path);
  expect(await file.failure()).toBeNull();
  return path;
}

const clean = (page: Page, arabic: boolean) => page.getByRole('button', {
  name: arabic ? 'نزّل ملفات PDF الجاهزة (ZIP)' : 'Download Clean PDFs (.zip)', exact: true,
});
const proof = (script: string, config: object) => JSON.parse(execFileSync('python', ['tests/e2e/m25-' + script + '-proof.py'],
  { encoding: 'utf8', input: JSON.stringify(config), windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } }));

async function suffix(element: Locator, extension: string) {
  const bdi = element.locator('bdi[dir="ltr"]');
  await expect(bdi).toHaveText(extension);
  const coordinates = await bdi.evaluate(el => {
    const text = el.firstChild!;
    return Array.from(text.textContent!, (_, i) => {
      const range = document.createRange();
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const { left, top, width } = range.getBoundingClientRect();
      return { left, top, width };
    });
  });
  expect(coordinates.every(c => c.width > 0 && c.top === coordinates[0]!.top)).toBe(true);
  for (let i = 1; i < coordinates.length; i++) expect(coordinates[i]!.left).toBeGreaterThan(coordinates[i - 1]!.left);
  return coordinates;
}

async function capture(page: Page, info: TestInfo, name: string, anchor: Locator) {
  const dir = process.env.ARABIFORM_CAPTURE_M25_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m25') : info.outputPath('screenshots');
  await mkdir(dir, { recursive: true });
  await anchor.evaluate(async el => {
    await document.fonts.ready;
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -12, behavior: 'instant' });
  });
  await page.screenshot({ path: join(dir, name + '.png'), animations: 'disabled' });
}

for (const lang of ['en', 'ar'] as const) {
  const ar = lang === 'ar';
  test('M25 ' + lang + ' downloads and independently parses selected local drafts, then holds invalid rows', async ({ page }, info) => {
    test.slow();
    const idle = await open(page, ar);
    await upload(page, rows);
    const pattern = page.locator('input.pattern-input');
    await pattern.fill('{{Stem}}.pdf');
    const rowCheck = (n: number) => page.locator('[data-testid="queue-row"][data-row="' + n + '"]').getByTestId('queue-row-select');
    for (const n of [4, 3, 1]) await rowCheck(n).check();
    const toggle = page.getByTestId('email-drafts-toggle');
    await toggle.click();
    const to = page.getByTestId('dispatch-recipient-column'), subject = page.getByTestId('dispatch-subject');
    const body = page.getByTestId('dispatch-message'), pack = page.getByTestId('dispatch-download');
    const ledger = page.getByTestId('dispatch-ledger-download');
    await expect(pack).toBeDisabled();
    await expect(ledger).toBeDisabled();
    await to.selectOption('Email');
    await subject.fill(subjectTemplate);
    await body.fill(bodyTemplate);
    const preview = page.getByTestId('dispatch-preview');
    await expect(preview).toContainText(reference(1));
    await expect(preview).toContainText(rows[0]!.Email);
    const suffixes = ar ? [await suffix(toggle, '(.eml)'), await suffix(pack, '(.zip)'), await suffix(ledger, '(.csv)')] : [];
    const dir = info.outputPath('selected');
    const pdfZip = await save(page, clean(page, ar), dir, 'arabiform-clean.zip');
    const draftZip = await save(page, pack, dir, 'arabiform-email-drafts.zip');
    const csv = await save(page, ledger, dir, 'dispatch-ledger.csv');
    const filenames = ['ملفمشترك.pdf', 'ملفمشترك-2.pdf', 'Summary.pdf'];
    const expected = [1, 3, 4].map((n, i) => {
      const { Name, ID, Email, Ticket } = rows[n - 1]!;
      return { rowNumber: n, to: Email, filename: filenames[i], subject: subjectLead + Ticket + ' · ' + Ticket,
        body: 'مرحبًا / Hello\n' + Ticket + '\nReference: ' + ID, values: { Name, ID } };
    });
    const mime = proof('dispatch', { pack: draftZip, pdfZip, csv, rows: expected });
    const access = await auditPage(page, 'workbench');
    await noOverflow(page);
    if (!ar && info.project.name === 'desktop') await capture(page, info, 'desktop-m25-dispatch-en', toggle);
    if (ar && info.project.name === 'mobile') await capture(page, info, 'mobile-m25-dispatch', toggle);
    await page.getByTestId('flatten-zip').check();
    await expect(ledger).toBeDisabled();
    const flatDir = info.outputPath('flattened');
    const flattenedZip = await save(page, clean(page, ar), flatDir, 'arabiform-clean.zip');
    const flattenedPack = await save(page, pack, flatDir, 'arabiform-email-drafts.zip');
    const flattenedCsv = await save(page, ledger, flatDir, 'dispatch-ledger.csv');
    const flatMime = proof('dispatch', { pack: flattenedPack, pdfZip: flattenedZip, csv: flattenedCsv,
      flattened: true, rows: expected });
    const unexpected: string[] = [];
    page.on('download', file => unexpected.push(file.suggestedFilename()));
    await page.getByTestId('use-all-ready').click();
    await expect(ledger).toBeDisabled();
    const issues = page.getByTestId('dispatch-issues');
    const hold = async (numbers: number[]) => {
      await expect(ledger).toBeDisabled();
      await pack.click();
      await expect(issues.locator('li')).toHaveCount(numbers.length);
      for (const [i, n] of numbers.entries()) await expect(issues.locator('li').nth(i)).toContainText((ar ? 'الصف ' : 'Row ') + n + ' ·');
      await expect(ledger).toBeDisabled();
      await noOverflow(page);
    };
    await to.selectOption('BadAddress');
    await hold([2, 5, 6]);
    await to.selectOption('Email');
    await subject.fill('{{BadSubject}}');
    await hold([2]);
    await subject.fill('Valid');
    await pattern.fill('{{BadStem}}.pdf');
    await hold([5]);
    expect(unexpected).toEqual([]);
    await writeFile(info.outputPath('m25-validation.json'), JSON.stringify({ idle, suffixes, mime, flatMime, access, unexpected,
      overflow: await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth, document.body.scrollWidth]) }, null, 2));
  });

  test('M25 ' + lang + ' masks Arabic name and ID on the live canvas and in review PDFs', async ({ page }, info) => {
    test.slow();
    const idle = await open(page, ar);
    const source = { Name: 'نسرين شريف', ID: '00518130', Email: 'review@example.test' };
    const last = { Name: source.Name, ID: '****8130' };
    const review = { Name: '**********', ID: last.ID };
    await upload(page, [source]);
    await page.locator('input.pattern-input').fill('review.pdf');
    const toggle = page.getByTestId('redacted-review-toggle');
    await toggle.click();
    const namePolicy = page.locator('[data-mask-field="Name"]'), idPolicy = page.locator('[data-mask-field="ID"]');
    await expect(namePolicy).toHaveValue('none');
    await expect(idPolicy).toHaveValue('none');
    const dir = info.outputPath('review');
    await mkdir(dir, { recursive: true });
    const raster = () => page.locator('canvas[data-rendered="true"]').evaluate((el: HTMLCanvasElement) => el.toDataURL('image/png'));
    const stage = async (label: string, expected: typeof last, previous?: string) => {
      await expect(page.getByTestId('ready-count')).toHaveText('1');
      await expect(page.locator('.preview-heading .tag-pass')).toBeVisible();
      const pdfZip = await save(page, clean(page, ar), join(dir, label), 'arabiform-clean.zip');
      const members = unzipSync(await readFile(pdfZip));
      expect(Object.keys(members)).toEqual(['review.pdf']);
      const bytes = members['review.pdf']!;
      const form = (await PDFDocument.load(bytes)).getForm();
      for (const [field, value] of Object.entries(expected)) expect(form.getTextField(field).getText()).toBe(value);
      await writeFile(join(dir, label + '.pdf'), bytes);
      // Intake also paints the original template while a new preflight is pending.
      // Sample only after the ready row and its downloadable PDF have been verified.
      await canvasInk(page);
      if (previous) await expect.poll(async () => await raster() !== previous).toBe(true);
      const latest = await raster();
      await writeFile(join(dir, label + '.png'), Buffer.from(latest.split(',')[1]!, 'base64'));
      return { latest, pdfZip };
    };
    const original = await stage('original', { Name: source.Name, ID: source.ID });
    await idPolicy.selectOption('keep-last-4');
    const partial = await stage('last', last, original.latest);
    await namePolicy.selectOption('full-mask');
    const masked = await stage('review', review, partial.latest);
    const status = page.getByTestId('redacted-review-status');
    await expect(status).toBeVisible();
    const access = await auditPage(page, 'workbench');
    await noOverflow(page);
    if (ar && info.project.name === 'desktop') await capture(page, info, 'desktop-m25-redacted-ar', page.getByTestId('pdf-canvas'));
    await page.getByTestId('email-drafts-toggle').click();
    await page.getByTestId('dispatch-recipient-column').selectOption('Email');
    await page.getByTestId('dispatch-subject').fill('نسخة مراجعة');
    await page.getByTestId('dispatch-message').fill('Review copy');
    const draftZip = await save(page, page.getByTestId('dispatch-download'), dir, 'arabiform-email-drafts.zip');
    const csv = await save(page, page.getByTestId('dispatch-ledger-download'), dir, 'dispatch-ledger.csv');
    const forbidden = ['0051', 'نسرين'];
    const mime = proof('dispatch', { pack: draftZip, csv, pdfZip: masked.pdfZip, redactedFields: ['Name', 'ID'], forbidden,
      rows: [{ rowNumber: 1, to: source.Email, filename: 'review.pdf', subject: 'نسخة مراجعة', body: 'Review copy', values: review }] });
    await page.getByTestId('mode-extract').click();
    await page.getByTestId('extract-pdf-upload').setInputFiles(join(dir, 'review.pdf'));
    const extracted = page.getByTestId('extract-row');
    await expect(extracted).toHaveAttribute('data-extract-status', 'extracted');
    for (const value of Object.values(review)) await expect(extracted.getByText(value, { exact: true })).toBeVisible();
    for (const token of forbidden) await expect(extracted).not.toContainText(token);
    // Reopen Fill with a literal stars-only roster as an independent visual control.
    await open(page, ar);
    await upload(page, [{ ...source, ...review }]);
    await page.locator('input.pattern-input').fill('review.pdf');
    await stage('literal', review);
    const pixels = proof('redaction', { dir, template, values: { last, review }, forbidden: { last: [forbidden[0]], review: forbidden } });
    await noOverflow(page);
    await writeFile(info.outputPath('m25-redaction.json'), JSON.stringify({ idle, access, mime, pixels,
      overflow: await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth, document.body.scrollWidth]) }, null, 2));
  });
}
