import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Filename } from '../../src/web/Filename';

it('isolates Unicode filename runs while preserving their logical order and the title', () => {
  const name = 'AR-00042-ق-سَلْمَى بِنْت يَاسِين.pdf';
  const html = renderToStaticMarkup(createElement(Filename, { name }));
  expect(html).toContain(`<bdi dir="ltr" class="filename" title="${name}">`);
  expect(html).toContain('<span class="filename-stem">AR-00042-<bdi dir="auto">ق</bdi>-<bdi dir="auto">سَلْمَى بِنْت يَاسِين</bdi></span>');
  expect(html).toContain('<span class="filename-extension">.pdf</span>');
  expect(html.replace(/<[^>]+>/g, '')).toBe(name);
});
