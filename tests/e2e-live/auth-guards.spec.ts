/**
 * LIVE auth-guard e2e (T-R76) — asserts the security invariants the hydration guard exists for.
 * Run headless: npx playwright test tests/e2e-live --project=chromium
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'https://harvest-app-self.vercel.app';

/** Click the register submit with a hardened race guard. */
async function clickRegisterAfterHydration(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: /continue to onboarding/i });
  // Keep clicking until the click actually submits (post-hydration) — bounded.
  await btn.click({ timeout: 15_000 }).catch(() => undefined);
  for (let i = 0; i < 20; i++) {
    if (page.url().includes('/onboarding')) return;
    if ((await btn.isDisabled().catch(() => true)) === false) {
      await btn.click().catch(() => undefined);
    }
    await page.waitForTimeout(400);
  }
}

test.describe('Auth hydration guards (live)', () => {
  test('register click NEVER puts the password in the URL', async ({ page }) => {
    await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="name"]', 'PW E2E User');
    await page.fill('input[name="email"]', `pwguard-${Date.now()}@e2e.test`);
    await page.fill('input[name="password"]', 'CorrectHorse2026!');
    await page.selectOption('select[name="role"]', 'REP');
    await clickRegisterAfterHydration(page);
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('password=');
    expect(page.url()).not.toContain(encodeURIComponent('CorrectHorse2026!'));
    // Either it advanced to onboarding (registered) or is still on /auth — either way, NO credential leak.
  });

  test('submit button is disabled before hydration, enabled after (fail-closed then usable)', async ({ page }) => {
    await page.goto(`${BASE}/auth`, { waitUntil: 'commit' });
    // Immediately after commit, before hydration, the button must exist disabled — a pre-hydration
    // click here CANNOT fire a native GET (the credential-leak the guard exists for).
    const btn = page.getByRole('button', { name: /continue to onboarding/i });
    await expect(btn).toBeDisabled({ timeout: 3000 });
    // ...and it MUST become enabled once the client bundle hydrates, or the real flow is broken.
    await expect(btn).toBeEnabled({ timeout: 15000 });
  });
});
