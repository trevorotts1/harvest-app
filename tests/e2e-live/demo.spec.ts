/**
 * LIVE E2E smoke suite — run against https://harvest-app-self.vercel.app (production).
 * Purpose: exercise the real demo journey headlessly and surface regressions the unit
 * suites can't see (serverless runtime, real DB, real deploy).
 *
 * Run: npx playwright test tests/e2e-live --project=chromium
 * Config: playwright.config.ts at repo root (testDir includes tests/e2e-live).
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'https://harvest-app-self.vercel.app';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`;
}

test.describe('Demo journey (live)', () => {
  test('home + auth pages load', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Harvest|2 Hour CEO|Downline/i);
    await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText(/create|register|sign up|continue/i);
  });

  test('register creates an account (live DB)', async ({ page }) => {
    const email = uniqueEmail('pwreg');
    await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
    // Fill the register form
    await page.fill('input[name="name"]', 'PW E2E User');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'CorrectHorse2026!');
    await page.selectOption('select[name="role"]', 'REP');
    // Submit (button label: "Continue to onboarding")
    await page.getByRole('button', { name: /continue to onboarding/i }).click();
    // Expect navigation to /onboarding (registration + sign-in both succeed)
    await page.waitForURL(/\/onboarding/, { timeout: 30000 });
    await expect(page.locator('body')).toContainText(/harvest|onboarding|welcome/i);
    console.log('registered:', email);
  });

  test('login screen renders', async ({ page }) => {
    await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /log in|sign in|login/i }).click();
    await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 5000 });
  });

  test('admin console requires ADMIN (redirect for anonymous)', async ({ page }) => {
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    // Anonymous → should be redirected to /auth or a 401 guard, NOT render the console
    await page.waitForTimeout(2500);
    const url = page.url();
    const isAuth = url.includes('/auth');
    const hasConsole = (await page.locator('body').innerText().catch(() => '')).includes('Admin');
    expect(isAuth || !hasConsole).toBeTruthy();
  });
});
