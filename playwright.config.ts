/**
 * Playwright config for the LIVE e2e smoke suite (tests/e2e-live).
 * Targets the production deployment; headless Chromium by default.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-live',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'https://harvest-app-self.vercel.app',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
