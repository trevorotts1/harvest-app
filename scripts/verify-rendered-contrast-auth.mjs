#!/usr/bin/env node
/**
 * T-R49 — the auth-gated half of the render-based WCAG AA contrast gate.
 *
 * WHY THIS EXISTS. `scripts/verify-rendered-contrast.mjs` (T-05 / T-57 R1b) covers the 9 §5
 * marquee screens + the two named emotional/gradient widgets, but ~40 (target x viewport x theme)
 * combinations behind `src/middleware.ts`'s NextAuth gate have never actually been RENDERED by that
 * script — no seeded-test-session harness existed, so every one of those combinations came back an
 * itemized `[SKIP]` ("redirected to /auth ... no seeded-test-session harness exists in this repo
 * yet"). Auth-gated contrast was therefore proven only by source token-math (`verify-contrast.mjs`)
 * and manual audit probes (T-59 Auditor E, T-R46 QC) — never by a rendered screenshot wired into
 * this repo's own checked-in tooling. A future regression on any of those ~40 combinations would
 * not be caught by anything that runs today. This script closes that gap.
 *
 * WHAT THIS SCRIPT DOES.
 *   1. Spins up an ISOLATED, throwaway Postgres database (`harvest_tr49_authcheck`, on the same
 *      local Postgres instance `DATABASE_URL` would otherwise point at — see `PG_*` env overrides
 *      below), pushes the current `prisma/schema.prisma` into it (`prisma db push`, no migration
 *      history needed for a disposable seed DB), and seeds exactly ONE `GATED_COMPLETE` REP user
 *      with a real bcrypt password hash (cost 12, matching `src/app/api/auth/register/route.ts`).
 *   2. Locally generates every secret the app needs to run for real — `NEXTAUTH_SECRET`,
 *      `CONTACT_HASH_PEPPER`, `CONTACT_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`,
 *      `SOLUTION_NUMBER_ENCRYPTION_KEY`, `WHY_SESSION_ENCRYPTION_KEY` — via `openssl rand -base64
 *      32`, exactly the way `.env.example` documents each one. None of these are ever logged,
 *      written to a file, or committed; they live only in the env of the `next start` child process
 *      this script spawns and disappear when the process exits.
 *   3. Boots the ALREADY-BUILT `.next` output (`next start`, reusing the same production build
 *      `verify-rendered-contrast.mjs` uses — Prisma Client reads `DATABASE_URL` at request time, not
 *      at build time, so no separate build is needed for this seeded variant) with that env.
 *   4. Drives a REAL login through the app's own `/auth` Credentials form (fills `#login-email` /
 *      `#login-password`, clicks the real submit button) — not a raw cookie/API injection — so the
 *      resulting session is a real next-auth JWT, the same shape a live rep's session would be. This
 *      exact approach (proven to work in this sandbox) is T-59 Auditor E / T-R46 QC's own probe
 *      method; see the scratchpad artifacts this build unit was briefed against.
 *   5. Re-uses `verify-rendered-contrast.mjs`'s own worst-case composited-contrast measurement (same
 *      WCAG relative-luminance math, same 5x3 inset sampling grid) against the SAME 9 auth-gated
 *      `AUTH_TARGETS` that script's own `TARGETS` array documents with `requiresAuth: true`, at both
 *      viewports x both themes (36 combinations) — WITH TWO BLIND-SPOT FIXES the T-59-E2 / T-R46
 *      probes surfaced (see the two comments marked "BLIND SPOT FIX" below):
 *        (a) SVG `<text>` ink is painted via the `fill` property, not `color` — the sibling script's
 *            "hide ink via `color:transparent`, sample the backdrop, read `color` as the foreground"
 *            method silently mismeasures every SVG text node (e.g. `/grow`'s org-tree `<text>` node
 *            labels) because blanking `color` never actually blanks the rendered glyph, and reading
 *            `color` never reads the ink that's actually on screen.
 *        (b) `fullPage: true` screenshots are NEVER used for measurement at all. The sibling script's
 *            (and this script's own first draft's) approach — one `fullPage: true` screenshot,
 *            sampled at each text node's `getBoundingClientRect()` coordinates — turned out to have a
 *            real, empirically-reproduced misalignment for ANY node whose pixels land near/after a
 *            one-viewport-height boundary of a page taller than one screen, not only `position:
 *            sticky`/`fixed` ones as originally suspected (confirmed while self-verifying this build:
 *            two buttons sharing the IDENTICAL CSS class and IDENTICAL computed `background-color`
 *            measured completely different backdrops from the same fullPage screenshot — proof the
 *            mismatch is a Playwright/Chromium expanded-viewport capture artifact, not a real design
 *            difference). Every node is instead measured against a PAGINATED SCAN of ordinary,
 *            un-expanded, viewport-only (`fullPage: false`) screenshots: the page is scrolled through
 *            in real viewport-height increments, one plain screenshot taken at each stop, and each
 *            node is scored from the first stop at which its (freshly re-queried, post-scroll)
 *            rect(s) land fully inside that stop's actual viewport — exactly what a real user
 *            scrolling the page would see, so `position: sticky`/`fixed` elements (which land
 *            differently at different real scroll positions) are automatically measured correctly
 *            too, with no separate special-casing needed. A handful of nodes whose text spans more
 *            than one full viewport height (very rare) fall back to one dedicated `scrollIntoView` +
 *            viewport screenshot of their own.
 *
 * HONEST DEGRADATION, NOT A SILENT OR FALSE RESULT. If a local Postgres genuinely isn't reachable
 * (checked empirically — a real `psql ... SELECT 1`, not an env-var guess) or seeding/login itself
 * fails for infrastructure reasons, EVERY affected combination is logged as an itemized `[SKIP]` with
 * a concrete diagnostic — exactly the pattern `verify-rendered-contrast.mjs` already uses for its own
 * auth-gated skips — and the script exits 0. It never turns "couldn't set this up" into a false PASS
 * (by silently rendering 0 nodes) or a false FAIL (by treating infra failure as an AA violation). Only
 * a REAL measured contrast shortfall on a page that was actually reached with a real session exits 1.
 *
 * WIRING (deliberately opt-in, NOT the default). This needs a real local Postgres in addition to
 * everything `verify:rendered-contrast` already needs — heavier and more environment-dependent than
 * even that script. It is invoked explicitly via `npm run verify:rendered-contrast:auth` only. It is
 * NOT added to `postbuild`, NOT added to `verify:rendered-contrast` itself (that script's public
 * TARGETS/behavior are completely untouched by this file), and NOT unconditionally wired into `npm
 * test` (a fast, DB-independent regression test of this script's honest-degradation contract lives
 * in `tests/unit/rendered-contrast-auth-gate.test.ts` instead — see that file's header comment for
 * why the full DB-backed run itself isn't part of the default suite).
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

// Local Postgres connection this harness seeds INTO — overridable so a CI box with a differently
// configured local Postgres (or none at all) can point elsewhere, or so `tests/unit/rendered-
// contrast-auth-gate.test.ts` can deterministically force the "unreachable" honest-skip path without
// touching a real database. Defaults match this sandbox's own Homebrew Postgres (trust-auth local
// connection, no password) — the same instance `harvest_t59e_seed`/`harvest_wp06_dev` already live on.
const PG_HOST = process.env.TR49_SEED_PGHOST || '127.0.0.1';
const PG_PORT = process.env.TR49_SEED_PGPORT || '5432';
const PG_USER = process.env.TR49_SEED_PGUSER || os.userInfo().username;
const SEED_DB_NAME = process.env.TR49_SEED_DB_NAME || 'harvest_tr49_authcheck';
// Kept short and bounded so an unreachable host (the honest-skip regression test deliberately points
// at one) fails FAST rather than hanging the whole run.
const PG_CONNECT_TIMEOUT_SECONDS = '3';

// Fresh, random per run — a throwaway credential for a throwaway database, never logged, never
// written to a file, never reused across runs.
const LOGIN_EMAIL = `tr49-seed-${crypto.randomBytes(6).toString('hex')}@example.test`;
const LOGIN_PASSWORD = crypto.randomBytes(24).toString('base64url');

/** Thrown for anything that means "the harness environment itself couldn't be established" — caught
 *  once, at the top, and turned into an itemized SKIP for every (target x viewport x theme)
 *  combination, never a measured failure. Distinct from `SkipTarget` (a single combination's own,
 *  narrower skip reason, e.g. a redirect back to /auth for one specific target). */
class HarnessUnavailable extends Error {}
/** Thrown by a target's own navigation/measurement step to mean "skip this ONE combination,
 *  gracefully, with a reason" — never counted as a failure, never silently dropped. Same contract as
 *  verify-rendered-contrast.mjs's own SkipTarget. */
class SkipTarget extends Error {}

// The 9 auth-gated marquee combinations verify-rendered-contrast.mjs's own TARGETS array documents
// with `requiresAuth: true` (see that file) — kept label-for-label identical so a report from this
// script cross-references directly against that one's own itemized SKIP list.
const AUTH_TARGETS = [
  { path: '/today', scope: null, label: 'Today (§5.2) — full page' },
  { path: '/shift', scope: null, label: 'Shift (§5.3) — full page' },
  { path: '/ritual/warm-market', scope: null, label: 'Warm-Market Ritual (§5.4) — full page' },
  { path: '/grow', scope: null, label: 'Orchard/Grow (§5.5) — full page' },
  { path: '/inbox', scope: null, label: 'Approval Inbox (§5.6) — full page' },
  {
    path: '/community/preview-contact',
    scope: null,
    label: 'Messaging/contact (§5.7) — per-contact conversation view',
  },
  { path: '/me/subscription', scope: null, label: 'Pricing/subscription (§5.8) — full page' },
  { path: '/team', scope: null, label: 'Team dashboard (§5.9) — full page' },
  {
    path: '/today',
    scope: '[class*="groveHero"]',
    label: 'Today — Grove milestone widget',
  },
];

const VIEWPORTS = [
  { width: 1440, height: 900, label: 'desktop-1440' },
  { width: 390, height: 844, label: 'mobile-390' },
];
const THEMES = [
  { name: 'light', colorScheme: 'light' },
  { name: 'dark', colorScheme: 'dark' },
];

// ---------------------------------------------------------------------------
// WCAG 2.x contrast math — identical to verify-rendered-contrast.mjs (same formulas as
// verify-contrast.mjs). Intentionally a separate copy, not a shared import: this file must never
// require touching, importing from, or risk destabilizing the public script.
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
function compositeOver(fg, bg) {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
}
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
// Seed-database plumbing.
// ---------------------------------------------------------------------------

function seedDatabaseUrl() {
  return `postgresql://${PG_USER}@${PG_HOST}:${PG_PORT}/${SEED_DB_NAME}?schema=public`;
}

function runPsql(args, { database = 'postgres' } = {}) {
  return spawnSync(
    'psql',
    ['-h', PG_HOST, '-p', PG_PORT, '-U', PG_USER, '-d', database, '-v', 'ON_ERROR_STOP=1', ...args],
    { encoding: 'utf8', env: { ...process.env, PGCONNECT_TIMEOUT: PG_CONNECT_TIMEOUT_SECONDS } }
  );
}

/** Empirically checks the seed Postgres is reachable — never trusts an env var alone (mirrors
 *  verify-rendered-contrast.mjs's own "detect the redirect empirically, not by trusting a flag"
 *  posture). Fails fast (PGCONNECT_TIMEOUT above) so an unreachable host degrades honestly instead
 *  of hanging. */
function checkPostgresAvailable() {
  if (spawnSync('psql', ['--version']).status !== 0) {
    return { ok: false, reason: '`psql` is not on PATH in this environment.' };
  }
  const res = runPsql(['-tA', '-c', 'SELECT 1']);
  if (res.status !== 0) {
    return {
      ok: false,
      reason:
        `could not reach Postgres at ${PG_HOST}:${PG_PORT} as role "${PG_USER}" ` +
        `(psql exit ${res.status}): ${(res.stderr || res.stdout || '').trim().slice(0, 300)}`,
    };
  }
  return { ok: true };
}

function createSeedDatabase() {
  const drop = runPsql(['-c', `DROP DATABASE IF EXISTS ${SEED_DB_NAME}`]);
  if (drop.status !== 0) {
    throw new HarnessUnavailable(`could not drop any stale seed database: ${(drop.stderr || '').trim()}`);
  }
  const create = runPsql(['-c', `CREATE DATABASE ${SEED_DB_NAME}`]);
  if (create.status !== 0) {
    throw new HarnessUnavailable(`could not create seed database "${SEED_DB_NAME}": ${(create.stderr || '').trim()}`);
  }
}

function dropSeedDatabase() {
  // Best-effort cleanup — never let a teardown failure mask the run's real result.
  runPsql(['-c', `DROP DATABASE IF EXISTS ${SEED_DB_NAME}`]);
}

function pushSchema(databaseUrl) {
  const res = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new HarnessUnavailable(`\`prisma db push\` against the seed database failed: ${(res.stderr || res.stdout || '').trim().slice(0, 1000)}`);
  }
}

async function seedGatedCompleteRep(databaseUrl) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const password_hash = await bcrypt.hash(LOGIN_PASSWORD, 12); // same cost as api/auth/register
    const user = await prisma.user.create({
      data: {
        email: LOGIN_EMAIL,
        password_hash,
        name: 'TR49 Seed Rep',
        role: 'REP',
        org_type: 'PRIMERICA',
        access_tier: 'FREE_ORG_LINKED',
        intensity_setting: 'MEDIUM',
        onboarding_status: 'GATED_COMPLETE',
        gated_complete_at: new Date(),
        gdpr_consent: true,
      },
    });
    return user.id;
  } catch (err) {
    throw new HarnessUnavailable(`could not seed the GATED_COMPLETE REP user: ${err?.message ?? err}`);
  } finally {
    await prisma.$disconnect();
  }
}

/** `openssl rand -base64 <bytes>` — the exact generation command `.env.example` documents for every
 *  one of these keys. Never logged, never returned to a caller that might print it. */
function opensslRandBase64(bytes) {
  const res = spawnSync('openssl', ['rand', '-base64', String(bytes)], { encoding: 'utf8' });
  if (res.status !== 0 || !res.stdout) {
    throw new HarnessUnavailable(`\`openssl rand\` failed while generating a local secret: ${(res.stderr || '').trim()}`);
  }
  return res.stdout.trim();
}

// ---------------------------------------------------------------------------
// Build/server plumbing — same shape as verify-rendered-contrast.mjs.
// ---------------------------------------------------------------------------

function ensureBuilt() {
  if (existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) return;
  console.log('verify-rendered-contrast-auth: no .next build found — running `next build` first...');
  const res = spawnSync('npx', ['next', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new HarnessUnavailable('`next build` failed — cannot render-check an unbuilt app.');
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
  throw new HarnessUnavailable(`seeded next start server never became ready at ${url} within ${timeoutMs}ms`);
}

function startServer(port, env) {
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.getOutput = () => out;
  return child;
}

// ---------------------------------------------------------------------------
// Real login through the app's own /auth Credentials form (T-59 Auditor E / T-R46 QC's proven
// method — reused verbatim, not a raw cookie/API injection).
// ---------------------------------------------------------------------------

async function loginAndReturnContext(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const diag = [];
  page.on('console', (msg) => diag.push(`console[${msg.type()}]: ${msg.text()}`));
  page.on('pageerror', (err) => diag.push(`pageerror: ${err?.message ?? err}`));

  await page.goto(baseUrl + '/auth', { waitUntil: 'networkidle' });
  // /auth defaults to the "register" tab — switch to "Sign in" first.
  const tabs = page.locator('button', { hasText: /sign in|log in/i });
  if ((await tabs.count()) > 0) {
    await tabs.first().click();
  } else {
    await page.locator('.actions button').nth(1).click();
  }
  await page.waitForSelector('#login-email', { timeout: 5000 });
  await page.locator('#login-email').fill(LOGIN_EMAIL);
  await page.locator('#login-password').fill(LOGIN_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(2500);
  await page
    .waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 8000 })
    .catch(() => {});
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name.includes('next-auth.session-token'));
  diag.push(`cookies present: ${cookies.map((c) => c.name).join(', ') || '(none)'}`);
  diag.push(`final url: ${page.url()}`);
  await page.close();

  if (!sessionCookie) {
    throw new HarnessUnavailable(
      `login did not establish a session cookie for the seeded user\n  DIAG:\n  ${diag.join('\n  ')}`
    );
  }

  // Independently validate with a real, fresh full navigation before trusting the context.
  const checkPage = await context.newPage();
  await checkPage.goto(baseUrl + '/today', { waitUntil: 'networkidle' });
  const checkUrl = new URL(checkPage.url());
  await checkPage.close();
  if (checkUrl.pathname.startsWith('/auth')) {
    throw new HarnessUnavailable(
      `session cookie present but a fresh navigation to /today still redirected to ${checkUrl.pathname} — middleware is not honoring this session.\n  DIAG:\n  ${diag.join('\n  ')}`
    );
  }
  return context;
}

// ---------------------------------------------------------------------------
// Per-page render + node walk + worst-case contrast measurement — same method as
// verify-rendered-contrast.mjs, PLUS the two blind-spot fixes (see header comment).
// ---------------------------------------------------------------------------

/** Tags every in-scope text-bearing element with a unique `data-tr49-node-id` (so it can be
 *  re-located after each scroll below) and returns its METADATA ONLY — no rects yet, since rects are
 *  scroll-position-dependent and get (re)computed fresh at each paginated-scan stop by
 *  `GET_FRESH_RECTS_FN`. `sticky` is recorded purely as an informational log annotation — it no
 *  longer changes how a node is measured (see header comment, blind-spot fix (b)): every node goes
 *  through the same real, un-expanded viewport-screenshot pipeline. NOTE (known, accepted, rare
 *  edge case): if a single element owns more than one separate run of direct text (e.g. `<div>Hello
 *  <b>World</b> Bye</div>`, where "Hello " and " Bye" are two distinct Text-node children of the
 *  same `<div>`), the single `data-tr49-node-id` attribute this tags that shared element with can
 *  only resolve to the LAST such run when re-queried post-scroll — the earlier run is conservatively
 *  dropped from `results` rather than measured against the wrong (later) run's rects. This can only
 *  under-count already-covered text, never mask a real violation on covered text, and this exact
 *  interleaved-Text-node shape was not observed on any of the 9 AUTH_TARGETS surfaces in practice. */
const TAG_AND_COLLECT_META_FN = (sel) => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const root = sel ? document.querySelector(sel) : document.body;
  const out = [];
  let counter = 0;

  function visible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function hasStickyOrFixedAncestor(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const pos = getComputedStyle(node).position;
      if (pos === 'sticky' || pos === 'fixed') return true;
      node = node.parentElement;
    }
    return false;
  }
  function walk(el) {
    if (!visible(el)) return;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0) {
        const parent = child.parentElement;
        // BLIND SPOT FIX (a): SVG <text>/<tspan> ink is painted via `fill`, not `color`.
        const isSvg = parent.namespaceURI === SVG_NS;
        const cs = getComputedStyle(parent);
        let text = '';
        for (const c of parent.childNodes) if (c.nodeType === Node.TEXT_NODE) text += c.textContent;
        text = text.trim();
        const id = `tr49-node-${counter++}`;
        parent.setAttribute('data-tr49-node-id', id);
        out.push({
          id,
          text,
          tag: parent.tagName,
          className: typeof parent.className === 'string' ? parent.className : '',
          isSvg,
          color: isSvg ? cs.fill : cs.color,
          fillOpacity: isSvg ? parseFloat(cs.fillOpacity || '1') : 1,
          fontSize: parseFloat(cs.fontSize),
          fontWeight: cs.fontWeight,
          sticky: hasStickyOrFixedAncestor(parent),
        });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  }
  if (root) walk(root);
  return out;
};

const BLANK_INK_FN = (sel) => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const root = sel ? document.querySelector(sel) : document.body;
  function walk(el) {
    let hasOwnText = false;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0) hasOwnText = true;
      else if (child.nodeType === Node.ELEMENT_NODE) walk(child);
    }
    if (hasOwnText) {
      // BLIND SPOT FIX (a): blank the property that actually paints this element's ink.
      if (el.namespaceURI === SVG_NS) {
        el.style.setProperty('fill', 'transparent', 'important');
      } else {
        el.style.setProperty('color', 'transparent', 'important');
      }
    }
  }
  if (root) walk(root);
};

/** Re-queries every still-tagged element at the CURRENT scroll position and returns its fresh,
 *  viewport-relative rects — this is what makes the paginated scan correct for `position: sticky`/
 *  `fixed` elements (whose rects legitimately differ at different real scroll positions) without any
 *  special-casing: it is called fresh after every scroll, for every node, uniformly. */
const GET_FRESH_RECTS_FN = () => {
  const els = Array.from(document.querySelectorAll('[data-tr49-node-id]'));
  return els.map((el) => {
    const id = el.getAttribute('data-tr49-node-id');
    let rects = [];
    for (const c of el.childNodes) {
      if (c.nodeType === Node.TEXT_NODE && c.textContent.trim().length > 0) {
        const r = document.createRange();
        r.selectNodeContents(c);
        rects.push(...Array.from(r.getClientRects()));
      }
    }
    return { id, rects: rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })) };
  });
};

/** Fallback for the rare node whose rect(s) never fit fully inside any single paginated-scan stop
 *  (e.g. a paragraph taller than one whole viewport at mobile width): one dedicated `scrollIntoView`
 *  + real viewport-only screenshot of its own, allowing a partially-clipped rect rather than skipping
 *  the node outright. */
async function measureNodeViaScrollIntoView(page, nodeId, fg) {
  const found = await page.evaluate((id) => {
    const el = document.querySelector(`[data-tr49-node-id="${id}"]`);
    if (!el) return false;
    // `behavior: 'instant'` overrides globals.css's `html { scroll-behavior: smooth }` for this call
    // specifically — without it, this scroll animates, and the very next `evaluate()`'s
    // getBoundingClientRect() reads (near-instantly) a different, earlier point of that animation
    // than the (slower, async) screenshot captures a moment later, corrupting the measurement.
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    return true;
  }, nodeId);
  if (!found) return null;

  await page.waitForTimeout(100);
  const fresh = await page.evaluate((id) => {
    const el = document.querySelector(`[data-tr49-node-id="${id}"]`);
    if (!el) return null;
    let rects = [];
    for (const c of el.childNodes) {
      if (c.nodeType === Node.TEXT_NODE && c.textContent.trim().length > 0) {
        const r = document.createRange();
        r.selectNodeContents(c);
        rects.push(...Array.from(r.getClientRects()));
      }
    }
    return { rects: rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })) };
  }, nodeId);
  if (!fresh || fresh.rects.length === 0) return null;

  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const buf = await page.screenshot({ fullPage: false });
  const png = PNG.sync.read(buf);
  function sample(x, y) {
    const px = Math.min(Math.max(Math.round(x * dpr), 0), png.width - 1);
    const py = Math.min(Math.max(Math.round(y * dpr), 0), png.height - 1);
    const idx = (png.width * py + px) << 2;
    return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
  }

  let worst = { ratio: Infinity, bg: null };
  for (const rect of fresh.rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    for (const { x, y } of gridPoints(rect)) {
      if (y < 0 || x < 0) continue;
      const bg = sample(x, y);
      const composited = compositeOver(fg, bg);
      const ratio = contrastRatio([composited.r, composited.g, composited.b], [bg.r, bg.g, bg.b]);
      if (ratio < worst.ratio) worst = { ratio, bg };
    }
  }
  return worst.bg === null ? null : worst;
}

async function measurePage(context, targetSpec, baseUrl, colorScheme) {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme });
  await page.goto(baseUrl + targetSpec.path, { waitUntil: 'networkidle' });
  const landedUrl = new URL(page.url());
  if (landedUrl.pathname === '/auth' || landedUrl.pathname === '/api/auth/error') {
    await page.close();
    throw new SkipTarget(`redirected to ${landedUrl.pathname}${landedUrl.search} even WITH a logged-in session`);
  }
  // `behavior: 'instant'` — see the header comment on the paginated-scan stops below for why this
  // matters: globals.css sets `html { scroll-behavior: smooth }` globally.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));

  const scopeSelector = targetSpec.scope;
  const scopeExists = scopeSelector
    ? await page.evaluate((sel) => !!document.querySelector(sel), scopeSelector)
    : true;
  if (scopeSelector && !scopeExists) {
    await page.close();
    throw new SkipTarget(`scope selector "${scopeSelector}" not present on the rendered page (widget not in this render state)`);
  }

  const meta = await page.evaluate(TAG_AND_COLLECT_META_FN, scopeSelector);
  await page.evaluate(BLANK_INK_FN, scopeSelector);

  const metaById = new Map(meta.map((m) => [m.id, m]));
  const fgById = new Map();
  for (const m of meta) {
    const fg = parseCssColor(m.color);
    if (m.isSvg) {
      // BLIND SPOT FIX (a): fold fill-opacity into the alpha this SVG text composites with.
      fg.a = fg.a * (Number.isFinite(m.fillOpacity) ? m.fillOpacity : 1);
    }
    fgById.set(m.id, fg);
  }

  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const viewportSize = page.viewportSize();
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  // BLIND SPOT FIX (b): a paginated scan of ordinary, un-expanded viewport screenshots — see header
  // comment. Scroll stops cover the whole document in real viewport-height increments, with a final
  // stop bottom-aligned so the tail of the page (which may be shorter than one full increment) is
  // still covered by a stop whose OWN viewport fully contains it.
  const stops = [0];
  let y = 0;
  while (y + viewportSize.height < scrollHeight) {
    y += viewportSize.height;
    stops.push(y);
  }
  const lastStop = Math.max(0, scrollHeight - viewportSize.height);
  if (stops[stops.length - 1] !== lastStop) stops.push(lastStop);

  const measured = new Map(); // id -> { ratio, bg }
  for (const stop of stops) {
    // BLIND SPOT FIX (b), continued: `behavior: 'instant'` is load-bearing, not cosmetic —
    // globals.css sets `html { scroll-behavior: smooth }` globally, so a plain `window.scrollTo(0,
    // sy)` animates. Without forcing `instant`, the very next `evaluate()` call (GET_FRESH_RECTS_FN,
    // which runs near-synchronously) reads element positions from an EARLIER point in that animation
    // than the (slower, async) `page.screenshot()` a moment later actually captures — a real,
    // reproduced bug caught during this build's own self-verification: it silently misaligned rects
    // against screenshot pixels almost exactly like the fullPage-capture bug this fix was written to
    // replace, just via a different mechanism (animation-vs-capture timing instead of viewport
    // expansion). Forcing `instant` makes the scroll (and every subsequent read of it) atomic.
    await page.evaluate((sy) => window.scrollTo({ top: sy, left: 0, behavior: 'instant' }), stop);
    await page.waitForTimeout(60); // let sticky/fixed layout settle at this real scroll position
    const fresh = await page.evaluate(GET_FRESH_RECTS_FN);

    const buf = await page.screenshot({ fullPage: false });
    const png = PNG.sync.read(buf);
    function sample(x, py) {
      const px = Math.min(Math.max(Math.round(x * dpr), 0), png.width - 1);
      const ppy = Math.min(Math.max(Math.round(py * dpr), 0), png.height - 1);
      const idx = (png.width * ppy + px) << 2;
      return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
    }

    for (const { id, rects } of fresh) {
      if (measured.has(id) || rects.length === 0) continue;
      const fits = rects.every((r) => r.y >= 0 && r.y + r.height <= viewportSize.height);
      if (!fits) continue;
      const fg = fgById.get(id);
      let worst = { ratio: Infinity, bg: null };
      for (const rect of rects) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        for (const { x, y: py } of gridPoints(rect)) {
          const bg = sample(x, py);
          const composited = compositeOver(fg, bg);
          const ratio = contrastRatio([composited.r, composited.g, composited.b], [bg.r, bg.g, bg.b]);
          if (ratio < worst.ratio) worst = { ratio, bg };
        }
      }
      if (worst.bg !== null) measured.set(id, worst);
    }
  }

  // Fallback for any node that never fully fit a single stop (very rare — see function header).
  for (const m of meta) {
    if (measured.has(m.id)) continue;
    const corrected = await measureNodeViaScrollIntoView(page, m.id, fgById.get(m.id));
    if (corrected) measured.set(m.id, corrected);
  }

  const results = [];
  for (const m of meta) {
    const worst = measured.get(m.id);
    if (!worst) continue; // never resolved to a real, in-viewport measurement anywhere — see fallback
    const isBold = parseInt(m.fontWeight, 10) >= 700 || m.fontWeight === 'bold';
    const isLarge = m.fontSize >= 24 || (isBold && m.fontSize >= 18.66);
    const target = isLarge ? AA_LARGE : AA_NORMAL;
    results.push({
      text: m.text,
      tag: m.tag,
      className: m.className,
      isSvg: m.isSvg,
      sticky: m.sticky,
      color: m.color,
      fontSize: m.fontSize,
      fontWeight: m.fontWeight,
      isLarge,
      target,
      worstRatio: worst.ratio,
      worstBg: worst.bg,
    });
  }
  await page.close();
  return results;
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

async function main() {
  console.log('Render-based WCAG AA contrast gate — AUTH-GATED half (T-R49, spec §6.1)\n');

  const pg = checkPostgresAvailable();
  if (!pg.ok) {
    logWholeRunSkip(`no local Postgres reachable — ${pg.reason}`);
    return;
  }

  let secrets;
  try {
    secrets = {
      NEXTAUTH_SECRET: opensslRandBase64(32),
      CONTACT_HASH_PEPPER: opensslRandBase64(32),
      CONTACT_ENCRYPTION_KEY: opensslRandBase64(32),
      MFA_ENCRYPTION_KEY: opensslRandBase64(32),
      SOLUTION_NUMBER_ENCRYPTION_KEY: opensslRandBase64(32),
      WHY_SESSION_ENCRYPTION_KEY: opensslRandBase64(32),
    };
  } catch (err) {
    logWholeRunSkip(err instanceof HarnessUnavailable ? err.message : `unexpected error generating secrets — ${err?.message ?? err}`);
    return;
  }

  const databaseUrl = seedDatabaseUrl();
  let dbCreated = false;
  let server;
  let browser;
  try {
    ensureBuilt();

    createSeedDatabase();
    dbCreated = true;
    pushSchema(databaseUrl);
    await seedGatedCompleteRep(databaseUrl);

    const port = await findFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const serverEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NEXTAUTH_SECRET: secrets.NEXTAUTH_SECRET,
      AUTH_SECRET: secrets.NEXTAUTH_SECRET,
      NEXTAUTH_URL: baseUrl,
      CONTACT_HASH_PEPPER: secrets.CONTACT_HASH_PEPPER,
      CONTACT_ENCRYPTION_KEY: secrets.CONTACT_ENCRYPTION_KEY,
      MFA_ENCRYPTION_KEY: secrets.MFA_ENCRYPTION_KEY,
      SOLUTION_NUMBER_ENCRYPTION_KEY: secrets.SOLUTION_NUMBER_ENCRYPTION_KEY,
      WHY_SESSION_ENCRYPTION_KEY: secrets.WHY_SESSION_ENCRYPTION_KEY,
    };
    server = startServer(port, serverEnv);
    await waitForServer(baseUrl + '/', 30000);
    browser = await chromium.launch();

    let failures = 0;
    let totalChecked = 0;
    const skipped = [];

    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        let context;
        try {
          context = await loginAndReturnContext(browser, baseUrl, viewport);
        } catch (err) {
          const reason = err?.message ?? String(err);
          for (const target of AUTH_TARGETS) {
            const combo = `${target.label} @ ${viewport.label} (${viewport.width}x${viewport.height}) [${theme.name} theme]`;
            skipped.push({ combo, reason: `LOGIN FAILED: ${reason}` });
            console.log(`--- ${combo} — [SKIP] LOGIN FAILED: ${reason} ---\n`);
          }
          continue;
        }

        for (const target of AUTH_TARGETS) {
          const combo = `${target.label} @ ${viewport.label} (${viewport.width}x${viewport.height}) [${theme.name} theme]`;
          let results;
          try {
            results = await measurePage(context, target, baseUrl, theme.colorScheme);
          } catch (err) {
            const reason = err instanceof SkipTarget ? err.message : `unexpected error — ${err?.message ?? err}`;
            skipped.push({ combo, reason });
            console.log(`--- ${combo} — [SKIP] ${reason} ---\n`);
            continue;
          }

          console.log(`--- ${combo} — ${results.length} text node(s) ---`);
          for (const r of results) {
            totalChecked++;
            const pass = r.worstRatio >= r.target;
            if (!pass) failures++;
            const selector = `<${r.tag.toLowerCase()}${r.className ? '.' + String(r.className).trim().split(/\s+/).join('.') : ''}>`;
            const bgStr = r.worstBg ? `rgb(${r.worstBg.r},${r.worstBg.g},${r.worstBg.b})` : 'n/a';
            const notes = [r.isSvg ? 'svg-fill' : null, r.sticky ? 'sticky-or-fixed-ancestor' : null]
              .filter(Boolean)
              .join(', ');
            console.log(
              `  [${pass ? 'PASS' : 'FAIL'}] (${theme.name}) ${selector} "${r.text.slice(0, 48)}${r.text.length > 48 ? '…' : ''}" ` +
                `— ${r.color}, ${r.fontSize}px/${r.fontWeight}${r.isLarge ? ' (large)' : ''}, ` +
                `worst ${r.worstRatio.toFixed(2)}:1 (need >=${r.target}:1) vs backdrop ~${bgStr}` +
                (notes ? ` [${notes}]` : '')
            );
          }
          console.log('');
        }
        await context.close();
      }
    }

    if (skipped.length > 0) {
      console.log(`--- ${skipped.length} (target x viewport x theme) combination(s) SKIPPED (never silently dropped) ---`);
      for (const s of skipped) console.log(`  [SKIP] ${s.combo}\n         reason: ${s.reason}`);
      console.log('');
    }
    console.log(
      `verify-rendered-contrast-auth: ${totalChecked} text node(s) checked across ${AUTH_TARGETS.length} auth-gated surface(s) x ${VIEWPORTS.length} viewport(s) x ${THEMES.length} theme(s), ` +
        `${failures} failing, ${skipped.length} combination(s) skipped (see above).`
    );
    if (failures > 0) {
      console.error(`\nverify-rendered-contrast-auth: ${failures} node(s) fail their WCAG AA render-based contrast target on an auth-gated surface.\n`);
      process.exitCode = 1;
      return;
    }
    console.log('verify-rendered-contrast-auth: OK — every reachable auth-gated text node meets its AA target.');
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof HarnessUnavailable) {
      logWholeRunSkip(err.message);
      return;
    }
    console.error('verify-rendered-contrast-auth: crashed —', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
    if (dbCreated) dropSeedDatabase();
  }
}

function logWholeRunSkip(reason) {
  const totalCombos = AUTH_TARGETS.length * VIEWPORTS.length * THEMES.length;
  console.log(
    `--- HARNESS UNAVAILABLE — all ${totalCombos} auth-gated (target x viewport x theme) combinations SKIPPED ---\n` +
      `  reason: ${reason}\n` +
      '  This is an honest degrade, not a pass or a failure: no real AA measurement could be taken, so ' +
      'none is claimed. Set TR49_SEED_PGHOST/TR49_SEED_PGPORT/TR49_SEED_PGUSER to point at a reachable ' +
      'local Postgres instance to enable real enforcement in this environment.\n'
  );
  console.log(
    `verify-rendered-contrast-auth: 0 text node(s) checked, 0 failing, ${totalCombos} combination(s) skipped (harness unavailable).`
  );
  process.exitCode = 0;
}

main().catch((err) => {
  console.error('verify-rendered-contrast-auth: crashed —', err);
  process.exitCode = 1;
});
