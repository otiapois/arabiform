import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { expect, golden, noOverflow, test } from './browser';
import { download } from './downloads';
import { auditPage } from './m10-accessibility';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const branch = 'الرياض';
const clinics = [branch, 'Jeddah', branch, '', 'CON', branch, 'West/A', 'WestA'];
const ids = ['00123', '00123', '00123', '00004', '00005', '00006', '00007', '00008'];
const names = ['سلمى', 'Layla', 'نور', 'Mary', 'عمر', 'Adam', 'هدى', 'Rose'];
const expectedPaths = [branch + '/00123.pdf', 'Jeddah/00123.pdf', branch + '/00123-2.pdf',
  '_Ungrouped/00004.pdf', '_CON/00005.pdf', branch + '/00006.pdf', 'WestA/00007.pdf', 'WestA-2/00008.pdf'];
const csvFile = (name: string, header: string[], records: string[][]) =>
  ({ name, mimeType: 'text/csv', buffer: Buffer.from(Papa.unparse([header, ...records])) });

async function capture(page: Page, info: TestInfo, name: string, anchor: Locator) {
  const directory = process.env.ARABIFORM_CAPTURE_M16_SCREENSHOTS === '1'
    ? resolve('docs/reports/screenshots/m16') : info.outputPath('screenshots');
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await anchor.evaluate(el => { el.scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy({ top: -12, behavior: 'instant' }); });
  await page.screenshot({ path: join(directory, name), animations: 'disabled' });
}

async function save(page: Page, button: Locator, dir: string) {
  await mkdir(dir, { recursive: true });
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(file.suggestedFilename()).toBe(basename(file.suggestedFilename()));
  const path = join(dir, file.suggestedFilename());
  await file.saveAs(path);
  expect(await file.failure()).toBeNull();
  return path;
}

function coverText(doc: PDFDocument) {
  const contents = doc.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(item => doc.context.lookup(item)) : [contents];
  const text = streams.map(item => {
    expect(item).toBeInstanceOf(PDFRawStream);
    return Buffer.from(decodePDFRawStream(item as PDFRawStream).decode()).toString('latin1');
  }).join('\n');
  return Array.from(text.matchAll(/\/ActualText <([0-9A-F]+)>/g), ([, hex]) =>
    new TextDecoder('utf-16be').decode(Buffer.from(hex!, 'hex')));
}

async function openRoster(page: Page, header = 'Clinic') {
  const roster = csvFile('bilingual-clinics.csv', ['Name', 'ID', header], clinics.map((group, i) => [names[i]!, ids[i]!, group]));
  await page.getByTestId('roster-upload').setInputFiles(roster);
  await expect(page.getByTestId('ready-count')).toHaveText(String(names.length));
  return roster;
}

for (const arabic of [false, true]) {
  test('M16 ' + (arabic ? 'Arabic' : 'English') + ' cold entry, grouped ZIP and split bilingual sheet indices match the downloaded custody bytes', async ({ page }, info) => {
    const scripts: string[] = [];
    page.context().on('request', request => {
      const path = new URL(request.url()).pathname;
      if (/\.m?js$/i.test(path)) scripts.push(path);
    });
    await page.goto(arabic ? '/ar/' : '/', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('dir', arabic ? 'rtl' : 'ltr');
    const idle = [...scripts];
    expect(idle).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
    await page.getByTestId('pdf-upload').setInputFiles(golden('template.pdf'));
    const roster = await openRoster(page);
    const select = page.getByTestId('group-by-column');
    await expect(select).toHaveAccessibleName(arabic ? 'تجميع الملفات حسب العمود' : 'Group files by column');
    await expect(select.locator('option:checked')).toHaveText(arabic ? 'بلا تجميع (مجلد واحد)' : 'None (single folder)');
    await expect(page.getByTestId('download-split')).toHaveCount(0);
    await page.locator('.pattern-input').fill('{{ID}}.pdf');
    await select.selectOption('Clinic');
    const summary = page.getByTestId('grouped-export-summary');
    await expect(summary).toContainText('_Ungrouped');
    for (const [i, path] of expectedPaths.entries()) {
      const row = page.getByTestId('queue-row').filter({ has: page.locator('.filename') }).nth(i);
      await expect(row).toHaveAttribute('data-row', String(i + 1));
      await expect(row.locator('.filename')).toHaveText(path.split('/')[1]!);
      await expect(row.getByTestId('filename-adjusted')).toHaveCount(i === 2 ? 1 : 0);
    }
    const search = page.getByTestId('queue-search');
    await search.fill('00123-2.pdf');
    const match = page.getByTestId('queue-row');
    await expect(match).toHaveCount(1);
    await expect(match).toHaveAttribute('data-row', '3');
    await match.getByRole('button').click();
    await expect(page.locator('.row-summary .filename')).toHaveText('00123-2.pdf');
    await search.fill('');
    await summary.locator('summary').click();
    await expect(summary.locator('li')).toHaveCount(6);
    await page.getByTestId('include-cover-sheet').check();
    await page.getByTestId('cover-language').selectOption('bilingual');
    await page.getByTestId('imposition').selectOption('2-up');
    const measures = await auditPage(page, 'workbench');
    await noOverflow(page);
    if (!arabic && info.project.name === 'desktop') await capture(page, info, 'desktop-m16-grouped-export.png', summary.locator('..').locator('..'));
    if (arabic && info.project.name === 'mobile') await capture(page, info, 'mobile-m16-grouped.png', summary);
    const dir = info.outputPath('downloads');
    const zip = await download(page, arabic ? 'نزّل ملفات PDF الجاهزة (ZIP)' : 'Download Clean PDFs (.zip)', dir, 'arabiform-clean.zip');
    const records = unzipSync(await readFile(zip));
    expect(Object.keys(records).sort()).toEqual([...expectedPaths].sort());
    for (const [i, path] of expectedPaths.entries()) {
      const form = (await PDFDocument.load(records[path]!)).getForm();
      expect(form.getTextField('Name').getText()).toBe(names[i]);
      expect(form.getTextField('ID').getText()).toBe(ids[i]);
    }
    const standalone = async (label: string) => JSON.parse(await readFile(await save(page, page.getByTestId('custody-download'), join(dir, label)), 'utf8'));
    const custody = await standalone('individual');
    const entries = expectedPaths.map(zipPath => ({ zipPath, filename: zipPath.split('/')[1], bytes: records[zipPath]!.length, sha256: sha(records[zipPath]!) }));
    expect(custody).toMatchObject({ templateSha256: sha(await readFile(golden('template.pdf'))), rosterSha256: sha(roster.buffer), entries });
    const json = await download(page, arabic ? 'نزّل تقرير الفحص (JSON)' : 'Download Preflight Audit (.json)', dir, 'arabiform-preflight.json');
    const csv = await download(page, arabic ? 'نزّل تقرير الفحص (CSV)' : 'Download Preflight Audit (.csv)', dir, 'arabiform-preflight.csv');
    const audit = JSON.parse(await readFile(json, 'utf8')) as { rowNumber: number; zipPath: string }[];
    const csvRows = Papa.parse<Record<string, string>>(await readFile(csv, 'utf8'), { header: true, skipEmptyLines: true });
    expect(csvRows.errors).toEqual([]);
    expect(audit.map(r => [r.rowNumber, r.zipPath])).toEqual(expectedPaths.map((p, i) => [i + 1, p]));
    expect(csvRows.data.map(r => [Number(r.rowNumber), r.zipPath])).toEqual(audit.map(r => [r.rowNumber, r.zipPath]));
    const split = page.getByTestId('download-split');
    await expect(split).toHaveAccessibleName(arabic ? 'تنزيل ملفات PDF المدمجة لكل مجموعة (.zip)' : 'Download Split Merged PDFs by Group (.zip)');
    const glyphs = await split.locator('bdi[dir=ltr]').evaluate(el => {
      const node = el.firstChild!;
      return Array.from(node.textContent!, (char, i) => {
        const range = document.createRange();
        range.setStart(node, i); range.setEnd(node, i + 1);
        return { char, left: range.getBoundingClientRect().left };
      });
    });
    expect(glyphs.map(g => g.char).join('')).toBe('(.zip)');
    expect(glyphs.map(g => g.left)).toEqual([...glyphs.map(g => g.left)].sort((a, b) => a - b));
    const packets = unzipSync(await readFile(await save(page, split, dir)));
    const receipt = JSON.parse(new TextDecoder().decode(packets['batch-custody.json']));
    const groups = [...new Set(expectedPaths.map(p => p.split('/')[0]!))];
    expect(Object.keys(packets).sort()).toEqual(['batch-custody.json', ...groups.map(g => g + '-merged.pdf')].sort());
    expect(receipt).toMatchObject({ groupByColumn: 'Clinic', templateSha256: custody.templateSha256, rosterSha256: custody.rosterSha256 });
    expect(receipt.groups).toHaveLength(groups.length);
    const covers = [];
    for (const folder of groups) {
      const path = folder + '-merged.pdf', bytes = packets[path]!;
      const rowNumbers = expectedPaths.flatMap((p, i) => p.startsWith(folder + '/') ? [i + 1] : []);
      const groupValue = clinics[rowNumbers[0]! - 1] || null;
      expect(receipt.groups).toContainEqual({ folder, groupValue, filename: path, zipPath: path, rowNumbers, bytes: bytes.length, sha256: sha(bytes) });
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.catalog.has(PDFName.of('AcroForm'))).toBe(false);
      expect(pdf.getPageCount()).toBe(1 + Math.ceil(rowNumbers.length / 2));
      for (const sheet of pdf.getPages().slice(1)) {
        const axes = [sheet.getWidth(), sheet.getHeight()].sort((a, b) => a - b);
        expect(axes[0]).toBeCloseTo(595.28, 1);
        expect(axes[1]).toBeCloseTo(841.89, 1);
      }
      const text = coverText(pdf);
      expect(text).toContain('Sheets');
      expect(text).toContain('الأوراق');
      const cells = text.slice(text.indexOf('الأوراق') + 1);
      expect(cells).toEqual(rowNumbers.flatMap((row, i) => [String(i + 1), String(row), expectedPaths[row - 1]!.split('/')[1], String(2 + Math.floor(i / 2))]));
      covers.push({ path, rowNumbers, cells });
    }
    expect((await standalone('split')).groups).toEqual(receipt.groups);
    await writeFile(info.outputPath('grouped.json'), JSON.stringify({ idle, accessibility: measures, entries, covers }, null, 2));
    await noOverflow(page);
  });
}

test('M16 v9 restores the exact grouping header, rejects its missing case variant and imports all eight flat legacy presets', async ({ page }, info) => {
  await page.goto('/');
  await page.getByTestId('pdf-upload').setInputFiles(golden('template.pdf'));
  await openRoster(page);
  const group = page.getByTestId('group-by-column'), upload = page.getByTestId('preset-upload');
  await group.selectOption('Clinic');
  const path = await save(page, page.getByTestId('preset-download'), info.outputPath('presets'));
  const data = JSON.parse(await readFile(path, 'utf8'));
  expect(data).toMatchObject({ version: 9, groupByColumn: 'Clinic' });
  for (let version = 1; version <= 8; version++) {
    const filenamePattern = 'legacy' + version + '-{{ID}}.pdf';
    const legacy = { version, filenamePattern, mapping: { Name: 'Name', ID: 'ID' }, minFontSize: 8, font: 'auto',
      ...(version >= 2 && { flattenZip: false }), ...(version >= 3 && { includeCoverSheet: false }),
      ...(version >= 4 && { alignOverrides: {} }), ...(version >= 5 && { watermark: { kind: 'none' } }),
      ...(version >= 6 && { virtualMappings: {} }), ...(version >= 7 && { qrStamp: { placement: 'none' }, coverLanguage: 'auto' }),
      ...(version === 8 && { imposition: '2-up' }) };
    await upload.setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
    await expect(page.locator('.pattern-input')).toHaveValue(filenamePattern);
    await expect(group).toHaveValue('');
    await expect(page.getByTestId('download-split')).toHaveCount(0);
    await expect(page.getByTestId('imposition')).toHaveValue(version === 8 ? '2-up' : '1-up');
    await upload.setInputFiles(path);
    await expect(group).toHaveValue('Clinic');
    await expect(page.getByTestId('download-split')).toBeEnabled();
  }
  await openRoster(page, 'clinic');
  await upload.setInputFiles(path);
  await expect(page.getByTestId('grouping-column-missing')).toBeVisible();
  await expect(group).toHaveValue('Clinic');
  await expect(group).toHaveAttribute('aria-invalid', 'true');
  for (const button of ['Download Clean PDFs (.zip)', 'Download Preflight Audit (.csv)', 'Download Preflight Audit (.json)'])
    await expect(page.getByRole('button', { name: button, exact: true })).toBeDisabled();
  await group.selectOption('clinic');
  await expect(page.getByTestId('grouping-column-missing')).toHaveCount(0);
  await expect(page.getByTestId('download-split')).toBeEnabled();
  await noOverflow(page);
});

test('M16 draws native dropdown and radio widgets, fills all bilingual choices and extracts the exact editable ZIP bytes', async ({ page }, info) => {
  await page.goto('/');
  await page.getByTestId('mode-design').click();
  await page.getByTestId('designer-upload').setInputFiles(golden('flat.pdf'));
  const stage = page.getByTestId('designer-stage'), inspector = page.locator('.designer-inspector');
  await expect(page.getByTestId('designer-canvas')).toHaveAttribute('data-rendered', 'true');
  const place = async (x: number, y: number) => {
    const box = (await stage.boundingBox())!;
    const position = { x: box.width * x, y: box.height * y };
    if (info.project.use.hasTouch) await stage.tap({ position });
    else await stage.click({ position });
  };
  const edit = async (id: string, value: string) => {
    const input = page.getByTestId(id);
    await input.fill(value);
    await input.press('Enter');
    await expect(input).toHaveValue(value);
  };
  const options = ['RIY', 'JED', 'جدة'], contacts = ['CALL', 'MAIL', 'MAIL'];
  await page.getByTestId('designer-tool-dropdown').click();
  await place(.34, .32);
  await edit('designer-field-name', 'Clinic');
  const editor = page.getByTestId('designer-dropdown-options');
  await editor.fill(options.join('\n'));
  await expect(page.getByTestId('designer-download')).toBeDisabled();
  await page.getByTestId('designer-apply-options').click();
  await expect(editor).toHaveValue(options.join('\n'));
  await page.getByTestId('designer-tool-radio').click();
  await place(.24, .41);
  await expect(page.getByTestId('designer-field-name')).toHaveAccessibleName('Group name');
  await edit('designer-field-name', 'Contact');
  await edit('designer-radio-export', 'CALL');
  await place(.47, .41);
  await expect(page.getByTestId('designer-field-name')).toHaveValue('Contact');
  await edit('designer-radio-export', 'MAIL');
  await expect(stage.getByTestId('designer-field')).toHaveCount(3);
  await stage.getByRole('button', { name: 'Clinic', exact: true }).click();
  await expect(editor).toHaveValue(options.join('\n'));
  const measures = await auditPage(page, 'workbench');
  await noOverflow(page);
  if (info.project.name === 'desktop') await capture(page, info, 'desktop-m16-designer-choices.png', inspector);
  const dir = info.outputPath('downloads');
  const template = await save(page, page.getByTestId('designer-download'), dir);
  const authored = (await PDFDocument.load(await readFile(template))).getForm();
  expect(authored.getFields().map(f => f.getName())).toEqual(['Clinic', 'Contact']);
  const dropdown = authored.getDropdown('Clinic'), radio = authored.getRadioGroup('Contact');
  expect(dropdown.acroField.dict.get(PDFName.of('FT'))?.toString()).toBe('/Ch');
  expect(dropdown.acroField.getFlags() & (1 << 17)).toBeTruthy();
  expect(dropdown.getOptions()).toEqual(options);
  expect(radio.acroField.dict.get(PDFName.of('FT'))?.toString()).toBe('/Btn');
  expect(radio.acroField.getFlags() & (1 << 15)).toBeTruthy();
  expect(radio.getOptions()).toEqual(['CALL', 'MAIL']);
  const onStates = radio.acroField.getWidgets().map(widget => {
    const normal = widget.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFDict);
    const states = normal.keys().map(key => key.decodeText());
    expect(states).toHaveLength(2);
    expect(states).toContain('Off');
    for (const key of normal.keys()) expect(normal.lookup(key, PDFRawStream).getContents().length).toBeGreaterThan(0);
    expect(widget.getAppearanceState()?.decodeText()).toBe('Off');
    return states.find(s => s !== 'Off')!;
  });
  expect(new Set(onStates).size).toBe(2);
  await page.getByTestId('designer-use-fill').click();
  await expect(page.getByTestId('mode-fill')).toHaveAttribute('aria-pressed', 'true');
  const keys = ['00123', '00007', '00003'];
  await page.getByTestId('roster-upload').setInputFiles(csvFile('synthetic-choices.csv', ['Clinic', 'Contact', 'ID'],
    options.map((value, i) => [value, contacts[i]!, keys[i]!])));
  for (const column of ['Clinic', 'Contact']) await page.locator('[data-pdf-field="' + column + '"]').selectOption(column);
  await page.locator('.pattern-input').fill('{{ID}}.pdf');
  await expect(page.getByTestId('ready-count')).toHaveText('3');
  await expect(page.getByTestId('flatten-zip')).not.toBeChecked();
  const archive = unzipSync(await readFile(await download(page, 'Download Clean PDFs (.zip)', dir, 'arabiform-clean.zip')));
  expect(Object.keys(archive)).toEqual(keys.map(id => id + '.pdf'));
  const files = [], cases = [];
  for (const [i, [filename, bytes]] of Object.entries(archive).entries()) {
    const path = join(dir, filename);
    await writeFile(path, bytes);
    files.push(path);
    const form = (await PDFDocument.load(bytes)).getForm(), filled = form.getRadioGroup('Contact');
    expect(form.getDropdown('Clinic').getSelected()).toEqual([options[i]]);
    expect(filled.getSelected()).toBe(contacts[i]);
    const widgets = onStates.map((state, index) => index === (i === 0 ? 0 : 1) ? state : 'Off');
    expect(filled.acroField.getWidgets().map(widget => widget.getAppearanceState()?.decodeText())).toEqual(widgets);
    expect(filled.acroField.dict.lookup(PDFName.of('V'), PDFName).decodeText()).toBe(widgets.find(state => state !== 'Off'));
    cases.push({ before: basename(template), after: filename, values: { Clinic: options[i], Contact: contacts[i] },
      dropdowns: { Clinic: { label: options[i] } }, radios: { Contact: { widgets } } });
  }
  const pixelManifest = join(dir, 'download-pixels.json');
  await writeFile(pixelManifest, JSON.stringify({ cases }));
  execFileSync('python', ['scripts/verify-pdf-pixels.py', pixelManifest], { windowsHide: true });
  await page.getByTestId('mode-extract').click();
  await page.getByTestId('extract-pdf-upload').setInputFiles(files);
  await expect(page.getByTestId('extract-row')).toHaveCount(3);
  const audit = JSON.parse(await readFile(await save(page, page.getByTestId('extract-download-audit'), dir), 'utf8'));
  const extracted = await readFile(await save(page, page.getByTestId('extract-download-csv'), dir));
  expect(audit.csvSha256).toBe(sha(extracted));
  const csv = Papa.parse<string[]>(extracted.toString('utf8'), { skipEmptyLines: true });
  expect(csv.errors).toEqual([]);
  for (const [i, [filename, bytes]] of Object.entries(archive).entries()) {
    expect(audit.rows[i]).toMatchObject({ filename, status: 'extracted', sourceSha256: sha(bytes),
      fields: { Clinic: { kind: 'dropdown', value: options[i] }, Contact: { kind: 'radio', value: contacts[i] } } });
    expect(csv.data[i + 1]).toEqual(expect.arrayContaining([filename, sha(bytes), options[i], contacts[i]]));
    await expect(page.getByTestId('extract-row').nth(i)).toContainText(options[i]!);
  }
  await noOverflow(page);
  await writeFile(info.outputPath('designer.json'), JSON.stringify({ options, onStates, accessibility: measures, rows: audit.rows }, null, 2));
});
