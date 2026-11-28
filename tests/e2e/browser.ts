import { expect, test as base, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Traffic {
  workers: string[];
}

export const test = base.extend<{ traffic: Traffic }>({
  traffic: [async ({ context, page, baseURL, browser }, use, testInfo) => {
    const requests: string[] = [];
    const outside: string[] = [];
    const errors: string[] = [];
    const websockets: string[] = [];
    const workers: string[] = [];

    context.on('request', request => {
      const url = new URL(request.url());
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return;
      requests.push(request.method() + ' ' + url.href);
      if (url.origin !== baseURL) outside.push(url.href);
    });
    context.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    context.on('console', message => {
      if (message.type() === 'error' || /setting up fake worker/i.test(message.text())) errors.push(message.text());
    });
    context.on('weberror', event => errors.push(event.error().message));
    page.on('websocket', socket => websockets.push(socket.url()));
    page.on('worker', worker => workers.push(worker.url()));

    await use({ workers });

    const viewport = page.viewportSize()!;
    const layout = await page.evaluate(() => ({
      innerWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
    }));
    const evidence = { edge: browser.version(), viewport, layout, requests, workers, websockets, outside, errors };
    await mkdir(testInfo.outputDir, { recursive: true });
    await writeFile(testInfo.outputPath('runtime.json'), JSON.stringify(evidence, null, 2));
    expect(outside, 'outbound HTTP/S requests').toEqual([]);
    expect(websockets, 'WebSocket connections').toEqual([]);
    expect(errors, 'browser errors, HTTP errors or PDF worker fallback').toEqual([]);
    expect(requests.length, 'the monitor observed genuine local traffic').toBeGreaterThan(0);
    expect(layout.innerWidth, 'final browser viewport').toBe(viewport.width);
    expect(Math.max(layout.documentWidth, layout.bodyWidth), 'final horizontal page extent').toBeLessThanOrEqual(viewport.width);
  }, { auto: true }],
});

export { expect };

export const golden = (filename: string) => resolve('fixtures', 'golden', filename);

export async function noOverflow(page: Page) {
  const width = page.viewportSize()!.width;
  const measured = await page.evaluate(() => ({
    inner: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(measured).toEqual({ inner: width, document: width, body: width });
}

export async function snap(page: Page, name: string, focus?: string) {
  if (process.env.ARABIFORM_CAPTURE_SCREENSHOTS !== '1') return;
  await page.evaluate(selector => {
    if (selector) document.querySelector(selector)!.scrollIntoView({ block: 'start', behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
    return document.fonts.ready.then(() => true);
  }, focus);
  const dir = resolve('docs/reports/screenshots');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name + '.png'), animations: 'disabled' });
}

export async function canvasInk(page: Page) {
  const canvas = page.locator('canvas[data-rendered="true"]');
  await expect(canvas).toBeVisible();
  const result = await canvas.evaluate((element: HTMLCanvasElement) => {
    const data = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    let dark = 0, paper = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255 && Math.max(data[i]!, data[i + 1]!, data[i + 2]!) < 140) dark++;
      if (data[i + 3] === 255 && Math.min(data[i]!, data[i + 1]!, data[i + 2]!) > 245) paper++;
    }
    return { width: element.width, height: element.height, dark, paper };
  });
  expect(result.dark).toBeGreaterThan(200);
  expect(result.paper).toBeGreaterThan(0.45 * result.width * result.height);
  return result;
}
