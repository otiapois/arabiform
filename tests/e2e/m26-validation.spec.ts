import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { expect, noOverflow, test } from './browser';
import { template as mixedTemplate } from './clinic-downloads';
import { auditPage } from './m10-accessibility';

const fixture = (name: string) => resolve('fixtures/m26', name);
const repairedIban = 'SA31 0000 0000 0000 0001 0001';
const aliases = ['SA9180B10000000000000000', 'SA91801B0000000000000000'];
const reasons = {
  'iban-checksum': ['IBAN check digits do not match. Compare every character with the original.', 'رقما التحقّق في الآيبان غير مطابقين. قارن كل حرف ورقم بالمصدر الأصلي.'],
  'iso-date': ['Enter a real Gregorian date in YYYY-MM-DD format.', 'أدخل تاريخًا ميلاديًا صالحًا بالصيغة YYYY-MM-DD.'],
};
const row = (page: Page, number: number) => page.locator(`[data-testid="queue-row"][data-row="${number}"]`);
const cell = (page: Page, column: string) => page.locator(`textarea[data-roster-column="${column}"]`);

async function open(page: Page, ar: boolean) {
  const requests: string[] = [];
  page.context().on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto(ar ? '/ar/pdf-mail-merge' : '/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
  const idle = [...requests];
  expect(idle.filter(p => /\.m?js$/i.test(p))).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
  expect(idle.filter(p => /\.(?:pdf|csv|xlsx|wasm)$/i.test(p))).toEqual([]);
  await noOverflow(page);
  const toggle = page.getByTestId('data-validation-toggle');
  await expect(toggle).toHaveAccessibleName(ar ? 'التحقق من بيانات الجدول' : 'Data validation');
  await toggle.click();
  await expect(page.getByTestId('schema-demo')).toHaveAccessibleName(ar
    ? 'جرّب مثال رواتب الخليج الاصطناعي للتحقق من IBAN' : 'Try Synthetic GCC Payroll / IBAN Demo');
  expect(requests.slice(idle.length).some(p => /DataValidation-[\w-]+\.js$/.test(p))).toBe(true);
  return idle;
}

async function counts(page: Page, ready: number, flagged: number) {
  await expect(page.getByTestId('ready-count')).toHaveText(String(ready));
  await expect(page.getByTestId('flagged-count')).toHaveText(String(flagged));
}

async function save(page: Page, button: Locator, directory: string, name: string) {
  await mkdir(directory, { recursive: true });
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toBe(name);
  const output = join(directory, name);
  await download.saveAs(output);
  expect(await download.failure()).toBeNull();
  return readFile(output);
}

type Issue = { code: string; column: string; rule: string; rowNumber: number; reasonCode: string; reason: { en: string; ar: string } };
type AuditRow = { rowNumber: number; filename: string; status: string; schemaDiagnostics?: Issue[] };

async function audit(page: Page, directory: string) {
  const panel = page.locator('.audit-actions');
  const json = await save(page, panel.getByRole('button', { name: /json/i }), directory, 'arabiform-preflight.json');
  const csv = await save(page, panel.getByRole('button', { name: /csv/i }), directory, 'arabiform-preflight.csv');
  const rows: AuditRow[] = JSON.parse(json.toString('utf8'));
  const parsed = Papa.parse<Record<string, string>>(csv.toString('utf8'), { header: true, skipEmptyLines: true });
  expect(parsed.errors).toEqual([]);
  expect(parsed.data.map(r => [Number(r.rowNumber), r.filename, r.status, JSON.parse(r.schemaDiagnostics!)]))
    .toEqual(rows.map(r => [r.rowNumber, r.filename, r.status, r.schemaDiagnostics]));
  return rows;
}

function sentinel(pdf: PDFDocument) {
  const field = pdf.getForm().getTextField('Sentinel');
  const appearance = field.acroField.getWidgets()[0]!.dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
  if (!(appearance instanceof PDFRawStream)) throw Error('Missing Sentinel appearance');
  expect(field.getText()).toBe('KEEP 00109');
  return Buffer.from(appearance.getContents());
}

async function zip(page: Page, dir: string) {
  return unzipSync(await save(page, page.getByTestId('download-zip'), dir, 'arabiform-clean.zip'));
}

async function suffixOrder(page: Page) {
  const suffix = page.getByTestId('email-drafts-toggle').locator('bdi[dir="ltr"]');
  await expect(suffix).toHaveText('(.eml)');
  const coordinates = await suffix.evaluate(node => Array.from(node.textContent!, (_, i) => {
    const range = document.createRange();
    range.setStart(node.firstChild!, i);
    range.setEnd(node.firstChild!, i + 1);
    const { left, top, width } = range.getBoundingClientRect();
    return { left, top, width };
  }));
  expect(coordinates.every((c, i) => c.width > 0 && c.top === coordinates[0]!.top && (!i || c.left > coordinates[i - 1]!.left))).toBe(true);
  return coordinates;
}

async function screenshot(page: Page, info: TestInfo, ar: boolean) {
  const mobile = info.project.name === 'mobile';
  if (mobile && !ar) return;
  const dir = process.env.ARABIFORM_CAPTURE_M26_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m26') : info.outputPath('screenshots');
  await mkdir(dir, { recursive: true });
  const anchor = mobile ? page.locator('.row-editor') : page.locator('.queue-selection');
  await anchor.evaluate(async el => {
    await document.fonts.ready;
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -12, behavior: 'instant' });
  });
  await expect(anchor).toBeInViewport();
  const name = mobile ? 'mobile-m26-validation' : 'desktop-m26-validation-' + (ar ? 'ar' : 'en');
  await page.screenshot({ path: join(dir, name + '.png'), animations: 'disabled' });
}

for (const lang of ['en', 'ar'] as const) {
  const ar = lang === 'ar';
  test('M26 ' + lang + ' payroll demo blocks bad checksums and calendar dates, repairs and prints exact source values', async ({ page }, info) => {
    test.slow();
    const idle = await open(page, ar);
    await page.getByTestId('schema-demo').click();
    await counts(page, 1, 2);
    const initial = await audit(page, info.outputPath('initial'));
    const expected = [
      { column: 'IBAN', rule: 'iban-mod97', reasonCode: 'iban-checksum' } as const,
      { column: 'Effective Date', rule: 'iso-date', reasonCode: 'iso-date' } as const,
    ];
    expect(initial.map(r => r.status)).toEqual(['pass', 'flagged', 'flagged']);
    expect(initial[0]!.schemaDiagnostics).toEqual([]);
    for (const [i, issue] of expected.entries()) {
      const n = i + 2;
      const [en, arabic] = reasons[issue.reasonCode];
      expect(initial[n - 1]!.schemaDiagnostics).toEqual([{ ...issue, code: 'schema-validation-failed', rowNumber: n, reason: { en, ar: arabic } }]);
      await expect(row(page, n).getByTestId('queue-row-select')).toBeDisabled();
      await row(page, n).locator('.row-link').click();
      const entry = page.getByTestId('selected-diagnostics').getByTestId('schema-issue');
      await expect(entry).toHaveAttribute('data-reason', issue.reasonCode);
      await expect(entry).toContainText(issue.column);
      await expect(entry).toContainText(ar ? arabic! : en!);
    }
    const flaggedDate = cell(page, 'Effective Date');
    await expect(flaggedDate).toHaveValue('2026-02-29');
    await flaggedDate.fill('2026-04-31');
    await counts(page, 1, 2);
    await expect(page.getByTestId('selected-diagnostics')).toContainText(reasons['iso-date'][ar ? 1 : 0]!);
    const held = await zip(page, info.outputPath('held'));
    expect(Object.keys(held)).toEqual(['0012345678.pdf']);
    const mergedButton = page.getByRole('button', { name: ar ? 'نزّل ملف PDF مدمجًا للطباعة' : 'Download Merged Printable PDF', exact: true });
    const heldPrint = await save(page, mergedButton, info.outputPath('held'), 'arabiform-merged.pdf');
    expect((await PDFDocument.load(heldPrint)).getPageCount()).toBe(1);
    await row(page, 2).locator('.row-link').click();
    await expect(cell(page, 'IBAN')).toHaveAttribute('aria-invalid', 'true');
    await expect(cell(page, 'IBAN')).toHaveValue('SA31 0000 0000 0000 0001 0002');
    const access = await auditPage(page, 'workbench');
    const suffix = ar ? await suffixOrder(page) : [];
    await noOverflow(page);
    await screenshot(page, info, ar);
    await cell(page, 'IBAN').fill(repairedIban);
    await counts(page, 2, 1);
    await expect(row(page, 2).getByTestId('queue-row-select')).toBeEnabled();
    await row(page, 3).locator('.row-link').click();
    await cell(page, 'Effective Date').fill('2026-04-30');
    await counts(page, 3, 0);
    const dir = info.outputPath('repaired');
    const after = await zip(page, dir);
    expect(Object.keys(after)).toEqual(['0012345678.pdf', '0012345679.pdf', '0012345680.pdf']);
    const before = await readFile(fixture('gcc-payroll.pdf'));
    const originalSentinel = sentinel(await PDFDocument.load(before));
    const raw = Papa.parse<Record<string, string>>(await readFile(fixture('gcc-payroll.csv'), 'utf8'), { header: true, skipEmptyLines: true }).data;
    raw[1]!.IBAN = repairedIban;
    raw[2]!['Effective Date'] = '2026-04-30';
    await writeFile(join(dir, 'before.pdf'), before);
    const cases = [];
    for (const { Department: _department, ...values } of raw) {
      const filename = values.EmployeeID + '.pdf';
      const pdf = await PDFDocument.load(after[filename]!);
      for (const [field, value] of Object.entries(values)) expect(pdf.getForm().getTextField(field).getText()).toBe(value);
      expect(sentinel(pdf)).toEqual(originalSentinel);
      await writeFile(join(dir, filename), after[filename]!);
      cases.push({ before: 'before.pdf', after: filename, values, label: 'Recovered payroll ' + values.EmployeeID });
    }
    await save(page, mergedButton, dir, 'arabiform-merged.pdf');
    const manifest = join(dir, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ cases, merged: { pdf: 'arabiform-merged.pdf', rows: cases.map(item => item.after) } }));
    const pixels = execFileSync('python', ['scripts/verify-pdf-pixels.py', manifest], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
    expect(pixels).toContain('3 identical merged pages');
    await noOverflow(page);
    await writeFile(info.outputPath('m26-repair.json'), JSON.stringify({ idle, access, suffix, initial, pixels }, null, 2));
  });

  test('M26 ' + lang + ' v13 preset roundtrip, held selections, and unmapped roster-only rules', async ({ page }, info) => {
    test.slow();
    const idle = await open(page, ar);
    await page.getByTestId('schema-demo').click();
    await counts(page, 1, 2);
    const presetButton = page.getByTestId('preset-download');
    const presetName = 'arabiform-mapping-preset.json';
    const preset = JSON.parse((await save(page, presetButton, info.outputPath('saved'), presetName)).toString('utf8'));
    const fixturePreset = JSON.parse(await readFile(fixture('gcc-payroll-preset-v13.json'), 'utf8'));
    expect(preset).toEqual({ ...fixturePreset, mapping: { ...fixturePreset.mapping, Sentinel: '' } });
    const restore = (value: object) => page.getByTestId('preset-upload').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    const { schemaRules, ...prior } = preset;
    for (const old of [
      { version: 1, mapping: preset.mapping, filenamePattern: preset.filenamePattern, minFontSize: preset.minFontSize, font: preset.font },
      { ...prior, version: 12 },
    ]) {
      await restore(old);
      await counts(page, 3, 0);
      await expect(page.getByTestId('schema-rule')).toHaveCount(0);
      await row(page, 1).getByTestId('queue-row-select').check();
      await row(page, 2).getByTestId('queue-row-select').check();
      await restore(preset);
      await counts(page, 1, 2);
      await expect(page.getByTestId('schema-rule')).toHaveCount(schemaRules.length);
      expect(Object.keys(await zip(page, info.outputPath('restored-' + old.version)))).toEqual(['0012345678.pdf']);
      const again = JSON.parse((await save(page, presetButton, info.outputPath('restored-' + old.version), presetName)).toString('utf8'));
      expect(again).toEqual(preset);
      const all = page.getByTestId('use-all-ready');
      if (await all.isVisible()) await all.click();
    }
    // A historical mixed-widget PDF supplies an independent sentinel and an unmapped validation column.
    await page.getByTestId('pdf-upload').setInputFiles(mixedTemplate);
    const good = { Name: 'سَلْمَى', ID: '00123', Gate: 'A' };
    const bad = { Name: 'Mira', ID: '00007', Gate: 'B' };
    const roster = (values: object[]) => page.getByTestId('roster-upload').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(Papa.unparse(values)) });
    await roster([good, bad]);
    const legacy = { version: 1, mapping: { Name: 'Name', ID: 'ID' }, filenamePattern: '{{ID}}', minFontSize: 8, font: 'auto' };
    await restore(legacy);
    await counts(page, 2, 0);
    await page.getByTestId('schema-rule-add').click();
    const column = page.getByTestId('schema-rule-column');
    await expect(column).toBeFocused();
    await column.selectOption('Gate');
    await page.getByTestId('schema-rule-kind').selectOption('allowed-values');
    await page.getByTestId('schema-rule-values').fill('A');
    await page.getByTestId('schema-rule-trimmed').check();
    const access = await auditPage(page, 'workbench');
    await page.getByTestId('schema-rule-apply').click();
    await counts(page, 1, 1);
    await row(page, 2).locator('.row-link').click();
    await expect(cell(page, 'Gate')).toHaveValue('B');
    await expect(page.getByTestId('selected-diagnostics').getByTestId('schema-issue')).toHaveAttribute('data-reason', 'allowed-values');
    await cell(page, 'Gate').fill('  A ');
    await counts(page, 2, 0);
    const compact = await zip(page, info.outputPath('unmapped'));
    expect(Object.keys(compact)).toEqual(['00123.pdf', '00007.pdf']);
    const expectedSentinel = sentinel(await PDFDocument.load(await readFile(mixedTemplate)));
    for (const record of [good, bad]) {
      const pdf = await PDFDocument.load(compact[record.ID + '.pdf']!);
      expect(pdf.getForm().getTextField('Name').getText()).toBe(record.Name);
      expect(pdf.getForm().getTextField('ID').getText()).toBe(record.ID);
      expect(sentinel(pdf)).toEqual(expectedSentinel);
    }
    await restore({ ...prior, ...legacy, version: 13, schemaRules: [{ column: 'IBAN', kind: 'iban-mod97' }] });
    await counts(page, 0, 2);
    await expect(page.getByTestId('schema-column-unavailable')).toBeVisible();
    await expect(page.getByTestId('download-zip')).toBeDisabled();
    await roster([{ ...good, IBAN: aliases[0] }, { ...bad, IBAN: aliases[1] }]);
    await counts(page, 0, 2);
    const aliasRows = await audit(page, info.outputPath('aliases'));
    for (const [i, entry] of aliasRows.entries()) expect(entry.schemaDiagnostics).toEqual([expect.objectContaining({
      rowNumber: i + 1, column: 'IBAN', code: 'schema-validation-failed', rule: 'iban-mod97', reasonCode: 'iban-ambiguous-transposition',
    })]);
    await expect(page.getByTestId('download-zip')).toBeDisabled();
    await noOverflow(page);
    await writeFile(info.outputPath('m26-presets.json'), JSON.stringify({ idle, access, aliasRows }, null, 2));
  });
}
