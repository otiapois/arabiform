import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { degrees, PDFDocument } from 'pdf-lib';
import { proveQrMatrix } from '../core/qr-proof';
import { canvasInk, expect, noOverflow, test } from './browser';
import { download } from './downloads';
import { selectEditor } from './m7-evidence';
import { physicalMarginPdf } from './m9-margin-fixture';

const workbook = resolve('fixtures/m13/multi-sheet-roster.xlsx');
const names = ['ليلى حسن', 'أحمد سالم', 'بَنِي يَمَن'];
const ids = ['00123', '00007', '00042'];
const files = ids.map(id => id + '.pdf');
const mergedLabel = 'Download Merged Printable PDF';
const custodyLabel = 'Download Custody Manifest (.json)';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function badge() {
  const doc = await PDFDocument.create();
  doc.setTitle('Synthetic Sample visitor badge');
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const page = doc.addPage([440, 570]);
  page.setCropBox(20, 30, 360, 480);
  page.setRotation(degrees(90));
  page.drawText('Synthetic Sample / Visitor badge', { x: 58, y: 355, size: 15 });
  const form = doc.getForm();
  for (const [i, key] of ['Name', 'ID', 'Notes'].entries()) {
    const field = form.createTextField(key);
    field.addToPage(page, { x: 60, y: 280 - i * 55, width: 205, height: 35, borderWidth: 1 });
    field.setFontSize(12);
  }
  return Buffer.from(await doc.save());
}

async function open(page: Page, info: TestInfo, arabic = false) {
  const urls: string[] = [];
  page.on('request', req => urls.push(new URL(req.url()).pathname));
  await page.goto(arabic ? '/ar/pdf-mail-merge' : '/');
  await expect(page.locator('html')).toHaveAttribute('dir', arabic ? 'rtl' : 'ltr');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const scripts = urls.filter(path => /\.m?js$/.test(path));
  expect(scripts).toHaveLength(1);
  expect(scripts[0]).toMatch(/^\/assets\/index-[\w-]+\.js$/);
  await noOverflow(page);
  await mkdir(info.outputDir, { recursive: true });
  await writeFile(info.outputPath('idle.json'), JSON.stringify({ arabic, scripts, viewport: page.viewportSize() }));
  const template = await badge();
  await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic visitor badge.pdf', mimeType: 'application/pdf', buffer: template });
  await page.getByTestId('roster-upload').setInputFiles(workbook);
  const sheet = page.getByTestId('worksheet');
  await expect(sheet).toHaveAccessibleName(arabic ? 'ورقة العمل' : 'Worksheet');
  await expect(sheet).toHaveValue('Summary');
  expect(await sheet.locator('option').allTextContents()).toEqual(['Summary', 'Roster_AR']);
  await expect(page.locator('[data-pdf-field="Name"]')).toHaveValue('');
  const layout = page.getByTestId('imposition');
  await expect(layout).toHaveAccessibleName(arabic ? 'تخطيط الأوراق في ملف PDF المدمج' : 'Merged PDF sheet layout');
  await expect(layout).toHaveValue('1-up');
  await sheet.selectOption('Roster_AR');
  await expect(page.locator('[data-pdf-field="Name"]')).toHaveValue('Name');
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  await page.locator('input.pattern-input').fill('{{ID}}.pdf');
  return template;
}

async function settings(page: Page) {
  await page.getByTestId('imposition').selectOption('2-up');
  await page.getByTestId('include-cover-sheet').check();
  await page.getByTestId('cover-language').selectOption('bilingual');
  await page.getByTestId('watermark-kind').selectOption('draft-ar');
  await page.getByTestId('qr-stamp-toggle').click();
  await page.getByTestId('qr-stamp-placement').selectOption('bottom-right');
  await page.getByTestId('qr-stamp-pattern').fill('CERT-{{ID}}');
  await expect(page.getByTestId('qr-stamp-size')).toHaveValue('48');
  await expect(page.getByTestId('qr-stamp-preview')).toBeVisible();
}

async function screenshot(page: Page, info: TestInfo, arabic = false) {
  if (process.env.ARABIFORM_CAPTURE_M13_SCREENSHOTS !== '1' || arabic && info.project.name === 'mobile') return;
  const dir = resolve('docs/reports/screenshots/m13');
  const name = arabic ? 'desktop-m13-ar-rtl-2up' : info.project.name === 'mobile' ? 'mobile-m13-2up' : 'desktop-m13-xlsx-sheet-and-2up';
  await mkdir(dir, { recursive: true });
  await canvasInk(page);
  await page.getByTestId('imposition').evaluate(async element => {
    await document.fonts.ready;
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 100, behavior: 'instant' });
  });
  await expect(page.getByTestId('imposition')).toBeInViewport({ ratio: 1 });
  await noOverflow(page);
  const clip = !arabic && info.project.name === 'desktop' ? await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="worksheet"]')!.getBoundingClientRect();
    const layout = document.querySelector('[data-testid="imposition"]')!.getBoundingClientRect();
    const y = Math.floor(window.scrollY + sheet.top - 48);
    return { x: 0, y, width: window.innerWidth, height: Math.ceil(window.scrollY + layout.bottom + 70 - y) };
  }) : undefined;
  await page.screenshot({ path: resolve(dir, name + '.png'), clip, fullPage: Boolean(clip), animations: 'disabled' });
}

test('M13 binds worksheet edits, exact IDs and custody to the selected workbook tab', async ({ page }, info) => {
  const template = await open(page, info);
  for (const [i, id] of ids.entries()) {
    const editor = await selectEditor(page, i + 1);
    await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(names[i]!);
    await expect(editor.getByRole('textbox', { name: 'ID', exact: true })).toHaveValue(id);
  }
  await expect(page.locator('#edit-cells').getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Approved');
  await expect(page.locator('.source-details')).toContainText('Excel stored a result for this formula');
  const take = (name: string, label: string, file: string) => download(page, label, info.outputPath(name), file);
  const zip = await take('editable', 'Download Clean PDFs (.zip)', 'arabiform-clean.zip');
  const members = unzipSync(await readFile(zip));
  expect(Object.keys(members)).toEqual(files);
  for (const [i, name] of files.entries()) {
    const form = (await PDFDocument.load(members[name]!)).getForm();
    expect(form.getTextField('Name').getText()).toBe(names[i]);
    expect(form.getTextField('ID').getText()).toBe(ids[i]);
    expect(form.getTextField('Notes').getText()).toBe(i === 2 ? 'Approved' : 'Synthetic Sample');
  }
  const source = { version: 1, sheetName: 'Roster_AR', templateSha256: sha(template), rosterSha256: sha(await readFile(workbook)),
    selectedRowNumbers: [1, 2, 3], exportScope: 'all-ready' };
  const receipt = async (stage: string) => JSON.parse(await readFile(await take(stage, custodyLabel, 'arabiform-custody-manifest.json'), 'utf8'));
  expect(await receipt('before-edit')).toEqual({ ...source, entries: files.map(filename => ({
    filename, bytes: members[filename]!.length, sha256: sha(members[filename]!) })) });
  const audit = JSON.parse(await readFile(await take('audit', 'Download Preflight Audit (.json)', 'arabiform-preflight.json'), 'utf8'));
  expect(audit.map((row: { filename: string }) => row.filename)).toEqual(files);
  expect(audit.every((row: object) => Object.keys(row).join(',') === 'rowNumber,filename,status,diagnostics,fontSizes')).toBe(true);

  const sheet = page.getByTestId('worksheet'), layout = page.getByTestId('imposition');
  await layout.selectOption('2-up');
  const first = await selectEditor(page, 1);
  await first.getByRole('textbox', { name: 'ID', exact: true }).fill('00456');
  await expect(page.locator('[data-row="1"]')).toContainText('00456.pdf');
  const draft = await take('draft', 'Save Draft (.json)', 'arabiform-batch-draft.json');
  expect(JSON.parse(await readFile(draft, 'utf8'))).toMatchObject({
    source: { sheetName: 'Roster_AR', rosterSha256: source.rosterSha256, templateSha256: source.templateSha256 },
    edits: { 0: { ID: '00456' } }, settings: { version: 8, imposition: '2-up' } });
  await sheet.selectOption('Summary');
  await expect(page.locator('[data-pdf-field="Name"]')).toHaveValue('');
  await page.getByTestId('draft-upload').setInputFiles(draft);
  await expect(page.getByTestId('draft-status')).toContainText('different PDF, roster, or worksheet');
  await expect(sheet).toHaveValue('Summary');
  await expect(layout).toHaveValue('2-up');
  await page.locator('[data-pdf-field="Name"]').selectOption('Topic');
  await expect(page.getByTestId('ready-count')).toHaveText('1');
  expect(await receipt('summary')).toEqual({ ...source, sheetName: 'Summary', selectedRowNumbers: [1] });
  await sheet.selectOption('Roster_AR');
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  await expect((await selectEditor(page, 1)).getByRole('textbox', { name: 'ID', exact: true })).toHaveValue('00123');
  expect(await receipt('switched-back')).toEqual(source);
  await page.getByTestId('draft-upload').setInputFiles(draft);
  await expect(page.getByTestId('draft-status')).toContainText('Draft loaded');
  await expect((await selectEditor(page, 1)).getByRole('textbox', { name: 'ID', exact: true })).toHaveValue('00456');
  await noOverflow(page);
});

test('M13 prints a bilingual index and three rotated vector records on two actual A4 sheets', async ({ page }, info) => {
  await open(page, info);
  await settings(page);
  await screenshot(page, info);
  const out = info.outputPath('print');
  const merged = (stage: string) => download(page, mergedLabel, resolve(out, stage), 'arabiform-merged.pdf');
  const printed = await merged('two-up');
  const manifest = await download(page, custodyLabel, out, 'arabiform-custody-manifest.json');
  expect(JSON.parse(await readFile(manifest, 'utf8'))).toMatchObject({
    sheetName: 'Roster_AR', rosterSha256: sha(await readFile(workbook)), mergedPdfSha256: sha(await readFile(printed)) });
  await page.getByTestId('imposition').selectOption('1-up');
  await page.getByTestId('include-cover-sheet').uncheck();
  const reference = await merged('one-up');
  await page.getByTestId('imposition').selectOption('2-up');
  await page.getByTestId('include-cover-sheet').check();
  await page.getByTestId('cover-language').selectOption('bilingual');
  await page.getByTestId('qr-stamp-placement').selectOption('none');
  await page.getByTestId('watermark-kind').selectOption('none');
  const plain = await merged('plain');
  const proof = JSON.parse(execFileSync('python', ['-B', 'tests/e2e/m13-print-proof.py', printed, reference, plain], { encoding: 'utf8', windowsHide: true }));
  expect(proof.rows).toHaveLength(3);
  for (const [i, row] of proof.rows.entries()) {
    const modules: boolean[][] = row.modules;
    const mask = [4, 3, 2].reduce((word, x, bit) => word | (Number(modules[8]![x]) << bit), 0) ^ ((0x5412 >> 10) & 7);
    proveQrMatrix({ version: 1, size: 21, modules, mask }, 'CERT-' + ids[i]);
    row.payload = 'CERT-' + ids[i];
    row.mask = mask;
    delete row.modules;
  }
  await writeFile(resolve(out, 'physical-proof.json'), JSON.stringify(proof, null, 2));
  await writeFile(resolve(out, 'plan.json'), JSON.stringify({ coverPages: 1, watermark: 'مسودة', qr: { location: 'bottom-right', size: 48 },
    rows: ids.map((id, i) => ({ filename: files[i], rowNumber: i + 1, payload: 'CERT-' + id })) }, null, 2));
  await noOverflow(page);
});

test('M13 restores v8 and all seven legacy layouts and makes multi-page fallback explicit', async ({ page }, info) => {
  const original = await open(page, info);
  await settings(page);
  const layout = page.getByTestId('imposition'), presetUpload = page.getByTestId('preset-upload');
  const preset = await download(page, 'Export mapping preset', info.outputPath('preset'), 'arabiform-mapping-preset.json');
  const data = JSON.parse(await readFile(preset, 'utf8'));
  expect(data).toMatchObject({ version: 8, imposition: '2-up', includeCoverSheet: true, coverLanguage: 'bilingual',
    qrStamp: { pattern: 'CERT-{{ID}}', placement: 'bottom-right' }, watermark: { kind: 'draft-ar' } });
  for (let version = 1; version <= 7; version++) {
    const filenamePattern = 'legacy' + version + '-{{ID}}.pdf';
    const old = { version, mapping: { Name: 'Name', ID: 'ID' }, minFontSize: 8, font: 'auto', filenamePattern,
      ...(version >= 2 && { flattenZip: true }), ...(version >= 3 && { includeCoverSheet: false }),
      ...(version >= 4 && { alignOverrides: {} }), ...(version >= 5 && { watermark: { kind: 'none' } }),
      ...(version >= 6 && { virtualMappings: {} }), ...(version >= 7 && { qrStamp: { placement: 'none' }, coverLanguage: 'auto' }) };
    await presetUpload.setInputFiles({ name: 'v' + version + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
    await expect(page.locator('input.pattern-input')).toHaveValue(filenamePattern);
    await expect(layout).toHaveValue('1-up');
    await presetUpload.setInputFiles(preset);
    await expect(layout).toHaveValue('2-up');
    await expect(page.getByTestId('qr-stamp-pattern')).toHaveValue('CERT-{{ID}}');
    await expect(page.getByTestId('cover-language')).toHaveValue('bilingual');
    await expect(page.getByTestId('preset-error')).toHaveCount(0);
  }
  await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic two-page.pdf', mimeType: 'application/pdf', buffer: await physicalMarginPdf() });
  await expect(layout).toBeDisabled();
  await expect(layout).toHaveValue('1-up');
  await expect(page.getByTestId('imposition-unavailable')).toBeVisible();
  await expect(page.getByTestId('imposition-unavailable')).toContainText(/single.page|one.page/i);
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  const fallback = await download(page, mergedLabel, info.outputPath('multi-page'), 'arabiform-merged.pdf');
  expect((await PDFDocument.load(await readFile(fallback))).getPageCount()).toBe(7);
  await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic restored badge.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(layout).toBeEnabled();
  await expect(layout).toHaveValue('2-up');
  await noOverflow(page);
});

test('M13 Arabic RTL exposes named worksheets and recovers after an invalid active sheet', async ({ page }, info) => {
  await open(page, info, true);
  await settings(page);
  await screenshot(page, info, true);
  const zip = unzipSync(await readFile(workbook));
  const key = 'xl/worksheets/sheet2.xml';
  const summary = strFromU8(zip[key]!);
  expect(summary).toContain('>Value<');
  zip[key] = strToU8(summary.replace('>Value<', '>Topic<'));
  await page.getByTestId('roster-upload').setInputFiles({ name: 'Synthetic invalid first tab.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(zipSync(zip)) });
  await expect(page.getByTestId('worksheet')).toHaveValue('Summary');
  await expect(page.getByTestId('worksheet-error')).toBeVisible();
  await expect(page.getByTestId('custody-download')).toBeDisabled();
  await page.getByTestId('worksheet').selectOption('Roster_AR');
  await expect(page.getByTestId('worksheet-error')).toHaveCount(0);
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  await expect((await selectEditor(page, 3)).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(names[2]!);
  await noOverflow(page);
});
