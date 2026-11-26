import type { Locator, Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { canvasInk, expect, noOverflow, test } from './browser';
import { clinic, mergedButton, template, verifyClinicDownloads, zipButton, type ClinicRow } from './clinic-downloads';
import { download } from './downloads';

const fixtureRoster = clinic('clinic-consent-roster.csv');
const font = (file: string) => resolve('public/fonts', file);
const filenameCases = ['00001-ليلى حسن.pdf', 'AR-00042-ق-سَلْمَى بِنْت يَاسِين.pdf'];

async function load(page: Page, roster: Parameters<Locator['setInputFiles']>[0], route = '/') {
  await page.goto(route);
  await page.getByTestId('pdf-upload').setInputFiles(template);
  await page.getByTestId('roster-upload').setInputFiles(roster);
}

async function counts(page: Page, ready: number, flagged: number) {
  await expect(page.getByTestId('ready-count')).toHaveText(String(ready));
  await expect(page.getByTestId('flagged-count')).toHaveText(String(flagged));
}

async function capture(page: Page, filename: string, selector: string) {
  if (process.env.ARABIFORM_CAPTURE_M3_SCREENSHOTS !== '1') return;
  await page.locator(selector).evaluate(async node => {
    await document.fonts.ready;
    node.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  const dir = resolve('docs/reports/screenshots/m3');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, filename + '.png'), animations: 'disabled' });
}

test('mixed consent widgets preserve original appearances and print the corrected rows', async ({ page }, info) => {
  await load(page, fixtureRoster);
  await counts(page, 2, 1);
  const fields = page.locator('.mapping-row');
  await expect(fields.filter({ has: page.locator('[data-pdf-field="Consent"]') }).getByText('Checkbox')).toBeVisible();
  await expect(page.locator('[data-pdf-field="Consent"]')).toHaveValue('Consent');
  for (const field of ['Contact', 'Clinic']) {
    await expect(fields.filter({ has: page.getByText(field, { exact: true }) }).getByText('Preserved untouched')).toBeVisible();
  }
  const rows = Papa.parse<ClinicRow>(await readFile(fixtureRoster, 'utf8'), { header: true, skipEmptyLines: true }).data;
  expect(rows.map(r => r.Consent)).toEqual(['نعم', 'لا', 'review']);
  const partial = await verifyClinicDownloads(page, info.outputPath('before-fix'), rows.slice(0, 2));
  await page.getByRole('button', { name: 'Select row 3' }).click();
  await expect(page.getByTestId('selected-diagnostics')).toContainText('Consent · Enter true or false');
  const flagged = await canvasInk(page);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Edit row 3' }).click();
  const cell = page.getByRole('textbox', { name: 'Consent', exact: true });
  await expect(cell).toHaveValue('review');
  await cell.fill('نعم');
  await counts(page, 3, 0);
  await expect(page.locator('[data-testid="queue-row"][data-row="3"]')).toContainText('Ready');
  await expect(page.getByTestId('selected-diagnostics')).toHaveCount(0);
  await expect(page.locator('#preview')).toContainText('Generated row');
  await page.getByRole('button', { name: 'Done editing' }).click();
  const fixed = await canvasInk(page);
  expect(fixed.dark).not.toBe(flagged.dark);
  await noOverflow(page);
  const desktop = info.project.name === 'desktop';
  await capture(page, desktop ? 'desktop-m3-mixed-widgets' : 'mobile-m3-mixed', '#preview');
  const complete = await verifyClinicDownloads(page, info.outputPath('after-fix'), [...rows.slice(0, 2), { ...rows[2]!, Consent: 'نعم' }]);
  await writeFile(info.outputPath('clinic-checks.json'), JSON.stringify({ partial, complete, flagged, fixed }, null, 2));
});

test('cached and uncached Excel consent formulas retain source positions and never recalculate', async ({ page }, info) => {
  await load(page, clinic('clinic-consent-formulas.xlsx'));
  await counts(page, 2, 0);
  await expect(page.getByTestId('warning-count')).toHaveText('2');
  for (const [index, address, message, value] of [
    [1, 'C2', 'Excel stored a result for this formula. Verify that it is current.', '1'],
    [2, 'C3', 'This Excel formula has no stored result. Enter a verified value if needed.', ''],
  ] as const) {
    await page.getByRole('button', { name: 'Select row ' + index }).click();
    await expect(page.locator('.source-details li')).toHaveText('Consent (' + address + ') · ' + message);
    await page.getByRole('button', { name: 'Edit row ' + index }).click();
    await expect(page.getByRole('textbox', { name: 'Consent' })).toHaveValue(value);
  }
  await canvasInk(page);
  await noOverflow(page);
  const rows = Papa.parse<ClinicRow>(await readFile(fixtureRoster, 'utf8'), { header: true, skipEmptyLines: true }).data;
  await verifyClinicDownloads(page, info.outputPath('formula-rows'), rows.slice(0, 2));
});

test('local font coverage controls all output and v1 presets retain only mapping and settings', async ({ page }, info) => {
  const rows = Papa.parse<ClinicRow>(await readFile(fixtureRoster, 'utf8'), { header: true, skipEmptyLines: true }).data.slice(0, 2);
  await load(page, { name: 'two-arabic-names.csv', mimeType: 'text/csv', buffer: Buffer.from(Papa.unparse(rows)) });
  await counts(page, 2, 0);
  const upload = page.getByTestId('custom-font-upload');
  await upload.setInputFiles(font('NotoSans-Regular.ttf'));
  await counts(page, 0, 2);
  await expect(page.getByTestId('custom-font-status')).toContainText('Some text needs glyphs this font lacks.');
  await expect(page.locator('.custom-font .loaded-filename')).toHaveText('Noto Sans');
  for (const row of [1, 2]) {
    await page.getByRole('button', { name: 'Select row ' + row }).click();
    await expect(page.getByTestId('selected-diagnostics')).toContainText('Name · The custom font is missing glyphs for this value.');
  }
  const zip = page.getByRole('button', { name: zipButton, exact: true });
  const merged = page.getByRole('button', { name: mergedButton, exact: true });
  await expect(zip).toBeDisabled();
  await expect(merged).toBeDisabled();
  const auditPath = await download(page, 'Download Preflight Audit (.json)', info.outputPath('font-negative'), 'arabiform-preflight.json');
  const audit = JSON.parse(await readFile(auditPath, 'utf8')) as { status: string; diagnostics: { field: string; code: string }[] }[];
  expect(audit).toHaveLength(2);
  for (const row of audit) {
    expect(row.status).toBe('flagged');
    expect(row.diagnostics).toContainEqual(expect.objectContaining({ field: 'Name', code: 'missing-glyphs' }));
  }

  await upload.setInputFiles(font('NotoNaskhArabic-Regular.ttf'));
  await counts(page, 2, 0);
  await expect(page.locator('.custom-font .loaded-filename')).toHaveText('Noto Naskh Arabic');
  await expect(page.getByTestId('custom-font-status')).toContainText('Preflight reported no missing glyphs.');
  await expect(page.getByText('The font stays in this browser tab.')).toBeVisible();
  const rendered = await canvasInk(page);
  await noOverflow(page);
  if (info.project.name === 'desktop') await capture(page, 'desktop-m3-custom-font', '.settings-panel');
  const verified = await verifyClinicDownloads(page, info.outputPath('font-positive'), rows);
  const preset = await download(page, 'Export mapping preset', info.outputPath('preset'), 'arabiform-mapping-preset.json');
  const text = await readFile(preset, 'utf8');
  expect(JSON.parse(text)).toEqual({
    version: 1, mapping: { Name: 'Name', ID: 'ID', Consent: 'Consent', Sentinel: '', Verified: '' },
    filenamePattern: '{{ID}}-{{Name}}.pdf', minFontSize: 8, font: 'auto',
  });
  await page.locator('[data-pdf-field="Consent"]').selectOption('');
  await page.getByTestId('preset-upload').setInputFiles(preset);
  await expect(page.locator('[data-pdf-field="Consent"]')).toHaveValue('Consent');
  await counts(page, 2, 0);
  await upload.setInputFiles({ name: 'corrupt.ttf', mimeType: 'font/ttf', buffer: Buffer.from('corrupt-font') });
  await expect(page.getByTestId('custom-font-error')).toContainText('This custom font could not be read.');
  await expect(zip).toBeDisabled();
  await expect(merged).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Download Preflight Audit (.json)' })).toBeDisabled();
  await expect(page.locator('#preview')).toContainText('Original template');
  await page.getByTestId('custom-font-clear').click();
  await counts(page, 2, 0);
  await expect(zip).toBeEnabled();
  await noOverflow(page);
  await writeFile(info.outputPath('font-checks.json'), JSON.stringify({ rendered, verified, presetBytes: Buffer.byteLength(text) }, null, 2));
});

async function verifyFilename(locator: Locator, filename: string) {
  await expect(locator).toHaveAttribute('dir', 'ltr');
  await expect(locator).toHaveText(filename);
  const measured = await locator.evaluate(element => {
    const textRects = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].filter(r => r.width > 0);
    };
    const box = element.getBoundingClientRect();
    const extension = element.querySelector('.filename-extension')!;
    const suffix = textRects(extension.firstChild!)[0]!;
    const stem = element.querySelector('.filename-stem')!;
    const walker = document.createTreeWalker(stem, NodeFilter.SHOW_TEXT);
    const ink = [];
    while (walker.nextNode()) ink.push(...textRects(walker.currentNode));
    const prefix = stem.firstChild!;
    const range = document.createRange();
    range.setStart(prefix, 0);
    range.setEnd(prefix, 1);
    const first = range.getBoundingClientRect();
    const firstMidline = (first.top + first.bottom) / 2;
    const firstLine = ink.filter(r => r.top <= firstMidline && firstMidline <= r.bottom);
    return {
      left: box.left, right: box.right, suffixLeft: suffix.left, suffixRight: suffix.right,
      stemRight: Math.max(...ink.map(r => r.right)), prefixLeft: first.left, firstLineLeft: Math.min(...firstLine.map(r => r.left)),
    };
  });
  expect(measured.suffixRight - measured.suffixLeft).toBeGreaterThan(10);
  expect(Math.abs(measured.right - measured.suffixRight)).toBeLessThanOrEqual(1);
  expect(measured.stemRight).toBeLessThanOrEqual(measured.suffixLeft + 1);
  expect(Math.abs(measured.prefixLeft - measured.firstLineLeft)).toBeLessThanOrEqual(1);
  return measured;
}

for (const route of ['/', '/ar/pdf-mail-merge']) {
  test('LTR filename glyph ranges stay ordered in the queue and summary on ' + route, async ({ page }, info) => {
    const rows = [
      { Name: 'ليلى حسن', ID: '00001', Consent: 'نعم' },
      { Name: 'سَلْمَى بِنْت يَاسِين', ID: 'AR-00042-ق', Consent: 'لا' },
    ];
    await load(page, { name: 'bidi-filenames.csv', mimeType: 'text/csv', buffer: Buffer.from(Papa.unparse(rows)) }, route);
    await counts(page, 2, 0);
    await expect(page.locator('html')).toHaveAttribute('dir', route === '/' ? 'ltr' : 'rtl');
    await canvasInk(page);
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const proof = [];
    for (const [index, name] of filenameCases.entries()) {
      const row = page.locator('[data-testid="queue-row"][data-row="' + (index + 1) + '"]');
      await row.getByRole('button').click();
      proof.push({ name, queue: await verifyFilename(row.locator('bdi.filename'), name),
        selected: await verifyFilename(page.locator('.row-summary bdi.filename'), name) });
    }
    await noOverflow(page);
    if (info.project.name === 'desktop') await capture(page,
      route === '/' ? 'desktop-m3-ltr-filenames' : 'desktop-m3-ar-rtl-filenames', '.queue');
    await writeFile(info.outputPath('filename-positions.json'), JSON.stringify(proof, null, 2));
  });
}
