import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { expect, noOverflow, test } from './browser';
import { auditPage } from './m10-accessibility';

const data = (name: string) => resolve('fixtures/m24', name);
const allRows = [1, 2, 3, 4, 5, 6, 7];
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function save(page: Page, button: Locator, directory: string, expected?: string) {
  await mkdir(directory, { recursive: true });
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const filename = file.suggestedFilename();
  if (expected) expect(filename).toBe(expected);
  const path = join(directory, filename);
  await file.saveAs(path);
  expect(await file.failure()).toBeNull();
  return { path, bytes: await readFile(path) };
}

async function ltrGlyphs(element: Locator, expected: string) {
  await expect(element).toHaveText(expected);
  await expect(element).toHaveCSS('direction', 'ltr');
  const glyphs = await element.evaluate(el => {
    const node = el.firstChild!;
    return Array.from(node.textContent!, (char, index) => {
      const r = document.createRange();
      r.setStart(node, index);
      r.setEnd(node, index + 1);
      const { left, top, width } = r.getBoundingClientRect();
      return { char, left, top, width };
    });
  });
  expect(new Set(glyphs.map(x => x.top)).size).toBe(1);
  for (let i = 1; i < glyphs.length; i++) expect(glyphs[i]!.left).toBeGreaterThan(glyphs[i - 1]!.left);
  return glyphs;
}

async function stats(block: Locator, records: number, sheets: number, covers: number, one = records + covers) {
  const fourSaved = one - sheets;
  const percent = one ? Math.round(10000 * fourSaved / one) / 100 : 0;
  const counts = { records, sheets, 'one-up': one, 'cover-pages': covers, 'four-up': sheets,
    'four-up-sheets-saved': fourSaved, 'four-up-percent-saved': percent };
  for (const [key, value] of Object.entries(counts)) await expect(block).toHaveAttribute('data-' + key, String(value));
  return counts;
}

async function snap(page: Page, info: TestInfo, ar: boolean) {
  const mobile = info.project.name === 'mobile';
  if (mobile && !ar) return;
  const name = mobile ? 'mobile-m24-4up' : ar ? 'desktop-m24-4up-certificate-ar' : 'desktop-m24-4up-estimator-en';
  const dir = process.env.ARABIFORM_CAPTURE_M24_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m24') : info.outputPath('screenshots');
  await mkdir(dir, { recursive: true });
  const anchor = mobile || !ar ? page.getByTestId('print-estimate') : page.locator('#export-heading');
  await anchor.evaluate(async el => {
    await document.fonts.ready;
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -12, behavior: 'instant' });
  });
  if (!mobile && ar) await expect(page.getByTestId('print-certificate-download')).toBeInViewport();
  await page.screenshot({ path: join(dir, name + '.png'), animations: 'disabled' });
}

for (const lang of ['en', 'ar'] as const) {
  const ar = lang === 'ar';
  test('M24 ' + lang + ' prints four badges per sheet and certifies the exact downloaded scope and bytes', async ({ page }, info) => {
    test.slow();
    const paths: string[] = [];
    page.context().on('request', request => paths.push(new URL(request.url()).pathname));
    await page.goto(ar ? '/ar/pdf-mail-merge' : '/', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
    const idle = [...paths];
    expect(idle.filter(path => /\.m?js$/i.test(path))).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
    expect(idle.filter(path => /\.(pdf|csv|xlsx)$/i.test(path))).toEqual([]);
    await noOverflow(page);
    const templateName = ar ? 'visitor-badge-rotated.pdf' : 'visitor-badge.pdf';
    const template = data(templateName), roster = data('visitor-roster.csv');
    // A legal local filename whose glyphs are outside the bundled PDF typefaces.
    const rosterName = !ar && info.project.name === 'mobile' ? '访客名单.csv' : basename(roster);
    await page.getByTestId('pdf-upload').setInputFiles(template);
    const certificate = page.getByTestId('print-certificate-download');
    await expect(certificate).toBeDisabled();
    await page.getByTestId('roster-upload').setInputFiles({ name: rosterName, mimeType: 'text/csv', buffer: await readFile(roster) });
    await expect(page.getByTestId('ready-count')).toHaveText('7');
    await expect(page.getByTestId('flagged-count')).toHaveText('0');
    const merged = page.getByRole('button', { name: ar ? 'نزّل ملف PDF مدمجًا للطباعة' : 'Download Merged Printable PDF', exact: true });
    await expect(certificate).toHaveAccessibleName(ar ? 'نزّل شهادة ما قبل الطباعة (.pdf)' : 'Download Print-Shop Certificate (.pdf)');
    const suffix = ar ? await ltrGlyphs(certificate.locator('bdi'), '(.pdf)') : [];
    const layout = page.getByTestId('imposition');
    await layout.selectOption('4-up');
    const sizes = await layout.evaluate(async (el: HTMLSelectElement) => {
      await document.fonts.ready;
      const css = getComputedStyle(el), c = document.createElement('canvas').getContext('2d')!;
      c.font = css.fontWeight + ' ' + css.fontSize + ' ' + css.fontFamily;
      const available = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - 18;
      return Array.from(el.options, option => ({ label: option.text, width: c.measureText(option.text).width, available }));
    });
    for (const option of sizes) expect(option.width, option.label).toBeLessThanOrEqual(option.available);
    const order = page.getByTestId('imposition-four-up-order'), guides = page.getByTestId('imposition-center-cut-guides');
    await expect(order).not.toBeChecked();
    await expect(guides).not.toBeChecked();
    await expect(order).toHaveAccessibleName(ar ? 'ترتيب القص والتكديس' : 'Cut-and-stack order');
    await expect(guides).toHaveAccessibleName(ar ? 'خطوط القص في المنتصف' : 'Center cut guides');
    const estimate = page.getByTestId('print-estimate-combined');
    const initial = await stats(estimate, 7, 2, 0);
    const printPair = async (name: string, rows: number[], covers: number, stack: boolean, first: 'certificate' | 'merged') => {
      const dir = info.outputPath(name);
      for (const kind of first === 'certificate' ? ['certificate', 'merged'] : ['merged', 'certificate']) {
        await save(page, kind === 'certificate' ? certificate : merged, dir, kind === 'certificate' ? 'print-shop-certificate.pdf' : 'arabiform-merged.pdf');
      }
      const pdf = await readFile(join(dir, 'arabiform-merged.pdf'));
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(Math.ceil(rows.length / 4) + covers);
      const config = { dir, rows, covers, stack, guides: stack, template, roster, templateName, rosterName, total: 7,
        scope: rows.length === 7 ? 'all ready rows' : 'selected ready rows' };
      const result = JSON.parse(execFileSync('python', ['tests/e2e/m24-print-proof.py'], { encoding: 'utf8', input: JSON.stringify(config), windowsHide: true }));
      expect(result.printSha256).toBe(sha(pdf));
      return result;
    };
    const sequential = await printPair('sequential', allRows, 0, false, 'certificate');
    await page.getByTestId('include-cover-sheet').check();
    await page.getByTestId('cover-language').selectOption('bilingual');
    await page.getByTestId('group-by-column').selectOption('Track');
    await order.check();
    await guides.check();

    const v12 = await save(page, page.getByTestId('preset-download'), info.outputPath('preset'));
    expect(JSON.parse(v12.bytes.toString('utf8'))).toMatchObject({ version: 12, imposition: '4-up',
      fourUpOrder: 'cut-and-stack', centerCutGuides: true, groupByColumn: 'Track', includeCoverSheet: true });
    await guides.uncheck();
    await order.uncheck();
    await layout.selectOption('1-up');
    await page.getByTestId('preset-upload').setInputFiles(v12.path);
    await expect(layout).toHaveValue('4-up');
    await expect(order).toBeChecked();
    await expect(guides).toBeChecked();
    const covered = await stats(estimate, 7, 3, 1);
    const percent = ar ? new Intl.NumberFormat('ar', { style: 'percent', maximumFractionDigits: 2 }).format(.625) : '62.5%';
    await expect(estimate.locator('..')).toContainText(percent);
    const split = await stats(page.getByTestId('print-estimate-split'), 7, 4, 2, 9);
    const active = await auditPage(page, 'workbench');
    await noOverflow(page);
    await snap(page, info, ar);
    const stack = await printPair('stack', allRows, 1, true, 'merged');
    expect(stack.printSha256).not.toBe(sequential.printSha256);

    const zip = unzipSync((await save(page, page.getByTestId('download-split'), info.outputPath('split'), 'arabiform-split-merged.zip')).bytes);
    const receipt = JSON.parse(strFromU8(zip['batch-custody.json']!)) as { groups: { groupValue: string; zipPath: string; rowNumbers: number[] }[] };
    expect(receipt.groups).toHaveLength(2);
    const groupRows: Record<string, number[]> = { North: [1, 3, 4, 7], South: [2, 5, 6] };
    let actualSplit = 0;
    const details = page.getByTestId('print-estimate').locator('details');
    await details.locator('summary').click();
    for (const group of receipt.groups) {
      expect(group.rowNumbers).toEqual(groupRows[group.groupValue]);
      const n = (await PDFDocument.load(zip[group.zipPath]!)).getPageCount();
      const row = details.getByRole('listitem').filter({ has: page.getByText(group.groupValue, { exact: true }) });
      await stats(row.getByTestId('print-estimate-group'), group.rowNumbers.length, n, 1);
      expect(n).toBe(2);
      actualSplit += n;
    }
    expect(actualSplit).toBe(split.sheets);
    const selectRow = (n: number) => page.locator('[data-testid="queue-row"][data-row="' + n + '"]').getByTestId('queue-row-select');
    await selectRow(2).check();
    await selectRow(7).check();
    await stats(estimate, 2, 2, 1);
    const selected = await printPair('selected', [2, 7], 1, true, 'certificate');
    expect(selected.printSha256).not.toBe(stack.printSha256);
    await selectRow(2).uncheck();
    await selectRow(7).uncheck();
    await expect(certificate).toBeDisabled();
    await expect(merged).toBeDisabled();
    await noOverflow(page);
    await writeFile(info.outputPath('m24-print.json'), JSON.stringify({ idle, templateName, rosterName, suffix, sizes, active, initial,
      covered, split, actualSplit, sequential, stack, selected }, null, 2));
  });
}

test('M24 Arabic signed template width change keeps the minus left of the digits', async ({ page }, info) => {
  await page.goto('/ar/pdf-mail-merge');
  await page.getByTestId('mode-compare').click();
  await page.getByTestId('compare-demo').click();
  const delta = page.getByTestId('compare-changes').locator('bdi').filter({ hasText: /^-22 × 0 pt$/ });
  const glyphs = await ltrGlyphs(delta, '-22 × 0 pt');
  await noOverflow(page);
  await writeFile(info.outputPath('m24-signed-delta.json'), JSON.stringify({ viewport: page.viewportSize(), glyphs }));
});
