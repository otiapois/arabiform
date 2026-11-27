import { type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from './browser';

export async function captureV1(page: Page, name: string, anchor?: string) {
  if (process.env.ARABIFORM_CAPTURE_M10_SCREENSHOTS !== '1') return;
  await page.evaluate(() => document.fonts.ready.then(() => true));
  if (anchor) await page.locator(anchor).evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const dir = resolve('docs/reports/screenshots/v1.0');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name + '.png'), animations: 'disabled' });
}

export async function auditPage(page: Page, phase: 'idle' | 'dialog' | 'workbench') {
  const client = await page.context().newCDPSession(page);
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  await client.detach();
  const ax = nodes.filter(n => !n.ignored);
  const roles = new Set(['button', 'checkbox', 'combobox', 'link', 'radio', 'searchbox', 'slider', 'spinbutton',
    'switch', 'textbox', 'DisclosureTriangle', 'region', 'navigation', 'dialog']);
  const named = ax.filter(n => roles.has(n.role?.value));
  expect(named.length).toBeGreaterThanOrEqual(phase === 'dialog' ? 3 : 10);
  expect(named.filter(n => !n.name?.value.trim()).map(n => [n.role?.value, n.backendDOMNodeId]), 'unnamed accessible controls/regions').toEqual([]);
  const landmarks = ax.filter(n => ['banner', 'navigation', 'main', 'region', 'contentinfo'].includes(n.role?.value))
    .map(n => [String(n.role?.value), String(n.name?.value ?? '')]);
  if (phase !== 'dialog') {
    for (const role of ['banner', 'navigation', 'main', 'contentinfo']) expect(landmarks.some(([r]) => r === role), role).toBe(true);
    const regions = landmarks.filter(([role]) => role === 'region').map(([, name]) => name);
    expect(new Set(regions).size).toBe(regions.length);
  }
  const live = ax.filter(n => n.properties?.some(p => p.name === 'live' && p.value.value === 'polite'));
  if (phase !== 'dialog') expect(live.length).toBeGreaterThan(0);

  // Start in real keyboard modality before systematically focusing each available element.
  await page.keyboard.press('Tab');
  const measures = await page.evaluate(() => {
    const root = document.querySelector('dialog:modal') ?? document.body;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const cssColors = new Map<string, number[]>();
    function rgba(css: string) {
      const cached = cssColors.get(css);
      if (cached) return cached;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
      const color = Array.from(ctx.getImageData(0, 0, 1, 1).data);
      color[3] = color[3]! / 255;
      cssColors.set(css, color);
      return color;
    }
    // Composite each element (including opacity) as a group over its parent's paint.
    function over(top: number[], bottom: number[]) {
      const a = top[3]! + bottom[3]! * (1 - top[3]!);
      return [0, 1, 2].map(i => a ? (top[i]! * top[3]! + bottom[i]! * bottom[3]! * (1 - top[3]!)) / a : 0).concat(a);
    }
    function paint(el: Element | null, ink = 'transparent') {
      let top = rgba(ink);
      for (let p = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        top = over(top, rgba(s.backgroundColor));
        top[3] = top[3]! * Number(s.opacity);
      }
      return over(top, [255, 255, 255, 1]);
    }
    function luminance(rgb: number[]) {
      return rgb.slice(0, 3).reduce((sum, c, i) => {
        const v = c / 255;
        return sum + [0.2126, 0.7152, 0.0722][i]! * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      }, 0);
    }
    function ratio(a: number[], b: number[]) {
      const x = luminance(a), y = luminance(b);
      return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
    }
    function visible(el: HTMLElement) {
      if (!el.getClientRects().length || getComputedStyle(el).visibility !== 'visible') return false;
      for (let p: HTMLElement | null = el; p; p = p.parentElement) {
        if (p instanceof HTMLDetailsElement && !p.open && p !== el && !p.querySelector(':scope > summary')?.contains(el)) return false;
      }
      return true;
    }
    const identify = (el: HTMLElement) => el.dataset.testid || el.id || el.tagName.toLowerCase() + '.' + el.className;
    const text: { element: string; sample: string; ratio: number }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement!;
      const sample = walker.currentNode.textContent!.trim();
      if (!sample || !visible(el) || el.closest('style,script,option,[hidden],.sr-only,[aria-hidden="true"],:disabled')) continue;
      if (el.closest('.skip-link') && !el.matches(':focus')) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      if (!range.getBoundingClientRect().width) continue;
      text.push({ element: identify(el), sample: sample.slice(0, 40), ratio: ratio(paint(el, getComputedStyle(el).color), paint(el)) });
    }

    const cues: { element: string; ratio: number }[] = [];
    const rings: { element: string; ratio: number }[] = [];
    const native: { index: number; type: string; background: number[] }[] = [];
    const nativeStyles = new Set<string>();
    const selector = 'a[href],button,input,textarea,select,summary,[tabindex="0"]';
    const controls = Array.from(root.querySelectorAll<HTMLElement>(selector));
    for (const [index, el] of controls.entries()) {
      if (!visible(el) || el.matches(':disabled,input[type=hidden]')) continue;
      const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      const owner = el.closest<HTMLElement>('.file-action,.preset-picker') ?? el;
      const style = getComputedStyle(owner), bg = paint(owner), outside = paint(owner.parentElement), id = identify(el);
      if (field || el instanceof HTMLSelectElement) {
        if (!el.matches('[type="file"],[type="checkbox"],[type="radio"],[type="range"]')) {
          const placeholder = field && !el.value && el.placeholder;
          if (el.value || placeholder) {
            const ts = placeholder ? getComputedStyle(el, '::placeholder') : getComputedStyle(el);
            const color = rgba(ts.color).slice();
            color[3] = color[3]! * Number(ts.opacity);
            const effective = over(color, paint(el));
            text.push({ element: id, sample: placeholder || el.value.slice(0, 40), ratio: ratio(effective, paint(el)) });
          }
        }
      }
      if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'range'].includes(el.type)) {
        const key = [el.type, el.checked, ...outside, getComputedStyle(el).accentColor].join('/');
        if (!nativeStyles.has(key)) { native.push({ index, type: el.type, background: outside }); nativeStyles.add(key); }
      } else {
        const hasBorder = parseFloat(style.borderTopWidth) > 0 && !['none', 'hidden'].includes(style.borderTopStyle);
        const boundary = Math.max(ratio(bg, outside), hasBorder ? ratio(paint(owner, style.borderTopColor), outside) : 1);
        const textCue = owner.matches('a,summary,.text-button') || (!hasBorder && owner.matches('button,[tabindex="0"]'));
        cues.push({ element: id, ratio: textCue ? Math.max(boundary, ratio(paint(owner, style.color), bg)) : boundary });
      }
      el.focus({ preventScroll: true });
      const ring = getComputedStyle(owner);
      const drawn = document.activeElement === el && parseFloat(ring.outlineWidth) >= 1 && !['none', 'hidden'].includes(ring.outlineStyle);
      rings.push({ element: id, ratio: drawn ? ratio(over(rgba(ring.outlineColor), outside), outside) : 0 });
    }
    return { text, cues, rings, native, selector };
  });

  // Sample Edge's actual native checkbox/radio/slider paint, which does not expose its colors through computed CSS.
  const samples: (typeof measures.native[number] & { png: string })[] = [];
  const root = phase === 'dialog' ? page.getByRole('dialog') : page.locator('body');
  for (const native of measures.native) {
    const bytes = await root.locator(measures.selector).nth(native.index).screenshot({ animations: 'disabled' });
    samples.push({ ...native, png: bytes.toString('base64') });
  }
  const nativeRatios: number[] = samples.length ? JSON.parse(execFileSync('python', ['tests/e2e/m10-native-contrast.py'], {
    encoding: 'utf8', input: JSON.stringify(samples), windowsHide: true,
  })) : [];
  const results = { text: measures.text, cues: [...measures.cues, ...nativeRatios.map((ratio, i) => ({ element: samples[i]!.type, ratio }))], rings: measures.rings };
  for (const [kind, values] of Object.entries(results)) {
    const threshold = kind === 'text' ? 4.5 : 3;
    expect(values.length, kind).toBeGreaterThan(0);
    expect(values.filter(v => v.ratio < threshold), phase + ' ' + kind).toEqual([]);
  }
  return { landmarks, namedControlsAndRegions: named.length, politeLiveRegions: live.length,
    measured: Object.fromEntries(Object.entries(results).map(([kind, values]) => [kind, { count: values.length, minimum: Math.min(...values.map(v => v.ratio)) }])) };
}
