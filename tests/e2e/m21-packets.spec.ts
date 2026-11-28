import type { Locator, Page, TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { PDFDocument, PDFName } from 'pdf-lib';
import { expect, noOverflow, test } from './browser';
import { auditPage } from './m10-accessibility';

const fixtures = resolve('fixtures');
const demoFiles = [join(fixtures, 'm4', 'multi-page-hr-choices.pdf'), join(fixtures, 'm3', 'clinic-consent-mixed.pdf')];
const uploadFiles = ['hr-onboarding.pdf', 'landscape-badge.pdf'].map(name => join(fixtures, 'm2', name));
const longName = 'سَلْمَى بِنْت يَاسِين / AR-00042';
const roster = Buffer.from('ID,Name,Badge print,Team\r\n00123,HR One,MYA,Intake\r\n00007,' + longName + ',' + longName + ',Other\r\n');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

type DocumentEntry = { templateIndex: number; title: string; startPage: number; pageCount: number };
type Recipient = { row: number; path: string; fields?: Record<string, string[]> };
interface Expected {
  files: string[];
  documents: DocumentEntry[];
  rosterName: string;
  rosterBytes: Buffer;
  people: Recipient[];
  group?: string;
}

async function download(page: Page, button: Locator, dir: string, filename: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(file.suggestedFilename()).toBe(filename);
  const target = join(dir, filename);
  await file.saveAs(target);
  expect(await file.failure()).toBeNull();
  return readFile(target);
}

async function verifyDownloads(page: Page, dir: string, expected: Expected) {
  await mkdir(dir, { recursive: true });
  const zip = await download(page, page.getByTestId('packet-download-zip'), dir, 'arabiform-packets.zip');
  const bytes = await download(page, page.getByTestId('packet-download-manifest'), dir, 'packet-custody-manifest.json');
  const manifest = JSON.parse(bytes.toString('utf8'));
  const members = unzipSync(zip);
  expect(Object.keys(members)).toEqual(expected.people.map(person => person.path));
  expect(manifest.kind).toBe('arabiform-packet-custody');
  expect(manifest.version).toBe(1);
  expect(manifest.groupByColumn).toBe(expected.group);
  expect(manifest.sources.roster).toEqual({ name: expected.rosterName, bytes: expected.rosterBytes.length, sha256: sha(expected.rosterBytes) });
  const sources = await Promise.all(expected.files.map(async (path, index) => {
    const source = await readFile(path);
    const { templateIndex, title, pageCount } = expected.documents[index]!;
    expect((await PDFDocument.load(source)).getPageCount()).toBe(pageCount);
    return { templateIndex, title, pageCount, name: basename(path), bytes: source.length, sha256: sha(source) };
  }));
  expect(manifest.sources.templates).toEqual(sources);
  const drawings = [];
  const outputs = [];
  for (const person of expected.people) {
    const pdfBytes = members[person.path]!;
    const document = await PDFDocument.load(pdfBytes);
    expect(document.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    const pageCount = expected.documents.reduce((n, item) => n + item.pageCount, 1);
    expect(document.getPageCount()).toBe(pageCount);
    const path = join(dir, basename(person.path));
    await writeFile(path, pdfBytes);
    outputs.push({ rowNumber: person.row, filename: basename(person.path), path: person.path, bytes: pdfBytes.length,
      sha256: sha(pdfBytes), pageCount, documents: expected.documents });
    drawings.push(JSON.parse(execFileSync('python', ['tests/e2e/m21-packet-print.py', path, JSON.stringify(expected.documents),
      JSON.stringify(person.fields ?? {})], { encoding: 'utf8', windowsHide: true })));
  }
  expect(manifest.outputs).toEqual(outputs);
  await writeFile(join(dir, 'independent-readback.json'), JSON.stringify({ sources, outputs, drawings }, null, 2));
}

async function enterPacket(page: Page, arabic: boolean) {
  const requests: { path: string; type: string }[] = [];
  page.context().on('request', req => requests.push({ path: new URL(req.url()).pathname, type: req.resourceType() }));
  await page.goto(arabic ? '/ar/pdf-mail-merge' : '/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('dir', arabic ? 'rtl' : 'ltr');
  await expect(page.getByTestId('mode-fill')).toHaveAttribute('aria-pressed', 'true');
  const packet = page.getByTestId('mode-packet');
  await expect(packet).toHaveAccessibleName(arabic ? 'تجميع الحزم' : 'Assemble packets');
  await expect(packet).toHaveAttribute('aria-pressed', 'false');
  const idle = [...requests];
  expect(idle.map(r => r.path).filter(path => /\.m?js$/i.test(path))).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
  expect(idle.filter(r => /\.(pdf|xlsx|csv)$/i.test(r.path))).toEqual([]);
  for (const r of idle.filter(r => /\.(ttf|otf|woff2?)$/i.test(r.path))) {
    expect(r.type).toBe('font');
    expect(r.path).toMatch(/^\/fonts\/Noto(?:NaskhArabic|Sans)-Regular\.ttf$/);
  }
  await expect(page.getByTestId('packet-workbench')).toHaveCount(0);
  await noOverflow(page);
  await packet.click();
  await expect(packet).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#packet-heading')).toBeFocused();
  await expect(page.getByTestId('packet-demo')).toHaveAccessibleName(arabic ? 'جرّب عينة اصطناعية لحزمة الموارد البشرية والموافقة من مستندين' : 'Try Synthetic 2-Document HR + Consent Packet Demo');
  await expect(page.getByTestId('packet-preflight')).toHaveAccessibleName(arabic ? 'افحص الحزم' : 'Check packets');
  expect(requests.slice(idle.length).some(r => /PacketWorkbench-[\w-]+\.js$/i.test(r.path))).toBe(true);
  return idle;
}

async function capture(page: Page, info: TestInfo, arabic: boolean) {
  if (info.project.name === 'mobile' && !arabic) return;
  const filename = info.project.name === 'mobile' ? 'mobile-m21-packet.png' : 'desktop-m21-packet-' + (arabic ? 'ar' : 'en') + '.png';
  const dir = process.env.ARABIFORM_CAPTURE_M21_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m21') : info.outputPath('screenshots');
  await mkdir(dir, { recursive: true });
  const showSources = info.project.name === 'desktop' && !arabic;
  await page.evaluate(async showSources => {
    await document.fonts.ready;
    const target = document.querySelector(showSources ? '.packet-intro' : '#packet-results-heading')!;
    const y = target.getBoundingClientRect().top + window.scrollY - (showSources ? 16 : window.innerWidth > 540 ? 395 : 225);
    window.scrollTo({ top: y, behavior: 'instant' });
  }, showSources);
  if (showSources) {
    await expect(page.getByTestId('packet-template-list')).toBeInViewport();
    await expect(page.getByTestId('packet-template-tab').last()).toBeInViewport();
  } else {
    await expect(page.getByTestId('packet-readiness-table')).toBeInViewport();
    await expect(page.getByTestId('packet-download-zip')).toBeInViewport();
  }
  await page.screenshot({ path: join(dir, filename), animations: 'disabled' });
}

for (const locale of ['en', 'ar']) {
  const ar = locale === 'ar';
  test('M21 ' + locale + ' synthetic packet demo produces flattened multi-page HR and consent packets', async ({ page }, info) => {
    const idle = await enterPacket(page, ar);
    await page.getByTestId('packet-demo').click();
    await expect(page.getByTestId('packet-ready-count')).toHaveText('2');
    await expect(page.getByTestId('packet-flagged-count')).toHaveText('1');
    await expect(page.getByTestId('packet-download-zip')).toBeEnabled();
    const table = page.getByTestId('packet-readiness-table');
    const flagged = table.locator('tbody tr[data-status="flagged"]');
    await expect(flagged.getByRole('rowheader')).toHaveAccessibleName('3');
    await expect(flagged.locator('.diagnostics li')).toHaveCount(1);
    await expect(flagged).toContainText('#2 clinic-consent-mixed.pdf · Consent');
    await expect(page.getByTestId('packet-cover')).toBeChecked();
    await expect(page.getByTestId('packet-synthetic')).toContainText(ar ? 'عينة اصطناعية' : 'Synthetic Sample');
    const sources = page.getByTestId('packet-template-list');
    await expect(sources.locator('bdi.loaded-filename')).toHaveText(demoFiles.map(f => basename(f)));
    await expect(sources.locator('bdi.packet-number[dir=ltr]')).toHaveText(['#1', '#2']);
    await expect(page.getByTestId('packet-download-zip').locator('bdi[dir=ltr]')).toHaveText('(.zip)');
    await expect(page.getByTestId('packet-download-manifest').locator('bdi[dir=ltr]')).toHaveText('(.json)');
    const rtlExtensions = [];
    if (ar) {
      for (const id of ['packet-download-zip', 'packet-download-manifest']) {
        const glyphs = await page.getByTestId(id).locator('bdi').evaluate(el => {
          const node = el.firstChild!;
          return Array.from(node.textContent!, (char, index) => {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            return { char, x: range.getBoundingClientRect().left };
          });
        });
        for (let i = 1; i < glyphs.length; i++) expect(glyphs[i]!.x, id + ' ' + glyphs[i]!.char).toBeGreaterThan(glyphs[i - 1]!.x);
        rtlExtensions.push({ id, glyphs });
      }
    }
    await noOverflow(page);
    const accessibility = await auditPage(page, 'workbench');
    await capture(page, info, ar);
    const rosterName = 'clinic-consent-roster.csv';
    await verifyDownloads(page, info.outputPath('demo'), { files: demoFiles, rosterName,
      rosterBytes: await readFile(join(fixtures, 'm3', rosterName)), documents: [
        { templateIndex: 1, title: 'HR onboarding', startPage: 2, pageCount: 2 },
        { templateIndex: 2, title: 'Clinic consent', startPage: 4, pageCount: 1 },
      ], people: [{ row: 1, path: '00001-packet.pdf' }, { row: 2, path: '00002-packet.pdf' }] });
    await page.getByTestId('packet-reset').click();
    await expect(page.getByTestId('packet-template-list')).toHaveCount(0);
    await expect(table).toHaveCount(0);
    await expect(page.getByTestId('packet-download-zip')).toBeDisabled();
    await expect(page.getByTestId('packet-download-manifest')).toBeDisabled();
    await writeFile(info.outputPath('packet-ui.json'), JSON.stringify({ idle, accessibility, rtlExtensions }, null, 2));
  });

  test('M21 ' + locale + ' real upload holds the whole recipient when document two is too narrow', async ({ page }, info) => {
    await enterPacket(page, ar);
    await page.getByTestId('packet-templates-upload').setInputFiles(uploadFiles);
    const rosterName = 'shared-roster.csv';
    await page.getByTestId('packet-roster-upload').setInputFiles({ name: rosterName, mimeType: 'text/csv', buffer: roster });
    const tabs = page.getByTestId('packet-template-tab');
    const mapping = page.locator('[data-testid="packet-field-mapping"][data-field="Name"]');
    await expect(tabs).toHaveCount(2);
    await expect(mapping).toHaveValue('Name');
    await tabs.first().focus();
    await page.keyboard.press(ar ? 'ArrowLeft' : 'ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await mapping.selectOption('Badge print');
    await tabs.first().click();
    await expect(mapping).toHaveValue('Name');
    await tabs.nth(1).click();
    await expect(mapping).toHaveValue('Badge print');
    await page.getByTestId('packet-cover').check();
    await page.getByTestId('packet-filename-pattern').fill('{{ID}}-packet.pdf');
    await page.getByTestId('packet-group-by').selectOption('Team');
    await page.getByTestId('packet-preflight').click();
    await expect(page.getByTestId('packet-download-zip')).toBeEnabled();
    await expect(page.getByTestId('packet-ready-count')).toHaveText('1');
    await expect(page.getByTestId('packet-flagged-count')).toHaveText('1');
    const rows = page.getByTestId('packet-readiness-table').locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute('data-status', 'ready');
    await expect(rows.first().locator('.filename')).toHaveText('Intake/00123-packet.pdf');
    await expect(rows.nth(1)).toHaveAttribute('data-status', 'flagged');
    await expect(rows.nth(1).getByRole('rowheader')).toHaveAccessibleName('2');
    const issue = rows.nth(1).locator('.diagnostics li');
    await expect(issue).toHaveCount(1);
    await expect(issue.locator('bdi[dir=ltr]')).toHaveText('#2');
    await expect(issue.locator('bdi[dir=auto]')).toHaveText(['landscape-badge.pdf', 'Name']);
    await expect(issue).toContainText(ar ? 'يتجاوز النص عرض الحقل عند الحد الأدنى لحجم الخط.' : 'Text exceeds the field width at the minimum font size.');
    await noOverflow(page);
    await verifyDownloads(page, info.outputPath('upload'), { files: uploadFiles, rosterName, rosterBytes: roster, group: 'Team',
      documents: [{ templateIndex: 1, title: 'hr-onboarding', startPage: 2, pageCount: 1 },
        { templateIndex: 2, title: 'landscape-badge', startPage: 3, pageCount: 1 }],
      people: [{ row: 1, path: 'Intake/00123-packet.pdf', fields: { '2': ['HR One'], '3': ['MYA'] } }] });
    await page.getByTestId('packet-move-earlier').nth(1).click();
    await expect(tabs.first()).toContainText('#1 landscape-badge.pdf');
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId('packet-download-zip')).toBeDisabled();
    await expect(page.getByTestId('packet-download-manifest')).toBeDisabled();
    await page.getByTestId('packet-preflight').click();
    await expect(rows.nth(1).locator('.diagnostics li bdi[dir=ltr]')).toHaveText('#1');
    await expect(rows.nth(1).locator('.diagnostics li bdi[dir=auto]')).toHaveText(['landscape-badge.pdf', 'Name']);
    await expect(page.getByTestId('packet-download-manifest')).toBeEnabled();
    await noOverflow(page);
  });
}
