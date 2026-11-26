import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { canvasInk, expect, noOverflow, test } from './browser';
import { download } from './downloads';
import { verifyManifestDownload } from './manifest-downloads';

const workflows = [
  { id: 'workshop', name: 'Workshop Attendance', pdf: 'synthetic-acroform.pdf', csv: 'synthetic-roster.csv', ready: 4, chunk: /^sample-(?!clinic-|hr-|badge-).+\.js$/ },
  { id: 'clinic', name: 'Clinic Consent', pdf: 'clinic-consent-mixed.pdf', csv: 'clinic-consent-roster.csv', ready: 2, chunk: /^sample-clinic-/ },
  { id: 'hr', name: 'Multi-Page HR Choices', pdf: 'multi-page-hr-choices.pdf', csv: 'multi-page-hr-choices.csv', ready: 2, chunk: /^sample-hr-/ },
  { id: 'badge', name: 'Landscape Visitor Badge', pdf: 'landscape-badge.pdf', csv: 'badge-roster.csv', ready: 0, chunk: /^sample-badge-/ },
] as const;
const routes = { en: '/arabic-pdf-form-filler', ar: '/ar/pdf-mail-merge' };
const engine = /^(?:fonts|pdf|PdfPreview|batch\.worker|pdf\.worker\.min)-/;

function trackScripts(page: Page) {
  const scripts: string[] = [];
  page.context().on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/assets/') && /\.m?js$/.test(path)) scripts.push(basename(path));
  });
  return scripts;
}

async function screenshot(page: Page, name: string, target?: string) {
  if (process.env.ARABIFORM_CAPTURE_M6_SCREENSHOTS !== '1') return;
  await page.evaluate(async selector => {
    await document.fonts.ready;
    if (selector) document.querySelector(selector)!.scrollIntoView({ block: 'center', behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }, target);
  const dir = resolve('docs/reports/screenshots/m6');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name + '.png'), animations: 'disabled' });
}

for (const workflow of workflows) {
  test('M6 gallery loads only the selected workflow: ' + workflow.name, async ({ page }, info) => {
    const scripts = trackScripts(page);
    await page.goto(routes.en);
    const gallery = page.getByTestId('sample-gallery');
    await expect(gallery.getByRole('button')).toHaveCount(4);
    const card = gallery.getByRole('button', { name: workflow.name + ' · Synthetic Sample', exact: true });
    await expect(card).toHaveAttribute('data-testid', 'sample-' + workflow.id);
    await page.waitForLoadState('networkidle');
    const idle = [...scripts];
    expect(idle.some(name => /^index-/.test(name))).toBe(true);
    expect(idle.filter(name => engine.test(name) || name.startsWith('sample-'))).toEqual([]);
    await card.click();
    await expect(card).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.loaded-filename')).toHaveText([workflow.pdf, workflow.csv]);
    await expect(page.getByTestId('total-count')).toHaveText(String(workflow.ready + 1));
    await expect(page.getByTestId('ready-count')).toHaveText(String(workflow.ready));
    await expect(page.getByTestId('flagged-count')).toHaveText('1');
    await canvasInk(page);
    const samples = scripts.filter(name => name.startsWith('sample-'));
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatch(workflow.chunk);
    expect(scripts.some(name => /^pdf-/.test(name))).toBe(true);
    expect(scripts.some(name => /^fonts-/.test(name))).toBe(true);
    await mkdir(info.outputDir, { recursive: true });
    await writeFile(info.outputPath('script-requests.json'), JSON.stringify({ idle, selected: [...scripts] }, null, 2));
    await noOverflow(page);
    if (workflow.id !== 'badge') return;

    const fix = page.getByTestId('apply-batch-min-font');
    await expect(fix).toHaveAccessibleName('Set min font to 7.58 pt to fix 1 row');
    await expect(page.locator('#min-font-size')).toHaveValue('8');
    await fix.click();
    await expect(page.locator('#min-font-size')).toHaveValue('7.58');
    await expect(page.getByTestId('ready-count')).toHaveText('1');
    await expect(page.getByTestId('flagged-count')).toHaveText('0');
    await expect(fix).toHaveCount(0);
    await canvasInk(page);
    const dir = info.outputPath('downloads');
    const zip = unzipSync(await readFile(await download(page, 'Download Clean PDFs (.zip)', dir, 'arabiform-clean.zip')));
    const queueName = await page.getByTestId('queue-row').locator('.filename').innerText();
    expect(Object.keys(zip)).toEqual([queueName]);
    const copy = await PDFDocument.load(zip[queueName]!);
    expect(copy.getForm().getTextField('Name').getText()).toBe('سَلْمَى بِنْت يَاسِين / AR-00042');
    expect(copy.getForm().getTextField('Badge ID').getText()).toBe('00007');
    const merged = await download(page, 'Download Merged Printable PDF', dir, 'arabiform-merged.pdf');
    const printed = await PDFDocument.load(await readFile(merged));
    expect(printed.getPageCount()).toBe(1);
    expect(printed.getPage(0).getRotation().angle).toBe(90);
    expect(printed.getForm().getFields()).toHaveLength(0);
    await noOverflow(page);
  });
}

for (const language of ['en', 'ar'] as const) {
  test('M6 ' + language + ' gallery and interactive specimen support pointer and keyboard while idle', async ({ page }, info) => {
    const scripts = trackScripts(page);
    await page.goto(routes[language]);
    await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    const gallery = page.getByTestId('sample-gallery');
    const names = language === 'en' ? workflows.map(item => item.name)
      : ['حضور ورشة العمل', 'موافقة العيادة', 'خيارات الموارد البشرية متعددة الصفحات', 'بطاقة زائر أفقية'];
    const synthetic = language === 'en' ? 'Synthetic Sample' : 'عينة اصطناعية';
    for (const [index, name] of names.entries()) {
      const button = gallery.getByTestId('sample-' + workflows[index]!.id);
      await expect(button).toHaveAccessibleName(name + ' · ' + synthetic);
      await expect(button).toBeVisible();
    }
    await noOverflow(page);
    if (info.project.name === 'desktop') {
      await screenshot(page, language === 'en' ? 'desktop-m6-workflow-gallery' : 'desktop-m6-ar-rtl-gallery');
    } else if (language === 'en') {
      await screenshot(page, 'mobile-m6-gallery');
    }
    const specimen = page.getByTestId('ink-specimen');
    const naive = specimen.getByTestId('ink-mode-naive');
    const bounds = specimen.getByTestId('ink-mode-bounds');
    const glyphs = specimen.getByTestId('ink-field').locator('.ink-glyphs');
    await expect(glyphs).toHaveText('بَنِي يَمَن / سَلْمَى بِنْت يَاسِين');
    await expect(naive).toHaveAccessibleName(language === 'en' ? 'Naive baseline (clipped)' : 'تموضع تقليدي (مع قصّ)');
    await expect(bounds).toHaveAccessibleName(language === 'en' ? 'ArabiForm ink-bounds (0 clipped)' : 'فحص حدود الحروف في ArabiForm (بلا قصّ)');
    await expect(naive).toBeChecked();
    await expect(glyphs).toHaveCSS('clip-path', /^inset\(/);
    await bounds.click();
    await expect(bounds).toBeChecked();
    await expect(glyphs).toHaveCSS('clip-path', 'none');
    await expect(specimen.locator('.ink-note-bounds')).toBeVisible();
    if (language === 'en' && info.project.name === 'desktop') await screenshot(page, 'desktop-m6-ink-toggle', '.ink-specimen');
    await bounds.press('ArrowUp');
    await expect(naive).toBeFocused();
    await expect(naive).toBeChecked();
    await expect(glyphs).toHaveCSS('clip-path', /^inset\(/);
    await expect(specimen.locator('.ink-note-naive')).toBeVisible();
    await naive.press('ArrowDown');
    await expect(bounds).toBeFocused();
    await expect(bounds).toBeChecked();
    await expect(glyphs).toHaveCSS('clip-path', 'none');
    await noOverflow(page);
    await page.waitForLoadState('networkidle');
    expect(scripts.filter(name => engine.test(name) || name.startsWith('sample-'))).toEqual([]);
  });

  test('M6 ' + language + ' downloaded print manifest indexes only ready HR rows and preserves their rendered pages', async ({ page }, info) => {
    await page.goto(routes[language]);
    await page.getByTestId('sample-hr').click();
    await expect(page.getByTestId('flagged-count')).toHaveText('1');
    await expect(page.getByTestId('ready-count')).toHaveText('2');
    await verifyManifestDownload(page, info.outputPath('downloads'), language);
    await noOverflow(page);
  });
}
