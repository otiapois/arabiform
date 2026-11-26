import { type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument, PDFName } from 'pdf-lib';
import { expect, golden, noOverflow, test } from './browser';
import { download } from './downloads';
import { selectEditor } from './m7-evidence';
import { physicalMarginPdf } from './m9-margin-fixture';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const auditKeys = ['rowNumber', 'filename', 'status', 'diagnostics', 'fontSizes'];
const copy = {
  en: { url: '/', custody: 'Download Custody Manifest (.json)', zip: 'Download Clean PDFs (.zip)', merged: 'Download Merged Printable PDF',
    auditJson: 'Download Preflight Audit (.json)', auditCsv: 'Download Preflight Audit (.csv)' },
  ar: { url: '/ar/pdf-mail-merge', custody: 'نزّل بيان سلسلة الحيازة (.json)', zip: 'نزّل ملفات PDF الجاهزة (ZIP)', merged: 'نزّل ملف PDF مدمجًا للطباعة',
    auditJson: 'نزّل تقرير الفحص (JSON)', auditCsv: 'نزّل تقرير الفحص (CSV)' },
};
type Language = keyof typeof copy;

async function capture(page: Page, info: TestInfo, language: Language) {
  if (process.env.ARABIFORM_CAPTURE_M9_SCREENSHOTS !== '1') return;
  const desktop = info.project.name === 'desktop';
  if (!desktop && language === 'ar') return;
  const name = desktop ? language === 'en' ? 'desktop-m9-custody-and-margin' : 'desktop-m9-ar-rtl-custody' : 'mobile-m9-custody';
  const folder = resolve('docs/reports/screenshots/m9');
  await mkdir(folder, { recursive: true });
  const tall = desktop && language === 'en';
  await page.evaluate(async () => { await document.fonts.ready; });
  if (tall) await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  else await page.locator('.exports').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: resolve(folder, name + '.png'), fullPage: tall, animations: 'disabled' });
}

async function guide(page: Page, number: number) {
  await page.locator('button[data-page="' + number + '"]').click();
  await expect(page.locator('button[aria-current="page"][data-page="' + number + '"]')).toBeVisible();
  const outline = page.getByTestId('margin-guide');
  await expect(outline).toBeVisible();
  await expect(outline).toHaveAttribute('data-inset-pt', '9');
  const sides = await outline.evaluate(el => {
    const line = el.getBoundingClientRect(), paper = el.parentElement!.getBoundingClientRect();
    return [line.top - paper.top, line.left - paper.left, paper.right - line.right, paper.bottom - line.bottom];
  });
  for (const inset of sides) expect(Math.abs(inset - 12)).toBeLessThan(0.08);
  return sides;
}

async function actualMembers(path: string, ids: string[], flattened = false) {
  const entries = unzipSync(await readFile(path));
  expect(Object.keys(entries)).toHaveLength(ids.length);
  for (const [i, bytes] of Object.values(entries).entries()) {
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.catalog.has(PDFName.of('AcroForm'))).toBe(!flattened);
    if (!flattened) {
      expect(pdf.getForm().getTextField('ID').getText()).toBe(ids[i]);
      expect(pdf.getForm().getTextField('Unmapped').getText()).toBe('KEEP 00109');
    }
  }
  return Object.entries(entries).map(([filename, bytes]) => ({ filename, sha256: sha(bytes), bytes: bytes.byteLength }));
}

for (const language of ['en', 'ar'] as const) {
  test('M9 ' + language + ' checks source and actual PDF hashes, print edge coordinates and receipt invalidation', async ({ page }, info) => {
    const labels = copy[language], english = language === 'en';
    const paths: string[] = [];
    page.on('request', req => paths.push(new URL(req.url()).pathname));
    await page.goto(labels.url);
    await expect(page.locator('html')).toHaveAttribute('dir', english ? 'ltr' : 'rtl');
    const button = page.getByTestId('custody-download');
    await expect(button).toHaveAccessibleName(labels.custody);
    await expect(button).toBeDisabled();
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => { await document.fonts.ready; });
    const idleJs = paths.filter(path => /\.m?js$/.test(path));
    expect(idleJs).toHaveLength(1);
    expect(idleJs[0]).toMatch(/\/assets\/index-[\w-]+\.js$/);
    await noOverflow(page);

    const template = await physicalMarginPdf();
    const csv = Buffer.from('\uFEFFName,ID\r\nMona,00123\r\nLayla,00007\r\n', 'utf8');
    const roster = english ? csv : await readFile(golden('roster.xlsx'));
    const ids = english ? ['00123', '00007'] : ['00123', '00007', '00891', 'AR-00042 / ق'];
    const templateSha256 = sha(template), rosterSha256 = sha(roster);
    const sources = { version: 1, templateSha256, rosterSha256 };
    await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic print margins.pdf', mimeType: 'application/pdf', buffer: template });
    await page.locator('.pattern-input').fill('{{ID}}.pdf');
    await expect(button).toBeDisabled();
    await page.getByTestId('roster-upload').setInputFiles(english ? { name: 'Synthetic records.csv', mimeType: 'text/csv', buffer: roster } : golden('roster.xlsx'));
    await expect(page.getByTestId('ready-count')).toHaveText(String(ids.length));
    await expect(page.getByTestId('flagged-count')).toHaveText(english ? '0' : '1');

    async function receipt(stage: string) {
      const file = await download(page, labels.custody, info.outputPath(stage), 'arabiform-custody-manifest.json');
      return JSON.parse(await readFile(file, 'utf8'));
    }
    expect(await receipt('sources')).toEqual(sources);
    const coverage = page.getByTestId('custody-coverage');
    await expect(coverage).toContainText(english ? 'Export a ZIP' : 'صدّر ملف ZIP');
    const advisory = page.getByTestId('margin-advisory');
    await expect(advisory).toBeVisible();
    await expect(advisory).toContainText(english ? 'Print-margin advisory' : 'تنبيه هامش الطباعة');
    const warnings = page.getByTestId('margin-advisory-item');
    await expect(warnings).toHaveCount(2);
    for (const [index, [p, edge, pt]] of [['1', 'left', '3.25'], ['2', 'right', '7.5']].entries()) {
      const item = warnings.nth(index);
      await expect(item).toHaveAttribute('data-field', 'Name');
      await expect(item).toHaveAttribute('data-page', p!);
      await expect(item).toHaveAttribute('data-edge', edge!);
      await expect(item).toHaveAttribute('data-clearance-pt', pt!);
      await expect(item).toContainText(english ? 'Page ' + p : 'الصفحة ' + p);
      await expect(item).toContainText(english ? pt + ' pt' : pt + ' نقطة');
      await expect(item).toContainText(english ? edge + ' edge' : index ? 'الحافة اليمنى' : 'الحافة اليسرى');
    }
    await expect(page.locator('[data-pdf-field="ID"]')).toHaveValue('ID');
    await expect(page.locator('[data-pdf-field="Unmapped"]')).toHaveValue('');
    const toggle = page.getByTestId('margin-guide-toggle');
    await expect(toggle).not.toBeChecked();
    await page.locator('#preview select').selectOption('1');
    await toggle.check();
    const insets = [await guide(page, 1), await guide(page, 2)];
    await page.locator('#preview select').selectOption('fit');
    await expect(page.getByTestId('margin-guide')).toBeVisible();
    await noOverflow(page);

    const json = await download(page, labels.auditJson, info.outputPath('audit'), 'arabiform-preflight.json');
    const csvAudit = await download(page, labels.auditCsv, info.outputPath('audit'), 'arabiform-preflight.csv');
    const parsed = Papa.parse<Record<string, string>>(await readFile(csvAudit, 'utf8'), { header: true, skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.meta.fields).toEqual(auditKeys);
    const rows = JSON.parse(await readFile(json, 'utf8')) as Record<string, unknown>[];
    expect(rows.length).toBe(ids.length + (english ? 0 : 1));
    for (const row of rows) expect(Object.keys(row)).toEqual(auditKeys);
    expect(rows).toEqual(parsed.data.map(r => ({ rowNumber: Number(r.rowNumber), filename: r.filename,
      status: r.status, diagnostics: JSON.parse(r.diagnostics!), fontSizes: JSON.parse(r.fontSizes!) })));
    expect(await receipt('after-audits')).toEqual(sources);

    const zip = await download(page, labels.zip, info.outputPath('editable'), 'arabiform-clean.zip');
    const entries = await actualMembers(zip, ids);
    expect(await receipt('zip-only')).toEqual({ ...sources, entries });
    const plain = await download(page, labels.merged, info.outputPath('plain'), 'arabiform-merged.pdf');
    const mergedBytes = await readFile(plain);
    const expectedPages = ids.length * 2;
    expect((await PDFDocument.load(mergedBytes)).getPageCount()).toBe(expectedPages);
    const combined = { ...sources, entries, mergedPdfSha256: sha(mergedBytes) };
    expect(await receipt('both')).toEqual(combined);
    await expect(coverage).toContainText(english ? 'ZIP members and merged PDF' : 'وبصمة ملف PDF المدمج');
    for (const [key, digest] of [['template', templateSha256], ['roster', rosterSha256]] as const) {
      const prefix = page.getByTestId('custody-' + key + '-prefix');
      await expect(prefix).toHaveAttribute('dir', 'ltr');
      await expect(prefix).toHaveText(digest.slice(0, 12) + '…');
      await prefix.click();
      const full = page.getByTestId('custody-' + key + '-sha256');
      await expect(full).toBeVisible();
      await expect(full).toHaveText(digest);
      await expect(full).toHaveCSS('direction', 'ltr');
    }
    await noOverflow(page);
    await capture(page, info, language);

    if (english) {
      const cover = page.getByTestId('include-cover-sheet');
      await cover.check();
      const footer = page.getByTestId('custody-cover-footer');
      await expect(footer).not.toBeChecked();
      expect(await receipt('cover-change')).toEqual(sources);
      const withoutFooter = await download(page, labels.merged, info.outputPath('cover-without-digest'), 'arabiform-merged.pdf');
      expect(await receipt('cover-only')).toEqual({ ...sources, mergedPdfSha256: sha(await readFile(withoutFooter)) });
      await footer.check();
      expect(await receipt('footer-change')).toEqual(sources);
      const withFooter = await download(page, labels.merged, info.outputPath('cover-digest'), 'arabiform-merged.pdf');
      const covered = await readFile(withFooter);
      expect(await receipt('footer-merged')).toEqual({ ...sources, mergedPdfSha256: sha(covered) });
      expect((await PDFDocument.load(covered)).getPageCount()).toBe(expectedPages + 1);
      const proof = execFileSync('python', ['tests/e2e/m9-cover-proof.py', plain, withoutFooter, withFooter, templateSha256, rosterSha256], { encoding: 'utf8', windowsHide: true });
      await writeFile(info.outputPath('m9-cover-proof.json'), proof);
      expect(JSON.parse(proof).identicalBodyPages).toBe(expectedPages);

      await page.getByTestId('flatten-zip').check();
      expect(await receipt('flatten-change')).toEqual(sources);
      const flatZip = await download(page, labels.zip, info.outputPath('flattened'), 'arabiform-clean.zip');
      const flat = await actualMembers(flatZip, ids, true);
      expect(flat.map(e => e.filename)).toEqual(entries.map(e => e.filename));
      for (const [index, entry] of flat.entries()) expect(entry.sha256).not.toBe(entries[index]!.sha256);
      expect(await receipt('flatten-zip')).toEqual({ ...sources, entries: flat });
      await page.locator('.pattern-input').fill('NEW-{{ID}}.pdf');
      expect(await receipt('renamed')).toEqual(sources);
      await page.getByTestId('flatten-zip').uncheck();
      const renamedZip = await download(page, labels.zip, info.outputPath('new-pattern'), 'arabiform-clean.zip');
      const renamed = await actualMembers(renamedZip, ids);
      expect(renamed.map(e => e.filename)).toEqual(ids.map(id => 'NEW-' + id + '.pdf'));
      expect(await receipt('renamed-exported')).toEqual({ ...sources, entries: renamed });
      const editor = await selectEditor(page, 1);
      await editor.getByRole('textbox', { name: 'ID', exact: true }).fill('00444');
      await expect(page.getByTestId('queue-row').first()).toContainText('NEW-00444.pdf');
      expect(await receipt('inline-edit')).toEqual(sources);
      const editedZip = await download(page, labels.zip, info.outputPath('edited'), 'arabiform-clean.zip');
      const edited = await actualMembers(editedZip, ['00444', '00007']);
      expect(await receipt('edited-exported')).toEqual({ ...sources, entries: edited });
      const replacement = Buffer.from('Name,ID\r\nChanged,00001\r\n');
      await page.getByTestId('roster-upload').setInputFiles({ name: 'Synthetic records.csv', mimeType: 'text/csv', buffer: replacement });
      await expect(page.getByTestId('ready-count')).toHaveText('1');
      const newSources = { ...sources, rosterSha256: sha(replacement) };
      expect(await receipt('replacement')).toEqual(newSources);
      const newZip = await download(page, labels.zip, info.outputPath('new-roster'), 'arabiform-clean.zip');
      expect(await receipt('replacement-exported')).toEqual({ ...newSources, entries: await actualMembers(newZip, ['00001']) });
      const nextPdf = await readFile(golden('template.pdf'));
      await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic print margins.pdf', mimeType: 'application/pdf', buffer: nextPdf });
      await expect(advisory).toHaveCount(0);
      expect(await receipt('new-template')).toEqual({ ...newSources, templateSha256: sha(nextPdf) });
    }
    await noOverflow(page);
    await writeFile(info.outputPath('m9-checks.json'), JSON.stringify({ idleJs, format: english ? 'CSV' : 'XLSX', combined, insets }, null, 2));
  });
}
