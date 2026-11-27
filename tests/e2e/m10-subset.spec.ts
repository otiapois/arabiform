import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument } from 'pdf-lib';
import { canvasInk, expect, noOverflow, test } from './browser';
import { download } from './downloads';
import { auditPage, captureV1 } from './m10-accessibility';
import { physicalMarginPdf } from './m9-margin-fixture';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const copy = {
  en: ['Download Clean PDFs (.zip)', 'Download Merged Printable PDF', 'Download Preflight Audit (.json)', 'Download Preflight Audit (.csv)', 'Download Custody Manifest (.json)'],
  ar: ['نزّل ملفات PDF الجاهزة (ZIP)', 'نزّل ملف PDF مدمجًا للطباعة', 'نزّل تقرير الفحص (JSON)', 'نزّل تقرير الفحص (CSV)', 'نزّل بيان سلسلة الحيازة (.json)'],
} as const;
const keys = ['rowNumber', 'filename', 'status', 'diagnostics', 'fontSizes'];

for (const lang of ['en', 'ar'] as const) {
  test('M10 ' + lang + ' exports two original rows with exact cover, PDF bytes, audit and custody', async ({ page }, info) => {
    const en = lang === 'en';
    const [zipLabel, mergedLabel, jsonLabel, csvLabel, manifestLabel] = copy[lang];
    await page.goto(en ? '/' : '/ar/pdf-mail-merge');
    const template = await physicalMarginPdf();
    const names = ['Nora', 'ليلى', 'Mona', 'سلمى', 'W'.repeat(270)];
    const ids = ['00111', '00222', '00333', '00444', '00555'];
    const roster = Buffer.from('Name,ID,Group\r\n' + names.map((name, i) => [name, ids[i], [1, 3, 4].includes(i) ? 'ReviewSet' : 'Others'].join(',')).join('\r\n') + '\r\n');
    await page.getByTestId('pdf-upload').setInputFiles({ name: 'Synthetic two-page form.pdf', mimeType: 'application/pdf', buffer: template });
    await page.locator('.pattern-input').fill('packet.pdf');
    await page.getByTestId('roster-upload').setInputFiles({ name: 'Synthetic queue.csv', mimeType: 'text/csv', buffer: roster });
    const scope = page.getByTestId('export-scope');
    const allReady = en ? 'All ready (4)' : 'كل الصفوف الجاهزة (4)';
    const selected = en ? 'Selected only' : 'الصفوف المحددة فقط';
    await expect(scope).toHaveText(allReady);
    await expect(page.getByTestId('flagged-count')).toHaveText('1');
    await expect(scope).toHaveRole('status');
    await page.getByTestId('include-cover-sheet').check();
    const row = (n: number) => page.locator('[data-testid="queue-row"][data-row="' + n + '"]');
    const check = (n: number) => row(n).getByTestId('queue-row-select');
    await expect(check(5)).toBeDisabled();
    await check(4).check();
    await check(2).check();
    await expect(scope).toHaveText(selected + ' (2)');
    const search = page.getByTestId('queue-search');
    const trigger = page.getByTestId('shortcuts-open');
    await trigger.focus();
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await page.keyboard.type('?/');
    await expect(search).toHaveValue('?/');
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
    await search.fill('ReviewSet');
    await expect(page.getByTestId('queue-row')).toHaveCount(3);
    await row(2).locator('.row-link').focus();
    await page.keyboard.press('ArrowDown');
    await expect(row(4).locator('.row-link')).toBeFocused();
    await expect(row(4)).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(row(2).locator('.row-link')).toBeFocused();
    await expect(row(2)).toHaveAttribute('data-selected', 'true');
    await page.getByTestId('clear-selection').click();
    await expect(scope).toHaveText(selected + ' (0)');
    await expect(page.getByTestId('export-subset-empty')).toContainText(en ? 'no ready rows' : 'لا توجد صفوف جاهزة');
    for (const name of copy[lang]) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    await page.getByTestId('select-filtered-ready').click();
    await expect(check(2)).toBeChecked();
    await expect(check(4)).toBeChecked();
    await expect(check(5)).not.toBeChecked();
    await expect(scope).toHaveText(selected + ' (2)');
    await search.fill('');
    await canvasInk(page);

    const fresh = { version: 1, templateSha256: sha(template), rosterSha256: sha(roster), exportScope: 'selected-subset', selectedRowNumbers: [2, 4] };
    const manifest = async (stage: string) => JSON.parse(await readFile(await download(page, manifestLabel, info.outputPath(stage), 'arabiform-custody-manifest.json'), 'utf8'));
    expect(await manifest('before')).toEqual(fresh);
    const json = JSON.parse(await readFile(await download(page, jsonLabel, info.outputPath('audit'), 'arabiform-preflight.json'), 'utf8')) as Record<string, unknown>[];
    const csv = Papa.parse<Record<string, string>>(await readFile(await download(page, csvLabel, info.outputPath('audit'), 'arabiform-preflight.csv'), 'utf8'), { header: true, skipEmptyLines: true });
    expect(csv.errors).toEqual([]);
    expect(csv.meta.fields).toEqual(keys);
    expect(json.map(row => Object.keys(row))).toEqual([keys, keys]);
    expect(json).toEqual(csv.data.map(r => ({ rowNumber: Number(r.rowNumber), filename: r.filename, status: r.status,
      diagnostics: JSON.parse(r.diagnostics!), fontSizes: JSON.parse(r.fontSizes!) })));
    const filenames = ['packet-2.pdf', 'packet-4.pdf'];
    expect(json.map(r => [r.rowNumber, r.filename, r.status, r.diagnostics])).toEqual([[2, filenames[0], 'pass', []], [4, filenames[1], 'pass', []]]);
    const zip = await download(page, zipLabel, info.outputPath('subset'), 'arabiform-clean.zip');
    const members = unzipSync(await readFile(zip));
    expect(Object.keys(members)).toEqual(filenames);
    const entries = [];
    for (const [i, [filename, bytes]] of Object.entries(members).entries()) {
      const original = [1, 3][i]!;
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(2);
      expect(pdf.getForm().getTextField('ID').getText()).toBe(ids[original]);
      expect(pdf.getForm().getTextField('Name').getText()).toBe(names[original]);
      expect(pdf.getForm().getTextField('Unmapped').getText()).toBe('KEEP 00109');
      entries.push({ filename, bytes: bytes.length, sha256: sha(bytes) });
    }
    expect(await manifest('zip')).toEqual({ ...fresh, entries });
    const merged = await download(page, mergedLabel, info.outputPath('subset'), 'arabiform-merged.pdf');
    const combined = { ...fresh, entries, mergedPdfSha256: sha(await readFile(merged)) };
    expect(await manifest('both')).toEqual(combined);
    const visual = JSON.parse(execFileSync('python', ['tests/e2e/m10-subset-proof.py', zip, merged, lang], { encoding: 'utf8', windowsHide: true }));

    for (const key of ['template', 'roster']) await page.getByTestId('custody-' + key + '-prefix').click();
    const lines = await page.locator('.custody-digest').evaluateAll(elements => elements.map(el => {
      const node = el.firstChild!, counts = new Map<number, number>();
      for (let i = 0; i < node.textContent!.length; i++) {
        const range = document.createRange();
        range.setStart(node, i); range.setEnd(node, i + 1);
        const y = range.getBoundingClientRect().top;
        counts.set(y, (counts.get(y) ?? 0) + 1);
      }
      return [...counts.values()];
    }));
    if (info.project.name === 'mobile') {
      expect(lines).toEqual([[32, 32], [32, 32]]);
      const cards = await page.locator('.custody-fingerprints > div').evaluateAll(els => els.map(el => {
        const { x, y, bottom, width } = el.getBoundingClientRect(); return { x, y, bottom, width };
      }));
      expect(cards[0]!.x).toBe(cards[1]!.x);
      expect(cards[0]!.width).toBe(cards[1]!.width);
      expect(cards[0]!.bottom).toBeLessThanOrEqual(cards[1]!.y);
    }
    await noOverflow(page);
    const review = await auditPage(page, 'workbench');
    if (info.project.name === 'desktop') await captureV1(page, 'desktop-v1-' + (en ? 'en' : 'ar-rtl') + '-workbench', en ? '.queue' : '.queue .table-scroll');
    else if (en) await captureV1(page, 'mobile-v1-workbench', '.exports');
    await page.getByTestId('use-all-ready').click();
    await expect(scope).toHaveText(allReady);
    expect(await manifest('reset')).toEqual({ ...fresh, exportScope: 'all-ready', selectedRowNumbers: [1, 2, 3, 4] });
    await trigger.click();
    await page.getByTestId('shortcuts-single-character').uncheck();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('/');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
    await writeFile(info.outputPath('m10-subset.json'), JSON.stringify({ combined, visual, lines, review }, null, 2));
  });
}
