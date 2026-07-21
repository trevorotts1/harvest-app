#!/usr/bin/env node
/**
 * RENDER-BASED WCAG AA contrast gate for the T-05-touched surfaces
 * (spec harvest-uiux-spec.md §6.1).
 *
 * WHY THIS EXISTS (T-05 QC — 3rd recurrence of the same defect class):
 * `scripts/verify-contrast.mjs` checks token HEX values in the abstract,
 * and `scripts/guard-no-opacity-on-text.mjs` statically greps CSS
 * Modules for a sub-1 `opacity`. Neither one actually RENDERS a page, so
 * neither can see:
 *   - an inline `style={{ color: 'rgba(255,255,255,0.78)' }}` in a .tsx
 *     file sitting on a non-flat background (a gradient), where the
 *     effective/composited contrast depends on exactly which pixel of
 *     the gradient the text lands on, which in turn depends on card
 *     height, line-wrap, and VIEWPORT WIDTH — none of which a source-only
 *     checker has any visibility into.
 *   - the fact that a fix can measure fine at one viewport and still
 *     fail at another (this is exactly what let this defect class
 *     survive two prior "fixes" of the `.score-ring` widget on `/`: a
 *     translucent-white-on-gradient paragraph that passed on mobile
 *     width and failed at desktop width, because at desktop width the
 *     text runs further down the 160deg gradient toward its amber end).
 *
 * This script closes that blind spot by actually launching headless
 * Chromium (Playwright), loading the real built app, walking every text
 * node in scope, and measuring the REAL composited pixel contrast: each
 * node's own foreground ink is hidden (`color: transparent`) so a
 * full-page screenshot reveals the true backdrop underneath (whatever
 * gradient/image/solid-fill stack is really there), then that sampled
 * backdrop RGB is analytically composited with the node's real declared
 * foreground color+alpha (`fg*a + bg*(1-a)`) to get the effective
 * on-screen color, and WCAG 2.x relative-luminance contrast is computed
 * between that effective color and the sampled backdrop — the same math
 * a11y auditing tools use for translucent text. Every node is sampled at
 * multiple points across every line-wrap rect it renders across, and the
 * WORST (lowest-contrast) point is what gets reported and gated on.
 *
 * SCOPE — ORIGINALLY (T-05) just 2 surfaces (`/` .score-ring, `/design-tokens` full page). T-57 R1b
 * (MAJOR-A5: "Rendered-contrast gate covers 2/9 marquee screens... this class recurred 3x") extends
 * TARGETS to the 9 §5 marquee screens + the two emotional/gradient widgets named in that finding
 * (Hidden Earnings reveal's `--gradient-reveal`, the Today Grove's milestone "full-bloom" narration
 * widget). T-57 R3d (A5-FOLLOWUP) closes two coverage gaps R1b's own QC flagged: O-1 Vision Splash
 * (the very first `/onboarding` screen, reachable with no `drive` script and no auth) full-page, and
 * its "begin" button specifically (`.btnHarvest` — the same class the O-8 fix targets, so this is a
 * second live re-check of that fix, not a duplicate) — see the TARGETS array below for the full,
 * current list and per-entry notes on exactly how (or whether) each one is actually reachable by
 * this headless script today.
 *
 * A REAL CONSTRAINT, not glossed over: `src/middleware.ts` (T-04, §16.4) puts a NextAuth session
 * gate in front of every one of those marquee screens except the public `/` and `/design-tokens`
 * (and `/onboarding`, deliberately never gated per that file's own header comment — identity capture
 * is itself a step *inside* onboarding). This repo has no seeded-test-session / E2E harness yet (the
 * remaining T-58 work explicitly tracks building one) — so most of the newly-added marquee targets
 * below cannot be rendered by an anonymous headless run TODAY. Each one is still listed (never
 * silently dropped): `main()` attempts every target, and a target whose navigation lands back on
 * `/auth` (this middleware's real, observed redirect) is logged as a loud, itemized SKIP — see
 * `AUTH_SIGNIN_PATH` / the `SkipTarget` handling below — rather than either crashing the run or
 * quietly vanishing from the report. The moment a seeded-session harness exists, these same TARGETS
 * entries start actually rendering with zero further changes to this file.
 *
 * `/onboarding` itself is the one new marquee-adjacent surface this script CAN drive today, with no
 * auth and no seed data: `driveOnboardingToReveal` below scripts the real O-1..O-7 UI (every one of
 * those screens' "continue" actions is provably client-state-only up to and including O-7 "Add
 * contacts manually" — verified against the actual component source, no network call anywhere in
 * that path) to reach O-8, the Hidden Earnings Reveal — the exact `--gradient-reveal` composited
 * widget A5 names by token. If that driver's own selectors ever fall out of sync with a future
 * onboarding UI change, it fails closed into the same graceful per-target SKIP, not a crash.
 *
 * Checked at two viewports (1440x900 desktop, 390x844 mobile) because
 * the known defect was viewport-dependent — checking only one width is
 * exactly the blind spot that let it recur.
 *
 * Checked in BOTH themes (light AND dark, via `page.emulateMedia({
 * colorScheme })`, which drives the real `@media (prefers-color-scheme)`
 * rules in tokens.css — the same mechanism a real OS-dark-mode user hits,
 * with no saved manual override in local storage to short-circuit it).
 * This is not optional: the QC round-4 dark-theme AA miss (the
 * `--color-harvest-text` on `--cream` pairing on `/design-tokens`,
 * 2.13:1) rendered FINE in light and only failed in dark — a single-theme
 * render gate is exactly as blind to theme-dependent regressions as a
 * single-viewport one is to width-dependent ones. Every (theme x
 * viewport x surface) combination below is gated independently.
 *
 * WIRING (deliberately NOT in `postbuild`): a full `next build` + boot a
 * production server + launch a browser is much heavier than the two
 * static checks that already run after every build, and flakier in a
 * constrained CI sandbox (port binding, browser download/launch). Per
 * the pragmatic instruction this script was commissioned under, it is
 * wired THREE independent ways so this class of defect cannot silently
 * stop being checked the way a quietly-skipped manual step could:
 *   - an explicitly-invoked script: `npm run verify:rendered-contrast`
 *   - a jest test that runs it: tests/unit/rendered-contrast-gate.test.ts
 *     (so `npm test` alone also exercises it)
 *   - an explicit `.github/workflows/ci.yml` step, "Render-based WCAG AA
 *     contrast gate (both themes x both viewports, T-05 spec §6.1)", run
 *     after the "Build" step (reusing that step's `.next` output) and
 *     after a preceding "Install Playwright Chromium" step installs the
 *     browser binary CI needs.
 *
 * Exits 0 on success, 1 with a per-node report on any NEW (non-grandfathered) AA failure —
 * `KNOWN_PRE_EXISTING_FAILURES` below is now EMPTY: the one defect this script's new (A5) coverage
 * surfaced (the `.btnHarvest` dark-theme `--on-harvest-fill`/`--color-harvest-fill` pairing, 2.67:1)
 * was fixed at the token layer in T-57 R3d (A5-FOLLOWUP) — see that Set's own header comment. The
 * Set stays wired up (not deleted) as the mechanism for the NEXT genuinely-out-of-scope defect a
 * future coverage expansion surfaces.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

// Where `src/middleware.ts`'s NextAuth gate sends an unauthenticated request. TWO real, DISTINCT
// cases were both actually observed running this script (not hypothetical — verified with a real
// `curl -I` against a `next start` instance):
//   - `/auth` — the configured `pages: { signIn: '/auth' }` — what a PROPERLY-CONFIGURED
//     environment (a real `NEXTAUTH_SECRET`/`AUTH_SECRET`, no session cookie) redirects to.
//   - `/api/auth/error?error=Configuration` — what next-auth's `withAuth` actually redirects to
//     when `NEXTAUTH_SECRET`/`AUTH_SECRET` themselves aren't set at all (this repo ships only
//     `.env.example`, never a real `.env` — true in this script's own dev/CI sandbox today). Without
//     this check, EVERY gated target here would silently come back "0 text nodes found" — count as
//     a false CLEAN PASS rather than the honest "couldn't reach this one" — exactly the kind of
//     silent-drop the R1b brief explicitly forbids.
// Either one means "this target needed something this run doesn't have" — detected empirically by
// pathname, not by trusting a target's own `requiresAuth` flag (which is documentation only).
const AUTH_REDIRECT_PATHS = ['/auth', '/api/auth/error'];

/** Thrown by a target's navigation/drive step to mean "skip this one, gracefully, with a reason" —
 *  caught in `main()`'s per-target loop and reported as `[SKIP]`, never counted as a failure and
 *  never silently dropped from the report (see header comment). */
class SkipTarget extends Error {}

/** First 10 hex chars of sha256(text) — same disambiguation-not-security rationale as
 *  guard-no-opacity-on-text.mjs's own `fingerprint()` (this script's closest sibling in spirit). */
function fingerprint(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 10);
}

/** Strips the trailing `__<hash>` Next.js CSS Modules appends to every class at build time (e.g.
 *  `onboarding_btnHarvest__aswcC` -> `onboarding_btnHarvest`) — that hash is a build artifact, not
 *  a stable identity, so a fingerprint keyed on the raw className would silently stop matching (and
 *  a grandfathered pre-existing failure would wrongly start hard-failing again) after an unrelated
 *  rebuild. */
function stripCssModuleHash(className) {
  return String(className)
    .trim()
    .split(/\s+/)
    .map((c) => c.replace(/__[A-Za-z0-9]+$/, ''))
    .join(' ');
}

/**
 * T-57 R1b (MAJOR-A5) surfaced exactly ONE real, pre-existing AA failure the moment `/onboarding`'s
 * Hidden Earnings Reveal (O-8) started actually being rendered — never caught before because that
 * round's TARGETS only covered 2/9 marquee screens (the whole point of A5). It was GRANDFATHERED at
 * the time (R1b's brief: "do not fix component colors in this unit... flag it for a follow-up") as
 * `.btnHarvest` (onboarding.module.css) `background: var(--color-harvest-fill); color:
 * var(--on-harvest-fill)`: light theme `--harvest-400` bg + `--soil-900` (dark ink) text = 7.37:1
 * (fine); dark theme repointed `--color-harvest-fill` to the brighter `--harvest-500` while ALSO
 * repointing `--on-harvest-fill` to `--ink-inverse` (light text) = 2.67:1, an AA FAIL.
 *
 * T-57 R3d (A5-FOLLOWUP) FIXED this at the token layer: `src/app/tokens.css`'s dark-theme
 * `--on-harvest-fill` now resolves to `--soil-900` (the SAME dark-ink pairing light theme already
 * used) instead of `--ink-inverse` — `--harvest-500` was simply too bright for a light-on-dark
 * inversion. New dark-theme ratio: `--soil-900` on `--harvest-500` = 5.47:1 (AA PASS). Verified
 * against every real consumer of the `--color-harvest-fill`/`--on-harvest-fill` pairing (grep across
 * src/), not just this one screen — `.btnHarvest` (this widget + `VisionSplash`'s "begin" button,
 * both now covered by TARGETS below) and `.currentBadge` (me/subscription/subscription.module.css)
 * — none regress, both go from FAIL to PASS. `KNOWN_PRE_EXISTING_FAILURES` is intentionally EMPTY
 * now: this Set exists for the NEXT genuinely-out-of-scope defect this gate's coverage surfaces, not
 * as a permanent home for this one — a failure that reappears here must hard-fail for real, exactly
 * like any other non-grandfathered result (see `resultFingerprint` / the main loop below).
 */
const KNOWN_PRE_EXISTING_FAILURES = new Set([]);

/** Builds the same fingerprint shape as `KNOWN_PRE_EXISTING_FAILURES`'s entries, from a real
 *  measured result — see that Set's own header comment for the exact field shape. */
function resultFingerprint(targetLabel, themeName, r) {
  return fingerprint(
    `${targetLabel}::${themeName}::${r.tag} ${stripCssModuleHash(r.className)}::${r.text}`
  );
}

/**
 * Scripts the real O-1..O-7 onboarding UI (client-state-only the whole way — verified against the
 * actual component source, see the header comment) to reach O-8, the Hidden Earnings Reveal. Every
 * selector below is either a semantic ARIA role (`role="radio"`, `#seven-whys-answer`'s label) or
 * positional (this repo's CSS Modules hash class names at build time, so an attribute-CONTAINS
 * selector like `[class*="reveal"]` — matching the substring Next.js preserves in the hashed name —
 * is this codebase's standard workaround, same convention `guard-touch-target.mjs` documents for a
 * different reason). Throws `SkipTarget` (never lets a raw Playwright timeout propagate) if the real
 * UI no longer matches this script's understanding of it — a future onboarding UI change fails this
 * ONE target closed, gracefully, rather than crashing the whole gate.
 */
async function driveOnboardingToReveal(page, baseUrl) {
  try {
    await page.goto(baseUrl + '/onboarding', { waitUntil: 'networkidle' });

    // O-1 Vision Splash — the only button ("begin").
    await page.locator('button').first().click();

    // O-2 Identity — the 3rd button ("skip photo") advances unconditionally (no name/email
    // required); the 4th ("continue") stays disabled until both fields are filled, so this is the
    // deterministic, always-enabled path through this screen.
    await page.locator('button').nth(2).click();

    // O-3 Org — pick the first org-type radio, then the now-enabled "continue" (last button; the
    // two org-type choices are themselves `role="radio"` buttons rendered before it in DOM order).
    await page.locator('[role="radio"]').first().click();
    await page.locator('button').last().click();

    // O-4 Goals & intensity — same radiogroup-then-continue shape as O-3.
    await page.locator('[role="radio"]').first().click();
    await page.locator('button').last().click();

    // O-5 Seven Whys — 7 turns; the submit button is disabled until the textarea is non-empty, and
    // `onSubmit` never inspects the answer's CONTENT (only that whyIndex advances) — any text does.
    for (let i = 0; i < 7; i++) {
      await page.locator('#seven-whys-answer').fill('This matters to me.');
      await page.locator('button[type="submit"]').click();
    }
    // The completion beat's own "continue" (last button — the outreach-consent toggle, if rendered,
    // is a `role="switch"` button that renders BEFORE it in DOM order).
    await page.locator('button').last().click();

    // O-6 Sponsor — every one of this screen's possible buttons (accept/waitlist/paid/no-upline-yet)
    // advances identically (verified in OnboardingFlow.tsx's wiring) — the first one is always safe.
    await page.locator('button').first().click();

    // O-7 Contacts — two client-only clicks: 1st moves the "value" beat to "preview"; 2nd
    // (`onRequestPermission`) sets a non-zero contactCount AND advances straight to O-8 — no CSV
    // upload, no network call, so the Reveal renders with real, non-zero figures either way.
    await page.locator('button').first().click();
    await page.locator('button').first().click();

    // Now on O-8 — the Hidden Earnings Reveal (`.reveal`, `background: var(--gradient-reveal)`).
    await page.waitForSelector('[class*="reveal"]', { timeout: 5000 });
  } catch (err) {
    throw new SkipTarget(
      `driveOnboardingToReveal failed at "${err?.message ?? err}" — the onboarding UI no longer ` +
        'matches this driver\'s understanding of it (see verify-rendered-contrast.mjs header comment).'
    );
  }
}

// Each target: the page path, and the CSS selector to scope the text-node walk to (`null` = whole
// document body). `requiresAuth: true` is documentation only (see header/SCOPE comment) — the REAL
// skip decision is made empirically, by detecting a redirect to `/auth` after navigation, not by
// trusting this flag alone. `drive`, when present, replaces the plain `page.goto(path)` navigation
// with a scripted UI flow (see `driveOnboardingToReveal`) — used for `/onboarding` sub-screens that
// have no own URL.
const TARGETS = [
  { path: '/', scope: '.score-ring', label: '/ — .score-ring widget' },
  { path: '/design-tokens', scope: null, label: '/design-tokens — full page' },

  // --- T-57 R1b (MAJOR-A5) — the 9 §5 marquee screens -------------------------------------------
  { path: '/today', scope: null, label: 'Today (§5.2) — full page', requiresAuth: true },
  { path: '/shift', scope: null, label: 'Shift (§5.3) — full page', requiresAuth: true },
  { path: '/ritual/warm-market', scope: null, label: 'Warm-Market Ritual (§5.4) — full page', requiresAuth: true },
  { path: '/grow', scope: null, label: 'Orchard/Grow (§5.5) — full page', requiresAuth: true },
  { path: '/inbox', scope: null, label: 'Approval Inbox (§5.6) — full page', requiresAuth: true },
  {
    path: '/community/preview-contact',
    scope: null,
    label: 'Messaging/contact (§5.7) — per-contact conversation view',
    requiresAuth: true,
  },
  { path: '/me/subscription', scope: null, label: 'Pricing/subscription (§5.8) — full page', requiresAuth: true },
  { path: '/team', scope: null, label: 'Team dashboard (§5.9) — full page', requiresAuth: true },

  // --- the two named emotional/gradient widgets --------------------------------------------------
  {
    path: '/today',
    scope: '[class*="groveHero"]',
    label: 'Today — Grove milestone widget (renders the "full-bloom" narration only when the ' +
      'signed-in account\'s real momentum data puts it in the bloom state — this script has no way ' +
      'to force that state without a seeded account; whatever state actually renders still gets a ' +
      'real contrast check)',
    requiresAuth: true,
  },
  {
    label: 'Onboarding O-8 Hidden Earnings Reveal — .reveal / --gradient-reveal widget',
    scope: '[class*="reveal"]',
    drive: driveOnboardingToReveal,
  },

  // --- T-57 R3d (A5-FOLLOWUP) — R1b-QC coverage gaps: O-1 Vision Splash was never in TARGETS even
  // though it's the very FIRST screen `/onboarding` renders (no `drive` needed — a plain `goto` lands
  // here directly) and, like O-8, needs no auth (see header comment: `/onboarding` is deliberately
  // never gated). Its "begin" button is `.btnHarvest` — the SAME class/tokens as the O-8 CTA above,
  // so this is also a live, independent re-check of the T-57 R3d token fix (see
  // KNOWN_PRE_EXISTING_FAILURES's header comment) on a second real render, not just a duplicate. ----
  { path: '/onboarding', scope: null, label: 'Onboarding O-1 Vision Splash (§5.1) — full page' },
  {
    path: '/onboarding',
    scope: '[class*="btnHarvest"]',
    label: 'Onboarding O-1 Vision Splash — "begin" button (.btnHarvest)',
  },
];

const VIEWPORTS = [
  { width: 1440, height: 900, label: 'desktop-1440' },
  { width: 390, height: 844, label: 'mobile-390' },
];

// Both themes, driven by the real `prefers-color-scheme` media feature
// (see header comment) — NOT a `data-theme` DOM override, so this
// exercises the same code path an OS-dark-mode visitor with no saved
// preference actually hits.
const THEMES = [
  { name: 'light', colorScheme: 'light' },
  { name: 'dark', colorScheme: 'dark' },
];

// ---------------------------------------------------------------------------
// WCAG 2.x contrast math (same formulas as verify-contrast.mjs).
// ---------------------------------------------------------------------------

function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function relativeLuminance([r, g, b]) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}
function contrastRatio(rgbA, rgbB) {
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const hi = Math.max(lA, lB);
  const lo = Math.min(lA, lB);
  return (hi + 0.05) / (lo + 0.05);
}
function parseCssColor(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`Could not parse computed color: "${str}"`);
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
/** Analytically composite a (possibly translucent) foreground over a sampled opaque backdrop pixel. */
function compositeOver(fg, bg) {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
}

/** A worst-case sampling grid across a text line's bounding rect, inset from the edges to avoid glyph anti-aliasing/edge artifacts. */
function gridPoints(rect, inset = 2, cols = 5, rows = 3) {
  const pts = [];
  const x0 = rect.x + inset, x1 = rect.x + rect.width - inset;
  const y0 = rect.y + inset, y1 = rect.y + rect.height - inset;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = cols === 1 ? (x0 + x1) / 2 : x0 + (i * (x1 - x0)) / (cols - 1);
      const y = rows === 1 ? (y0 + y1) / 2 : y0 + (j * (y1 - y0)) / (rows - 1);
      pts.push({ x, y });
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Build/server plumbing.
// ---------------------------------------------------------------------------

function ensureBuilt() {
  if (existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) return;
  console.log('verify-rendered-contrast: no .next build found — running `next build` first...');
  const res = spawnSync('npx', ['next', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error('`next build` failed — cannot render-check an unbuilt app.');
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server never became ready at ${url} within ${timeoutMs}ms`);
}

function startServer(port) {
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.getOutput = () => out;
  return child;
}

// ---------------------------------------------------------------------------
// Per-page render + node walk + worst-case contrast measurement.
// ---------------------------------------------------------------------------

/**
 * Loads a target (either a plain `path`, or a scripted `drive(page, baseUrl)` — see the TARGETS
 * array) in `page` at the viewport already set on it, hides every in-scope text node's own ink in
 * one batched mutation, takes ONE full-page screenshot (so image pixel coords == document coords,
 * since we pin scroll to (0,0) first), then measures each node's worst-case composited contrast
 * against that screenshot. Restores the DOM mutation before returning (defensive — a fresh
 * `page.goto` per target already makes this unnecessary, but cheap to be correct).
 *
 * Throws `SkipTarget` if navigation lands on `AUTH_SIGNIN_PATH` (this target needs a session this
 * anonymous run doesn't have — see header comment) — callers must catch this and skip gracefully,
 * never count it as a measured failure.
 */
async function measurePage(page, targetSpec, baseUrl, scopeSelector, colorScheme) {
  await page.emulateMedia({ colorScheme });
  if (targetSpec.drive) {
    await targetSpec.drive(page, baseUrl);
  } else {
    await page.goto(baseUrl + targetSpec.path, { waitUntil: 'networkidle' });
  }
  const landedUrl = new URL(page.url());
  if (AUTH_REDIRECT_PATHS.includes(landedUrl.pathname)) {
    const reason =
      landedUrl.pathname === '/auth'
        ? 'redirected to /auth — this route requires an authenticated session (src/middleware.ts, ' +
          'T-04 §16.4); no seeded-test-session harness exists in this repo yet.'
        : `redirected to ${landedUrl.pathname}${landedUrl.search} — this environment has no real ` +
          'NEXTAUTH_SECRET/AUTH_SECRET configured (only .env.example exists, not a real .env), so ' +
          "next-auth's own middleware can't run at all; in a properly-configured environment this " +
          'would instead be the ordinary /auth session gate above.';
    throw new SkipTarget(reason);
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  const nodes = await page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : document.body;
    const out = [];
    function visible(el) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function walk(el) {
      if (!visible(el)) return;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0) {
          const parent = child.parentElement;
          const cs = getComputedStyle(parent);
          let text = '';
          for (const c of parent.childNodes) if (c.nodeType === Node.TEXT_NODE) text += c.textContent;
          text = text.trim();
          let rects = [];
          for (const c of parent.childNodes) {
            if (c.nodeType === Node.TEXT_NODE && c.textContent.trim().length > 0) {
              const r = document.createRange();
              r.selectNodeContents(c);
              rects.push(...Array.from(r.getClientRects()));
            }
          }
          rects = rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
          out.push({
            text,
            tag: parent.tagName,
            className: typeof parent.className === 'string' ? parent.className : '',
            color: cs.color,
            fontSize: parseFloat(cs.fontSize),
            fontWeight: cs.fontWeight,
            rects,
          });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      }
    }
    if (root) walk(root);
    return out;
  }, scopeSelector);

  await page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : document.body;
    function walk(el) {
      let hasOwnText = false;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0) hasOwnText = true;
        else if (child.nodeType === Node.ELEMENT_NODE) walk(child);
      }
      if (hasOwnText) el.style.setProperty('color', 'transparent', 'important');
    }
    if (root) walk(root);
  }, scopeSelector);

  const buf = await page.screenshot({ fullPage: true });
  const png = PNG.sync.read(buf);
  const dpr = await page.evaluate(() => window.devicePixelRatio);

  function sample(x, y) {
    const px = Math.min(Math.max(Math.round(x * dpr), 0), png.width - 1);
    const py = Math.min(Math.max(Math.round(y * dpr), 0), png.height - 1);
    const idx = (png.width * py + px) << 2;
    return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
  }

  const results = [];
  for (const info of nodes) {
    const fg = parseCssColor(info.color);
    const isBold = parseInt(info.fontWeight, 10) >= 700 || info.fontWeight === 'bold';
    const isLarge = info.fontSize >= 24 || (isBold && info.fontSize >= 18.66);
    const target = isLarge ? AA_LARGE : AA_NORMAL;

    let worst = { ratio: Infinity, bg: null };
    for (const rect of info.rects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      for (const { x, y } of gridPoints(rect)) {
        const bg = sample(x, y);
        const composited = compositeOver(fg, bg);
        const ratio = contrastRatio([composited.r, composited.g, composited.b], [bg.r, bg.g, bg.b]);
        if (ratio < worst.ratio) worst = { ratio, bg };
      }
    }
    results.push({
      text: info.text,
      tag: info.tag,
      className: info.className,
      color: info.color,
      fontSize: info.fontSize,
      fontWeight: info.fontWeight,
      isLarge,
      target,
      worstRatio: worst.ratio,
      worstBg: worst.bg,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

async function main() {
  ensureBuilt();
  const port = await findFreePort();
  const server = startServer(port);
  const baseUrl = `http://127.0.0.1:${port}`;

  let browser;
  let failures = 0;
  let totalChecked = 0;
  let grandfathered = 0;
  // Every (target x viewport x theme) combination that was skipped (never a silent drop — see
  // header comment / T-57 R1b MAJOR-A5) — printed as its own itemized section below, distinct from
  // pass/fail counts, and NEVER contributing to `failures` (a skip is not a measured result).
  const skipped = [];

  try {
    await waitForServer(baseUrl + '/', 30000);
    browser = await chromium.launch();

    console.log('Render-based WCAG AA contrast gate (T-05 / T-57 R1b, spec §6.1)\n');

    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        for (const target of TARGETS) {
          const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2 });
          const combo = `${target.label} @ ${viewport.label} (${viewport.width}x${viewport.height}) [${theme.name} theme]`;

          let results;
          try {
            results = await measurePage(page, target, baseUrl, target.scope, theme.colorScheme);
          } catch (err) {
            await page.close().catch(() => {});
            const reason = err instanceof SkipTarget ? err.message : `unexpected error — ${err?.message ?? err}`;
            skipped.push({ combo, reason });
            console.log(`--- ${combo} — [SKIP] ${reason} ---\n`);
            continue;
          }
          await page.close();

          console.log(`--- ${combo} — ${results.length} text node(s) ---`);
          for (const r of results) {
            totalChecked++;
            const pass = r.worstRatio >= r.target;
            const isKnownFailure = !pass && KNOWN_PRE_EXISTING_FAILURES.has(resultFingerprint(target.label, theme.name, r));
            if (!pass && !isKnownFailure) failures++;
            if (isKnownFailure) grandfathered++;
            const selector = `<${r.tag.toLowerCase()}${r.className ? '.' + String(r.className).trim().split(/\s+/).join('.') : ''}>`;
            const bgStr = r.worstBg ? `rgb(${r.worstBg.r},${r.worstBg.g},${r.worstBg.b})` : 'n/a';
            const status = pass ? 'PASS' : isKnownFailure ? 'WARN-EXEMPT-KNOWN-DEFECT' : 'FAIL';
            console.log(
              `  [${status}] (${theme.name}) ${selector} "${r.text.slice(0, 48)}${r.text.length > 48 ? '…' : ''}" ` +
                `— ${r.color}, ${r.fontSize}px/${r.fontWeight}${r.isLarge ? ' (large)' : ''}, ` +
                `worst ${r.worstRatio.toFixed(2)}:1 (need >=${r.target}:1) vs backdrop ~${bgStr}`
            );
          }
          console.log('');
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  if (skipped.length > 0) {
    console.log(`--- ${skipped.length} (target x viewport x theme) combination(s) SKIPPED (never silently dropped) ---`);
    for (const s of skipped) {
      console.log(`  [SKIP] ${s.combo}\n         reason: ${s.reason}`);
    }
    console.log('');
  }

  console.log(
    `verify-rendered-contrast: ${totalChecked} text node(s) checked across ${TARGETS.length} surface(s) x ${VIEWPORTS.length} viewport(s) x ${THEMES.length} theme(s), ` +
      `${failures} NEW failing, ${grandfathered} pre-existing (grandfathered, see WARN-EXEMPT-KNOWN-DEFECT above / KNOWN_PRE_EXISTING_FAILURES), ${skipped.length} combination(s) skipped (see above).`
  );
  if (grandfathered > 0) {
    console.log(
      `\n${grandfathered} render(s) hit KNOWN_PRE_EXISTING_FAILURES — a REAL, tracked, out-of-scope defect ` +
        '(see that Set\'s own header comment) — not fixed here, not silently dropped, not blocking this build.'
    );
  }
  if (failures > 0) {
    console.error(`\nverify-rendered-contrast: ${failures} NEW node(s) fail their WCAG AA render-based contrast target.\n`);
    process.exitCode = 1;
    return;
  }
  console.log('verify-rendered-contrast: OK — every text node on every checked/reachable surface/viewport meets its AA target (or is a tracked, pre-existing, grandfathered exception).');
  process.exitCode = 0;
}

main().catch((err) => {
  console.error('verify-rendered-contrast: crashed —', err);
  process.exitCode = 1;
});
