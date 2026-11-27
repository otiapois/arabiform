import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument, rgb } from 'pdf-lib';
import { canvasInk, expect, golden, noOverflow, test } from './browser';
import { download } from './downloads';
import { receipt } from './m7-evidence';

const selector = (page: Page, field: string) => page.locator('[data-pdf-field="' + field + '"]');
const row = (page: Page, field: string) => page.locator('[data-mapping-field="' + field + '"]');
const overlay = (page: Page, field: string, index = 1) =>
  page.locator('[data-testid="widget-overlay"][data-field="' + field + '"][data-widget-index="' + index + '"]');
const roster = { name: 'Synthetic names.csv', mimeType: 'text/csv',
  buffer: Buffer.from('Name,ROW_INDEX,@PADDED_ROW_001\r\nHana,00701,00901\r\nMona,00702,00902\r\n') };
const presetName = 'arabiform-mapping-preset.json';
const pattern = 'take-{{ROW_INDEX}}-{{@PADDED_ROW_001}}-[[@PADDED_ROW_001]].pdf';

async function workshop(page: Page) {
  await page.goto('/');
  await page.getByTestId('sample-workshop').click();
  await canvasInk(page);
  await page.getByTestId('roster-upload').setInputFiles(roster);
  await expect(page.getByTestId('ready-count')).toHaveText('2');
  await expect(page.locator('.preview-heading')).toContainText('Generated row');
  await canvasInk(page);
}

async function virtual(page: Page, field: string, id: string) {
  const control = selector(page, field);
  const option = control.locator('optgroup option[data-virtual-column="' + id + '"]');
  await control.selectOption({ label: (await option.textContent())! });
}

async function screenshot(page: Page, name: string, field: string) {
  if (process.env.ARABIFORM_CAPTURE_M11_SCREENSHOTS !== '1') return;
  await page.locator('.canvas-paper').evaluate(async el => {
    await document.fonts.ready;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  const dir = resolve('docs/reports/screenshots/m11');
  await mkdir(dir, { recursive: true });
  await expect(page.locator('.preview-heading')).toContainText('Generated row');
  await canvasInk(page);
  await expect(overlay(page, field)).toHaveAttribute('data-active', 'true');
  await expect(overlay(page, field)).toBeInViewport();
  await page.screenshot({ path: join(dir, name + '.png'), animations: 'disabled' });
}

async function serialPreview(page: Page) {
  // Crop the actual Workshop canvas inside the ID widget border; the rows differ only in the serial's final digit here.
  return page.locator('canvas[data-rendered="true"]').evaluate((c: HTMLCanvasElement) => {
    const scale = c.width / 612;
    const data = c.getContext('2d')!.getImageData(Math.ceil(68 * scale), Math.ceil(324 * scale),
      Math.floor(208 * scale), Math.floor(28 * scale)).data;
    let hash = 2166136261, dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      hash = Math.imul(hash ^ data[i]!, 16777619);
      if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) < 140) dark++;
    }
    return { hash, dark };
  });
}

test('M11 Workshop canvas maps by pointer and keyboard, previews two serials and exports unclipped computed values', async ({ page }, info) => {
  // Keep the browser's actual local day stable even when a run crosses midnight.
  await page.clock.setFixedTime(new Date());
  await workshop(page);
  const id = selector(page, 'ID');
  const idBox = overlay(page, 'ID');
  await expect(idBox).toHaveRole('button');
  await expect(idBox).toHaveAccessibleName(/ID/);
  await idBox.click();
  await expect(id).toBeFocused();
  await expect(row(page, 'ID')).toHaveAttribute('data-active', 'true');
  await expect(idBox).toHaveAttribute('data-active', 'true');
  await screenshot(page, info.project.name === 'desktop' ? 'desktop-m11-canvas-click-map' : 'mobile-m11-canvas-map', 'ID');
  await expect(id.locator('optgroup[label="Virtual columns (computed locally)"] > option')).toHaveCount(4);
  await virtual(page, 'ID', 'PADDED_ROW_001');
  const title = overlay(page, 'Title');
  await title.focus();
  await page.keyboard.press('Enter');
  await expect(selector(page, 'Title')).toBeFocused();
  await expect(row(page, 'Title')).toHaveAttribute('data-active', 'true');
  await virtual(page, 'Title', 'PADDED_ROW_001');
  await page.locator('[data-virtual-template-field="Title"]').fill('CERT-{{PADDED_ROW_001}}');
  await virtual(page, 'Notes', 'TODAY_AR');
  await expect(page.locator('[data-virtual-filename-token="PADDED_ROW_001"]')).toHaveText('[[@PADDED_ROW_001]]');
  await page.locator('.pattern-input').fill(pattern);
  await expect(page.getByTestId('ready-count')).toHaveText('2');
  await expect(page.locator('.preview-heading')).toContainText('Generated row');
  await canvasInk(page);
  if (info.project.name === 'desktop') await screenshot(page, 'desktop-m11-virtual-serial', 'Title');
  await mkdir(info.outputDir, { recursive: true });
  const activeInk = info.outputPath('active-title.png');
  const inactiveInk = info.outputPath('inactive-title.png');
  await expect(title).toHaveAttribute('data-active', 'true');
  await title.screenshot({ path: activeInk });
  await id.focus();
  await expect(idBox).toHaveAttribute('data-active', 'true');
  await title.screenshot({ path: inactiveInk });
  const overlayInk = execFileSync('python', ['tests/e2e/m11-overlay-ink.py', inactiveInk, activeInk], { encoding: 'utf8', windowsHide: true });
  await receipt(info, 'selected-glyph-ink', JSON.parse(overlayInk));
  await page.locator('.preview-toolbar select').selectOption('1.25');
  await canvasInk(page);
  const first = await serialPreview(page);
  expect(first.dark).toBeGreaterThan(5);
  await page.locator('[data-row="2"] .row-link').click();
  await expect.poll(async () => {
    const rendered = await serialPreview(page);
    return rendered.dark > 5 && rendered.hash !== first.hash;
  }).toBe(true);
  const second = await serialPreview(page);
  expect(second.dark).toBeGreaterThan(5);
  await page.locator('[data-row="1"] .row-link').click();
  await expect.poll(async () => (await serialPreview(page)).hash).toBe(first.hash);
  await receipt(info, 'preview', { first, second });

  const out = info.outputPath('virtual-downloads');
  const saved = await download(page, 'Export mapping preset', out, presetName);
  const preset = JSON.parse(await readFile(saved, 'utf8'));
  expect(preset).toMatchObject({ version: 6, filenamePattern: pattern, virtualMappings: {
    ID: { column: 'PADDED_ROW_001' }, Title: { column: 'PADDED_ROW_001', template: 'CERT-{{PADDED_ROW_001}}' },
    Notes: { column: 'TODAY_AR' } } });
  await id.selectOption('ROW_INDEX');
  await page.locator('.pattern-input').fill('changed.pdf');
  await page.getByTestId('preset-upload').setInputFiles(saved);
  await expect(page.locator('.pattern-input')).toHaveValue(pattern);
  await expect(id.locator('option:checked')).toHaveAttribute('data-virtual-column', 'PADDED_ROW_001');
  await expect(page.locator('[data-virtual-template-field="Title"]')).toHaveValue('CERT-{{PADDED_ROW_001}}');
  await expect(page.getByTestId('preset-warning')).toHaveCount(0);
  await expect(page.getByTestId('ready-count')).toHaveText('2');
  const filenames = ['take-00701-00901-0001.pdf', 'take-00702-00902-0002.pdf'];
  const json = JSON.parse(await readFile(await download(page, 'Download Preflight Audit (.json)', out, 'arabiform-preflight.json'), 'utf8'));
  const csv = Papa.parse<Record<string, string>>(await readFile(await download(page, 'Download Preflight Audit (.csv)', out, 'arabiform-preflight.csv'), 'utf8'), { header: true, skipEmptyLines: true });
  expect(csv.errors).toEqual([]);
  expect(csv.meta.fields).toEqual(['rowNumber', 'filename', 'status', 'diagnostics', 'fontSizes']);
  expect(json).toEqual(csv.data.map(r => ({ rowNumber: Number(r.rowNumber), filename: r.filename, status: r.status,
    diagnostics: JSON.parse(r.diagnostics!), fontSizes: JSON.parse(r.fontSizes!) })));
  const zip = unzipSync(await readFile(await download(page, 'Download Clean PDFs (.zip)', out, 'arabiform-clean.zip')));
  expect(Object.keys(zip)).toEqual(filenames);
  const localDay = await page.evaluate(() => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const dayAr = localDay.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
  const cases = [];
  await writeFile(join(out, 'before.pdf'), await readFile(golden('template.pdf')));
  for (const [i, name] of filenames.entries()) {
    const serial = ['0001', '0002'][i]!;
    const values = { ID: serial, Title: 'CERT-' + serial, Name: ['Hana', 'Mona'][i]!, Notes: dayAr };
    expect(json[i]).toMatchObject({ rowNumber: i + 1, filename: name, status: 'pass', diagnostics: [] });
    expect(Object.keys(json[i].fontSizes).sort()).toEqual(Object.keys(values).sort());
    const pdf = await PDFDocument.load(zip[name]!);
    for (const [field, value] of Object.entries(values)) expect(pdf.getForm().getTextField(field).getText()).toBe(value);
    expect(pdf.getForm().getTextField('Sentinel').getText()).toBe('KEEP 00109');
    await writeFile(join(out, name), zip[name]!);
    cases.push({ before: 'before.pdf', after: name, values });
  }
  const manifest = join(out, 'manifest.json');
  await writeFile(manifest, JSON.stringify({ cases }));
  execFileSync('python', ['scripts/verify-pdf-pixels.py', manifest], { encoding: 'utf8', windowsHide: true });
  const proof = JSON.parse(await readFile(join(out, 'manifest-verification.json'), 'utf8'));
  expect(proof.scale).toBe(4);
  expect(proof.cases).toHaveLength(2);
  for (const result of proof.cases) {
    expect(result).toMatchObject({ outsideMappedWidgetChangedPixels: 0, clippedInkPixels: 0 });
    expect(result.widgets).toHaveLength(4);
  }
  await noOverflow(page);
});

test('M11 imports v1–v5 and restores a filename-only v6 while literal columns retain their own values', async ({ page }, info) => {
  await workshop(page);
  const mapping = { Name: 'Name', ID: 'ROW_INDEX', Title: '@PADDED_ROW_001' };
  for (const version of [1, 2, 3, 4, 5]) {
    const filenamePattern = 'v' + version + '-{{ROW_INDEX}}.pdf';
    const settings = { version, mapping, minFontSize: 8, font: 'auto', filenamePattern,
      ...(version >= 2 && { flattenZip: false }), ...(version >= 3 && { includeCoverSheet: false }),
      ...(version >= 4 && { alignOverrides: { Name: 'center' } }),
      ...(version >= 5 && { watermark: { kind: 'draft-ar', opacity: 0.2, angle: -45 } }) };
    await page.getByTestId('preset-upload').setInputFiles({ name: 'v' + version + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(settings)) });
    await expect(page.locator('.pattern-input')).toHaveValue(filenamePattern);
    await expect(selector(page, 'ID')).toHaveValue('ROW_INDEX');
    await expect(selector(page, 'Title')).toHaveValue('@PADDED_ROW_001');
    await expect(page.getByTestId('preset-error')).toHaveCount(0);
    await expect(page.getByTestId('preset-warning')).toHaveCount(0);
  }
  await page.locator('.pattern-input').fill(pattern);
  const file = await download(page, 'Export mapping preset', info.outputPath('filename-only'), presetName);
  expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 6, mapping, virtualMappings: {}, filenamePattern: pattern });
  await page.reload();
  await workshop(page);
  await page.getByTestId('preset-upload').setInputFiles(file);
  await expect(page.locator('.pattern-input')).toHaveValue(pattern);
  await expect(page.getByTestId('preset-error')).toHaveCount(0);
  const zip = unzipSync(await readFile(await download(page, 'Download Clean PDFs (.zip)', info.outputPath('filename-only'), 'arabiform-clean.zip')));
  const filenames = ['take-00701-00901-0001.pdf', 'take-00702-00902-0002.pdf'];
  expect(Object.keys(zip)).toEqual(filenames);
  for (const [i, name] of filenames.entries()) {
    const form = (await PDFDocument.load(zip[name]!)).getForm();
    expect(form.getTextField('ID').getText()).toBe('0070' + (i + 1));
    expect(form.getTextField('Title').getText()).toBe('0090' + (i + 1));
  }
  await noOverflow(page);
});

test('M11 RTL cropped pages keep zoomed overlays on the painted widget at all four rotations', async ({ page }, info) => {
  await page.goto('/ar/pdf-mail-merge');
  const original = await PDFDocument.load(await readFile(golden('edge-cases.pdf')));
  const widgets = original.getForm().getTextField('Repeated').acroField.getWidgets();
  for (const [i, p] of original.getPages().entries()) {
    p.setCropBox(12, 15, 380, 508);
    // A bright ring immediately outside the true annotation stays visible in the PDF.js canvas.
    const r = widgets[i]!.getRectangle();
    p.drawRectangle({ x: r.x - 2, y: r.y - 2, width: r.width + 4, height: r.height + 4, color: rgb(1, 0, 1) });
  }
  await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic cropped rotations.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await original.save({ updateFieldAppearances: false })) });
  await page.getByTestId('roster-upload').setInputFiles({ name: 'repeat.csv', mimeType: 'text/csv', buffer: Buffer.from('Repeated\nTest\n') });
  await expect(page.getByTestId('ready-count')).toHaveText('1');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('[data-virtual-filename-token="TODAY_AR"]')).toBeVisible();
  const measures = [];
  const zoom = page.locator('.preview-toolbar select');
  for (const size of ['fit', '1.25']) {
    await zoom.selectOption(size);
    for (const number of [1, 2, 3, 4]) {
      await page.locator('[data-page="' + number + '"]').click();
      const box = overlay(page, 'Repeated', number);
      await expect(box).toBeVisible();
      const geometry = await box.evaluate(el => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-rendered="true"]')!;
        const bitmap = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
        let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
        for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) {
          const k = 4 * (y * bitmap.width + x);
          if (bitmap.data[k]! < 210 || bitmap.data[k + 1]! > 100 || bitmap.data[k + 2]! < 210) continue;
          x0 = Math.min(x, x0); x1 = Math.max(x, x1); y0 = Math.min(y, y0); y1 = Math.max(y, y1);
        }
        const c = canvas.getBoundingClientRect(), b = el.getBoundingClientRect();
        const sx = c.width / canvas.width, sy = c.height / canvas.height;
        return { ring: [x0, y0, x1, y1], error: [b.left - c.left - x0 * sx, b.top - c.top - y0 * sy,
          c.left + (x1 + 1) * sx - b.right, c.top + (y1 + 1) * sy - b.bottom] };
      });
      expect(geometry.ring[2]).toBeGreaterThan(geometry.ring[0]!);
      expect(geometry.ring[3]).toBeGreaterThan(geometry.ring[1]!);
      for (const edge of geometry.error) { expect(edge).toBeGreaterThan(-1.25); expect(edge).toBeLessThan(5); }
      measures.push({ size, page: number, ...geometry });
    }
  }
  const multiline = selector(page, 'Multiline');
  await multiline.focus();
  await expect(page.locator('[data-page="2"]')).toHaveAttribute('aria-current', 'page');
  await expect(overlay(page, 'Multiline')).toHaveAttribute('data-active', 'true');
  await overlay(page, 'Repeated', 2).focus();
  await page.keyboard.press('Space');
  await expect(selector(page, 'Repeated')).toBeFocused();
  await expect(overlay(page, 'Repeated', 2)).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-page="2"]')).toHaveAttribute('aria-current', 'page');
  await receipt(info, 'canvas-geometry', measures);
  await noOverflow(page);
});
