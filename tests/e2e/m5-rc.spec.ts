import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument } from 'pdf-lib';
import { expect, golden, noOverflow, test } from './browser';
import { download } from './downloads';

const roster = ['Name,Record', 'Mona,../عقد', 'Hana,CON', 'Lina,Batch', 'Ali,batch', 'Salma,Ｂａｔｃｈ'];
const names = ['عقد.pdf', '_CON.pdf', 'Batch.pdf', 'batch-2.pdf', 'Ｂａｔｃｈ-3.pdf'];
const copy = {
  en: {
    badge: 'Filename adjusted', sanitized: 'The name was cleaned up to make a valid filename.',
    reserved: 'The name was changed because Windows reserves it.', collision: 'A number was added because another row uses this name.',
    edit: 'Edit row 2', done: 'Done editing', zip: 'Download Clean PDFs (.zip)',
    json: 'Download Preflight Audit (.json)', csv: 'Download Preflight Audit (.csv)', phase: 'Checking rows',
  },
  ar: {
    badge: 'تم تعديل اسم الملف', sanitized: 'نُقّح الاسم ليصلح للاستخدام كاسم ملف.',
    reserved: 'تغيّر الاسم لأنه من الأسماء المحجوزة في Windows.', collision: 'أُضيف رقم لأن صفًا آخر يستخدم الاسم نفسه.',
    edit: 'عدّل الصف 2', done: 'تمّ التعديل', zip: 'نزّل ملفات PDF الجاهزة (ZIP)',
    json: 'نزّل تقرير الفحص (JSON)', csv: 'نزّل تقرير الفحص (CSV)', phase: 'فحص الصفوف',
  },
};

for (const language of ['en', 'ar'] as const) {
  test('M5 ' + language + ' previews adjusted names, cancels a keyboard edit and verifies the actual downloads', async ({ page }, info) => {
    const text = copy[language];
    const paths: string[] = [];
    page.on('request', request => paths.push(new URL(request.url()).pathname));
    await page.goto(language === 'en' ? '/' : '/ar/pdf-mail-merge');
    await expect(page.locator('html')).toHaveAttribute('dir', language === 'en' ? 'ltr' : 'rtl');
    await expect(page.getByTestId('pdf-upload')).toBeAttached();
    await page.evaluate(async () => { await document.fonts.ready; });
    const idlePaths = [...paths];
    expect(idlePaths.filter(path => /\/assets\/(fonts|pdf|PdfPreview|batch\.worker|pdf\.worker\.min)-/.test(path))).toEqual([]);
    const displayFont = '/fonts/NotoNaskhArabic-Regular.ttf';
    if (language === 'ar') expect(idlePaths).toContain(displayFont);
    else expect(idlePaths.filter(path => path.startsWith('/fonts/'))).toEqual([]);
    await page.getByTestId('pdf-upload').setInputFiles(golden('template.pdf'));
    await page.locator('.pattern-input').fill('{{Record}}.pdf');
    const checkbox = page.getByTestId('flatten-zip');
    await expect(checkbox).toHaveAccessibleName(/.+/);
    const labelGap = await checkbox.evaluate((input: HTMLInputElement) => {
      const box = input.getBoundingClientRect();
      const text = input.labels![0]!.querySelector('span')!.getBoundingClientRect();
      return Math.max(box.left - text.right, text.left - box.right);
    });
    expect(labelGap).toBeGreaterThanOrEqual(8);
    await mkdir(info.outputDir, { recursive: true });
    const csvFile = info.outputPath('synthetic-filenames.csv');
    await writeFile(csvFile, roster.join('\r\n'), 'utf8');
    const phase = await page.locator('.queue').evaluateHandle((queue, expected) => {
      const selector = 'p[aria-live="polite"]';
      let seen = false;
      const observer = new MutationObserver(records => {
        // A live region can mount, change and clear before this callback runs.
        const phaseNodes = new Set<Node>();
        for (const record of records) {
          const addedOrRemoved = [...record.addedNodes, ...record.removedNodes];
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          if (target?.closest(selector)) {
            phaseNodes.add(record.target);
            for (const node of addedOrRemoved) phaseNodes.add(node);
          }
          for (const node of addedOrRemoved) {
            if (!(node instanceof Element)) continue;
            if (node.matches(selector)) phaseNodes.add(node);
            for (const live of node.querySelectorAll(selector)) phaseNodes.add(live);
          }
        }
        seen = [...phaseNodes].some(node => node.textContent?.trim() === expected)
          || records.some(record => phaseNodes.has(record.target) && record.oldValue?.trim() === expected);
        if (seen) observer.disconnect();
      });
      observer.observe(queue, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
      return { seen: () => seen, disconnect: () => observer.disconnect() };
    }, text.phase);
    try {
      await page.getByTestId('roster-upload').setInputFiles(csvFile);
      await expect.poll(() => phase.evaluate(watch => watch.seen())).toBe(true);
    } finally {
      await phase.evaluate(watch => watch.disconnect());
      await phase.dispose();
    }
    const counts = page.locator('.queue dl[aria-live="polite"]');
    await expect(counts.getByTestId('ready-count')).toHaveText('5');
    await expect(counts.getByTestId('flagged-count')).toHaveText('0');
    expect(paths.some(path => /\/assets\/fonts-.*\.js$/.test(path))).toBe(true);

    const rows = page.getByTestId('queue-row');
    const filenames = rows.locator('.filename');
    await expect(filenames).toHaveText(names);
    const displayed = await filenames.allTextContents();
    const reasons = [text.sanitized, text.reserved, undefined, text.collision, text.collision];
    for (const [index, reason] of reasons.entries()) {
      const row = rows.nth(index);
      const badge = row.getByTestId('filename-adjusted');
      if (!reason) {
        await expect(badge).toHaveCount(0);
        continue;
      }
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(text.badge);
      await badge.focus();
      await badge.press('Enter');
      await expect(row.getByText(reason, { exact: true })).toBeVisible();
      await badge.press('Enter');
    }
    const secondRow = rows.nth(1);
    await secondRow.getByTestId('filename-adjusted').click();
    await noOverflow(page);
    const desktop = info.project.name === 'desktop';
    if (process.env.ARABIFORM_CAPTURE_M5_SCREENSHOTS === '1' && (desktop || language === 'ar')) {
      const dir = resolve('docs/reports/screenshots/m5');
      await mkdir(dir, { recursive: true });
      await page.locator('.queue').evaluate(async element => {
        await document.fonts.ready;
        element.scrollIntoView({ block: 'start', behavior: 'instant' });
      });
      const shot = desktop ? (language === 'en' ? 'desktop-m5-collision-badges' : 'desktop-m5-ar-rtl-rc') : 'mobile-m5-rc';
      await page.screenshot({ path: resolve(dir, shot + '.png'), animations: 'disabled' });
    }

    const search = page.getByTestId('queue-search');
    await page.getByTestId('queue-filter-all').focus();
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await search.press('/');
    await expect(search).toHaveValue('/');
    await search.fill('');
    await secondRow.getByRole('button').click();
    const edit = page.getByRole('button', { name: text.edit, exact: true });
    const cell = page.getByRole('textbox', { name: 'Name', exact: true });
    await edit.click();
    await expect(cell).toHaveValue('Hana');
    await cell.fill('Noor');
    await page.getByRole('button', { name: text.done, exact: true }).click();
    await edit.click();
    await cell.fill('Temp');
    await cell.press('/');
    await expect(cell).toHaveValue('Temp/');
    await cell.press('Escape');
    await expect(cell).toBeHidden();
    await expect(edit).toBeFocused();
    const ring = await edit.evaluate(node => {
      const css = getComputedStyle(node);
      return { visible: node.matches(':focus-visible'), width: parseFloat(css.outlineWidth), style: css.outlineStyle };
    });
    expect(ring.visible).toBe(true);
    expect(ring.width).toBeGreaterThanOrEqual(2);
    expect(ring.style).not.toMatch(/^(none|hidden)$/);
    await edit.press('Enter');
    await expect(cell).toHaveValue('Noor');
    await cell.press('Escape');
    await expect(edit).toBeFocused();
    await expect(counts.getByTestId('ready-count')).toHaveText('5');
    await noOverflow(page);

    const dir = info.outputPath('downloads');
    const zip = unzipSync(await readFile(await download(page, text.zip, dir, 'arabiform-clean.zip')));
    expect(Object.keys(zip)).toEqual(displayed);
    const restored = await PDFDocument.load(zip['_CON.pdf']!);
    expect(restored.getForm().getTextField('Name').getText()).toBe('Noor');
    const keys = ['rowNumber', 'filename', 'status', 'diagnostics', 'fontSizes'];
    const jsonPath = await download(page, text.json, dir, 'arabiform-preflight.json');
    const audit: Record<string, unknown>[] = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(audit.map(row => row.filename)).toEqual(displayed);
    for (const row of audit) expect(Object.keys(row).sort()).toEqual([...keys].sort());
    const csvPath = await download(page, text.csv, dir, 'arabiform-preflight.csv');
    const csv = Papa.parse<Record<string, string>>(await readFile(csvPath, 'utf8'), { header: true, skipEmptyLines: true });
    expect(csv.errors).toEqual([]);
    expect(csv.meta.fields).toEqual(keys);
    expect(csv.data.map(row => row.filename)).toEqual(displayed);
    await writeFile(info.outputPath('m5-checks.json'), JSON.stringify({ idlePaths, displayed, ring, labelGap, phaseObserved: text.phase }, null, 2));
    await noOverflow(page);
  });
}
