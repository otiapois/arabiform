import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { expect, noOverflow, test } from './browser';
import { choicesFixture } from './choices-downloads';
import { download } from './downloads';
import { align, canvasNameInk, cleanPanel, downloadedCenterPixels, localOnly, receipt, screenshot, selectEditor, verifyWorkshopZip } from './m7-evidence';

const raw = ['  أحمد  سالم. ', 'إيمان. ', 'ليلى'];
const cleaned = ['احمد سالم!', 'ايمان!', 'ليلى'];
const ids = ['00123', '00007', '00891'];

async function workshop(page: Page) {
  await page.goto('/');
  await page.getByTestId('sample-workshop').click();
  await expect(page.getByTestId('ready-count')).toHaveText('4');
  const csv = ['Name,ID', ...raw.map((name, i) => `"${name}","${ids[i]}"`)].join('\r\n');
  await page.getByTestId('roster-upload').setInputFiles({ name: 'workshop-operators.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('total-count')).toHaveText('3');
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  await page.locator('.pattern-input').fill('{{ID}}.pdf');
}

test('M7 previews exact Arabic cleanup and literal replacement, applies and restores the actual ZIP', async ({ page }, info) => {
  await workshop(page);
  await align(page, 'Name').selectOption('center');
  const panel = await cleanPanel(page);
  await panel.getByRole('checkbox', { name: 'Name', exact: true }).check();
  const examples = await panel.locator('label').filter({ hasText: '→' }).evaluateAll(labels => labels.map(label => {
    const tree = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    const letters = [];
    for (let node = tree.nextNode(); node; node = tree.nextNode()) {
      const value = node.textContent!;
      for (let index = 0; index < value.length; index++) {
        const char = value[index]!;
        if (!/[أإآاةهىي→]/u.test(char)) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const { left, right, top } = range.getBoundingClientRect();
        letters.push({ char, left, right, top });
      }
    }
    return letters;
  }));
  expect(examples.map(letters => letters.map(item => item.char).join(''))).toEqual(['أإآ→ا', 'ة→ه', 'ى→ي']);
  for (const letters of examples) {
    const arrow = letters.find(item => item.char === '→')!;
    const target = letters.at(-1)!;
    for (const source of letters.slice(0, -2)) {
      expect(source.top).toBe(arrow.top);
      expect(source.right).toBeLessThan(arrow.left);
    }
    expect(target.top).toBe(arrow.top);
    expect(arrow.right).toBeLessThan(target.left);
  }
  const spaces = panel.getByRole('checkbox', { name: /Clean spaces/ });
  const alef = panel.getByRole('checkbox', { name: /Normalize Alef \(/ });
  await expect(alef).not.toBeChecked();
  await spaces.uncheck();
  await expect(panel.getByTestId('hygiene-count')).toHaveText('No cells would change.');
  await spaces.check();
  await alef.check();
  await panel.getByLabel('Find', { exact: true }).fill('.');
  await panel.getByLabel('Replace with').fill('!');
  await expect(panel.getByTestId('hygiene-count')).toHaveText('2 affected cells across 2 rows');
  const samples = panel.getByTestId('hygiene-samples').locator('li');
  expect(await samples.locator('del').allTextContents()).toEqual(raw.slice(0, 2));
  expect(await samples.locator('ins').allTextContents()).toEqual(cleaned.slice(0, 2));
  const editor = await selectEditor(page, 1);
  await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(raw[0]!);
  await verifyWorkshopZip(page, info.outputPath('before'), raw, ids);
  await screenshot(page, info.project.name === 'desktop' ? 'desktop-m7-hygiene-and-align' : 'mobile-m7-editor', '.hygiene');
  await panel.getByRole('button', { name: 'Apply transform' }).click();
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  await expect((await selectEditor(page, 1)).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(cleaned[0]!);
  await verifyWorkshopZip(page, info.outputPath('applied'), cleaned, ids);
  await panel.getByRole('button', { name: 'Undo last transform' }).click();
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  await expect((await selectEditor(page, 1)).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(raw[0]!);
  await verifyWorkshopZip(page, info.outputPath('undone'), raw, ids);
  await expect(panel.getByRole('button', { name: 'Undo last transform' })).toBeDisabled();
  await receipt(info, 'hygiene', { raw, cleaned, ids, examples, beforeApply: { rows: 2, cells: 2 }, storage: await localOnly(page) });
});

test('M7 centers live Arabic ink and downloaded 4x pixels, roundtrips v4 and imports v1 to v3', async ({ page }, info) => {
  await workshop(page);
  const field = align(page, 'Name');
  const name = 'ليلى حسن';
  await (await selectEditor(page, 1)).getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByRole('combobox', { name: 'Preview zoom' }).selectOption('1.25');
  await field.selectOption('ltr');
  await expect.poll(async () => {
    const ink = await canvasNameInk(page);
    return ink.ink > 0 && ink.right - ink.left > 75;
  }).toBe(true);
  const leftAnchor = await canvasNameInk(page);
  await field.selectOption('center');
  await expect.poll(async () => {
    const ink = await canvasNameInk(page);
    return ink.ink > 0 && Math.abs(ink.right - ink.left) <= 3;
  }).toBe(true);
  const centered = await canvasNameInk(page);
  const entries = await verifyWorkshopZip(page, info.outputPath('download'), [name, ...raw.slice(1)], ids);
  await downloadedCenterPixels(info, entries['00123.pdf']!, name, '00123');
  const preset = await download(page, 'Export mapping preset', info.outputPath('preset'), 'arabiform-mapping-preset.json');
  const v4 = JSON.parse(await readFile(preset, 'utf8'));
  expect(v4).toMatchObject({ version: 4, alignOverrides: { Name: 'center' }, flattenZip: false, includeCoverSheet: false });
  const upload = page.getByTestId('preset-upload');
  for (const version of [1, 2, 3]) {
    const legacy = {
      version, mapping: v4.mapping, filenamePattern: 'v' + version + '-{{ID}}.pdf', minFontSize: 7, font: 'auto',
      ...(version >= 2 && { flattenZip: true }), ...(version === 3 && { includeCoverSheet: true }),
    };
    await field.selectOption('center');
    await upload.setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
    await expect(field).toHaveValue('auto');
    await expect(page.locator('#min-font-size')).toHaveValue('7');
    await expect(page.locator('.pattern-input')).toHaveValue(legacy.filenamePattern);
    await expect(page.getByTestId('flatten-zip')).toBeChecked({ checked: version >= 2 });
    await expect(page.getByTestId('include-cover-sheet')).toBeChecked({ checked: version === 3 });
  }
  await upload.setInputFiles(preset);
  await expect(field).toHaveValue('center');
  await expect(page.getByTestId('flatten-zip')).not.toBeChecked();
  await expect(page.getByTestId('include-cover-sheet')).not.toBeChecked();
  await expect(page.locator('.pattern-input')).toHaveValue('{{ID}}.pdf');
  await expect(page.locator('#min-font-size')).toHaveValue('8');
  await receipt(info, 'alignment', { leftAnchor, centered, v4, storage: await localOnly(page) });
});

test('M7 zooms flag page 2 and restores a portable HR draft only on its original inputs', async ({ page }, info) => {
  await page.goto('/');
  await page.getByTestId('sample-hr').click();
  await expect(page.getByTestId('ready-count')).toHaveText('2');
  await align(page, 'Employee').selectOption('center');
  await expect(page.getByTestId('flagged-count')).toHaveText('1');
  const rail = page.getByTestId('preview-pages');
  await expect(rail.getByRole('button')).toHaveCount(2);
  await rail.locator('[data-page="1"]').click();
  await expect(page.locator('.page-counter')).toHaveText('Page 1 of 2');
  const flagged = rail.getByTestId('issue-page');
  await expect(flagged).toHaveAccessibleName('Page 2 · 1 issue');
  const dot = flagged.locator('.page-issue-dot');
  await expect(dot).toBeVisible();
  const red = await dot.evaluate(el => getComputedStyle(el).backgroundColor);
  const channels = red.match(/\d+/g)!.map(Number);
  expect(channels[0]!).toBeGreaterThan(1.5 * Math.max(channels[1]!, channels[2]!));
  await flagged.click();
  await expect(flagged).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.page-counter')).toHaveText('Page 2 of 2');
  await expect(page.getByTestId('flagged-widget')).toHaveAttribute('data-field', 'Clinic');
  const zoom = page.getByRole('combobox', { name: 'Preview zoom' });
  await expect(zoom.locator('option')).toHaveCount(4);
  await expect(zoom).toHaveValue('fit');
  const canvas = page.locator('canvas[data-rendered="true"]');
  const dimensions = () => canvas.evaluate((el: HTMLCanvasElement) => ({ css: el.getBoundingClientRect().width, raster: el.width }));
  const fit = await dimensions();
  const source = await PDFDocument.load(await readFile(choicesFixture('pdf')));
  const expectedWidth = source.getPage(1).getWidth() * 96 / 72 * 1.25;
  await zoom.selectOption('1.25');
  await expect.poll(async () => Math.abs((await dimensions()).css - expectedWidth)).toBeLessThanOrEqual(1);
  const enlarged = await dimensions();
  expect(enlarged.css).toBeGreaterThan(fit.css);
  expect(enlarged.raster).toBeGreaterThan(fit.raster);
  await noOverflow(page);
  if (info.project.name === 'desktop') await screenshot(page, 'desktop-m7-multipage-zoom', '#preview');
  await zoom.selectOption('fit');
  await expect.poll(dimensions).toEqual(fit);

  const employee = 'سلمى QA 00123';
  await (await selectEditor(page, 1)).getByRole('textbox', { name: 'Employee', exact: true }).fill(employee);
  const panel = await cleanPanel(page);
  await panel.getByRole('checkbox', { name: 'Employee', exact: true }).check();
  await panel.getByLabel('Find', { exact: true }).fill('Layla');
  await panel.getByLabel('Replace with').fill('ليلى');
  await expect(panel.getByTestId('hygiene-count')).toHaveText('1 affected cells across 1 rows');
  await panel.getByRole('button', { name: 'Apply transform' }).click();
  await page.getByTestId('include-cover-sheet').check();
  await page.locator('.pattern-input').fill('HR-{{Employee}}.pdf');
  const save = (folder: string) => download(page, 'Save Draft (.json)', info.outputPath(folder), 'arabiform-batch-draft.json');
  const original = await save('saved');
  const draft = JSON.parse(await readFile(original, 'utf8'));
  expect(draft.edits).toMatchObject({ 0: { Employee: employee }, 2: { Employee: 'ليلى 00007' } });
  expect(draft.hygiene).toMatchObject([{ affectedRows: 1, affectedCells: 1, operation: { find: 'Layla', replace: 'ليلى' } }]);
  expect(draft.settings).toMatchObject({ alignOverrides: { Employee: 'center' }, includeCoverSheet: true, filenamePattern: 'HR-{{Employee}}.pdf' });
  await page.reload();
  await expect(page.getByTestId('total-count')).toHaveText('0');
  await page.getByTestId('sample-hr').click();
  await expect(page.getByTestId('ready-count')).toHaveText('2');
  await expect((await selectEditor(page, 1)).getByRole('textbox', { name: 'Employee', exact: true })).not.toHaveValue(employee);
  await expect(align(page, 'Employee')).toHaveValue('auto');
  await page.getByTestId('draft-upload').setInputFiles(original);
  await expect(page.getByTestId('draft-status')).toContainText('Draft loaded');
  await expect((await selectEditor(page, 1)).getByRole('textbox', { name: 'Employee', exact: true })).toHaveValue(employee);
  await expect((await selectEditor(page, 3)).getByRole('textbox', { name: 'Employee', exact: true })).toHaveValue('ليلى 00007');
  await expect(align(page, 'Employee')).toHaveValue('center');
  await expect(page.getByTestId('include-cover-sheet')).toBeChecked();
  expect(JSON.parse(await readFile(await save('restored'), 'utf8'))).toEqual(draft);

  const otherRoster = (await readFile(choicesFixture('csv'), 'utf8')).replace('Layla', 'Mona');
  await page.getByTestId('roster-upload').setInputFiles({ name: 'multi-page-hr-choices.csv', mimeType: 'text/csv', buffer: Buffer.from(otherRoster) });
  await expect((await selectEditor(page, 3)).getByRole('textbox', { name: 'Employee', exact: true })).toHaveValue('Mona 00007');
  const beforeReject = JSON.parse(await readFile(await save('mismatch-before'), 'utf8'));
  expect(beforeReject.source.rosterSha256).not.toBe(draft.source.rosterSha256);
  await page.getByTestId('draft-upload').setInputFiles(original);
  await expect(page.getByTestId('draft-status')).toHaveRole('alert');
  await expect(page.getByTestId('draft-status')).toContainText('different PDF, roster, or worksheet');
  expect(JSON.parse(await readFile(await save('mismatch-after'), 'utf8'))).toEqual(beforeReject);
  await receipt(info, 'zoom-draft', { fit, enlarged, expectedWidth, red, source: draft.source, storage: await localOnly(page) });
});

test('M7 isolates only the Arabic .xlsx extension and keeps three idle routes free of PDF engine and embedding-font JS', async ({ page }, info) => {
  const requests: string[] = [];
  page.context().on('request', request => requests.push(new URL(request.url()).pathname));
  const routes = [];
  for (const route of ['/', '/arabic-pdf-form-filler', '/ar/pdf-mail-merge']) {
    const start = requests.length;
    await page.goto(route);
    await expect(page.getByTestId('roster-upload')).toBeAttached();
    await page.waitForLoadState('networkidle');
    const paths = requests.slice(start);
    expect(paths.some(path => /^index-.+\.js$/.test(basename(path)))).toBe(true);
    const heavy = paths.filter(path => /^(?:fonts|pdf|PdfPreview|batch\.worker|pdf\.worker\.min|sample(?:-\w+)?)-.+\.m?js$/i.test(basename(path)));
    expect(heavy).toEqual([]);
    routes.push({ route, paths, storage: await localOnly(page) });
  }
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const extension = page.locator('.source-panel bdi[dir="ltr"]').filter({ hasText: /^\.xlsx$/ });
  await expect(extension).toHaveCount(1);
  const geometry = await extension.evaluate(element => {
    const node = element.firstChild!;
    const box = (start: number, end: number) => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const bounds = range.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    };
    const dot = box(0, 1), word = box(1, 5);
    return { text: element.textContent, direction: getComputedStyle(element).direction, dot, word,
      inversionPx: Math.max(0, dot.left - word.left), edgeOverlapPx: Math.max(0, dot.right - word.left) };
  });
  expect(geometry.text).toBe('.xlsx');
  expect(geometry.direction).toBe('ltr');
  expect(geometry.dot.top).toBe(geometry.word.top);
  expect(geometry.dot.bottom).toBe(geometry.word.bottom);
  expect(geometry.dot.left).toBeLessThan(geometry.word.left);
  expect(geometry.inversionPx).toBe(0);
  if (info.project.name === 'desktop') await screenshot(page, 'desktop-m7-ar-rtl-fixed', '.source-panel');
  await receipt(info, 'bidi-idle', { geometry, routes });
});
