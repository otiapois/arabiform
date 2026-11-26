import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { canvasInk, expect, noOverflow, test } from './browser';
import { choicesFixture, riyadh, verifyChoiceDownloads } from './choices-downloads';
import { download } from './downloads';

const field = (page: Page, name: string) => page.locator('[data-pdf-field="' + name + '"]');
const queueRow = (page: Page, n: number) => page.locator('[data-testid="queue-row"][data-row="' + n + '"]');
const inlineClinic = (page: Page) => page.locator('[data-testid="roster-choice"][data-roster-column="Clinic"]');
const labels = {
  en: { page: 'Page 2 of 2', first: 'Page 1 of 2', issue: 'Page 2 · 1 issue', previous: 'Previous page',
    zip: 'Download Clean PDFs (.zip)', generated: 'Generated row', ready: 'Ready' },
  ar: { page: 'الصفحة 2 من 2', first: 'الصفحة 1 من 2', issue: 'الصفحة 2 · عدد التنبيهات 1', previous: 'الصفحة السابقة',
    zip: 'نزّل ملفات PDF الجاهزة (ZIP)', generated: 'الصف بعد التعبئة', ready: 'جاهز' },
};

async function load(page: Page, language: 'en' | 'ar') {
  await page.goto(language === 'ar' ? '/ar/pdf-mail-merge' : '/');
  await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
  await page.getByTestId('pdf-upload').setInputFiles(choicesFixture('pdf'));
  await page.getByTestId('roster-upload').setInputFiles(choicesFixture(language === 'en' ? 'csv' : 'xlsx'));
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  for (const name of ['Employee', 'Acknowledged']) await expect(field(page, name)).toHaveValue(name);
  for (const name of ['Clinic', 'Contact', 'Sentinel']) await expect(field(page, name)).toHaveValue('');
  await expect(page.getByTestId('flatten-zip')).not.toBeChecked();
  for (const name of ['Clinic', 'Contact']) await field(page, name).selectOption(name);
  await expect(page.getByTestId('flagged-count')).toHaveText('1');
  await expect(page.getByTestId('ready-count')).toHaveText('2');
}

async function screenshot(page: Page, filename: string) {
  if (process.env.ARABIFORM_CAPTURE_M4_SCREENSHOTS !== '1') return;
  const directory = resolve('docs/reports/screenshots/m4');
  await mkdir(directory, { recursive: true });
  await page.locator('#preview').evaluate(async section => {
    await document.fonts.ready;
    section.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  await page.screenshot({ path: join(directory, filename), animations: 'disabled' });
}

for (const language of ['en', 'ar'] as const) {
  test('M4 ' + language + ' jumps to the failed Clinic, repairs the row, and prints every actual ZIP page', async ({ page }, info) => {
    const copy = labels[language];
    await load(page, language);
    await page.locator('.pattern-input').fill('{{Employee}}.pdf');
    await queueRow(page, 2).getByRole('button').click();
    await expect(page.locator('#preview')).toContainText(copy.generated);
    await canvasInk(page);
    const previous = page.getByRole('button', { name: copy.previous, exact: true });
    if (await previous.isEnabled()) await previous.click();
    await expect(page.locator('.page-counter')).toHaveText(copy.first);
    await queueRow(page, 1).getByRole('button').click();
    await expect(page.locator('.page-counter')).toHaveText(copy.page);
    const pill = page.getByTestId('issue-page');
    await expect(pill).toHaveCount(1);
    await expect(pill).toHaveAttribute('data-page', '2');
    await expect(pill).toHaveText(copy.issue);
    await expect(pill).toHaveAttribute('aria-current', 'page');
    const overlay = page.getByTestId('flagged-widget');
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toHaveAttribute('data-field', 'Clinic');
    await expect(overlay).toHaveCSS('border-top-color', 'rgb(176, 47, 41)');
    const source = await PDFDocument.load(await readFile(choicesFixture('pdf')));
    const rect = source.getForm().getDropdown('Clinic').acroField.getWidgets()[0]!.getRectangle();
    const size = source.getPage(1).getSize();
    const geometry = await overlay.evaluate(node => {
      const box = node.getBoundingClientRect(), paper = node.parentElement!.getBoundingClientRect();
      return [(box.left - paper.left) / paper.width, (box.top - paper.top) / paper.height, box.width / paper.width, box.height / paper.height];
    });
    const expected = [rect.x / size.width, 1 - (rect.y + rect.height) / size.height, rect.width / size.width, rect.height / size.height];
    for (const [index, value] of expected.entries()) expect(geometry[index]).toBeCloseTo(value, 2);
    const flagged = await canvasInk(page);
    await noOverflow(page);
    const diag = page.getByTestId('selected-diagnostics');
    await expect(diag.locator('.choice-list li')).toHaveText([riyadh + ' · RIY', 'Jeddah Clinic · JED']);
    if (language === 'en' && info.project.name === 'desktop') await screenshot(page, 'desktop-m4-multipage-jump.png');
    if (language === 'ar' && info.project.name === 'mobile') await screenshot(page, 'mobile-m4-choices.png');
    await page.getByRole('button', { name: copy.previous, exact: true }).click();
    await expect(page.locator('.page-counter')).toHaveText(copy.first);
    await expect(overlay).toHaveCount(0);
    const firstPage = await canvasInk(page);
    expect(firstPage.dark).not.toBe(flagged.dark);
    await pill.click();
    await expect(page.locator('.page-counter')).toHaveText(copy.page);
    await expect(overlay).toHaveAttribute('data-field', 'Clinic');
    expect(await canvasInk(page)).toEqual(flagged);
    const select = inlineClinic(page);
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('Unknown Clinic');
    await expect(select.locator('option:enabled')).toHaveText([riyadh + ' · RIY', 'Jeddah Clinic · JED']);
    await select.selectOption('RIY');
    await expect(page.getByTestId('ready-count')).toHaveText('3');
    await expect(page.getByTestId('flagged-count')).toHaveText('0');
    await expect(queueRow(page, 1)).toContainText(copy.ready);
    await expect(page.locator('#preview')).toContainText(copy.generated);
    await expect(page.locator('.page-counter')).toHaveText(copy.page);
    await expect(diag).toHaveCount(0);
    await expect(overlay).toHaveCount(0);
    await expect(pill).toHaveCount(0);
    const ready = await canvasInk(page);
    expect(ready.dark).not.toBe(flagged.dark);
    await noOverflow(page);
    if (language === 'en' && info.project.name === 'desktop') await screenshot(page, 'desktop-m4-choices-ready.png');
    await verifyChoiceDownloads(page, info.outputPath('downloads'), copy.zip);
    await noOverflow(page);
    await writeFile(info.outputPath('preview.json'), JSON.stringify({ geometry, expected, firstPage, flagged, ready }, null, 2));
  });
}

test('M4 v2 print preset restores both choices, and v1 restores the legacy editable settings', async ({ page }, info) => {
  await load(page, 'en');
  const toggle = page.getByTestId('flatten-zip');
  const pattern = '{{Employee}}.pdf';
  await page.locator('.pattern-input').fill(pattern);
  await toggle.check();
  const preset = await download(page, 'Export mapping preset', info.outputPath('v2'), 'arabiform-mapping-preset.json');
  const settings = { filenamePattern: pattern, minFontSize: 8, font: 'auto' };
  const legacyMapping = { Employee: 'Employee', Acknowledged: 'Acknowledged', Sentinel: '' };
  expect(JSON.parse(await readFile(preset, 'utf8'))).toEqual({
    version: 2, ...settings, mapping: { ...legacyMapping, Clinic: 'Clinic', Contact: 'Contact' }, flattenZip: true,
  });
  await toggle.uncheck();
  for (const name of ['Clinic', 'Contact']) await field(page, name).selectOption('');
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  const upload = page.getByTestId('preset-upload');
  await upload.setInputFiles(preset);
  await expect(toggle).toBeChecked();
  for (const name of ['Clinic', 'Contact']) await expect(field(page, name)).toHaveValue(name);
  await expect(page.getByTestId('flagged-count')).toHaveText('1');
  const old = { version: 1, ...settings, mapping: legacyMapping };
  await upload.setInputFiles({ name: 'prior-version.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await expect(toggle).not.toBeChecked();
  for (const name of ['Clinic', 'Contact']) await expect(field(page, name)).toHaveValue('');
  for (const name of ['Employee', 'Acknowledged']) await expect(field(page, name)).toHaveValue(name);
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  const restored = await download(page, 'Export mapping preset', info.outputPath('v1'), 'arabiform-mapping-preset.json');
  expect(JSON.parse(await readFile(restored, 'utf8'))).toEqual(old);
  await noOverflow(page);
});
