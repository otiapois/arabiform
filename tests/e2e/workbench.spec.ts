import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { canvasInk, expect, golden, noOverflow, snap, test } from './browser';
import { verifyDownloads } from './downloads';

async function counts(page: Page, ready: number, flagged: number) {
  await expect(page.getByTestId('ready-count')).toHaveText(String(ready));
  await expect(page.getByTestId('flagged-count')).toHaveText(String(flagged));
}

for (const format of ['csv', 'xlsx']) {
  test(`upload PDF + ${format}, resolve overflow and verify actual downloads`, async ({ page, traffic }, info) => {
    const desktop = info.project.name === 'desktop';
    await page.goto('/');
    await page.getByTestId('pdf-upload').setInputFiles(golden('template.pdf'));
    await page.getByTestId('roster-upload').setInputFiles(golden('roster.' + format));
    await counts(page, 4, 1);
    await expect(page.getByTestId('warning-count')).toHaveText('0');
    await expect(page.locator('[data-pdf-field="Sentinel"]')).toHaveValue('');
    if (format === 'xlsx') {
      const sheet = page.getByTestId('worksheet');
      await expect(sheet.locator('option')).toHaveText(['Roster', 'Numeric IDs']);
      await sheet.selectOption({ label: 'Numeric IDs' });
      await expect(page.getByTestId('total-count')).toHaveText('4');
      await expect(page.getByTestId('warning-count')).toHaveText('3');
      await page.getByRole('button', { name: 'Select row 2', exact: true }).click();
      await expect(page.getByText(/stored this identifier as a number/)).toBeVisible();
      for (const index of [3, 4]) {
        await page.getByRole('button', { name: 'Select row ' + index, exact: true }).click();
        await expect(page.getByText(/Excel uses scientific notation/)).toBeVisible();
      }
      await sheet.selectOption({ label: 'Roster' });
      await counts(page, 4, 1);
      await expect(page.getByTestId('warning-count')).toHaveText('0');
    }

    const initial = await canvasInk(page);
    const row = page.locator('[data-testid="queue-row"][data-row="5"]');
    await expect(row).toContainText('Flagged');
    await row.getByRole('button', { name: 'Select row 5' }).click();
    const overlay = page.getByTestId('flagged-widget');
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toHaveAttribute('data-field', 'Name');
    await expect(overlay).toBeVisible();

    const original = await PDFDocument.load(await readFile(golden('template.pdf')));
    const formRect = original.getForm().getTextField('Name').acroField.getWidgets()[0]!.getRectangle();
    const { width, height } = original.getPages()[0]!.getSize();
    const rect = await overlay.evaluate(node => {
      const border = getComputedStyle(node);
      const area = node.getBoundingClientRect();
      const canvas = node.parentElement!.querySelector('canvas')!.getBoundingClientRect();
      return {
        x: (area.left - canvas.left) / canvas.width, top: (area.top - canvas.top) / canvas.height,
        width: area.width / canvas.width, height: area.height / canvas.height,
        color: border.borderTopColor, stroke: parseFloat(border.borderTopWidth),
      };
    });
    expect(rect.x).toBeCloseTo(formRect.x / width, 2);
    expect(rect.top).toBeCloseTo(1 - (formRect.y + formRect.height) / height, 2);
    expect(rect.width).toBeCloseTo(formRect.width / width, 2);
    expect(rect.height).toBeCloseTo(formRect.height / height, 2);
    const [red, green, blue] = rect.color.match(/\d+/g)!.map(Number);
    expect(red!).toBeGreaterThan(Math.max(green!, blue!) * 2);
    expect(rect.stroke).toBeGreaterThanOrEqual(1);
    await noOverflow(page);
    const flagged = await canvasInk(page);
    if (format === 'csv' && desktop) await snap(page, 'desktop-preview-flagged', '#preview');
    await expect(page.getByTestId('export-counts')).toContainText('skip flagged rows (1)');
    const before = await verifyDownloads(page, info.outputPath('flagged'), false);

    await page.getByRole('button', { name: 'Edit row 5', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('ليلى حسن');
    await counts(page, 5, 0);
    await expect(row).toContainText('Ready');
    await expect(page.getByTestId('flagged-widget')).toHaveCount(0);
    await expect(page.locator('#preview')).toContainText('Generated row');
    const fixed = await canvasInk(page);
    expect(fixed.dark).not.toBe(flagged.dark);
    await page.getByRole('button', { name: 'Done editing' }).click();
    await noOverflow(page);
    if (format === 'csv' && desktop) await snap(page, 'desktop-fixed-ready', '.queue');
    const after = await verifyDownloads(page, info.outputPath('fixed'), true);
    expect(traffic.workers.some(url => /\/assets\/pdf\.worker\.min-[^/]+\.mjs$/.test(new URL(url).pathname))).toBe(true);
    await writeFile(info.outputPath('browser-output-checks.json'),
      JSON.stringify({ before, after, canvas: { initial, flagged, fixed }, highlight: rect }, null, 2));
  });
}

test('one-click synthetic sample, English and Arabic RTL', async ({ page, traffic }, info) => {
  const desktop = info.project.name === 'desktop';
  await page.goto('/');
  await noOverflow(page);
  await snap(page, desktop ? 'desktop-home' : 'mobile-home');
  await page.getByRole('button', { name: 'Try Synthetic Arabic Sample' }).click();
  await counts(page, 4, 1);
  await expect(page.getByText('Synthetic Sample', { exact: true })).toBeVisible();
  await canvasInk(page);
  await noOverflow(page);
  if (!desktop) await snap(page, 'mobile-preview', '#preview');

  await page.goto('/ar/pdf-mail-merge');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await noOverflow(page);
  await page.getByRole('button', { name: 'جرّب العينة العربية الاصطناعية' }).click();
  await counts(page, 4, 1);
  await expect(page.getByText('عينة اصطناعية', { exact: true })).toBeVisible();
  await canvasInk(page);
  await noOverflow(page);
  if (desktop) await snap(page, 'desktop-ar-rtl');
  expect(traffic.workers.length).toBeGreaterThan(0);
});

test('a rejected replacement clears the old template and disables PDF export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try Synthetic Arabic Sample' }).click();
  await counts(page, 4, 1);
  for (const [file, message] of [
    ['xfa.pdf', 'XFA forms are unsupported'],
    ['flat.pdf', 'No fillable text fields or checkboxes were found'],
    ['encrypted.pdf', 'This PDF is encrypted'],
    ['signed.pdf', 'This PDF has a signature field'],
  ] as const) {
    await page.getByTestId('pdf-upload').setInputFiles(golden(file));
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('button', { name: 'Download Clean PDFs (.zip)' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Download Merged Printable PDF' })).toBeDisabled();
    await expect(page.getByTestId('empty-preview')).toBeVisible();
    await noOverflow(page);
  }
});
