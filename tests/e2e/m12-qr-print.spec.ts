import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { proveQrMatrix } from '../core/qr-proof';
import { canvasInk, expect, noOverflow, test } from './browser';
import { download } from './downloads';
import { physicalMarginPdf } from './m9-margin-fixture';

const ids = ['00123', '00007'];
const mergedLabel = 'Download Merged Printable PDF';
const zipLabel = 'Download Clean PDFs (.zip)';
const qrPattern = 'CERT-{{ID}}';
const qrSettings = { placement: 'bottom-right', sizePt: 48, pattern: qrPattern };
const filename = (page: Page) => page.locator('input.pattern-input:not([data-testid="qr-stamp-pattern"])');

async function load(page: Page, arabic = false) {
  const urls: string[] = [];
  page.on('request', request => urls.push(new URL(request.url()).pathname));
  await page.goto(arabic ? '/ar/pdf-mail-merge' : '/');
  await expect(page.locator('html')).toHaveAttribute('dir', arabic ? 'rtl' : 'ltr');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const idleJs = urls.filter(url => /\.m?js$/.test(url));
  expect(idleJs).toHaveLength(1);
  expect(idleJs[0]).toMatch(/^\/assets\/index-[\w-]+\.js$/);
  await noOverflow(page);
  const template = await physicalMarginPdf();
  await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic QR.pdf', mimeType: 'application/pdf', buffer: template });
  const csv = 'Name,ID,Code,Long\r\nMona,00123,OK,OK\r\nLayla,00007,,' + 'ع'.repeat(53) + '\r\n';
  await page.getByTestId('roster-upload').setInputFiles({ name: 'Synthetic QR.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('ready-count')).toHaveText('2');
  await filename(page).fill('{{ID}}.pdf');
  await canvasInk(page);
  return { idleJs, template };
}

async function enableQr(page: Page) {
  const toggle = page.getByTestId('qr-stamp-toggle');
  await expect(page.getByTestId('qr-stamp-placement')).toHaveCount(0);
  await toggle.click();
  const placement = page.getByTestId('qr-stamp-placement');
  await expect(placement).toHaveValue('none');
  expect(await placement.locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value).sort()))
    .toEqual(['bottom-left', 'bottom-right', 'none', 'top-left', 'top-right']);
  await placement.selectOption('bottom-right');
  await page.getByTestId('qr-stamp-pattern').fill(qrPattern);
  await expect(page.getByTestId('qr-stamp-size')).toHaveValue('48');
}

async function matrix(page: Page, expected: string) {
  const svg = page.getByTestId('qr-stamp-preview');
  await expect(svg).toBeVisible();
  // Sample occupied SVG geometry in its own coordinate system, independent of serialized path syntax.
  const grid = await svg.evaluate(element => {
    const root = element as SVGSVGElement;
    const path = root.querySelector('path')!;
    const side = root.viewBox.baseVal.width;
    const point = root.createSVGPoint();
    return Array.from({ length: side }, (_, y) => Array.from({ length: side }, (_, x) => {
      point.x = x + 0.5;
      point.y = y + 0.5;
      return path.isPointInFill(point);
    }));
  });
  const modules = grid.slice(4, -4).map(line => line.slice(4, -4));
  const size = modules.length;
  for (const [y, line] of grid.entries()) {
    for (const [x, bit] of line.entries()) {
      if (x < 4 || y < 4 || x >= size + 4 || y >= size + 4) expect(bit).toBe(false);
    }
  }
  // The three error-level-M mask bits occupy positions 10–12 in the XOR-masked format word.
  const formatBits = [4, 3, 2].reduce((word, col, i) => word | (Number(modules[8]![col]) << i), 0);
  const mask = formatBits ^ ((0x5412 >> 10) & 7);
  proveQrMatrix({ version: (size - 17) / 4, size, modules, mask }, expected);
  return modules;
}

async function capture(page: Page, info: TestInfo, arabic = false) {
  if (process.env.ARABIFORM_CAPTURE_M12_SCREENSHOTS !== '1' || (arabic && info.project.name === 'mobile')) return;
  const name = arabic ? 'desktop-m12-ar-rtl-qr' : info.project.name === 'mobile' ? 'mobile-m12-qr' : 'desktop-m12-qr-stamp-preview';
  const dir = resolve('docs/reports/screenshots/m12');
  await mkdir(dir, { recursive: true });
  await page.getByTestId('qr-stamp-toggle').evaluate(async el => {
    await document.fonts.ready;
    const offset = window.innerWidth < 600 ? 275 : 360;
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - offset, behavior: 'instant' });
  });
  await expect(page.getByTestId('qr-stamp-preview')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: resolve(dir, name + '.png'), animations: 'disabled' });
}

async function sentinel(bytes: Uint8Array) {
  const form = (await PDFDocument.load(bytes)).getForm();
  const field = form.getTextField('Unmapped');
  const appearances = field.acroField.getWidgets()[0]!.dict.lookup(PDFName.of('AP'), PDFDict);
  const normal = appearances.lookup(PDFName.of('N'));
  if (!(normal instanceof PDFRawStream)) throw new Error('Unmapped field has no saved appearance');
  return { value: field.getText(), rawValue: field.acroField.dict.get(PDFName.of('V'))!.toString(),
    ap: appearances.toString(), normalBytes: Buffer.from(normal.getContents()) };
}

test('M12 prints each live QR into cropped portrait and rotated record pages, with a bilingual index and editable originals', async ({ page }, info) => {
  const { idleJs, template } = await load(page);
  const out = info.outputPath('qr-downloads');
  const take = (stage: string, merged = false) => download(page, merged ? mergedLabel : zipLabel,
    resolve(out, stage), merged ? 'arabiform-merged.pdf' : 'arabiform-clean.zip');
  await expect(page.getByTestId('cover-language')).toHaveCount(0);
  await page.getByTestId('include-cover-sheet').check();
  await page.getByTestId('cover-language').selectOption('bilingual');
  const plain = await take('plain', true);
  const unmarked = await take('original');
  await enableQr(page);
  const first = await matrix(page, 'CERT-00123');
  await capture(page, info);
  await page.locator('[data-row="2"] .row-link').click();
  await expect(page.getByTestId('qr-stamp-preview')).toHaveAccessibleName('QR preview for row 2');
  const second = await matrix(page, 'CERT-00007');
  expect(second).not.toEqual(first);
  const preview = resolve(out, 'preview.json');
  await writeFile(preview, JSON.stringify([first, second]));
  const marked = await take('stamped', true);
  const editable = await take('editable');
  await page.getByTestId('flatten-zip').check();
  const flat = await take('flattened');
  const sourceField = await sentinel(template);
  expect(sourceField.value).toBe('KEEP 00109');
  for (const file of [unmarked, editable]) {
    const members = unzipSync(await readFile(file));
    expect(Object.keys(members)).toEqual(ids.map(id => id + '.pdf'));
    for (const id of ids) {
      const bytes = members[id + '.pdf']!;
      const form = (await PDFDocument.load(bytes)).getForm();
      expect(form.getTextField('ID').getText()).toBe(id);
      expect(await sentinel(bytes)).toEqual(sourceField);
    }
  }
  const output = execFileSync('python', ['-B', 'tests/e2e/m12-qr-proof.py', plain, marked, flat, unmarked, editable, preview],
    { encoding: 'utf8', windowsHide: true });
  await writeFile(resolve(out, 'physical-proof.json'), output);
  await writeFile(resolve(out, 'idle.json'), JSON.stringify(idleJs));
  expect(JSON.parse(output).stamps).toHaveLength(4);
  await noOverflow(page);
});

test('M12 restores active v7 and v1–v6 defaults, and rejects empty or oversized rows only on print outputs', async ({ page }, info) => {
  await load(page);
  await enableQr(page);
  await page.getByTestId('include-cover-sheet').check();
  const language = page.getByTestId('cover-language');
  await language.selectOption('bilingual');
  const preset = await download(page, 'Export mapping preset', info.outputPath('presets'), 'arabiform-mapping-preset.json');
  const settings = JSON.parse(await readFile(preset, 'utf8'));
  expect(settings).toMatchObject({ version: 7, qrStamp: qrSettings, coverLanguage: 'bilingual', includeCoverSheet: true });
  for (let version = 1; version <= 6; version++) {
    const filenamePattern = 'v' + version + '-{{ID}}.pdf';
    const old = { version, mapping: { Name: 'Name', ID: 'ID' }, minFontSize: 8, font: 'auto', filenamePattern,
      ...(version >= 2 && { flattenZip: false }), ...(version >= 3 && { includeCoverSheet: true }),
      ...(version >= 4 && { alignOverrides: { Name: 'center' } }), ...(version >= 5 && { watermark: { kind: 'none' } }),
      ...(version >= 6 && { virtualMappings: {} }) };
    await page.getByTestId('preset-upload').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
    await expect(filename(page)).toHaveValue(filenamePattern);
    await expect(page.getByTestId('preset-error')).toHaveCount(0);
    await expect(page.getByTestId('qr-stamp-placement')).toHaveCount(0);
    await page.getByTestId('qr-stamp-toggle').click();
    await expect(page.getByTestId('qr-stamp-placement')).toHaveValue('none');
    if (version <= 2) await page.getByTestId('include-cover-sheet').check();
    await expect(language).toHaveValue('auto');
    await page.getByTestId('preset-upload').setInputFiles(preset);
    await expect(page.getByTestId('qr-stamp-pattern')).toHaveValue(qrPattern);
    await expect(language).toHaveValue('bilingual');
  }
  await expect(page.getByTestId('qr-stamp-size')).toHaveValue('48');
  await expect(page.getByTestId('qr-stamp-placement')).toHaveValue('bottom-right');
  await expect(page.getByTestId('ready-count')).toHaveText('2');
  const downloads: string[] = [];
  page.on('download', file => downloads.push(file.suggestedFilename()));
  for (const [token, message] of [['Code', /empty QR code/], ['Long', /QR byte limit/]] as const) {
    await page.getByTestId('qr-stamp-pattern').fill('{{' + token + '}}');
    await matrix(page, 'OK');
    await page.getByRole('button', { name: mergedLabel, exact: true }).click();
    await expect(page.getByTestId('export-error')).toContainText('Row 2.');
    await expect(page.getByTestId('export-error')).toContainText(message);
    await page.getByTestId('flatten-zip').check();
    await page.getByRole('button', { name: zipLabel, exact: true }).click();
    await expect(page.getByTestId('export-error')).toContainText(message);
    await page.getByTestId('flatten-zip').uncheck();
  }
  expect(downloads).toEqual([]);
  const clean = await download(page, zipLabel, info.outputPath('invalid-qr-editable'), 'arabiform-clean.zip');
  const members = unzipSync(await readFile(clean));
  expect(Object.keys(members)).toEqual(ids.map(id => id + '.pdf'));
  for (const bytes of Object.values(members)) expect((await sentinel(bytes)).value).toBe('KEEP 00109');
  await noOverflow(page);
});

test('M12 Arabic RTL defers QR until interaction and shows the selected row without horizontal overflow', async ({ page }, info) => {
  const { idleJs } = await load(page, true);
  await expect(page.getByTestId('qr-stamp-toggle')).toHaveText('رمز QR للطباعة (اختياري)');
  await enableQr(page);
  await page.getByTestId('include-cover-sheet').check();
  await page.getByTestId('cover-language').selectOption('bilingual');
  await page.locator('[data-row="2"] .row-link').click();
  await expect(page.getByTestId('qr-stamp-preview')).toHaveAccessibleName('معاينة رمز QR للصف 2');
  await matrix(page, 'CERT-00007');
  await noOverflow(page);
  await capture(page, info, true);
  await mkdir(info.outputDir, { recursive: true });
  await writeFile(info.outputPath('idle.json'), JSON.stringify(idleJs));
});
