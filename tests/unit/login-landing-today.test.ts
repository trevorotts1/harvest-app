// T-R28 — parity audit T-51 found that a successful login landed on `/dashboard`, the pre-rebuild
// demo scaffold (hardcoded mock arrays, `#fragment` nav, no links to the five real destinations),
// instead of `/today` — violating uiux AC-2-1 ("Today is the default landing surface; every login
// lands on Today"). This proves the fix end-to-end:
//   1. The login page's success handler now pushes to `/today`, not `/dashboard`.
//   2. `/dashboard` itself is now a pure server-side redirect to `/today` (not the demo scaffold),
//      so no bookmark/old link into it dead-ends — proven by actually invoking the page component
//      and asserting it throws Next's real `NEXT_REDIRECT` control-flow error targeting `/today`.
//   3. `/dashboard` is still covered by `src/middleware.ts`'s gated-route matcher, so
//      `scripts/verify-middleware.mjs` (the T-04 CRITICAL regression guard) keeps passing.
//   4. The onboarding completion handoffs (O-9 / dense track / first48) that already claimed in
//      comments to land on "Today/Mission Control" actually do so now.
//   5. Today's AnchorHeader nav exposes the five uiux destinations.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

function src(...parts: string[]): string {
  return readFileSync(path.join(SRC_DIR, ...parts), 'utf8');
}

describe('T-R28 — a successful login lands on /today, and /dashboard is no longer a dead end', () => {
  test('the login page pushes to /today on a successful sign-in, not the retired /dashboard demo', () => {
    const authPage = src('app', 'auth', 'page.tsx');
    // Isolate the credentials-login success branch (`result?.ok`) rather than matching anywhere in
    // the file, so this can't be satisfied by an unrelated `/today` string elsewhere in the page.
    const successBranch = authPage.match(/result\?\.ok\)\s*\{[\s\S]*?\}/);
    expect(successBranch).not.toBeNull();
    expect(successBranch?.[0]).toMatch(/router\.push\(\s*'\/today'\s*\)/);
    expect(successBranch?.[0]).not.toMatch(/\/dashboard/);
  });

  test('the login page\'s "skip" links point at /today, not /dashboard', () => {
    const authPage = src('app', 'auth', 'page.tsx');
    expect(authPage).not.toContain("href=\"/dashboard\"");
    expect((authPage.match(/href="\/today"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test('DashboardPage is a pure server redirect to /today (real Next.js redirect, not a rendered demo)', () => {
    // Import lazily, inside the test, so a throw during module evaluation can't be mistaken for a
    // pre-existing failure elsewhere in the suite.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: DashboardPage } = require('@/app/dashboard/page');

    let thrown: unknown;
    try {
      DashboardPage();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    // This is Next 14's real `next/navigation` `redirect()` control-flow signal (see
    // node_modules/next/dist/client/components/redirect.js `getRedirectError`) — asserting on its
    // `digest` shape proves this calls the FRAMEWORK's redirect, not a look-alike that merely
    // throws, and that it targets `/today` specifically.
    const digest = (thrown as { digest?: string }).digest;
    expect(digest).toMatch(/^NEXT_REDIRECT;replace;\/today;/);
  });

  test('dashboard/page.tsx no longer contains the retired demo scaffold', () => {
    const dashboardPage = src('app', 'dashboard', 'page.tsx');
    // The old demo's hardcoded mock data / in-page-only nav.
    expect(dashboardPage).not.toContain('Maya Johnson');
    expect(dashboardPage).not.toMatch(/href="#/);
    expect(dashboardPage).not.toMatch(/from '\.\/contact-upload-demo'/);
    expect(dashboardPage).toMatch(/redirect\(\s*'\/today'\s*\)/);
    expect(dashboardPage).toMatch(/from 'next\/navigation'/);
  });

  test('/dashboard is still covered by middleware\'s gated-route matcher (verify-middleware.mjs stays green)', () => {
    const middleware = src('middleware.ts');
    const matcherBlock = middleware.match(/export const config = \{[\s\S]*?\};/);
    expect(matcherBlock).not.toBeNull();
    expect(matcherBlock?.[0]).toMatch(/'\/dashboard\/:path\*'/);
  });

  test('onboarding completion handoffs (O-9, dense track, first48) land on /today, not /dashboard', () => {
    const flow = src('app', 'onboarding', 'OnboardingFlow.tsx');
    expect(flow).not.toMatch(/router\.push\(\s*'\/dashboard'\s*\)/);
    // Three call sites: the shared `advance()` fallthrough, the dense UplineTrack `onFinish`, and
    // the First48Handoff `onShowToday`.
    expect((flow.match(/router\.push\(\s*'\/today'\s*\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test("Today's AnchorHeader nav links to Community, Grow, and Me (Subscription) — three of the five uiux destinations", () => {
    const anchorHeader = src('app', 'today', 'components', 'AnchorHeader.tsx');
    expect(anchorHeader).toMatch(/href="\/community"/);
    expect(anchorHeader).toMatch(/href="\/grow"/);
    expect(anchorHeader).toMatch(/href="\/me\/subscription"/);
  });

  test("Today also reaches Learn via WP07Panel, so all five uiux destinations are reachable from Today", () => {
    const wp07Panel = src('app', 'today', 'components', 'WP07Panel.tsx');
    expect(wp07Panel).toMatch(/href="\/learn"/);
  });
});
