import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument, PDFName } from 'pdf-lib';
import { canvasInk, expect, golden, noOverflow, test } from './browser';
import { download } from './downloads';
import { receipt, selectEditor } from './m7-evidence';
import { capacityColumns, expectedCapacity, makeCapacityPdf } from './m8-capacity-fixture';

async function capture(page: Page, name: string, selector: string) {
  if (process.env.ARABIFORM_CAPTURE_M8_SCREENSHOTS !== '1') return;
  await page.locator(selector).evaluate(async element => {
    await document.fonts.ready;
    element.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  const dir = resolve('docs/reports/screenshots/m8');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name + '.png'), animations: 'disabled' });
}

test('M8 template-only inspector measures every widget and exports an escaped, shaped capacity sheet', async ({ page }, info) => {
  const requests: string[] = [];
  page.context().on('request', request => requests.push(new URL(request.url()).pathname));
  const idle = [];
  for (const route of ['/ar/pdf-mail-merge', '/']) {
    const start = requests.length;
    await page.goto(route);
    await expect(page.getByTestId('pdf-upload')).toBeAttached();
    await page.waitForLoadState('networkidle');
    const js = requests.slice(start).filter(path => /\.m?js$/.test(path)).map(path => basename(path));
    expect(js.some(name => /^index-/.test(name))).toBe(true);
    expect(js.filter(name => /^(?:capacity|watermark|fonts-|pdf[-.]|pdfpreview|template-|batch\.worker|sample-)/i.test(name))).toEqual([]);
    idle.push({ route, js });
  }
  await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic capacity specimen.pdf',
    mimeType: 'application/pdf', buffer: await makeCapacityPdf() });
  const panel = page.getByTestId('capacity-inspector');
  await expect(panel.locator('summary')).toHaveText('Inspect template field capacities (6 fields)');
  await panel.locator('summary').click();
  const table = page.getByTestId('capacity-table');
  const reports = [];
  for (const size of [8, 10]) {
    if (size === 10) await page.locator('#min-font-size').fill('10');
    await expect(table.locator('caption')).toContainText(size + ' pt');
    await expect(page.getByTestId('total-count')).toHaveText('0');
    const expected = await expectedCapacity(size);
    const kinds: Record<string, string> = { text: 'Text', dropdown: 'Dropdown', checkbox: 'Checkbox', radio: 'Radio buttons' };
    const cells = await page.getByTestId('capacity-row').evaluateAll(rows => rows.map(row => Array.from(row.children, cell => cell.textContent)));
    expect(cells).toEqual(expected.map(row => [row.fieldName, kinds[row.kind], row.pageNumber, row.widgetNumber, row.widgetRotation + '°',
      row.innerWidthPt + ' × ' + row.innerHeightPt, row.maxLength || '—', row.arabicCharacters || '—', row.latinCharacters || '—']));
    await noOverflow(page);
    if (size === 8) await capture(page, info.project.name === 'desktop' ? 'desktop-m8-capacity-inspector' : 'mobile-m8-capacity', '[data-testid="capacity-inspector"]');
    const path = await download(page, 'Download capacity CSV', info.outputPath('capacity-' + size), 'arabiform-template-capacity.csv');
    const csv = Papa.parse<Record<string, string>>(await readFile(path, 'utf8'), { header: true, skipEmptyLines: true });
    expect(csv.errors).toEqual([]);
    expect(csv.meta.fields).toEqual(capacityColumns);
    expect(csv.data).toEqual(expected.map(row => ({ ...row, fieldName: row.fieldName.startsWith('=') ? "'" + row.fieldName : row.fieldName })));
    reports.push({ size, rows: expected });
  }
  expect(Number(reports[0]!.rows[0]!.arabicCharacters)).toBeGreaterThan(Number(reports[1]!.rows[0]!.arabicCharacters));
  expect(Number(reports[0]!.rows[0]!.latinCharacters)).toBeGreaterThan(Number(reports[1]!.rows[0]!.latinCharacters));
  await page.goto('/ar/pdf-mail-merge');
  await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic capacity specimen.pdf',
    mimeType: 'application/pdf', buffer: await makeCapacityPdf() });
  await expect(panel.locator('summary')).toContainText('افحص سعة حقول القالب');
  await panel.locator('summary').click();
  const region = panel.getByRole('region', { name: 'سعة حقول القالب' });
  await expect(region.getByRole('columnheader', { name: 'الأحرف العربية' })).toBeVisible();
  await expect(region.getByRole('columnheader', { name: 'الأحرف اللاتينية' })).toBeVisible();
  const rtlRegion = await region.evaluate(el => ({ viewport: el.clientWidth, content: el.scrollWidth, direction: getComputedStyle(el).direction }));
  expect(rtlRegion.direction).toBe('rtl');
  if (info.project.name === 'mobile') expect(rtlRegion.content).toBeGreaterThan(rtlRegion.viewport);
  await page.getByRole('combobox', { name: /علامة مائية للطباعة/ }).selectOption({ label: 'مسودة' });
  await expect(page.getByTestId('watermark-opacity-value')).toHaveText('14%');
  await expect(page.getByTestId('watermark-angle')).toHaveValue('45');
  await noOverflow(page);
  await receipt(info, 'capacity', { idle, reports, rtlRegion });
});

const zipButton = 'Download Clean PDFs (.zip)';
const mergedButton = 'Download Merged Printable PDF';
const presetFile = 'arabiform-mapping-preset.json';
const member = '00123.pdf';

test('M8 Arabic print stamp survives v5 restore and changes only printable outputs at 4x', async ({ page }, info) => {
  const directory = info.outputPath('prints');
  const values = { Name: 'مُحَمَّد سالم', ID: '00123' };
  await page.goto('/');
  await page.getByTestId('pdf-upload').setInputFiles(golden('template.pdf'));
  await page.getByTestId('roster-upload').setInputFiles({ name: 'Synthetic stamp.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Name,ID\r\n' + values.Name + ',' + values.ID) });
  await expect(page.getByTestId('ready-count')).toHaveText('1');
  await page.getByRole('textbox', { name: 'PDF filename pattern' }).fill('{{ID}}.pdf');
  const kind = page.getByTestId('watermark-kind');
  await expect(kind).toHaveValue('none');
  const zip = (folder: string) => download(page, zipButton, join(directory, folder), 'arabiform-clean.zip');
  const merged = (folder: string) => download(page, mergedButton, join(directory, folder), 'arabiform-merged.pdf');
  const plainEditable = await zip('plain-editable');
  const before = unzipSync(await readFile(plainEditable));
  expect(Object.keys(before)).toEqual([member]);
  const plain = await merged('plain');
  const flatten = page.getByTestId('flatten-zip');
  await flatten.check();
  const plainFlat = await zip('plain-flat');
  await flatten.uncheck();
  await kind.selectOption({ label: 'مسودة' });
  await expect(page.getByTestId('watermark-opacity-value')).toHaveText('14%');
  await page.getByTestId('watermark-opacity').fill('20');
  await page.getByTestId('watermark-angle').selectOption('-45');
  const savePreset = (folder: string) => download(page, 'Export mapping preset', join(directory, folder), presetFile);
  const saved = await savePreset('saved');
  const preset = JSON.parse(await readFile(saved, 'utf8'));
  expect(preset).toMatchObject({ version: 5, flattenZip: false, watermark: { kind: 'draft-ar', opacity: 0.20, angle: -45 } });
  await kind.selectOption('none');
  const upload = page.getByTestId('preset-upload');
  await upload.setInputFiles(saved);
  await expect(kind).toHaveValue('draft-ar');
  await expect(page.getByTestId('watermark-angle')).toHaveValue('-45');
  await expect(page.getByTestId('watermark-opacity-value')).toHaveText('20%');
  expect(JSON.parse(await readFile(await savePreset('restored'), 'utf8'))).toEqual(preset);
  await upload.setInputFiles({ name: 'invalid.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...preset, watermark: { ...preset.watermark, opacity: 0.90 } })) });
  await expect(page.getByTestId('preset-error')).toBeVisible();
  await expect(kind).toHaveValue('draft-ar');
  await expect(page.getByTestId('watermark-opacity')).toHaveValue('20');
  await upload.setInputFiles(saved);
  await expect(page.getByTestId('preset-error')).toHaveCount(0);
  await expect(page.getByTestId('ready-count')).toHaveText('1');
  await noOverflow(page);
  if (info.project.name === 'desktop') await capture(page, 'desktop-m8-watermark-settings', '[aria-labelledby="settings-heading"]');
  const markedEditable = await zip('marked-editable');
  const editable = unzipSync(await readFile(markedEditable));
  expect(Object.keys(editable)).toEqual([member]);
  expect(Buffer.from(editable[member]!).equals(before[member]!)).toBe(true);
  const form = (await PDFDocument.load(editable[member]!)).getForm();
  for (const [field, value] of Object.entries(values)) expect(form.getTextField(field).getText()).toBe(value);
  expect(form.getTextField('Sentinel').getText()).toBe('KEEP 00109');
  const stamped = await merged('marked');
  await flatten.check();
  const flat = await zip('marked-flat');
  const printed = unzipSync(await readFile(flat));
  expect(Object.keys(printed)).toEqual([member]);
  for (const bytes of [printed[member]!, await readFile(stamped)]) {
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.catalog.has(PDFName.of('AcroForm'))).toBe(false);
  }
  await writeFile(join(directory, 'before.pdf'), await readFile(golden('template.pdf')));
  await writeFile(join(directory, member), editable[member]!);
  const manifest = join(directory, 'manifest.json');
  await writeFile(manifest, JSON.stringify({ cases: [{ before: 'before.pdf', after: member, values }],
    merged: { pdf: plain, rows: [member] }, choiceZip: { editable: markedEditable, flattened: plainFlat, rows: [member] },
    watermarkProofs: [{ plainPdf: plain, pdf: stamped, zip: flat, member, label: 'Real Edge Arabic stamp',
      text: 'مسودة', angle: -45, opacity: 0.20 }] }));
  execFileSync('python', ['scripts/verify-pdf-pixels.py', manifest], { encoding: 'utf8', windowsHide: true });
  const pixels = JSON.parse(await readFile(join(directory, 'manifest-verification.json'), 'utf8'));
  expect(pixels.scale).toBe(4);
  expect(pixels.watermarkProofs[0].clippedWatermarkInkPixels).toBe(0);
  expect(pixels.watermarkProofs[0].pages[0].inkPixelsAt4x).toBeGreaterThan(1000);
  const sourceWidgets = pixels.cases[0].widgets as { field: string; inkPixelsAt4x: number }[];
  for (const field of Object.keys(values)) expect(sourceWidgets.find(item => item.field === field)!.inkPixelsAt4x).toBeGreaterThan(0);
  // Missing glyphs are checked at export. A rejected print must deliver no stale file.
  const unexpected: string[] = [];
  page.on('download', file => unexpected.push(file.suggestedFilename()));
  await kind.selectOption('custom');
  await expect(page.getByRole('button', { name: mergedButton })).toBeDisabled();
  await page.getByTestId('watermark-text').fill('A'.repeat(33));
  await expect(page.getByRole('button', { name: mergedButton })).toBeDisabled();
  await expect(page.getByRole('button', { name: zipButton })).toBeDisabled();
  await page.getByTestId('watermark-text').fill('🧪');
  await page.getByRole('button', { name: mergedButton }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'cannot render this watermark' })).toBeVisible();
  expect(unexpected).toEqual([]);
  await noOverflow(page);
  await receipt(info, 'watermark', { preset, editableSha256: createHash('sha256').update(editable[member]!).digest('hex'), pixels });
});

async function liveProgress(page: Page) {
  const live = await page.waitForFunction(() => {
    const meter = document.querySelector<HTMLProgressElement>('[data-testid="batch-progress"][data-phase="preflight"]');
    return meter?.max === 500 && meter.value > 0 && meter.value < meter.max ? meter.value : false;
  });
  return Number(await live.jsonValue());
}

test('M8 real 500-row worker cancels, restarts, accepts keyboard search during progress and finishes the exact roster', async ({ page, traffic, baseURL }, info) => {
  test.setTimeout(180_000);
  const id = (row: number) => String(row).padStart(5, '0');
  const bad = new Set([203, 499]);
  const name = (row: number) => bad.has(row) ? 'سَلْمَى '.repeat(100) : 'سَلْمَى QA ' + id(row);
  const rows = Array.from({ length: 500 }, (_, i) => [id(i + 1), name(i + 1), 'synthetic-' + id(i + 1)]);
  await page.goto('/');
  await page.getByTestId('pdf-upload').setInputFiles(resolve('fixtures/m2/hr-onboarding.pdf'));
  await page.getByRole('textbox', { name: 'PDF filename pattern' }).fill('{{Employee ID}}.pdf');
  const started = performance.now();
  await page.getByTestId('roster-upload').setInputFiles({ name: 'Synthetic 500.csv', mimeType: 'text/csv',
    buffer: Buffer.from(Papa.unparse([['Employee ID', 'Name', 'Search key'], ...rows])) });
  const cancelledAt = await liveProgress(page);
  const workerUrl = (url: string) => new URL(url).origin === baseURL && /\/assets\/batch\.worker-[\w-]+\.js$/.test(new URL(url).pathname);
  const first = page.workers().find(w => workerUrl(w.url()))!;
  const closed = first.waitForEvent('close');
  await page.getByTestId('cancel-batch').click();
  await closed;
  await expect(page.getByTestId('batch-progress')).toHaveCount(0);
  await expect(page.getByRole('button', { name: zipButton })).toBeDisabled();
  const search = page.getByTestId('queue-search');
  const observedRows = page.getByTestId('queue-row');
  const resumeStart = performance.now();
  await page.getByTestId('resume-batch').click();
  const progressBefore = await liveProgress(page);
  const interactionStart = performance.now();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await search.pressSequentially('synthetic-00500');
  await expect(observedRows).toHaveCount(1);
  await expect(observedRows).toHaveAttribute('data-row', '500');
  const progressAfter = await liveProgress(page);
  const searchMs = Math.round(performance.now() - interactionStart);
  expect(progressAfter).toBeGreaterThanOrEqual(progressBefore);
  for (const sample of [cancelledAt, progressBefore, progressAfter]) expect(sample % 25).toBe(0);
  await expect(page.getByTestId('ready-count')).toHaveText('498', { timeout: 110_000 });
  const preflightMs = Math.round(performance.now() - resumeStart);
  await expect(page.getByTestId('flagged-count')).toHaveText('2');
  await expect(page.getByTestId('total-count')).toHaveText('500');
  expect(traffic.workers.filter(workerUrl)).toHaveLength(2);
  expect(page.workers().filter(item => workerUrl(item.url()))).toHaveLength(1);
  expect(page.workers().includes(first)).toBe(false);
  const editor = await selectEditor(page, 500);
  await expect(editor.getByRole('textbox', { name: 'Employee ID', exact: true })).toHaveValue('00500');
  await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name(500));
  await expect(page.locator('#preview')).toContainText('Generated row');
  await canvasInk(page);
  const audit = JSON.parse(await readFile(await download(page, 'Download Preflight Audit (.json)', info.outputPath('500'), 'arabiform-preflight.json'), 'utf8')) as {
    rowNumber: number; status: string; filename: string;
  }[];
  expect(audit.map(({ rowNumber, status, filename }) => [rowNumber, status, filename])).toEqual(
    rows.map(([code], i) => [i + 1, bad.has(i + 1) ? 'flagged' : 'pass', code + '.pdf']));
  await noOverflow(page);
  await receipt(info, 'scale-500', { rows: 500, ready: 498, flagged: [...bad], cancelledAt, progressBefore, progressAfter,
    searchMs, preflightMs, uploadCancelResumeMs: Math.round(performance.now() - started), readBackRow500: rows[499],
    workerInstances: traffic.workers.filter(workerUrl) });
});
