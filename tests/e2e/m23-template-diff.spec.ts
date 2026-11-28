import type { Locator, Page, TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { canvasInk, expect, golden, noOverflow, test } from './browser';
import { auditPage } from './m10-accessibility';

const fixture = (file: string) => resolve('fixtures/m23', file);
const oldFile = fixture('2026-offer.pdf');
const newFile = fixture('2027-offer.pdf');
const sourcePreset = fixture('offer-preset-v11.json');
const sourceRoster = fixture('offer-roster.csv');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const coreChunk = /\/diff-migrator-[\w-]+\.js$/;
const demoChunk = /\/compare-demo-[\w-]+\.js$/;

async function openCompare(page: Page, ar: boolean) {
  const paths: string[] = [];
  page.context().on('request', request => paths.push(new URL(request.url()).pathname));
  await page.goto(ar ? '/ar/pdf-mail-merge' : '/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
  const idle = [...paths];
  expect(idle.filter(path => /\.m?js$/i.test(path))).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
  expect(idle.filter(path => /\.(pdf|csv|xlsx)$/i.test(path))).toEqual([]);
  const mode = page.getByTestId('mode-compare');
  await expect(mode).toHaveAccessibleName(ar ? 'مقارنة القوالب' : 'Compare templates');
  await mode.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('compare-old-upload')).toBeAttached();
  expect(paths.some(path => /\/CompareTemplates-[\w-]+\.js$/.test(path))).toBe(true);
  expect(paths.filter(path => coreChunk.test(path) || demoChunk.test(path))).toEqual([]);
  return { idle, paths };
}

async function save(page: Page, button: Locator, dir: string) {
  await mkdir(dir, { recursive: true });
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const dest = join(dir, file.suggestedFilename());
  await file.saveAs(dest);
  expect(await file.failure()).toBeNull();
  return readFile(dest);
}

async function snapshot(page: Page, info: TestInfo, ar: boolean) {
  const mobile = info.project.name === 'mobile';
  if (mobile && !ar) return;
  const dir = process.env.ARABIFORM_CAPTURE_M23_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m23') : info.outputPath('screenshots');
  await mkdir(dir, { recursive: true });
  await page.getByTestId('compare-changes').evaluate(async el => {
    await document.fonts.ready;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 12, behavior: 'instant' });
  });
  const name = mobile ? 'mobile-m23-template-diff' : 'desktop-m23-template-diff-' + (ar ? 'ar' : 'en');
  await page.screenshot({ path: join(dir, name + '.png'), animations: 'disabled' });
}

async function extensions(page: Page) {
  const evidence = [];
  for (const [id, expected] of [['compare-migrated-preset', '(.json)'], ['compare-report-csv', '(.csv)'], ['compare-report-json', '(.json)']] as const) {
    const text = page.getByTestId(id).locator('bdi');
    await expect(text).toHaveText(expected);
    const glyphs = await text.evaluate(el => {
      const node = el.firstChild!;
      return Array.from(node.textContent!, (_, index) => {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const { left, top } = range.getBoundingClientRect();
        return { left, top };
      });
    });
    expect(new Set(glyphs.map(({ top }) => top)).size).toBe(1);
    for (let i = 1; i < glyphs.length; i++) expect(glyphs[i]!.left, id).toBeGreaterThan(glyphs[i - 1]!.left);
    evidence.push({ id, expected, glyphs });
  }
  return evidence;
}

function sentinel(document: PDFDocument) {
  const field = document.getForm().getTextField('Sentinel');
  const normal = field.acroField.getWidgets()[0]!.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
  if (!(normal instanceof PDFRawStream)) throw new Error('Sentinel lacks a saved normal appearance');
  return { text: field.getText(), appearance: sha(normal.getContents()) };
}

for (const locale of ['en', 'ar']) {
  const ar = locale === 'ar';
  test('M23 ' + locale + ' real offer uploads migrate v11 and open the revised form in Fill', async ({ page, traffic }, info) => {
    const { idle, paths } = await openCompare(page, ar);
    const old = await readFile(oldFile), revised = await readFile(newFile);
    const [oldSha256, newSha256] = [old, revised].map(sha);
    await page.getByTestId('compare-old-upload').setInputFiles(oldFile);
    await page.getByTestId('compare-preset-upload').setInputFiles(sourcePreset);
    expect(paths.some(path => coreChunk.test(path))).toBe(false);
    await page.getByTestId('compare-new-upload').setInputFiles(newFile);
    const changes = page.getByTestId('compare-changes');
    await expect(changes.locator('dd')).toHaveText(['1', '1', '1', '1']);
    await expect(page.getByTestId('compare-warning')).toBeVisible();
    for (const detail of ['154 × 32 → 132 × 32 pt', '-22 × 0 pt', '40 → 28', 'ARCHIVE']) await expect(changes).toContainText(detail);
    expect(paths.some(path => coreChunk.test(path))).toBe(true);
    expect(paths.some(path => demoChunk.test(path))).toBe(false);
    const rename = page.getByTestId('compare-rename');
    await expect(rename).toHaveAccessibleName(/FullName/);
    const handoff = page.getByTestId('compare-open-fill');
    await expect(handoff).toBeDisabled();
    await expect(page.getByTestId('compare-migrated-preset')).toBeDisabled();
    const options = await rename.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value));
    expect(options).toContain('EmployeeFullName');
    for (const usedOrIncompatible of ['Department', 'EmployeeCode', 'ReviewReference']) expect(options).not.toContain(usedOrIncompatible);
    await rename.selectOption('EmployeeFullName');
    await expect(handoff).toBeEnabled();
    const geometry = { field: 'EmployeeCode', pageNumber: 1, occurrence: 1, oldWidthPt: 154, newWidthPt: 132, widthDeltaPt: -22, oldHeightPt: 32, newHeightPt: 32, heightDeltaPt: 0, shrunk: true };
    const dir = info.outputPath('migrated');
    const reportJson = await save(page, page.getByTestId('compare-report-json'), dir);
    const report = JSON.parse(reportJson.toString('utf8'));
    expect(report).toMatchObject({ oldSha256, newSha256, status: 'flagged', breaking: true, presetStatus: 'ready',
      appliedRenames: [{ field: 'FullName', target: 'EmployeeFullName' }], diagnostics: [],
      addedFields: [{ name: 'EmployeeFullName', kind: 'text' }], removedFields: [{ name: 'FullName', kind: 'text' }],
      geometryChangedFields: [geometry], maxLenChangedFields: [{ field: 'EmployeeCode', oldMaxLength: 40, newMaxLength: 28, reduced: true }],
      choiceOptionsChangedFields: [{ field: 'Department', added: [], removed: [{ value: 'ARCHIVE', label: 'Legacy archive' }] }] });
    const reportCsv = await save(page, page.getByTestId('compare-report-csv'), dir);
    const csv = Papa.parse<Record<string, string>>(reportCsv.toString('utf8'), { header: true, skipEmptyLines: true });
    expect(csv.errors).toEqual([]);
    expect(csv.data.map(row => row.change).sort()).toEqual(['added', 'choices', 'geometry', 'maxLen', 'removed', 'rename', 'summary']);
    for (const row of csv.data) expect([row.oldSha256, row.newSha256, row.status]).toEqual([oldSha256, newSha256, 'flagged']);
    const byChange = Object.fromEntries(csv.data.map(row => [row.change, row]));
    expect(JSON.parse(byChange.geometry!.details!)).toEqual({ widthDeltaPt: -22, heightDeltaPt: 0, shrunk: true });
    expect([byChange.maxLen!.old, byChange.maxLen!.new]).toEqual(['40', '28']);
    expect(JSON.parse(byChange.choices!.details!).removed).toEqual(report.choiceOptionsChangedFields[0].removed);
    const preset = await save(page, page.getByTestId('compare-migrated-preset'), dir);
    const before = JSON.parse(await readFile(sourcePreset, 'utf8'));
    const expected = JSON.parse(JSON.stringify(before));
    for (const key of ['mapping', 'alignOverrides', 'fieldTypography']) {
      expected[key].EmployeeFullName = expected[key].FullName;
      delete expected[key].FullName;
    }
    expected.conditionalRules[0].field = 'EmployeeFullName';
    expect(JSON.parse(preset.toString('utf8'))).toEqual(expected);
    await noOverflow(page);
    const accessibility = await auditPage(page, 'workbench');
    const rtlExtensions = ar ? await extensions(page) : [];
    await snapshot(page, info, ar);

    await handoff.click();
    await expect(page.locator('.source-panel').getByText('2027-offer.pdf', { exact: true })).toBeVisible();
    await expect(page.getByTestId('download-zip')).toBeDisabled();
    await page.getByTestId('roster-upload').setInputFiles(sourceRoster);
    await expect(page.getByTestId('ready-count')).toHaveText('2');
    await expect(page.getByTestId('flagged-count')).toHaveText('0');
    const preview = await canvasInk(page);
    const members = unzipSync(await save(page, page.getByTestId('download-zip'), dir));
    expect(Object.keys(members).sort()).toEqual(['00007.pdf', '00123.pdf']);
    const originalSentinel = sentinel(await PDFDocument.load(revised));
    expect(originalSentinel.text).toBe('KEEP 00109');
    const pdfEntries = [];
    for (const [code, name, review, department] of [
      ['00123', 'مُحَمَّد سَالِم ١٢', 'HR-0001', 'ENG'], ['00007', 'سَلْمَى يَاسِين', 'HR-0002', 'OPS'],
    ] as const) {
      const filename = code + '.pdf';
      const bytes = members[filename]!;
      const pdf = await PDFDocument.load(bytes);
      const form = pdf.getForm();
      expect(form.getTextField('EmployeeFullName').getText()).toBe(name);
      expect(form.getTextField('EmployeeCode').getText()).toBe(code);
      expect(form.getTextField('ReviewReference').getText()).toBe(review);
      expect(form.getDropdown('Department').getSelected()).toEqual([department]);
      expect(sentinel(pdf)).toEqual(originalSentinel);
      pdfEntries.push({ filename, bytes: bytes.length, sha256: sha(bytes) });
    }
    const receipt = JSON.parse((await save(page, page.getByTestId('custody-download'), dir)).toString('utf8'));
    expect(receipt).toMatchObject({ templateSha256: newSha256, rosterSha256: sha(await readFile(sourceRoster)), entries: pdfEntries });
    const workers = [...traffic.workers];
    expect(workers.some(url => /pdf\.worker/.test(url))).toBe(true);
    await noOverflow(page);

    // The same migrated settings must still hold an entire failing roster at preflight.
    await page.getByTestId('roster-upload').setInputFiles({ name: 'oversize.csv', mimeType: 'text/csv',
      buffer: Buffer.from('Name,Code,Department,Tier\r\nRecheck,' + '1'.repeat(29) + ',OPS,Standard\r\n') });
    await expect(page.getByTestId('flagged-count')).toHaveText('1');
    await expect(page.getByTestId('ready-count')).toHaveText('0');
    await expect(page.getByTestId('download-zip')).toBeDisabled();
    const audit = JSON.parse((await save(page, page.locator('.audit-actions').getByRole('button', { name: /json/i }), dir)).toString('utf8'));
    expect(audit[0].diagnostics).toContainEqual(expect.objectContaining({ field: 'EmployeeCode', code: 'exceeds-maxlen', maxLengthExcess: 1 }));
    await writeFile(info.outputPath('m23-evidence.json'), JSON.stringify({ idle, workers, preview, accessibility, rtlExtensions,
      oldSha256, newSha256, csvSha256: sha(reportCsv), jsonSha256: sha(reportJson), presetSha256: sha(preset), pdfEntries, oversize: audit }, null, 2));
  });

  test('M23 ' + locale + ' lazy demo holds a removed conditional choice and rejected replacement PDF', async ({ page }, info) => {
    const { paths } = await openCompare(page, ar);
    await page.getByTestId('compare-demo').click();
    await expect(page.getByTestId('compare-rename')).toHaveCount(1);
    expect(paths.some(path => demoChunk.test(path))).toBe(true);
    await expect(page.getByTestId('compare-templates').getByText(ar ? 'عينة اصطناعية' : 'Synthetic Sample', { exact: true })).toHaveCount(3);
    const before = JSON.parse(await readFile(sourcePreset, 'utf8'));
    before.conditionalRules[1].action.value = 'ARCHIVE';
    await page.getByTestId('compare-preset-upload').setInputFiles({ name: 'retired-choice.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(before)) });
    await expect(page.locator('[data-code="invalid-choice"]')).toContainText('Department');
    await page.getByRole('combobox', { name: /FullName/ }).selectOption('EmployeeFullName');
    const openFill = page.getByTestId('compare-open-fill');
    await expect(openFill).toBeDisabled();
    await expect(page.getByTestId('compare-migrated-preset')).toBeDisabled();
    const report = JSON.parse((await save(page, page.getByTestId('compare-report-json'), info.outputPath('blocked'))).toString('utf8'));
    expect(report).toMatchObject({ status: 'blocked', presetStatus: 'blocked',
      diagnostics: [{ field: 'Department', ruleIndex: 2, code: 'invalid-choice' }] });
    await noOverflow(page);
    await page.getByTestId('compare-new-upload').setInputFiles(golden('encrypted.pdf'));
    await expect(page.getByTestId('compare-error')).toHaveAttribute('data-code', 'encrypted-pdf');
    await expect(page.getByTestId('compare-changes')).toHaveCount(0);
    await expect(openFill).toHaveCount(0);
    await noOverflow(page);
  });
}
