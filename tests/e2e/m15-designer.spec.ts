import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument, PDFName, TextAlignment } from 'pdf-lib';
import { expect, golden, noOverflow, test } from './browser';
import { download } from './downloads';
import { auditPage } from './m10-accessibility';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const axes = ['x', 'y', 'w', 'h'] as const;
const nameRect = [74.5, 526.25, 265.75, 43.5] as const;
const checkRect = [75.25, 450.5, 22, 22] as const;
const field = (page: Page, name: string) => page.getByTestId('designer-stage').getByRole('button', { name, exact: true });

async function commitValue(input: Locator, value: string) {
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toHaveValue(value);
}

async function draw(page: Page, info: TestInfo, from: [number, number], to: [number, number]) {
  const stage = page.getByTestId('designer-stage');
  await expect(page.getByTestId('designer-canvas')).toHaveAttribute('data-rendered', 'true');
  await stage.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const box = (await stage.boundingBox())!;
  const point = ([u, v]: [number, number]) => ({ x: box.x + u * box.width, y: box.y + v * box.height });
  const a = point(from), b = point(to);
  const { width, height } = page.viewportSize()!;
  for (const p of [a, b]) {
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(width);
    expect(p.y).toBeLessThan(height);
  }
  if (info.project.use.hasTouch) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [b] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await client.detach();
    }
  } else {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
  }
}

async function setRect(page: Page, rect: readonly number[]) {
  for (const [i, axis] of axes.entries()) await commitValue(page.getByTestId('designer-' + axis), String(rect[i]));
}

async function save(page: Page, id: string, info: TestInfo, name: string) {
  return download(page, (await page.getByTestId(id).innerText()).trim(), info.outputPath('downloads'), name);
}

async function visibleInk(canvas: Locator) {
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await expect(canvas).toBeVisible();
  const ink = await canvas.evaluate((el: HTMLCanvasElement) => {
    const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    let dark = 0, light = 0;
    for (let n = 0; n < data.length; n += 4) {
      if (data[n + 3] === 255 && Math.max(data[n]!, data[n + 1]!, data[n + 2]!) < 140) dark++;
      if (data[n + 3] === 255 && Math.min(data[n]!, data[n + 1]!, data[n + 2]!) > 220) light++;
    }
    return { dark, light, pixels: el.width * el.height };
  });
  expect(ink.dark).toBeGreaterThan(200);
  expect(ink.light).toBeGreaterThan(ink.pixels * .5);
  return ink;
}

async function capture(page: Page, info: TestInfo, filename: string, anchor: Locator) {
  const directory = process.env.ARABIFORM_CAPTURE_M15_SCREENSHOTS === '1'
    ? resolve('docs/reports/screenshots/m15') : info.outputPath('screenshots');
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await anchor.evaluate(el => { el.scrollIntoView({ behavior: 'instant', block: 'start' }); window.scrollBy({ top: -12, behavior: 'instant' }); });
  await page.screenshot({ path: join(directory, filename), animations: 'disabled' });
}

test('M15 recovers a dropped flat PDF, restores its bound layout and reads both real editable ZIP records through Extract', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByTestId('mode-fill')).toHaveAttribute('aria-pressed', 'true');
  const original = await readFile(golden('flat.pdf'));
  const dropped = await page.evaluateHandle(encoded => {
    const files = new DataTransfer();
    const pdf = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    files.items.add(new File([pdf], 'flat.pdf', { type: 'application/pdf' }));
    return files;
  }, original.toString('base64'));
  const dropzone = page.locator('.file-box').filter({ has: page.getByTestId('pdf-upload') });
  await dropzone.dispatchEvent('dragover', { dataTransfer: dropped });
  await dropzone.dispatchEvent('drop', { dataTransfer: dropped });
  await dropped.dispose();
  await expect(page.getByRole('alert')).toContainText('No fillable text fields or checkboxes were found');
  await expect(page.getByTestId('mode-fill')).toHaveAttribute('aria-pressed', 'true');
  const recover = page.getByTestId('open-flat-designer');
  await expect(recover).toHaveAccessibleName(/Open in Visual Field Designer/i);
  await recover.click();
  await expect(page.getByTestId('mode-design')).toHaveAttribute('aria-pressed', 'true');
  const panel = page.getByTestId('field-designer');
  await expect(panel.getByText('flat.pdf', { exact: true })).toBeVisible();
  await expect(page.getByTestId('designer-download')).toBeDisabled();
  const sourceInk = await visibleInk(page.getByTestId('designer-canvas'));

  await page.getByTestId('designer-tool-text').click();
  await draw(page, info, [.13, .27], [.59, .34]);
  const drawn = await Promise.all(axes.map(async axis => Number(await page.getByTestId('designer-' + axis).inputValue())));
  // Independent geometry for the golden, unrotated 612 × 792 pt sheet. Pointer rounding varies with CSS scale.
  for (const [i, expected] of [612 * .13, 792 * .66, 612 * .46, 792 * .07].entries()) {
    expect(Math.abs(drawn[i]! - expected), 'drawn ' + axes[i]).toBeLessThan(4);
  }
  await commitValue(page.getByTestId('designer-field-name'), 'Name');
  await page.getByTestId('designer-alignment').selectOption('rtl');
  await page.getByTestId('designer-multiline').check();
  await commitValue(page.getByTestId('designer-max-length'), '64');
  await commitValue(page.getByTestId('designer-font-size'), '15');
  await setRect(page, nameRect);
  const name = field(page, 'Name');
  await name.press('ArrowRight');
  await expect(page.getByTestId('designer-x')).toHaveValue('75.5');
  await name.press('Shift+ArrowUp');
  await expect(page.getByTestId('designer-y')).toHaveValue('531.25');
  await name.press('Control+z');
  await expect(page.getByTestId('designer-y')).toHaveValue('526.25');
  await page.getByTestId('designer-undo').click();
  await expect(page.getByTestId('designer-x')).toHaveValue('74.5');
  await page.getByTestId('designer-tool-checkbox').click();
  await draw(page, info, [.13, .425], [.171, .457]);
  await commitValue(page.getByTestId('designer-field-name'), 'Verified');
  await setRect(page, checkRect);
  await field(page, 'Verified').press('Delete');
  await expect(field(page, 'Verified')).toHaveCount(0);
  await page.getByTestId('designer-undo').click();
  await expect(field(page, 'Verified')).toBeVisible();

  const layoutPath = await save(page, 'designer-save-layout', info, 'flat-field-layout.json');
  const layout = JSON.parse(await readFile(layoutPath, 'utf8'));
  expect(layout).toMatchObject({ version: 1, sourceSha256: sha(original), fields: [
    { name: 'Name', kind: 'text', rectPdf: nameRect, alignment: 'rtl', multiline: true, maxLen: 64, fontSize: 15 },
    { name: 'Verified', kind: 'checkbox', rectPdf: checkRect },
  ] });
  const upload = page.getByTestId('designer-upload');
  // Same visible filename and PDF page, distinct source bytes.
  await upload.setInputFiles({ name: 'flat.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([original, Buffer.from('\n% independent source revision\n')]) });
  await expect(page.getByTestId('designer-field')).toHaveCount(0);
  await page.getByTestId('designer-load-layout').setInputFiles(layoutPath);
  await expect(page.getByTestId('designer-error')).toHaveAttribute('data-code', 'layout-source-mismatch');
  await expect(page.getByTestId('designer-download')).toBeDisabled();
  await upload.setInputFiles(golden('flat.pdf'));
  await expect(page.getByTestId('designer-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.getByTestId('designer-load-layout').setInputFiles(layoutPath);
  await expect(name).toBeVisible();
  await expect(field(page, 'Verified')).toBeVisible();
  const templatePath = await save(page, 'designer-download', info, 'flat-acroform.pdf');
  const authored = await readFile(templatePath);
  const form = (await PDFDocument.load(authored)).getForm();
  expect(form.getFields().map(f => f.getName())).toEqual(['Name', 'Verified']);
  const text = form.getTextField('Name'), checkbox = form.getCheckBox('Verified');
  const rectangles = [text, checkbox].map(f => {
    const { x, y, width, height } = f.acroField.getWidgets()[0]!.getRectangle();
    return [x, y, width, height];
  });
  expect(rectangles).toEqual([nameRect, checkRect]);
  expect([text.getAlignment(), text.isMultiline(), text.getMaxLength(), checkbox.isChecked()]).toEqual([TextAlignment.Right, true, 64, false]);
  expect(text.acroField.getDefaultAppearance()).toMatch(/\s15\s+Tf\b/);
  await noOverflow(page);

  await page.getByTestId('designer-use-fill').click();
  await expect(page.getByTestId('mode-fill')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('flat-acroform.pdf', { exact: true }).first()).toBeVisible();
  const names = ['سَلْمَى بِنْتُ يَاسِين', 'مُحَمَّد سَالِم'];
  const roster = Buffer.from(Papa.unparse([['Name', 'Verified', 'ID'], [names[0], 'yes', '00123'], [names[1], 'no', '00007']]));
  await page.getByTestId('roster-upload').setInputFiles({ name: 'harakat.csv', mimeType: 'text/csv', buffer: roster });
  await page.locator('.pattern-input').fill('{{ID}}.pdf');
  await expect(page.getByTestId('ready-count')).toHaveText('2');
  await expect(page.getByTestId('flatten-zip')).not.toBeChecked();
  const filledInk = await visibleInk(page.getByTestId('pdf-canvas'));
  if (info.project.name === 'desktop') await capture(page, info, 'desktop-m15-flat-to-fill.png', page.locator('.preview-toolbar'));
  await noOverflow(page);
  const zip = await download(page, 'Download Clean PDFs (.zip)', info.outputPath('downloads'), 'arabiform-clean.zip');
  const members = unzipSync(await readFile(zip));
  expect(Object.keys(members)).toEqual(['00123.pdf', '00007.pdf']);
  const files = [];
  for (const [i, [filename, bytes]] of Object.entries(members).entries()) {
    const saved = (await PDFDocument.load(bytes)).getForm();
    const check = saved.getCheckBox('Verified');
    expect(saved.getTextField('Name').getText()).toBe(names[i]);
    expect(check.isChecked()).toBe(!i);
    expect(check.acroField.dict.get(PDFName.of('V'))?.toString()).toBe(i ? '/Off' : '/Yes');
    expect(check.acroField.getWidgets()[0]!.getAppearanceState()?.toString()).toBe(i ? '/Off' : '/Yes');
    const path = info.outputPath('downloads', filename);
    await writeFile(path, bytes);
    files.push(path);
  }
  await page.getByTestId('mode-extract').click();
  await page.getByTestId('extract-pdf-upload').setInputFiles(files);
  await expect(page.getByTestId('extract-row')).toHaveCount(2);
  const auditFile = await save(page, 'extract-download-audit', info, 'arabiform-extraction-audit.json');
  const csvFile = await save(page, 'extract-download-csv', info, 'arabiform-extracted.csv');
  const receipt = JSON.parse(await readFile(auditFile, 'utf8'));
  const csv = await readFile(csvFile);
  expect(receipt.csvSha256).toBe(sha(csv));
  const rows = Papa.parse<string[]>(new TextDecoder('utf8', { fatal: true }).decode(csv), { skipEmptyLines: true });
  expect(rows.errors).toEqual([]);
  for (const [i, [filename, bytes]] of Object.entries(members).entries()) {
    const state = i ? 'unchecked' : 'checked', nativeValue = i ? 'Off' : 'Yes';
    expect(receipt.rows[i]).toMatchObject({ filename, sourceSha256: sha(bytes), status: 'extracted',
      fields: { Name: { kind: 'text', value: names[i] }, Verified: { kind: 'checkbox', value: state, nativeValue } } });
    expect(rows.data[i + 1]).toEqual(expect.arrayContaining([filename, sha(bytes), names[i], state, nativeValue]));
    await expect(page.getByTestId('extract-row').nth(i)).toContainText(names[i]!);
  }
  await noOverflow(page);
  await writeFile(info.outputPath('roundtrip.json'), JSON.stringify({ sourceSha256: sha(original), templateSha256: sha(authored),
    sourceInk, filledInk, drawn, rectangles, extracted: receipt.rows, input: info.project.use.hasTouch ? 'touch' : 'mouse' }, null, 2));
});

for (const arabic of [false, true]) {
  test('M15 ' + (arabic ? 'Arabic alias' : 'English') + ' loads only the idle entry and designs a reusable synthetic certificate', async ({ page }, info) => {
    const scripts: string[] = [];
    page.context().on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith('.js')) scripts.push(path);
    });
    const response = await page.goto(arabic ? '/ar/' : '/', { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    if (arabic) {
      const previous = response!.request().redirectedFrom()!;
      expect([new URL(previous.url()).pathname, (await previous.response())?.status(), new URL(page.url()).pathname])
        .toEqual(['/ar/', 301, '/ar/pdf-mail-merge']);
    }
    await expect(page.locator('html')).toHaveAttribute('dir', arabic ? 'rtl' : 'ltr');
    await expect(page.getByTestId('mode-fill')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pdf-upload')).toBeAttached();
    const idle = [...scripts];
    expect(idle).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
    await page.getByTestId('mode-design').click();
    const panel = page.getByTestId('field-designer');
    await expect(panel).toHaveCSS('direction', arabic ? 'rtl' : 'ltr');
    await page.getByTestId('designer-demo').click();
    await expect(panel.getByText(arabic ? 'عينة اصطناعية' : 'Synthetic Sample', { exact: true })).toBeVisible();
    const canvas = page.getByTestId('designer-canvas');
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await expect(canvas).toHaveAccessibleName(arabic ? 'صفحة PDF الأصلية' : 'Source PDF page');
    const ink = await visibleInk(canvas);
    await page.getByTestId('designer-tool-checkbox').click();
    await draw(page, info, [.105, .723], [.139, .769]);
    await commitValue(page.getByTestId('designer-field-name'), arabic ? 'حضور' : 'Verified');
    await page.getByTestId('designer-tool-text').click();
    await draw(page, info, [.105, .47], [.887, .557]);
    const label = arabic ? 'اسم المشارك' : 'Participant name';
    await commitValue(page.getByTestId('designer-field-name'), label);
    await page.getByTestId('designer-alignment').selectOption(arabic ? 'rtl' : 'ltr');
    await expect(field(page, label)).toHaveAttribute('aria-pressed', 'true');
    const measures = await auditPage(page, 'workbench');
    await noOverflow(page);
    if (info.project.name === 'desktop' || arabic) {
      const filename = info.project.name === 'desktop' ? 'desktop-m15-designer-' + (arabic ? 'ar' : 'en') + '.png' : 'mobile-m15-designer.png';
      await capture(page, info, filename, info.project.name === 'desktop' ? panel : panel.locator('.designer-toolbar'));
    }
    const path = await save(page, 'designer-download', info, 'synthetic-flat-certificate-acroform.pdf');
    const bytes = await readFile(path);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getForm().getFields().map(f => f.getName())).toEqual([arabic ? 'حضور' : 'Verified', label]);
    expect(pdf.getForm().getTextField(label).getAlignment()).toBe(arabic ? TextAlignment.Right : TextAlignment.Left);
    await writeFile(info.outputPath('designer.json'), JSON.stringify({ idle, scripts, ink, accessibility: measures, templateSha256: sha(bytes) }, null, 2));
  });
}
