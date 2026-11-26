import { defineConfig } from '@playwright/test';

const port = Number(process.env.ARABIFORM_E2E_PORT ?? 4187);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { channel: 'msedge', browserName: 'chromium', baseURL, deviceScaleFactor: 1, actionTimeout: 15_000 },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  globalSetup: './tests/e2e/preview.mjs',
});
