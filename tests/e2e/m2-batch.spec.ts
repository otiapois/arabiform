import type { Page, TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { canvasInk, expect, noOverflow, test } from './browser';
import { download } from './downloads';

const asset = (file: string) => resolve('fixtures/m2', file);
const ids = Array.from({ length: 200 }, (_, index) => String(index + 1).padStart(5, '0'));
const names = ['ليلى حسن', 'بَنِي يَمَن', 'أحمد سالم', 'سَلْمَى'];
const nameAt = (index: number) => names[index % names.length]!;
const zipButton = 'Download Clean PDFs (.zip)';
const batchWorker = /\/assets\/batch\.worker-[\w-]+\.js$/;

function csvFile(lines: string[]) {
  return { name: 'synthetic-roster.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\r\n')) };
}

async function upload200(page: Page) {
  await page.goto('/');
  await page.getByTestId('pdf-upload').setInputFiles(asset('hr-onboarding.pdf'));
  const roster = csvFile(['Employee ID,Name,Filename', ...ids.map((id, i) => [id, nameAt(i), 'specimen-' + id].join(','))]);
  await page.getByRole('textbox', { name: 'PDF filename pattern' }).fill('{{Employee ID}}-{{Name}}.pdf');
  const started = performance.now();
  await page.getByTestId('roster-upload').setInputFiles(roster);
  return started;
}

async function liveProgress(page: Page, phase: string) {
  const value = await page.waitForFunction(expected => {
    const meter = document.querySelector<HTMLProgressElement>('[data-testid="batch-progress"]');
    return meter?.dataset.phase === expected && meter.max === 200 && meter.value > 0 && meter.value < meter.max
      ? meter.value : false;
  }, phase);
  return Number(await value.jsonValue());
}

async function capture(page: Page, name: string, selector: string) {
  if (process.env.ARABIFORM_CAPTURE_M2_SCREENSHOTS !== '1') return;
  const dir = resolve('docs/reports/screenshots/m2');
  await mkdir(dir, { recursive: true });
  await page.locator(selector).evaluate(async node => {
    await document.fonts.ready;
    node.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  await page.screenshot({ path: resolve(dir, name + '.png'), animations: 'disabled' });
}

async function evidence(info: TestInfo, name: string, data: object) {
  await mkdir(info.outputDir, { recursive: true });
  await writeFile(info.outputPath(name + '.json'), JSON.stringify(data, null, 2));
}

test('200 live worker rows, responsive search and paging, verified PDFs, cancel a merged export', async ({ page, traffic, baseURL }, info) => {
  test.setTimeout(180_000);
  const started = await upload200(page);
  const first = await liveProgress(page, 'preflight');
  const search = page.getByTestId('queue-search');
  const rows = page.getByTestId('queue-row');
  const interactionStart = performance.now();
  await search.fill('specimen-00181');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-row', '181');
  const afterSearch = await liveProgress(page, 'preflight');
  const searchMs = Math.round(performance.now() - interactionStart);
  await search.fill('');
  await expect(rows).toHaveCount(20);
  await expect(page.getByTestId('queue-page')).toHaveText('1–20 of 200 matching rows');
  await page.getByTestId('queue-next-page').click();
  await expect(rows.first()).toHaveAttribute('data-row', '21');
  await expect(page.getByTestId('queue-page')).toHaveText('21–40 of 200 matching rows');
  await page.getByTestId('queue-prev-page').click();
  await expect(page.getByTestId('ready-count')).toHaveText('200', { timeout: 110_000 });
  const preflightMs = Math.round(performance.now() - started);
  await expect(page.getByTestId('flagged-count')).toHaveText('0');
  await expect(page.getByTestId('warning-count')).toHaveText('0');
  expect(traffic.workers.some(url => new URL(url).origin === baseURL && batchWorker.test(new URL(url).pathname))).toBe(true);
  for (const query of ['row 200', '00200-' + nameAt(199) + '.pdf']) {
    await search.fill(query);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-row', '200');
  }
  await search.fill('');
  await page.getByTestId('queue-filter-flagged').click();
  await expect(rows).toHaveCount(0);
  await page.getByTestId('queue-filter-warnings').click();
  await expect(rows).toHaveCount(0);
  await page.getByTestId('queue-filter-ready').click();
  await expect(rows).toHaveCount(20);
  await noOverflow(page);
  await capture(page, info.project.name === 'desktop' ? 'desktop-m2-200row-queue' : 'mobile-m2-queue', '.queue');

  const zipStart = performance.now();
  const path = await download(page, zipButton, info.outputPath('batch'), 'arabiform-clean.zip');
  const zipMs = Math.round(performance.now() - zipStart);
  const bytes = await readFile(path);
  const members = unzipSync(bytes);
  const expectedNames = ids.map((id, i) => id + '-' + nameAt(i).normalize('NFC') + '.pdf');
  expect(Object.keys(members)).toEqual(expectedNames);
  for (const [i, filename] of expectedNames.entries()) {
    const pdf = await PDFDocument.load(members[filename]!);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getForm().getTextField('Employee ID').getText()).toBe(ids[i]);
    expect(pdf.getForm().getTextField('Name').getText()).toBe(nameAt(i));
  }
  const active = page.workers().find(worker => batchWorker.test(new URL(worker.url()).pathname))!;
  const closed = active.waitForEvent('close');
  const lateDownloads: string[] = [];
  page.on('download', file => lateDownloads.push(file.suggestedFilename()));
  await page.getByRole('button', { name: 'Download Merged Printable PDF' }).click();
  const mergedAt = await liveProgress(page, 'merged');
  await page.getByTestId('cancel-batch').click();
  await closed;
  await expect(page.getByTestId('resume-batch')).toBeEnabled();
  await expect(page.getByRole('button', { name: zipButton })).toBeDisabled();
  expect(lateDownloads).toEqual([]);
  await evidence(info, 'batch-200', { rows: ids.length, preflightMs, searchMs, progressBeforeSearch: first,
    progressAfterSearch: afterSearch, zipMs, zipBytes: bytes.length, pdfReadbacks: expectedNames.length,
    mergedAt, uploadToDownloadMs: Math.round(zipStart + zipMs - started) });
});

test('cancel active preflight, resume retained data, replace with a fresh roster and verify its ZIP', async ({ page }, info) => {
  await upload200(page);
  const canceledAt = await liveProgress(page, 'preflight');
  const worker = page.workers().find(item => batchWorker.test(new URL(item.url()).pathname))!;
  const closed = worker.waitForEvent('close');
  await page.getByTestId('cancel-batch').click();
  await closed;
  await expect(page.getByTestId('resume-batch')).toBeEnabled();
  await expect(page.getByText(/Batch canceled/)).toBeVisible();
  await expect(page.getByTestId('batch-progress')).toHaveCount(0);
  await expect(page.getByRole('button', { name: zipButton })).toBeDisabled();
  await page.getByTestId('resume-batch').click();
  const resumedAt = await liveProgress(page, 'preflight');
  const resumed = page.workers().find(item => batchWorker.test(new URL(item.url()).pathname))!;
  expect(resumed).not.toBe(worker);
  const replaced = resumed.waitForEvent('close');
  await page.getByTestId('roster-upload').setInputFiles(csvFile(['Employee ID,Name', '00999,Mona']));
  await replaced;
  await expect(page.getByTestId('total-count')).toHaveText('1');
  await expect(page.getByTestId('ready-count')).toHaveText('1');
  await expect(page.getByTestId('queue-row')).toHaveCount(1);
  const zip = await download(page, zipButton, info.outputPath('replacement'), 'arabiform-clean.zip');
  const members = unzipSync(await readFile(zip));
  expect(Object.keys(members)).toEqual(['00999-Mona.pdf']);
  const doc = await PDFDocument.load(members['00999-Mona.pdf']!);
  expect(doc.getForm().getTextField('Employee ID').getText()).toBe('00999');
  await evidence(info, 'cancellation', { canceledAt, resumedAt, replacedRows: 200, verifiedReplacement: '00999' });
  await noOverflow(page);
});

test('rotated red badge resolves at the displayed limit and MaxLen stays fail-closed', async ({ page }, info) => {
  await page.goto('/');
  await page.getByTestId('pdf-upload').setInputFiles(asset('landscape-badge.pdf'));
  await page.getByTestId('roster-upload').setInputFiles(asset('badge-roster.csv'));
  await expect(page.getByTestId('flagged-count')).toHaveText('1');
  for (const id of ['preview-diagnostics', 'selected-diagnostics']) {
    await expect(page.getByTestId(id)).toContainText('Name · Needs 7.58 pt (min is 8 pt)');
  }
  const overlay = page.getByTestId('flagged-widget');
  await expect(overlay).toHaveAttribute('data-field', 'Name');
  await expect(overlay).toHaveAttribute('title', 'Needs 7.58 pt (min is 8 pt)');
  await expect(overlay).toBeVisible();
  await canvasInk(page);
  await noOverflow(page);
  if (info.project.name === 'desktop') await capture(page, 'desktop-m2-flagged-delta', '#preview');
  await expect(page.getByTestId('apply-min-font')).toHaveText('Set min font to 7.58 pt');
  await page.getByTestId('apply-min-font').click();
  await expect(page.locator('#min-font-size')).toHaveValue('7.58');
  await expect(page.getByTestId('ready-count')).toHaveText('1');
  await expect(page.getByTestId('flagged-count')).toHaveText('0');
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('#preview')).toContainText('Generated row');
  await canvasInk(page);
  const archive = await download(page, zipButton, info.outputPath('fixed-badge'), 'arabiform-clean.zip');
  const entries = Object.values(unzipSync(await readFile(archive)));
  expect(entries).toHaveLength(1);
  const form = (await PDFDocument.load(entries[0]!)).getForm();
  expect(form.getTextField('Name').getText()).toBe('سَلْمَى بِنْت يَاسِين / AR-00042');
  expect(form.getTextField('Badge ID').getText()).toBe('00007');

  await page.getByTestId('pdf-upload').setInputFiles(asset('access-code.pdf'));
  await page.getByTestId('roster-upload').setInputFiles(csvFile(['Printed Code', '0012345678']));
  for (const id of ['preview-diagnostics', 'selected-diagnostics']) {
    await expect(page.getByTestId(id)).toContainText('Printed Code · Exceeds MaxLen by 6 chars');
  }
  await expect(page.getByTestId('apply-min-font')).toHaveCount(0);
  await expect(page.getByRole('button', { name: zipButton })).toBeDisabled();
  await noOverflow(page);
});

test('portable preset, isolated filenames, safe downloaded members and local reset', async ({ page, context }, info) => {
  await page.goto('/');
  await page.getByTestId('pdf-upload').setInputFiles(asset('hr-onboarding.pdf'));
  const stems = ['../note', '..\\note', '/note', 'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'AR-00042-ق-سَلْمَى'];
  const expected = ['note', 'note-2', 'note-3', '_CON', '_PRN', '_AUX', '_NUL', '_COM1', stems[8]!]
    .map(stem => stem.normalize('NFC') + '.pdf');
  await page.getByTestId('roster-upload').setInputFiles(csvFile(['Employee ID,Name,Job', ...stems.map((stem, i) => [ids[i], 'Mona', stem].join(','))]));
  await expect(page.getByTestId('ready-count')).toHaveText('9');
  const dateField = page.locator('[data-pdf-field="Start Date"]');
  const pattern = page.getByRole('textbox', { name: 'PDF filename pattern' });
  const font = page.getByRole('combobox', { name: 'Font', exact: true });
  const size = page.getByRole('slider');
  await dateField.selectOption('Employee ID');
  await pattern.fill('{{Job}}.pdf');
  await font.selectOption('latin');
  await size.fill('9.25');
  await expect(page.getByTestId('ready-count')).toHaveText('9');
  const path = await download(page, 'Export mapping preset', info.outputPath('preset'), 'arabiform-mapping-preset.json');
  const preset = JSON.parse(await readFile(path, 'utf8'));
  expect(preset).toEqual({ version: 1, mapping: { Name: 'Name', 'Employee ID': 'Employee ID', 'Start Date': 'Employee ID', Sentinel: '' },
    filenamePattern: '{{Job}}.pdf', minFontSize: 9.25, font: 'latin' });
  await dateField.selectOption('');
  await pattern.fill('replaced.pdf');
  await font.selectOption('auto');
  await size.fill('8');
  const upload = page.getByTestId('preset-upload');
  await upload.setInputFiles(path);
  await expect(dateField).toHaveValue('Employee ID');
  await expect(pattern).toHaveValue(preset.filenamePattern);
  await expect(font).toHaveValue('latin');
  await expect(size).toHaveValue('9.25');
  await upload.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...preset, version: 2 })) });
  await expect(page.getByTestId('preset-error')).toContainText('not a valid ArabiForm mapping preset');
  await expect(pattern).toHaveValue('{{Job}}.pdf');
  await upload.setInputFiles({ name: 'unmatched.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...preset, mapping: { ...preset.mapping, RetiredField: 'Job' } })) });
  await expect(page.getByTestId('preset-warning')).toContainText('RetiredField');
  await expect(page.getByTestId('preset-error')).toHaveCount(0);
  await expect(page.getByTestId('ready-count')).toHaveText('9');
  const filenames = page.getByTestId('queue-row').locator('bdi.filename[dir="auto"]');
  await expect(filenames).toHaveText(expected);
  const zip = await download(page, zipButton, info.outputPath('filenames'), 'arabiform-clean.zip');
  const members = unzipSync(await readFile(zip));
  expect(Object.keys(members)).toEqual(expected);
  for (const [i, file] of expected.entries()) {
    const form = (await PDFDocument.load(members[file]!)).getForm();
    expect(form.getTextField('Employee ID').getText()).toBe(ids[i]);
  }
  await noOverflow(page);
  expect(await context.storageState({ indexedDB: true })).toEqual({ cookies: [], origins: [] });
  expect(await page.evaluate(async () => ({ sessionKeys: sessionStorage.length, caches: await caches.keys() })))
    .toEqual({ sessionKeys: 0, caches: [] });
  await page.reload();
  await expect(page.getByTestId('total-count')).toHaveText('0');
  await expect(pattern).toHaveValue('{{ID}}-{{Name}}.pdf');
});

test('English and RTL ink guides label the same synthetic specimen and display live RTL filenames', async ({ page }, info) => {
  for (const [route, heading, specimen] of [
    ['/arabic-pdf-form-filler', 'Why ink-bounds preflight matters', 'Synthetic specimen: بَنِي يَمَن'],
    ['/ar/pdf-mail-merge', 'لماذا نفحص حدود الحروف قبل التصدير؟', 'من العينة الاصطناعية «بَنِي يَمَن»'],
  ] as const) {
    const response = await page.goto(route);
    expect(await response!.text()).toContain(specimen);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText(specimen, { exact: false })).toBeVisible();
    await noOverflow(page);
  }
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'جرّب العينة العربية الاصطناعية' }).click();
  await expect(page.getByTestId('ready-count')).toHaveText('4');
  const mixed = page.locator('[data-row="4"] bdi.filename[dir="auto"]');
  await expect(mixed).toContainText('AR-00042');
  await expect(mixed).toContainText('ق');
  expect(await mixed.evaluate(node => getComputedStyle(node).unicodeBidi)).toBe('isolate');
  await canvasInk(page);
  await noOverflow(page);
  if (info.project.name === 'desktop') await capture(page, 'desktop-m2-ar-rtl', '.queue');
});
