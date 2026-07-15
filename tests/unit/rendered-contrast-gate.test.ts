import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Gates `npm test` on the RENDER-BASED contrast check
 * (scripts/verify-rendered-contrast.mjs), which is what actually caught
 * the T-05 QC defect that survived two prior source-only "fixes": a
 * translucent (`rgba(255,255,255,0.78)`) paragraph on the `.score-ring`
 * gradient that measured fine at some viewports and failed at others.
 * `contrast-gate.test.ts` (alongside this file) already gates the two
 * static/token-level checks; this test closes the remaining gap by
 * exercising the one check that actually launches a browser, renders the
 * real app, and samples real composited pixels.
 *
 * This is NOT wired into `postbuild` (see the header comment in
 * verify-rendered-contrast.mjs for why: a full build + production server
 * + headless-browser launch is meaningfully heavier and more
 * environment-dependent than the two static checks that already run
 * after every build). It is wired here instead, plus as the
 * explicitly-invocable `npm run verify:rendered-contrast`, PLUS as its
 * own explicit `.github/workflows/ci.yml` step (after "Build" and an
 * "Install Playwright Chromium" step) — so the check runs via three
 * independent hooks, the same "can't go quiet" pattern
 * `contrast-gate.test.ts` already uses for the static checks.
 *
 * Generous timeout: the script may need to run `next build` if `.next`
 * doesn't exist yet, boots a real `next start` server on a free port,
 * and launches headless Chromium — all slower than a typical jest unit
 * test, but still well under a minute in practice.
 */
describe('Render-based WCAG AA contrast gate (T-05)', () => {
  const repoRoot = path.join(__dirname, '..', '..');

  it(
    'verify:rendered-contrast — every text node on `.score-ring` (/) and the full /design-tokens page meets its AA target at every checked viewport x theme combination',
    () => {
      const scriptPath = path.join(repoRoot, 'scripts', 'verify-rendered-contrast.mjs');
      expect(() => execFileSync('node', [scriptPath], { stdio: 'pipe', timeout: 120000 })).not.toThrow();
    },
    120000
  );
});
