import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseCliArgs } from '../../src/core/cli/arguments';
import { expect, golden, noOverflow, test } from './browser';

const sheetName = 'دفعة (02)';
const groupName = 'قسم & Team';
const prefix = 'npm run arabiform-cli -- ';
const defaultCommand = prefix + '--mode fill --template template.pdf --roster roster.csv --preset arabiform-mapping-preset.json --out-dir output --imposition 1-up --strict';

test.use({ timezoneId: 'Asia/Shanghai' });

async function roster() {
  const entries = unzipSync(await readFile('fixtures/m13/multi-sheet-roster.xlsx'));
  const book = 'xl/workbook.xml';
  const rows = 'xl/worksheets/sheet4.xml';
  entries[book] = strToU8(strFromU8(entries[book]!).replace('name="Roster_AR"', 'name="' + sheetName + '"'));
  entries[rows] = strToU8(strFromU8(entries[rows]!).replace('>Notes<', '>قسم &amp; Team<'));
  return { name: 'Synthetic class.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(zipSync(entries)) };
}

for (const language of ['en', 'ar'] as const) {
  test('M18 ' + language + ' copies the active XLSX command with keyboard and preset parity', async ({ context, page, baseURL }, info) => {
    const ar = language === 'ar';
    const requested: string[] = [];
    page.on('request', request => requested.push(new URL(request.url()).pathname));
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
    // Local November 27 starts while the UTC calendar still reads November 26.
    await page.clock.setFixedTime(new Date('2026-11-26T18:30:00Z'));
    const response = await page.goto(ar ? '/ar/' : '/');
    expect(new URL(page.url()).pathname).toBe(ar ? '/ar/pdf-mail-merge' : '/');
    if (ar) {
      const redirect = response!.request().redirectedFrom()!;
      expect(new URL(redirect.url()).pathname).toBe('/ar/');
      expect((await redirect.response())!.status()).toBe(301);
    }
    await expect(page.locator('html')).toHaveAttribute('dir', ar ? 'rtl' : 'ltr');
    await page.waitForLoadState('networkidle');
    const scripts = () => requested.filter(path => /\.m?js$/.test(path));
    const idle = scripts();
    expect(idle).toEqual([expect.stringMatching(/^\/assets\/index-[\w-]+\.js$/)]);
    const helper = page.getByTestId('cli-command-helper');
    const summary = helper.locator('summary');
    const field = helper.getByTestId('cli-command-code');
    const copy = helper.getByTestId('cli-command-copy');
    const status = helper.getByTestId('cli-command-status');
    await expect(helper).toHaveJSProperty('open', false);
    await expect(summary).toHaveAccessibleName(ar ? 'أمر التشغيل المحلي' : 'Local CLI command');
    await expect(field).toHaveCount(0);
    await noOverflow(page);
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(helper).toHaveJSProperty('open', true);
    await expect(field).toHaveValue(defaultCommand);
    await expect(field).toHaveAccessibleName(ar ? 'أمر التعبئة' : 'Fill command');
    await expect(field).toHaveJSProperty('readOnly', true);
    await expect(field).toHaveAttribute('lang', 'en');
    await expect(field).toHaveCSS('direction', 'ltr');
    await expect(field).toHaveCSS('unicode-bidi', 'isolate');
    await expect(copy).toHaveAccessibleName(ar ? 'انسخ الأمر' : 'Copy command');
    await expect(status).toHaveRole('status');
    await page.waitForLoadState('networkidle');
    const helperScripts = scripts().slice(idle.length);
    expect(helperScripts).toEqual([expect.stringMatching(/^\/assets\/LocalCliCommand-[\w-]+\.js$/)]);
    await page.keyboard.press('Tab');
    await expect(field).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(copy).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(status).toHaveText(ar ? 'تم نسخ الأمر.' : 'Command copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(defaultCommand);
    await page.keyboard.press('Shift+Tab');
    await expect(field).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(summary).toBeFocused();
    await page.keyboard.press('Space');
    await expect(helper).toHaveJSProperty('open', false);
    await expect(field).toHaveCount(0);

    await page.getByTestId('pdf-upload').setInputFiles(golden('template.pdf'));
    await page.getByTestId('roster-upload').setInputFiles(await roster());
    const sheet = page.getByTestId('worksheet');
    await expect(sheet).toHaveValue('Summary');
    await sheet.selectOption(sheetName);
    await expect(page.getByTestId('ready-count')).toHaveText('3');
    await page.getByTestId('imposition').selectOption('2-up');
    await page.getByTestId('group-by-column').selectOption(groupName);
    await page.getByTestId('include-cover-sheet').check();
    if (ar) {
      await summary.click();
      const note = helper.getByText(/يستخدم الأمر الإنجليزية للغلاف/);
      await expect(note).toBeVisible();
      await page.getByTestId('cover-language').selectOption('bilingual');
      await expect(note).toHaveCount(0);
      await summary.click();
    } else {
      await page.getByTestId('cover-language').selectOption('bilingual');
    }
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('preset-download').click()]);
    expect(download.suggestedFilename()).toBe('arabiform-mapping-preset.json');
    await mkdir(info.outputDir, { recursive: true });
    const presetPath = info.outputPath(download.suggestedFilename());
    await download.saveAs(presetPath);
    expect(await download.failure()).toBeNull();
    const preset = JSON.parse(await readFile(presetPath, 'utf8'));
    expect(preset).toMatchObject({ version: 9, mapping: { Name: 'Name', ID: 'ID' }, imposition: '2-up', groupByColumn: groupName, includeCoverSheet: true, coverLanguage: 'bilingual' });
    await summary.focus();
    await page.keyboard.press('Space');
    await expect(field).toHaveValue(/--roster roster\.xlsx/);
    const command = await field.inputValue();
    expect(command.startsWith(prefix)).toBe(true);
    const args = command.slice(prefix.length).split(' ');
    expect(args.every(arg => /^[A-Za-z0-9_.-]+$/.test(arg))).toBe(true);
    const parsed = parseCliArgs(args);
    expect(parsed).toMatchObject({ mode: 'fill', strict: true, cover: true, imposition: '2-up',
      files: { template: 'template.pdf', roster: 'roster.xlsx', preset: download.suggestedFilename(), outDir: 'output',
        sheet: sheetName, groupBy: groupName, date: '2026-11-27' } });
    await page.keyboard.press('Tab');
    await expect(field).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(copy).toBeFocused();
    await page.keyboard.press('Space');
    await expect(status).toHaveText(ar ? 'تم نسخ الأمر.' : 'Command copied.');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(command);
    await noOverflow(page);
    const measurements = await helper.evaluate(el => ({ width: el.clientWidth, contentWidth: el.scrollWidth }));
    expect(measurements.contentWidth).toBe(measurements.width);
    if (info.project.name === 'desktop' || ar) {
      const directory = process.env.ARABIFORM_CAPTURE_M18_SCREENSHOTS === '1' ? resolve('docs/reports/screenshots/m18') : info.outputPath('screenshots');
      await mkdir(directory, { recursive: true });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await summary.evaluate(el => { el.scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy({ top: -28, behavior: 'instant' }); });
      await expect(copy).toBeInViewport();
      const name = info.project.name === 'mobile' ? 'mobile-m18-cli-helper' : 'desktop-m18-cli-helper-' + language;
      await page.screenshot({ path: join(directory, name + '.png'), animations: 'disabled' });
    }
    await page.getByTestId('imposition').selectOption('1-up');
    await expect(field).toHaveValue(/--imposition 1-up/);
    await expect(status).toBeEmpty();
    await writeFile(info.outputPath('cli-helper.json'), JSON.stringify({ language, idle, helperScripts, command, clipboard, parsed, measurements }));
  });
}
