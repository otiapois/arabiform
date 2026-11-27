import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument, PDFName } from 'pdf-lib';
import { expect, golden, noOverflow, test } from './browser';
import { choicesFixture, riyadh } from './choices-downloads';
import { download } from './downloads';
import { auditPage } from './m10-accessibility';

type Source = { filename: string; bytes: Uint8Array };
type AuditRow = {
  filename: string; sourceSha256: string; status: string;
  fields: Record<string, { kind: string; value: string; nativeValue?: string; displayLabel?: string }>;
  schema?: { extra: string[]; missing: string[]; typeChanged: unknown[] };
};
type Receipt = { version: number; rows: AuditRow[]; csvSha256: string; xlsxSha256: string;
  spreadsheetColumns: { header: string; field?: string; detail?: 'value' | 'nativeValue' | 'displayLabel' }[] };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function readExports(page: Page, info: TestInfo) {
  const directory = info.outputPath('exports');
  const result: Buffer[] = [];
  for (const [kind, filename] of [
    ['csv', 'arabiform-extracted.csv'], ['xlsx', 'arabiform-extracted.xlsx'], ['audit', 'arabiform-extraction-audit.json'],
  ] as const) {
    const button = page.getByTestId('extract-download-' + kind);
    const file = await download(page, (await button.innerText()).trim(), directory, filename);
    result.push(await readFile(file));
  }
  const [csv, xlsx, json] = result as [Buffer, Buffer, Buffer];
  const receipt: Receipt = JSON.parse(json.toString('utf8'));
  expect(receipt.version).toBe(1);
  expect([receipt.csvSha256, receipt.xlsxSha256]).toEqual([sha(csv), sha(xlsx)]);
  expect(csv.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const csvRows = Papa.parse<string[]>(new TextDecoder('utf-8', { fatal: true }).decode(csv), { skipEmptyLines: true });
  expect(csvRows.errors).toEqual([]);
  const parts = unzipSync(xlsx);
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(parts['xl/worksheets/sheet1.xml']!);
  const sheet = await page.evaluate(source => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.querySelector('parsererror, f')) throw new Error('Malformed sheet or unexpected formula');
    return Array.from(doc.querySelectorAll('sheetData > row'), row => Array.from(row.children, cell => {
      if (cell.localName !== 'c' || cell.getAttribute('t') !== 'inlineStr') throw new Error('Expected text cell at ' + cell.getAttribute('r'));
      return cell.querySelector('is > t')!.textContent!;
    }));
  }, xml);
  const header = receipt.spreadsheetColumns.map(column => column.header);
  const expected = [header, ...receipt.rows.map(row => [row.filename, row.sourceSha256, row.status,
    ...receipt.spreadsheetColumns.slice(3).map(column => row.fields[column.field!]?.[column.detail!] ?? '')])];
  expect(sheet).toEqual(expected);
  expect(csvRows.data).toEqual(expected.map(row => row.map(cell => cell === '=flat.pdf' ? "'" + cell : cell)));
  return { receipt, sheet };
}

async function checkVisibleRows(page: Page, receipt: Receipt) {
  const rows = page.getByTestId('extract-row');
  await expect(rows).toHaveCount(receipt.rows.length);
  for (const [index, row] of receipt.rows.entries()) {
    const view = rows.nth(index);
    await expect(view).toHaveAttribute('data-extract-status', row.status);
    await expect(view.getByRole('rowheader')).toHaveText(row.filename);
    const digest = view.getByTestId('extract-source-sha256');
    await expect(digest.locator('summary')).toHaveText(row.sourceSha256.slice(0, 12) + '…');
    await digest.locator('summary').click();
    const full = digest.locator('.custody-digest');
    await expect(full).toBeVisible();
    await expect(full).toHaveText(row.sourceSha256);
    expect(row.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(full).toHaveCSS('direction', 'ltr');
    await digest.locator('summary').click();
  }
  await noOverflow(page);
}

async function capture(page: Page, info: TestInfo, arabic: boolean) {
  if (info.project.name === 'mobile' && !arabic) return;
  const name = info.project.name === 'mobile' ? 'mobile-m14-extractor.png' : 'desktop-m14-extractor-' + (arabic ? 'ar' : 'en') + '.png';
  const dir = process.env.ARABIFORM_CAPTURE_M14_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m14') : info.outputPath('screenshots');
  await mkdir(dir, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const region = document.querySelector<HTMLElement>('.extract-results .table-scroll')!;
    region.scrollLeft = 0;
    const target = document.querySelector(window.innerWidth < 500 ? '#pdf-extractor' : '[data-testid="mode-fill"]')!;
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -18, behavior: 'instant' });
  });
  await page.screenshot({ path: join(dir, name), animations: 'disabled' });
}

test('M14 fills an editable ZIP, drops its original PDFs with a flat file, and verifies both sheets against the PDF bytes', async ({ page }, info) => {
  await page.goto('/');
  const selector = (name: string) => page.locator('[data-pdf-field="' + name + '"]');
  await expect(page.getByTestId('mode-fill')).toHaveAttribute('aria-pressed', 'true');
  const employee = ['سَلْمَى بِنْتُ يَاسِين', 'مُحَمَّد 00123'];
  const ids = ['00123', '00007'];
  const roster = Papa.unparse([['Employee', 'ID', 'Acknowledged', 'Clinic', 'Contact'],
    [employee[0]!, ids[0]!, 'yes', 'RIY', 'CALL'], [employee[1]!, ids[1]!, 'no', 'JED', 'MAIL']]);
  await page.getByTestId('pdf-upload').setInputFiles(choicesFixture('pdf'));
  await page.getByTestId('roster-upload').setInputFiles({ name: 'filled-choices.csv', mimeType: 'text/csv', buffer: Buffer.from(roster) });
  for (const [field, column] of [['Clinic', 'Clinic'], ['Contact', 'Contact'], ['Sentinel', 'ID']] as const)
    await selector(field).selectOption(column);
  await page.locator('.pattern-input').fill('{{Employee}}.pdf');
  await expect(page.getByTestId('ready-count')).toHaveText('2');
  await expect(page.getByTestId('flatten-zip')).not.toBeChecked();
  const zip = await download(page, 'Download Clean PDFs (.zip)', info.outputPath('fill'), 'arabiform-clean.zip');
  const members = unzipSync(await readFile(zip));
  expect(Object.keys(members)).toEqual(employee.map(s => s.normalize('NFC') + '.pdf'));
  const inputs: Source[] = [];
  for (const [i, [filename, bytes]] of Object.entries(members).entries()) {
    const form = (await PDFDocument.load(bytes)).getForm();
    expect(form.getTextField('Employee').getText()).toBe(employee[i]);
    expect(form.getTextField('Sentinel').getText()).toBe(ids[i]);
    expect(form.getCheckBox('Acknowledged').acroField.dict.get(PDFName.of('V'))?.toString()).toBe(i ? '/Off' : '/Yes');
    expect(form.getDropdown('Clinic').getSelected()).toEqual([i ? 'JED' : 'RIY']);
    expect(form.getRadioGroup('Contact').getSelected()).toBe(i ? 'MAIL' : 'CALL');
    inputs.push({ filename, bytes });
  }
  inputs.push({ filename: '=flat.pdf', bytes: await readFile(golden('flat.pdf')) });
  await page.getByTestId('mode-extract').click();
  await expect(page.getByRole('heading', { name: 'Extract filled PDFs' })).toBeVisible();
  const files = await page.evaluateHandle(items => {
    const data = new DataTransfer();
    for (const { filename, b64 } of items) {
      const bytes = Uint8Array.from(atob(b64), char => char.charCodeAt(0));
      data.items.add(new File([bytes], filename, { type: 'application/pdf' }));
    }
    return data;
  }, inputs.map(({ filename, bytes }) => ({ filename, b64: Buffer.from(bytes).toString('base64') })));
  const zone = page.getByTestId('extract-pdf-dropzone');
  await zone.dispatchEvent('dragover', { dataTransfer: files });
  await expect(zone).toHaveAttribute('data-dragging', 'true');
  await zone.dispatchEvent('drop', { dataTransfer: files });
  await files.dispose();
  await expect(page.getByTestId('extract-results')).toBeVisible();
  const { receipt } = await readExports(page, info);
  expect(receipt.rows.map(row => [row.filename, row.sourceSha256, row.status])).toEqual(inputs.map(({ filename, bytes }, i) =>
    [filename, sha(bytes), i === 2 ? 'blocked-flat' : 'extracted']));
  for (const [i, row] of receipt.rows.slice(0, 2).entries()) {
    expect(row.fields).toMatchObject({ Employee: { value: employee[i] }, Sentinel: { value: ids[i] },
      Acknowledged: { value: i ? 'unchecked' : 'checked', nativeValue: i ? 'Off' : 'Yes' },
      Clinic: { value: i ? 'JED' : 'RIY', displayLabel: i ? 'Jeddah Clinic' : riyadh },
      Contact: { value: i ? 'MAIL' : 'CALL' } });
    const line = page.getByTestId('extract-row').nth(i);
    for (const text of [employee[i]!, ids[i]!, i ? 'Off' : 'Yes', i ? 'JED' : 'RIY', i ? 'MAIL' : 'CALL'])
      await expect(line.getByText(text, { exact: true }).first()).toBeVisible();
  }
  expect(receipt.rows[2]!.fields).toEqual({});
  await expect(page.getByTestId('extract-row').last()).toContainText('Flat PDF (blocked)');
  expect(receipt.spreadsheetColumns).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: 'Acknowledged', detail: 'nativeValue' }), expect.objectContaining({ field: 'Clinic', detail: 'displayLabel' }),
  ]));
  await checkVisibleRows(page, receipt);
  await capture(page, info, false);
});

for (const arabic of [false, true]) {
  test('M14 ' + (arabic ? 'Arabic alias' : 'English') + ' cold fill opens only the extractor, then reads all synthetic downloads', async ({ page }, info) => {
    const assets: string[] = [];
    page.context().on('request', req => {
      const path = new URL(req.url()).pathname;
      if (path.startsWith('/assets/')) assets.push(path);
    });
    const response = await page.goto(arabic ? '/ar/' : '/', { waitUntil: 'networkidle' });
    expect(response!.status()).toBe(200);
    if (arabic) {
      const from = response!.request().redirectedFrom()!;
      expect(new URL(from.url()).pathname).toBe('/ar/');
      expect((await from.response())!.status()).toBe(301);
      expect(new URL(page.url()).pathname).toBe('/ar/pdf-mail-merge');
    }
    const snapshot = () => assets.filter(path => path.endsWith('.js'));
    const idle = snapshot();
    expect(idle).toHaveLength(1);
    expect(idle[0]).toMatch(/^\/assets\/index-[\w-]+\.js$/);
    await expect(page.locator('html')).toHaveAttribute('dir', arabic ? 'rtl' : 'ltr');
    const fill = page.getByTestId('mode-fill'), extract = page.getByTestId('mode-extract');
    await expect(fill).toHaveAttribute('aria-pressed', 'true');
    await expect(extract).toHaveText(arabic ? /استخراج بيانات/ : /Extract PDFs.*CSV.*\.xlsx/);
    await fill.focus();
    await page.keyboard.press('Tab');
    await expect(extract).toBeFocused();
    expect(await extract.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Enter');
    const panel = page.getByTestId('pdf-extractor');
    await expect(panel).toHaveCSS('direction', arabic ? 'rtl' : 'ltr');
    await page.waitForLoadState('networkidle');
    const activated = snapshot().slice(idle.length);
    expect(activated.some(path => /\/PdfExtractor-/.test(path))).toBe(true);
    expect(activated.filter(path => !/\/(PdfExtractor|Filename)-/.test(path))).toEqual([]);
    await noOverflow(page);
    const demo = page.getByTestId('extract-demo');
    await expect(demo).toHaveText(arabic ? /جرّب/ : /Synthetic/);
    await demo.click();
    await expect(page.getByTestId('extract-synthetic')).toBeVisible();
    const executed = snapshot().slice(idle.length + activated.length);
    for (const module of ['extractor-demo', 'extract']) expect(executed.some(path => path.startsWith('/assets/' + module + '-'))).toBe(true);
    expect(executed.filter(path => /qr-|PdfPreview|batch\.worker|\/sample-/i.test(path))).toEqual([]);
    const { receipt } = await readExports(page, info);
    const ids = ['00123', '00007', '00891'];
    expect(receipt.rows.map(row => row.filename)).toEqual(ids.map(id => 'synthetic-clinic-' + id + '.pdf'));
    expect(receipt.rows.map(row => row.status)).toEqual(['extracted', 'extracted', 'warning-schema-mismatch']);
    expect(receipt.rows[2]!.schema).toEqual({ extra: ['Notes'], missing: [], typeChanged: [] });
    expect(receipt.rows.map(row => row.fields.ID!.value)).toEqual(ids);
    expect(receipt.rows.map(row => row.fields.Name!.value)).toEqual(['سَلْمَى بِنْتُ يَاسِين', 'مُحَمَّد سَالِم', 'Layla حَسَن']);
    expect(receipt.rows.map(row => row.fields.Consent!.nativeValue)).toEqual(['Yes', 'Off', 'Yes']);
    expect(receipt.rows.map(row => row.fields.Clinic!.value)).toEqual(['RIY', 'JED', 'RIY']);
    expect(receipt.rows.map(row => row.fields.Contact!.value)).toEqual(['CALL', 'MAIL', 'MAIL']);
    for (const [i, id] of ids.entries()) await expect(page.getByTestId('extract-row').nth(i).getByText(id, { exact: true })).toBeVisible();
    await expect(page.getByTestId('extract-row').last()).toContainText(arabic ? 'حقول إضافية' : 'Extra fields');
    await expect(page.getByTestId('extract-results')).toContainText(riyadh);
    await checkVisibleRows(page, receipt);
    const accessibility = await auditPage(page, 'workbench');
    await writeFile(info.outputPath('activation.json'), JSON.stringify({ arabic, idle, activated, executed, accessibility }, null, 2));
    if (arabic) await capture(page, info, true);
  });
}
