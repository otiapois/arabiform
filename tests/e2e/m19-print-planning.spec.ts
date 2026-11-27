import type { Locator, Page, TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { expect, noOverflow, test } from './browser';
import { auditPage } from './m10-accessibility';

const voiceName = 'فَاطِمَةُ الزَّهْرَاءِ بِنْتُ عَبْدِ الرَّحْمَنِ';
const roster = [
  ['Al', '001', 'North'], ['Eve', '000222', 'North'], ['May', '003', 'South'],
  ['Noor', '004', 'North'], [voiceName, '005', 'South'], ['Sami', '006', 'South'], ['Rose', '007', 'North'],
];
const groups = { North: [1, 4, 7], South: [3, 5, 6] };
const queueRow = (page: Page, row: number) => page.locator('[data-testid="queue-row"][data-row="' + row + '"]');

async function certificate() {
  const doc = await PDFDocument.create();
  const issued = new Date('2026-11-28T00:00:00Z');
  doc.setCreationDate(issued);
  doc.setModificationDate(issued);
  const page = doc.addPage([440, 180]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(.12, .32, .25);
  page.drawRectangle({ x: 0, y: 169, width: 440, height: 11, color: green });
  page.drawText('Certificate of attendance', { x: 20, y: 129, size: 22, font: bold, color: green });
  page.drawText('Synthetic Sample', { x: 20, y: 111, size: 10 });
  page.drawText('Participant', { x: 20, y: 84, size: 10, font: bold });
  page.drawText('Record ID', { x: 328, y: 84, size: 10, font: bold });
  for (const [name, x, width] of [['Name', 20, 288], ['ID', 328, 90]] as const) {
    const field = doc.getForm().createTextField(name);
    field.addToPage(page, { x, y: 36, width, height: 40, borderWidth: 1, borderColor: green });
    field.setFontSize(19);
    if (name === 'ID') field.setMaxLength(3);
  }
  return { name: 'Synthetic attendance certificate.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

async function enter(page: Page, ar: boolean) {
  const paths: string[] = [];
  page.context().on('request', request => paths.push(new URL(request.url()).pathname));
  const response = await page.goto(ar ? '/ar/' : '/', { waitUntil: 'networkidle' });
  expect(new URL(page.url()).pathname).toBe(ar ? '/ar/pdf-mail-merge' : '/');
  if (ar) {
    const redirect = response!.request().redirectedFrom()!;
    expect(new URL(redirect.url()).pathname).toBe('/ar/');
    expect((await redirect.response())!.status()).toBe(301);
  }
  await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
  const idle = [...paths];
  expect(idle.filter(path => /\.m?js$/i.test(path))).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
  await noOverflow(page);
  await page.getByTestId('pdf-upload').setInputFiles(await certificate());
  return idle;
}

async function loadRoster(page: Page) {
  await page.getByTestId('roster-upload').setInputFiles({
    name: 'Synthetic two-branch roster.csv', mimeType: 'text/csv',
    buffer: Buffer.from(['Name,ID,Branch', ...roster.map(row => row.join(','))].join('\r\n')),
  });
  await expect(page.getByTestId('ready-count')).toHaveText('6');
  await expect(page.getByTestId('flagged-count')).toHaveText('1');
  await expect(queueRow(page, 2).getByTestId('queue-row-select')).toBeDisabled();
}

async function capture(page: Page, info: TestInfo, name: string, anchor: Locator) {
  const dir = process.env.ARABIFORM_CAPTURE_M19_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m19') : info.outputPath('screenshots');
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await anchor.evaluate(el => { el.scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy({ top: -12, behavior: 'instant' }); });
  await page.screenshot({ path: join(dir, name), animations: 'disabled' });
}

async function ink(canvas: Locator) {
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await expect(canvas).toBeVisible();
  return canvas.evaluate(async (el: HTMLCanvasElement) => {
    const { width, height } = el;
    const rect = el.getBoundingClientRect();
    const pixels = el.getContext('2d')!.getImageData(0, 0, width, height).data;
    // Inside the drawn Name box only. The template border, labels and ID are outside this region.
    const left = Math.ceil(width * 22 / 440), right = Math.floor(width * 306 / 440);
    const top = Math.ceil(height * 106 / 180), bottom = Math.floor(height * 142 / 180);
    let dark = 0, paper = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const pos = (y * width + x) * 4;
        const rgb = [pixels[pos]!, pixels[pos + 1]!, pixels[pos + 2]!];
        if (pixels[pos + 3] === 255 && Math.max(...rgb) < 160) dark++;
        if (pixels[pos + 3] === 255 && Math.min(...rgb) > 245) paper++;
      }
    }
    const hash = await crypto.subtle.digest('SHA-256', pixels.buffer);
    return { width, height, cssWidth: rect.width, cssHeight: rect.height, dark, paper,
      hash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') };
  });
}

async function counts(block: Locator, expected: { records: number; covers: number; one: number; two: number }, twoUp: boolean) {
  const { records, covers, one, two } = expected;
  const sheets = twoUp ? two : one, saved = one - two;
  const percent = one ? Math.round(10000 * saved / one) / 100 : 0;
  const values = { records, 'cover-pages': covers, sheets, 'one-up': one, 'two-up': two, 'sheets-saved': saved, 'percent-saved': percent };
  for (const [key, value] of Object.entries(values)) await expect(block).toHaveAttribute('data-' + key, String(value));
  await expect(block.locator('dd')).toHaveText([sheets, covers, one, two].map(String));
  return values;
}

async function saveDownload(page: Page, button: Locator, dir: string, name: string) {
  await mkdir(dir, { recursive: true });
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(file.suggestedFilename()).toBe(name);
  const path = join(dir, name);
  await file.saveAs(path);
  expect(await file.failure()).toBeNull();
  return readFile(path);
}

async function compareDownloads(page: Page, ar: boolean, dir: string, selected: typeof groups, cover: boolean, twoUp: boolean) {
  const perGroup = Object.entries(selected);
  const size = (records: number) => ({ records, covers: +cover, one: records + +cover, two: Math.ceil(records / 2) + +cover });
  const total = perGroup.reduce((sum, [, rows]) => sum + rows.length, 0);
  const combined = await counts(page.getByTestId('print-estimate-combined'), size(total), twoUp);
  const totals = perGroup.map(([, rows]) => size(rows.length));
  const sum = (key: keyof typeof totals[number]) => totals.reduce((n, item) => n + item[key], 0);
  const split = await counts(page.getByTestId('print-estimate-split'), { records: total, covers: sum('covers'), one: sum('one'), two: sum('two') }, twoUp);
  const detail = page.getByTestId('print-estimate').locator('details');
  if (!(await detail.evaluate((node: HTMLDetailsElement) => node.open))) await detail.locator('summary').click();
  const merged = await saveDownload(page, page.getByRole('button', { name: ar ? 'نزّل ملف PDF مدمجًا للطباعة' : 'Download Merged Printable PDF', exact: true }), dir, 'arabiform-merged.pdf');
  expect((await PDFDocument.load(merged)).getPageCount()).toBe(combined.sheets);
  const zip = await saveDownload(page, page.getByTestId('download-split'), dir, 'arabiform-split-merged.zip');
  const files = unzipSync(zip);
  const receipt = JSON.parse(strFromU8(files['batch-custody.json']!)) as { groups: { groupValue: string; zipPath: string; rowNumbers: number[] }[] };
  expect(receipt.groups).toHaveLength(perGroup.length);
  expect(Object.keys(files).sort()).toEqual(['batch-custody.json', ...receipt.groups.map(group => group.zipPath)].sort());
  const actualGroups: Record<string, { rows: number[]; pages: number }> = {};
  let physical = 0;
  for (const [group, rows] of perGroup) {
    const member = receipt.groups.find(record => record.groupValue === group)!;
    expect(member.rowNumbers).toEqual(rows);
    const row = page.getByTestId('print-estimate').getByRole('listitem').filter({ has: page.getByText(group, { exact: true }) });
    const visual = await counts(row.getByTestId('print-estimate-group'), size(rows.length), twoUp);
    const pages = (await PDFDocument.load(files[member.zipPath]!)).getPageCount();
    expect(pages).toBe(visual.sheets);
    actualGroups[basename(member.zipPath)] = { rows, pages };
    physical += pages;
  }
  expect(physical).toBe(split.sheets);
  return { combined, split, actualGroups, actualCombined: combined.sheets, actualSplit: physical };
}

for (const language of ['en', 'ar'] as const) {
  const ar = language === 'ar';

  test('M19 ' + language + ' jumps to original boundary rows and compares rendered names and blank flagged fields', async ({ page }, info) => {
    const idle = await enter(page, ar);
    const primary = page.getByTestId('pdf-canvas');
    const original = await ink(primary);
    expect(original.dark).toBe(0);
    await loadRoster(page);
    const audit = JSON.parse((await saveDownload(page,
      page.getByRole('button', { name: ar ? 'نزّل تقرير الفحص (JSON)' : 'Download Preflight Audit (.json)', exact: true }),
      info.outputPath('audit'), 'arabiform-preflight.json')).toString('utf8')) as {
        rowNumber: number; status: string; fontSizes: Record<string, number[]>;
      }[];
    const minimumSize = (n: number) => Math.min(...Object.values(audit[n - 1]!.fontSizes).flat());
    const smallest = audit.filter(item => item.status === 'pass').sort((a, b) => minimumSize(a.rowNumber) - minimumSize(b.rowNumber))[0]!.rowNumber;
    const boundaries = [['smallest', smallest], ['longest', 5], ['flagged', 2]] as const;
    for (const [id, n] of boundaries) {
      const jump = page.getByTestId('spotlight-' + id);
      await expect(jump).toHaveAttribute('data-row', String(n));
      await jump.click();
      await expect(jump).toHaveAttribute('aria-pressed', 'true');
      await expect(queueRow(page, n)).toHaveAttribute('data-selected', 'true');
    }
    await expect(page.getByTestId('preview-diagnostics')).toContainText('MaxLen');
    expect((await ink(primary)).dark).toBe(0);
    const toggle = page.getByTestId('toggle-row-compare');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panes = [page.getByTestId('compare-pane-a'), page.getByTestId('compare-pane-b')] as const;
    const [a, b] = panes;
    await expect(a).toHaveAttribute('data-row', '2');
    await expect(a.getByTestId('compare-status')).toHaveAttribute('data-status', 'flagged');
    await expect(a.getByTestId('compare-status')).toContainText(ar ? 'القالب الأصلي' : 'original template');
    await expect(a.getByTestId('compare-diagnostics')).toContainText('MaxLen');
    await expect(a.getByTestId('compare-diagnostics')).toContainText('ID');
    for (const testId of ['compare-font-size', 'compare-ink-clearance']) {
      await expect(a.getByTestId(testId)).toHaveText(ar ? 'غير متاح' : 'Unavailable');
    }
    const blank = await ink(a.getByTestId('pdf-canvas'));
    expect(blank.dark).toBe(0);
    await a.getByTestId('compare-row-a').selectOption('1');
    await b.getByTestId('compare-row-b').selectOption('5');
    const values = [];
    for (const [index, pane] of panes.entries()) {
      const n = index === 0 ? 1 : 5;
      await expect(pane).toHaveAttribute('data-row', String(n));
      await expect(pane.getByTestId('compare-status')).toHaveAttribute('data-status', 'pass');
      await expect(pane.getByTestId('compare-status')).toHaveText(ar ? 'جاهز' : 'Ready');
      const canvas = pane.getByTestId('pdf-canvas');
      await expect(canvas).toHaveCSS('direction', 'ltr');
      const picture = await ink(canvas);
      expect(picture.dark).toBeGreaterThan(10);
      expect(picture.paper).toBeGreaterThan(500);
      expect(picture.width).toBeGreaterThanOrEqual(Math.floor(picture.cssWidth));
      expect(picture.height).toBeGreaterThanOrEqual(Math.floor(picture.cssHeight));
      const fontSize = Number(await pane.getByTestId('compare-font-size').getAttribute('data-points'));
      const clearance = Number(await pane.getByTestId('compare-ink-clearance').getAttribute('data-points'));
      expect(fontSize).toBe(minimumSize(n));
      expect(clearance).toBeGreaterThan(0);
      for (const [id, value] of [['compare-font-size', fontSize], ['compare-ink-clearance', clearance]] as const) {
        await expect(pane.getByTestId(id)).toContainText(value.toLocaleString('en', { maximumFractionDigits: 4 }));
      }
      values.push({ row: n, fontSize, clearance, picture });
    }
    expect(values[0]!.picture.hash).not.toBe(values[1]!.picture.hash);
    expect(values[1]!.picture.dark).toBeGreaterThan(values[0]!.picture.dark * 2);
    const boxA = (await a.boundingBox())!, boxB = (await b.boundingBox())!;
    const mobile = info.project.name === 'mobile';
    if (mobile) {
      expect(boxB.y).toBeGreaterThanOrEqual(boxA.y + boxA.height);
      expect(Math.abs(boxA.x - boxB.x)).toBeLessThan(2);
    } else {
      expect(Math.abs(boxA.y - boxB.y)).toBeLessThan(2);
      expect(ar ? boxA.x - boxB.x - boxB.width : boxB.x - boxA.x - boxA.width).toBeGreaterThan(0);
    }
    const accessibility = await auditPage(page, 'workbench');
    await noOverflow(page);
    if ((!mobile && !ar) || (mobile && ar)) {
      const anchor = mobile ? page.getByTestId('row-compare') : page.locator('#preview-heading');
      const name = mobile ? 'mobile-m19-compare.png' : 'desktop-m19-row-compare-en.png';
      await capture(page, info, name, anchor);
      for (const pane of panes) await expect(pane.getByTestId('pdf-canvas')).toBeInViewport({ ratio: .96 });
    }
    await toggle.click();
    await expect(page.getByTestId('row-compare')).toHaveCount(0);
    await writeFile(info.outputPath('compare.json'), JSON.stringify({ language, idle, original, blank, smallest, values, boxA, boxB, accessibility }, null, 2));
  });

  test('M19 ' + language + ' counts combined and per-group sheets against downloaded PDFs through layout, cover and subset changes', async ({ page }, info) => {
    const idle = await enter(page, ar);
    await loadRoster(page);
    const estimate = page.getByTestId('print-estimate');
    await expect(estimate).toHaveAttribute('data-imposition', '1-up');
    const initial = await counts(page.getByTestId('print-estimate-combined'), { records: 6, covers: 0, one: 6, two: 3 }, false);
    await expect(page.getByTestId('print-estimate-split')).toHaveCount(0);
    const group = page.getByTestId('group-by-column');
    await group.selectOption('Branch');
    const noCover = await compareDownloads(page, ar, info.outputPath('no-cover'), groups, false, false);
    await page.getByTestId('include-cover-sheet').check();
    await page.getByTestId('cover-language').selectOption('bilingual');
    const covered = await compareDownloads(page, ar, info.outputPath('covered'), groups, true, false);
    const imposition = page.getByTestId('imposition');
    await imposition.selectOption('2-up');
    await expect(estimate).toHaveAttribute('data-imposition', '2-up');
    const imposed = await compareDownloads(page, ar, info.outputPath('imposed'), groups, true, true);
    await expect(page.getByTestId('print-estimate-combined').locator('..')).toContainText('42.86%');
    await expect(page.getByTestId('print-estimate-split').locator('..')).toContainText('25%');
    const accessibility = await auditPage(page, 'workbench');
    await noOverflow(page);
    if (info.project.name === 'desktop' && ar) await capture(page, info, 'desktop-m19-estimator-ar.png', estimate);
    const select = (n: number) => queueRow(page, n).getByTestId('queue-row-select');
    for (const n of [1, 4, 5]) await select(n).check();
    await select(4).uncheck();
    await expect(page.getByTestId('export-scope')).toContainText('(2)');
    const subset = await compareDownloads(page, ar, info.outputPath('subset'), { North: [1], South: [5] }, true, true);
    await noOverflow(page);
    await writeFile(info.outputPath('estimate.json'), JSON.stringify({ language, idle, initial, noCover, covered, imposed, subset, accessibility }, null, 2));
  });
}
