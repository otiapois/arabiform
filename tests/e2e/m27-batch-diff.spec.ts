import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { unzipSync, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { expect, noOverflow, test } from './browser';
import { auditPage } from './m10-accessibility';

const fixtures = resolve('fixtures/m27');
const filenames = { zip: 'delta-reprint-pdfs.zip', csv: 'batch-diff-audit.csv', json: 'batch-diff-audit.json', pdf: 'delta-reprint-summary.pdf' };
const ext = Object.keys(filenames) as (keyof typeof filenames)[];
const kinds = ['unchanged', 'modified', 'added', 'removed'] as const;
const first = 'certificates/record-001.pdf';
const second = 'certificates/record-002.pdf';
const by = (page: Page, name: string) => page.getByTestId('batch-diff-' + name);

async function open(page: Page, arabic: boolean) {
  const paths: string[] = [];
  page.context().on('request', req => paths.push(new URL(req.url()).pathname));
  await page.goto(arabic ? '/ar/pdf-mail-merge' : '/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('dir', arabic ? 'rtl' : 'ltr');
  const idle = [...paths];
  expect(idle.filter(path => /\.m?js$/i.test(path))).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
  expect(idle.filter(path => /\.(pdf|zip|wasm)$/i.test(path))).toEqual([]);
  await noOverflow(page);
  await page.getByTestId('mode-compare-batches').click();
  await expect(by(page, 'run')).toBeDisabled();
  await expect(by(page, 'demo')).toHaveAccessibleName(arabic ? /الاصطناعي/ : /synthetic/i);
  expect(paths.slice(idle.length).some(path => /CompareBatches-.*\.js$/i.test(path))).toBe(true);
  return idle;
}

async function counts(page: Page, expected: number[], savings: string) {
  for (const [index, kind] of kinds.entries()) await expect(by(page, 'count-' + kind)).toHaveText(String(expected[index]));
  await expect(by(page, 'count-savings')).toHaveText(savings);
  await noOverflow(page);
}

async function save(page: Page, dir: string, extension: keyof typeof filenames) {
  const [file] = await Promise.all([page.waitForEvent('download'), by(page, 'download-' + extension).click()]);
  expect(file.suggestedFilename()).toBe(filenames[extension]);
  await file.saveAs(join(dir, filenames[extension]));
  expect(await file.failure()).toBeNull();
}

async function extensions(page: Page) {
  const positions = [];
  for (const name of ['previous', 'next', ...ext.map(e => 'download-' + e)]) {
    const control = by(page, name);
    const owner = name.startsWith('download-') ? control : control.locator('..').locator('.batch-diff-source-label');
    const suffix = name.startsWith('download-') ? name.slice(9) : 'zip';
    const isolated = owner.locator('bdi[dir="ltr"]').filter({ hasText: '(.' + suffix + ')' });
    await expect(isolated).toHaveText('(.' + suffix + ')');
    await expect(control).toHaveAccessibleName(new RegExp('\\(\\.' + suffix + '\\)'));
    const coords = await isolated.evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const positions = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        for (let index = 0; index < node.textContent!.length; index++) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const { x, y, width } = range.getBoundingClientRect();
          positions.push({ x, y, width });
        }
      }
      return positions;
    });
    expect(coords).toHaveLength(suffix.length + 3);
    expect(coords.every((p, i) => p.y === coords[0]!.y && p.width > 0 && (!i || p.x > coords[i - 1]!.x)), name).toBe(true);
    positions.push({ name, coords });
  }
  return positions;
}

async function capture(page: Page, info: TestInfo, ar: boolean) {
  const mobile = info.project.name === 'mobile';
  if (mobile && !ar) return;
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const anchor = page.locator(mobile ? '.batch-diff-results' : '.batch-diff');
  await anchor.evaluate(el => { el.scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy(0, -10); });
  const dir = process.env.ARABIFORM_CAPTURE_M27_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m27') : info.outputPath('screenshots');
  await mkdir(dir, { recursive: true });
  const name = mobile ? 'mobile-m27-batch-diff' : 'desktop-m27-batch-diff-' + (ar ? 'ar' : 'en');
  await page.screenshot({ path: join(dir, name + '.png'), animations: 'disabled' });
}

function verifyFiles(dir: string, previous: string, next: string) {
  return JSON.parse(execFileSync('python', ['tests/e2e/m27-download-proof.py', dir, previous, next], {
    encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' }, windowsHide: true,
  }));
}

for (const language of ['en', 'ar'] as const) {
  const ar = language === 'ar';
  test('M27 ' + language + ' Monday and Tuesday demo exposes both saved field edits and delivers four verified artifacts', async ({ page }, info) => {
    const idle = await open(page, ar);
    await by(page, 'demo').click();
    await counts(page, [1, 1, 0, 0], '50%');
    const table = by(page, 'table');
    await expect(table.getByText(first, { exact: true })).toBeVisible();
    await by(page, 'filter').selectOption('modified');
    await expect(table.getByText(first, { exact: true })).toHaveCount(0);
    await expect(table.getByText(second, { exact: true })).toBeVisible();
    const fieldTable = table.getByRole('table');
    await expect(fieldTable.getByRole('columnheader')).toHaveText(ar ? ['الحقل', 'القيمة السابقة', 'القيمة الجديدة'] : ['Field', 'Old value', 'New value']);
    for (const [field, oldValue, newValue] of [['NameAr', 'سارة أحمد', 'سارة محمد'], ['Verified', 'Off', 'Yes']] as const) {
      const row = fieldTable.getByRole('row').filter({ has: page.getByRole('rowheader', { name: field, exact: true }) });
      await expect(row.getByRole('cell')).toHaveText([oldValue, newValue]);
    }
    const access = await auditPage(page, 'workbench');
    const suffixes = ar ? await extensions(page) : [];
    await capture(page, info, ar);
    const dir = info.outputPath('downloads');
    await mkdir(dir, { recursive: true });
    for (const extension of ext) await save(page, dir, extension);
    const proof = verifyFiles(dir, join(fixtures, 'previous-batch.zip'), join(fixtures, 'next-batch.zip'));
    expect(proof.changedValues[second]).toEqual({ NameAr: ['سارة أحمد', 'سارة محمد'], Verified: ['Off', 'Yes'] });
    await by(page, 'filter').selectOption('added');
    await expect(table).toHaveCount(0);
    await expect(page.getByText(ar ? 'لا توجد ملفات بهذه الحالة.' : 'No files match this status.', { exact: true })).toBeVisible();
    await writeFile(info.outputPath('m27-demo.json'), JSON.stringify({ idle, access, suffixes, proof }, null, 2));
  });

  test('M27 ' + language + ' uploaded mixed and identical batches keep source bytes and replacing corrupt inputs invalidates exports', async ({ page }, info) => {
    const idle = await open(page, ar);
    const oldMembers = unzipSync(await readFile(join(fixtures, 'previous-batch.zip')));
    const newMembers = unzipSync(await readFile(join(fixtures, 'next-batch.zip')));
    const dir = info.outputPath('uploads');
    await mkdir(dir, { recursive: true });
    const prior = join(dir, 'Previous.zip'), next = join(dir, 'New.zip');
    const removed = 'old/expired.pdf', added = 'new/added.pdf', flat = 'print/proof.pdf';
    const blank = await PDFDocument.create();
    blank.addPage([210, 297]);
    const onePage = await blank.save();
    blank.addPage([210, 297]);
    const twoPages = await blank.save();
    await writeFile(prior, zipSync({ ...oldMembers, [removed]: onePage, [flat]: onePage }));
    await writeFile(next, zipSync({ ...newMembers, [added]: twoPages, [flat]: twoPages }));
    await by(page, 'previous').setInputFiles(prior);
    await expect(by(page, 'run')).toBeDisabled();
    await by(page, 'next').setInputFiles(next);
    await by(page, 'run').click();
    await counts(page, [1, 2, 1, 1], '16.67%');
    for (const [status, files] of [['added', [added]], ['removed', [removed]], ['modified', [second, flat]], ['unchanged', [first]]] as const) {
      await by(page, 'filter').selectOption(status);
      for (const path of files) await expect(by(page, 'table').getByText(path, { exact: true })).toBeVisible();
      await expect(by(page, 'table').locator(':scope > tbody')).toHaveCount(files.length);
    }
    await by(page, 'filter').selectOption('modified');
    await expect(by(page, 'table')).toContainText(ar ? /التغييرات المرئية/ : /visual or flattened changes/);
    for (const extension of ext) await save(page, dir, extension);
    const proof = verifyFiles(dir, prior, next);
    expect(proof.reprint).toMatchObject({ fullPages: 6, deltaPages: 5, savedPages: 1 });
    for (const side of ['previous', 'next'] as const) {
      await by(page, side).setInputFiles({ name: 'unreadable.zip', mimeType: 'application/zip', buffer: Buffer.from('Not a ZIP') });
      for (const extension of ext) await expect(by(page, 'download-' + extension)).toHaveCount(0);
      await by(page, 'run').click();
      await expect(by(page, side)).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('alert')).toContainText(ar ? /تالف/ : /damaged/);
      await expect(by(page, 'table')).toHaveCount(0);
      for (const extension of ext) await expect(by(page, 'download-' + extension)).toHaveCount(0);
      await by(page, side).setInputFiles(next);
    }
    await by(page, 'run').click();
    await counts(page, [4, 0, 0, 0], '100%');
    const unchanged = info.outputPath('identical');
    await mkdir(unchanged, { recursive: true });
    for (const extension of ext) await save(page, unchanged, extension);
    const same = verifyFiles(unchanged, next, next);
    expect(same.members).toEqual([]);
    await writeFile(info.outputPath('m27-upload.json'), JSON.stringify({ idle, proof, same }, null, 2));
  });
}
