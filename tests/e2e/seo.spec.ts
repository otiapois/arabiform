import { readdir } from 'node:fs/promises';
import { expect, noOverflow, test } from './browser';

const routes = ['/', '/arabic-pdf-form-filler', '/ar/pdf-mail-merge', '/preserve-leading-zeros-pdf', '/privacy-and-proof'];

test('five direct prerendered routes serve distinct metadata and production headers', async ({ page, request }) => {
  const files = await readdir('dist', { recursive: true });
  expect(files.filter(path => path.endsWith('.html'))).toHaveLength(5);
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  const canonicals = [];
  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    expect(new URL(response!.url()).pathname).toBe(route);
    const headers = response!.headers();
    expect(headers['content-security-policy']).toContain("connect-src 'none'");
    expect(headers['content-security-policy']).toContain("worker-src 'self'");
    expect(headers['content-security-policy']).toContain("form-action 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    const meta = await page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return {
        title: doc.title, description: doc.querySelector('meta[name=description]')!.getAttribute('content')!,
        canonical: doc.querySelector('link[rel=canonical]')!.getAttribute('href')!,
        language: doc.documentElement.lang, direction: doc.documentElement.dir,
        namedForms: doc.querySelectorAll('form[name]').length, heading: doc.querySelector('h1')!.textContent,
        schema: Array.from(doc.querySelectorAll('script[type="application/ld+json"]'), node => JSON.parse(node.textContent!)),
      };
    }, await response!.text());
    titles.add(meta.title);
    descriptions.add(meta.description);
    canonicals.push(meta.canonical);
    expect(meta.heading).toBeTruthy();
    expect(meta.description).toBeTruthy();
    expect(new URL(meta.canonical).pathname).toBe(route);
    expect(meta.schema.map(entry => entry['@type']).sort()).toEqual(['FAQPage', 'SoftwareApplication']);
    expect(meta.schema.find(entry => entry['@type'] === 'FAQPage').mainEntity.length).toBeGreaterThan(0);
    expect(meta.language).toBe(route.startsWith('/ar/') ? 'ar' : 'en');
    expect(meta.direction).toBe(route.startsWith('/ar/') ? 'rtl' : 'ltr');
    expect(meta.namedForms).toBe(0);
    await expect(page.locator('form[name]')).toHaveCount(0);
    await noOverflow(page);
  }
  expect(titles.size).toBe(5);
  expect(descriptions.size).toBe(5);
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  const urls = Array.from((await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g), match => match[1]);
  expect(urls.sort()).toEqual(canonicals.sort());
  expect(await (await request.get('/robots.txt')).text()).toContain(new URL('/sitemap.xml', canonicals[0]).href);
});

test('Edge enforces connect-src none even for the same origin', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  // Use a separate context so the deliberate violation cannot mask normal runtime errors.
  const probe = await browser.newContext({ baseURL });
  try {
    const tab = await probe.newPage();
    await tab.goto('/');
    const violation = await tab.evaluate(async () => {
      const event = new Promise<string>(resolve => document.addEventListener('securitypolicyviolation', ev => {
        resolve(ev.effectiveDirective + ' ' + ev.disposition);
      }, { once: true }));
      const result = await fetch('/robots.txt?csp-proof').then(() => 'allowed', error => error.name);
      return { result, event: await event };
    });
    expect(violation).toEqual({ result: 'TypeError', event: 'connect-src enforce' });
  } finally {
    await probe.close();
  }
});
