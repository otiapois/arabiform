import type { Locator, Page, TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { expect, noOverflow, test } from './browser';
import { template } from './clinic-downloads';
import { auditPage } from './m10-accessibility';

const banner = 'كبار الشخصيات / VIP';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const expectedHits = [{ field: 'Name', ruleIndex: 1 }, { field: 'Consent', ruleIndex: 2 }];

async function openPanel(page: Page, ar: boolean) {
  const paths: string[] = [];
  page.context().on('request', r => paths.push(new URL(r.url()).pathname));
  await page.goto(ar ? '/ar/pdf-mail-merge' : '/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
  const idle = [...paths];
  expect(idle.filter(p => /\.m?js$/i.test(p))).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
  expect(idle.filter(p => /\.(pdf|csv|xlsx)$/i.test(p))).toEqual([]);
  await noOverflow(page);
  const toggle = page.getByTestId('conditional-rules-toggle');
  await expect(toggle).toHaveAccessibleName(ar ? 'قواعد التعبئة الشرطية' : 'Conditional rules');
  await toggle.click();
  const example = page.getByTestId('conditional-rules-example');
  await expect(example).toHaveAccessibleName(ar ? 'جرّب مثال VIP وStandard الاصطناعي' : 'Try Synthetic VIP/Standard Example');
  expect(paths.slice(idle.length).some(p => /ConditionalRules-[\w-]+\.js$/.test(p))).toBe(true);
  return idle;
}

async function save(page: Page, button: Locator, folder: string) {
  await mkdir(folder, { recursive: true });
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = join(folder, download.suggestedFilename());
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  return readFile(path);
}

async function audit(page: Page, folder: string) {
  const json = await save(page, page.locator('.audit-actions').getByRole('button', { name: /json/i }), folder);
  const csv = await save(page, page.locator('.audit-actions').getByRole('button', { name: /csv/i }), folder);
  const rows = JSON.parse(json.toString('utf8')) as {
    rowNumber: number; filename: string; status: string; ruleApplied?: typeof expectedHits;
    diagnostics: { field: string; code: string }[];
  }[];
  const parsed = Papa.parse<Record<string, string>>(csv.toString('utf8'), { header: true, skipEmptyLines: true });
  expect(parsed.errors).toEqual([]);
  expect(parsed.data.map(r => [Number(r.rowNumber), r.filename, r.status, JSON.parse(r.diagnostics!),
    r.ruleApplied === undefined ? undefined : JSON.parse(r.ruleApplied)])).toEqual(
    rows.map(r => [r.rowNumber, r.filename, r.status, r.diagnostics, r.ruleApplied]));
  return rows;
}

function sentinel(pdf: PDFDocument) {
  const field = pdf.getForm().getTextField('Sentinel');
  const appearance = field.acroField.getWidgets()[0]!.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
  if (!(appearance instanceof PDFRawStream)) throw new Error('Sentinel has no saved normal appearance');
  return { value: field.getText(), appearance: sha(appearance.getContents()) };
}

async function checkedPdfs(page: Page, folder: string, rows: { filename: string }[], names: string[], states: boolean[]) {
  const members = unzipSync(await save(page, page.getByTestId('download-zip'), folder));
  expect(Object.keys(members)).toEqual(rows.map(row => row.filename));
  const untouched = sentinel(await PDFDocument.load(await readFile(template)));
  expect(untouched.value).toBe('KEEP 00109');
  for (const [index, row] of rows.entries()) {
    const pdf = await PDFDocument.load(members[row.filename]!);
    const form = pdf.getForm();
    expect(form.getTextField('Name').getText()).toBe(names[index]);
    const consent = form.getCheckBox('Consent');
    expect(consent.isChecked()).toBe(states[index]);
    expect(consent.acroField.getWidgets().map(w => w.getAppearanceState()?.toString())).toEqual(Array(2).fill(states[index] ? '/Yes' : '/Off'));
    expect(sentinel(pdf)).toEqual(untouched);
  }
  return Object.fromEntries(Object.entries(members).map(([name, bytes]) => [name, sha(bytes)]));
}

// Read the actual canvas pixels inside each field, excluding the widget's printed border.
async function previewInk(page: Page) {
  const canvas = page.getByTestId('pdf-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  return canvas.evaluate(async (el: HTMLCanvasElement) => {
    const context = el.getContext('2d')!;
    const rect = el.getBoundingClientRect();
    const overlays = el.parentElement!.querySelectorAll<HTMLElement>('[data-testid="widget-overlay"][data-field="Name"],[data-testid="widget-overlay"][data-field="Consent"]');
    return Promise.all(Array.from(overlays, async overlay => {
      const box = overlay.getBoundingClientRect(), sx = el.width / rect.width, sy = el.height / rect.height;
      const x = Math.round((box.x - rect.x) * sx), y = Math.round((box.y - rect.y) * sy);
      const w = Math.round(box.width * sx), h = Math.round(box.height * sy);
      const inset = Math.max(2, Math.round(h * .12));
      const pixels = context.getImageData(x + inset, y + inset, w - 2 * inset, h - 2 * inset).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] === 255 && Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) < 150) ink++;
      const hash = await crypto.subtle.digest('SHA-256', pixels as Uint8ClampedArray<ArrayBuffer>);
      return { field: overlay.dataset.field!, ink, hash: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') };
    }));
  });
}

async function screenshot(page: Page, info: TestInfo, ar: boolean) {
  if (info.project.name === 'mobile' && !ar) return;
  const dir = process.env.ARABIFORM_CAPTURE_M22_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m22') : info.outputPath('screenshots');
  await mkdir(dir, { recursive: true });
  const filename = info.project.name === 'mobile' ? 'mobile-m22-rules.png' : 'desktop-m22-rules-' + (ar ? 'ar' : 'en') + '.png';
  const showPdf = info.project.name === 'desktop' && ar;
  const target = showPdf ? page.locator('#preview-heading') : page.getByTestId('conditional-rules-toggle');
  await target.evaluate(async el => {
    await document.fonts.ready;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 20, behavior: 'instant' });
  });
  if (showPdf) await expect(page.getByTestId('pdf-canvas')).toBeInViewport({ ratio: .8 });
  else await expect(page.getByTestId('conditional-rule-value').first()).toBeInViewport();
  await page.screenshot({ path: join(dir, filename), animations: 'disabled' });
}

for (const locale of ['en', 'ar']) {
  const ar = locale === 'ar';
  const count = (n: number) => ar ? 'تنطبق على ' + n + ' من أصل 2 صف' : 'Matches ' + n + ' of 2 rows';

  test('M22 ' + locale + ' VIP sample changes live canvas and both Consent widgets, restores a v11 preset', async ({ page }, info) => {
    const idle = await openPanel(page, ar);
    await page.getByTestId('conditional-rules-example').click();
    await expect(page.getByTestId('ready-count')).toHaveText('2');
    await expect(page.getByTestId('conditional-rule-matches')).toHaveText([count(1), count(1)]);
    const name = page.getByTestId('conditional-rule-value').first();
    await expect(name).toHaveValue(banner);
    const boxes = (pixels: Awaited<ReturnType<typeof previewInk>>) => pixels.filter(p => p.field === 'Consent').map(p => p.ink);
    await expect.poll(async () => boxes(await previewInk(page)).filter(n => n > 0).length).toBe(2);
    const marked = await previewInk(page);
    expect(marked.filter(p => p.field === 'Name' && p.ink > 10)).toHaveLength(1);
    const preset = await save(page, page.getByTestId('preset-download'), info.outputPath('v11'));
    const { conditionalRules, ...v10 } = JSON.parse(preset.toString('utf8'));
    expect(v10.version).toBe(11);
    expect(conditionalRules).toEqual([
      { field: 'Name', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-text', value: banner } },
      { field: 'Consent', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-checkbox', checked: true } },
    ]);
    const upload = page.getByTestId('preset-upload');
    await upload.setInputFiles({ name: 'legacy-v10.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...v10, version: 10 })) });
    await expect(page.getByTestId('conditional-rule')).toHaveCount(0);
    await expect(page.getByTestId('ready-count')).toHaveText('2');
    await expect.poll(async () => boxes(await previewInk(page))).toEqual([0, 0]);
    const original = await previewInk(page);
    expect(original.find(p => p.field === 'Name')!.hash).not.toBe(marked.find(p => p.field === 'Name')!.hash);
    const old = await audit(page, info.outputPath('legacy'));
    expect(old.map(row => row.ruleApplied)).toEqual([undefined, undefined]);
    await checkedPdfs(page, info.outputPath('legacy'), old, ['VIP Guest', 'Standard Guest'], [false, false]);
    await upload.setInputFiles({ name: 'restore-v11.json', mimeType: 'application/json', buffer: preset });
    await expect(page.getByTestId('conditional-rule')).toHaveCount(2);
    await expect.poll(() => previewInk(page)).toEqual(marked);
    const rows = await audit(page, info.outputPath('restored'));
    expect(rows.map(row => row.ruleApplied)).toEqual([expectedHits, []]);
    const pdfHashes = await checkedPdfs(page, info.outputPath('restored'), rows, [banner, 'Standard Guest'], [true, false]);
    const again = await save(page, page.getByTestId('preset-download'), info.outputPath('restored'));
    expect(JSON.parse(again.toString('utf8'))).toEqual(JSON.parse(preset.toString('utf8')));
    const accessibility = await auditPage(page, 'workbench');
    await noOverflow(page);
    await screenshot(page, info, ar);
    await writeFile(info.outputPath('conditional-preview.json'), JSON.stringify({ idle, original, marked, pdfHashes, accessibility }, null, 2));
  });

  test('M22 ' + locale + ' real upload applies manually ordered rules and holds an oversized matched banner', async ({ page }, info) => {
    await openPanel(page, ar);
    const source = await readFile(template);
    const roster = Buffer.from('Name,ID,Consent,Role\r\nOrder One,00123,false,VIP\r\nOrder Two,00007,false,Standard\r\n');
    const dir = info.outputPath('authored');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'clinic-consent-mixed.pdf'), source);
    await writeFile(join(dir, 'roster.csv'), roster);
    await page.getByTestId('pdf-upload').setInputFiles(template);
    await page.getByTestId('roster-upload').setInputFiles({ name: 'roster.csv', mimeType: 'text/csv', buffer: roster });
    await expect(page.getByTestId('ready-count')).toHaveText('2');
    const rules = page.getByTestId('conditional-rule');
    async function add(field: string, value: string) {
      await page.getByTestId('conditional-rule-add').click();
      const rule = rules.last();
      await rule.getByTestId('conditional-rule-field').selectOption(field);
      await rule.getByTestId('conditional-rule-column').selectOption('Role');
      await rule.getByTestId('conditional-rule-operand').fill('VIP');
      const control = rule.getByTestId('conditional-rule-value');
      if (field === 'Name') await control.fill(value);
      else await control.selectOption(value);
    }
    await add('Name', banner);
    await add('Consent', 'true');
    await add('Name', 'Priority {{ID}}');
    const counts = page.getByTestId('conditional-rule-matches');
    await expect(counts).toHaveText([count(1), count(1), count(0)]);
    await rules.last().getByTestId('conditional-rule-up').click();
    await rules.nth(1).getByTestId('conditional-rule-up').click();
    await expect(counts).toHaveText([count(1), count(0), count(1)]);
    const priority = await audit(page, info.outputPath('priority'));
    expect(priority[0]!.ruleApplied).toEqual([{ field: 'Name', ruleIndex: 1 }, { field: 'Consent', ruleIndex: 3 }]);
    await checkedPdfs(page, info.outputPath('priority'), priority, ['Priority 00123', 'Order Two'], [true, false]);
    await rules.first().getByTestId('conditional-rule-delete').click();
    await expect(counts).toHaveText([count(1), count(1)]);
    const pass = await audit(page, dir);
    expect(pass.map(row => row.ruleApplied)).toEqual([expectedHits, []]);
    await save(page, page.getByTestId('preset-download'), dir);
    await checkedPdfs(page, dir, pass, [banner, 'Order Two'], [true, false]);
    await rules.first().getByTestId('conditional-rule-value').fill('سَلام '.repeat(80));
    await expect(page.getByTestId('flagged-count')).toHaveText('1');
    await expect(page.getByTestId('ready-count')).toHaveText('1');
    const heldDir = info.outputPath('held');
    const held = await audit(page, heldDir);
    expect(held.map(row => row.status)).toEqual(['flagged', 'pass']);
    expect(held[0]!.ruleApplied).toEqual(expectedHits);
    expect(held[0]!.diagnostics).toContainEqual(expect.objectContaining({ field: 'Name', code: 'too-narrow' }));
    await save(page, page.getByTestId('preset-download'), heldDir);
    await checkedPdfs(page, heldDir, held.slice(1), ['Order Two'], [false]);
    await noOverflow(page);
  });
}
