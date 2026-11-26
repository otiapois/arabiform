import { expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { golden, noOverflow } from './browser';
import { download } from './downloads';

export async function screenshot(page: Page, name: string, selector: string) {
  if (process.env.ARABIFORM_CAPTURE_M7_SCREENSHOTS !== '1') return;
  await page.locator(selector).evaluate(async element => {
    await document.fonts.ready;
    element.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  const directory = resolve('docs/reports/screenshots/m7');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name + '.png'), animations: 'disabled' });
}

export async function receipt(info: TestInfo, name: string, value: unknown) {
  await mkdir(info.outputDir, { recursive: true });
  await writeFile(info.outputPath(name + '.json'), JSON.stringify(value, null, 2));
}

export async function localOnly(page: Page) {
  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage), session: Object.keys(sessionStorage), indexedDB: await indexedDB.databases(),
    caches: await caches.keys(), workers: (await navigator.serviceWorker.getRegistrations()).length,
  }));
  expect(storage).toEqual({ local: [], session: [], indexedDB: [], caches: [], workers: 0 });
  expect(await page.context().cookies()).toEqual([]);
  await noOverflow(page);
  return storage;
}

export async function selectEditor(page: Page, row: number) {
  const record = page.locator(`[data-testid="queue-row"][data-row="${row}"]`);
  if (await record.getAttribute('data-selected') !== 'true') await record.getByRole('button').click();
  const edit = page.locator('button[aria-controls="edit-cells"]');
  if (await edit.getAttribute('aria-expanded') !== 'true') await edit.click();
  return page.locator('#edit-cells');
}

export const align = (page: Page, field: string) => page.locator(`[data-align-field="${field}"]`);

export async function cleanPanel(page: Page) {
  const panel = page.locator('details').filter({ has: page.getByText('Clean & replace roster text', { exact: true }) });
  if (!await panel.evaluate((el: HTMLDetailsElement) => el.open)) await panel.locator('summary').click();
  return panel;
}

export async function verifyWorkshopZip(page: Page, directory: string, names: string[], ids: string[]) {
  const path = await download(page, 'Download Clean PDFs (.zip)', directory, 'arabiform-clean.zip');
  const entries = unzipSync(await readFile(path));
  expect(Object.keys(entries)).toEqual(ids.map(id => id + '.pdf'));
  for (const [index, id] of ids.entries()) {
    const pdf = await PDFDocument.load(entries[id + '.pdf']!);
    expect(pdf.getForm().getTextField('ID').getText()).toBe(id);
    expect(pdf.getForm().getTextField('Name').getText()).toBe(names[index]);
  }
  return entries;
}

export async function canvasNameInk(page: Page) {
  // The Workshop template has an unrotated US-Letter page. Exclude the known border from the ink scan.
  const doc = await PDFDocument.load(await readFile(golden('template.pdf')));
  const paper = doc.getPage(0).getSize();
  const widget = doc.getForm().getTextField('Name').acroField.getWidgets()[0]!.getRectangle();
  return page.locator('canvas[data-rendered="true"]').evaluate((canvas: HTMLCanvasElement, { paper, widget }) => {
    const scale = canvas.width / paper.width;
    const left = widget.x * scale;
    const right = (widget.x + widget.width) * scale;
    const top = (paper.height - widget.y - widget.height) * scale;
    const bottom = (paper.height - widget.y) * scale;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let first = canvas.width, last = -1, ink = 0;
    for (let y = Math.ceil(top + 2 * scale); y < bottom - 2 * scale; y++) {
      for (let x = Math.ceil(left + 2 * scale); x < right - 2 * scale; x++) {
        const offset = 4 * (canvas.width * y + x);
        if (Math.max(data[offset]!, data[offset + 1]!, data[offset + 2]!) >= 140) continue;
        first = Math.min(x, first);
        last = Math.max(x, last);
        ink++;
      }
    }
    return { ink, left: first - left, right: right - last - 1 };
  }, { paper, widget });
}

export async function downloadedCenterPixels(info: TestInfo, bytes: Uint8Array, name: string, id: string) {
  const directory = info.outputPath('center');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'before.pdf'), await readFile(golden('template.pdf')));
  await writeFile(join(directory, 'center.pdf'), bytes);
  const spec = { before: 'before.pdf', after: 'center.pdf', values: { Name: name, ID: id }, alignments: { Name: { mode: 'center', anchor: 'center' } } };
  const manifest = join(directory, 'manifest.json');
  await writeFile(manifest, JSON.stringify({ cases: [spec] }));
  execFileSync('python', ['scripts/verify-pdf-pixels.py', manifest], { encoding: 'utf8', windowsHide: true });
  const report = JSON.parse(await readFile(join(directory, 'manifest-verification.json'), 'utf8'));
  expect(report.scale).toBe(4);
  expect(report.cases[0]).toMatchObject({ clippedInkPixels: 0, outsideMappedWidgetChangedPixels: 0 });
  const field = report.cases[0].widgets.find((item: { field: string }) => item.field === 'Name');
  expect(field.inkPixelsAt4x).toBeGreaterThan(0);
  const [left, right] = field.logicalHorizontalInsetsAt4x;
  expect(Math.abs(left - right)).toBeLessThanOrEqual(3);
}
