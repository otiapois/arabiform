import { writeFile } from 'node:fs/promises';
import { expect, noOverflow, test } from './browser';
import { auditPage, captureV1 } from './m10-accessibility';

for (const route of ['/', '/arabic-pdf-form-filler', '/ar/pdf-mail-merge', '/preserve-leading-zeros-pdf', '/privacy-and-proof']) {
  test('M10 keyboard, accessible names, contrast and cold entry on ' + route, async ({ page }, info) => {
    const loaded: string[] = [];
    page.on('request', r => loaded.push(new URL(r.url()).pathname));
    const response = await page.goto(route, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    expect(new URL(response!.url()).pathname).toBe(route);
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const js = loaded.filter(path => /\.m?js$/i.test(path));
    expect(js).toHaveLength(1);
    expect(js[0]).toMatch(/^\/assets\/index-[\w-]+\.js$/);
    expect(loaded.filter(path => /\.pdf$|\/assets\/.*(?:pdf|fontkit|shap|worker|fingerprint|custody|preflight|margin)/i.test(path))).toEqual([]);
    const arabic = route.startsWith('/ar/');
    await expect(page.locator('html')).toHaveAttribute('lang', arabic ? 'ar' : 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', arabic ? 'rtl' : 'ltr');
    await noOverflow(page);
    const idle = await auditPage(page, 'idle');
    const trigger = page.locator('a.brand');
    const open = page.getByTestId('shortcuts-open');
    const dialog = page.getByRole('dialog', { name: arabic ? 'اختصارات لوحة المفاتيح' : 'Keyboard shortcuts', exact: true });
    const close = page.getByTestId('shortcuts-close');
    const toggle = page.getByTestId('shortcuts-single-character');
    await trigger.focus();
    await page.keyboard.press('?');
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    expect(await dialog.locator('kbd').allTextContents()).toEqual(arabic ? ['?', '؟', '/', 'Esc', '↑', '↓'] : ['?', '/', 'Esc', '↑', '↓']);
    await page.keyboard.press('Shift+Tab');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await noOverflow(page);
    const modal = await auditPage(page, 'dialog');
    await close.focus();
    // Consecutive physical events can arrive before the native "close" event is delivered.
    for (let sequence = 0; sequence < 3; sequence++) {
      await page.keyboard.press('Escape');
      await page.keyboard.press('?');
      await expect(close).toBeFocused();
      await expect(dialog).toBeVisible();
    }
    if (route === '/' && info.project.name === 'desktop') await captureV1(page, 'desktop-v1-shortcuts-modal');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    if (arabic) {
      // OS-layout Arabic question mark; "insertText" alone would omit the native keydown.
      const keyboard = await page.context().newCDPSession(page);
      for (const type of ['keyDown', 'keyUp'] as const) await keyboard.send('Input.dispatchKeyEvent', {
        type, key: '؟', code: 'Slash', modifiers: 8, windowsVirtualKeyCode: 191,
        ...(type === 'keyDown' ? { text: '؟', unmodifiedText: 'ظ' } : {}),
      });
      await expect(dialog).toBeVisible();
      await keyboard.detach();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await open.click();
    await expect(dialog).toBeVisible();
    await toggle.uncheck();
    await close.click();
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
    await expect(open).toBeFocused();
    await page.keyboard.press('?');
    await expect(dialog).toHaveCount(0);
    await open.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();
    await noOverflow(page);
    await writeFile(info.outputPath('m10-route.json'), JSON.stringify({ route, js, idle, modal }, null, 2));
  });
}
