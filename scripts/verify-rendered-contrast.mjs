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
 * SCOPE (matches the T-05 remediation, not a full-site audit — that is
 * a separate later unit, T-52):
 *   - `/`            -> only text nodes inside `.score-ring` (the
 *                        gradient widget T-05 touched).
 *   - `/design-tokens` -> the entire page (T-05's own artifact).
 * Checked at two viewports (1440x900 desktop, 390x844 mobile) because
 * the known defect was viewport-dependent — checking only one width is
 * exactly the blind spot that let it recur.
 *
 * WIRING (deliberately NOT in `postbuild`): a full `next build` + boot a
 * production server + launch a browser is much heavier than the two
 * static checks that already run after every build, and flakier in a
 * constrained CI sandbox (port binding, browser download/launch). Per
 * the pragmatic instruction this script was commissioned under, it is
 * wired as:
 *   - an explicitly-invoked script: `npm run verify:rendered-contrast`
 *   - a jest test that runs it: tests/unit/rendered-contrast-gate.test.ts
 * CI is expected to run `npm run verify:rendered-contrast` as an
 * explicit step after `npm run build` (in addition to `npm test`, which
 * already exercises it via the jest test above) so this class of defect
 * cannot silently stop being checked the way a quietly-skipped manual
 * step could.
 *
 * Exits 0 on success, 1 with a per-node report on any AA failure.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

// Each target: the page path, and the CSS selector to scope the text-node
// walk to (`null` = whole document body). See the SCOPE note above.
const TARGETS = [
  { path: '/', scope: '.score-ring', label: '/ — .score-ring widget' },
  { path: '/design-tokens', scope: null, label: '/design-tokens — full page' },
];

const VIEWPORTS = [
  { width: 1440, height: 900, label: 'desktop-1440' },
  { width: 390, height: 844, label: 'mobile-390' },
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
 * Loads `url` in `page` at the viewport already set on it, hides every
 * in-scope text node's own ink in one batched mutation, takes ONE
 * full-page screenshot (so image pixel coords == document coords, since
 * we pin scroll to (0,0) first), then measures each node's worst-case
 * composited contrast against that screenshot. Restores the DOM mutation
 * before returning (defensive — a fresh `page.goto` per target already
 * makes this unnecessary, but cheap to be correct).
 */
async function measurePage(page, url, scopeSelector) {
  await page.goto(url, { waitUntil: 'networkidle' });
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

  try {
    await waitForServer(baseUrl + '/', 30000);
    browser = await chromium.launch();

    console.log('Render-based WCAG AA contrast gate (T-05, spec §6.1)\n');

    for (const viewport of VIEWPORTS) {
      for (const target of TARGETS) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2 });
        const url = baseUrl + target.path;
        const results = await measurePage(page, url, target.scope);
        await page.close();

        console.log(`--- ${target.label} @ ${viewport.label} (${viewport.width}x${viewport.height}) — ${results.length} text node(s) ---`);
        for (const r of results) {
          totalChecked++;
          const pass = r.worstRatio >= r.target;
          if (!pass) failures++;
          const selector = `<${r.tag.toLowerCase()}${r.className ? '.' + String(r.className).trim().split(/\s+/).join('.') : ''}>`;
          const bgStr = r.worstBg ? `rgb(${r.worstBg.r},${r.worstBg.g},${r.worstBg.b})` : 'n/a';
          console.log(
            `  [${pass ? 'PASS' : 'FAIL'}] ${selector} "${r.text.slice(0, 48)}${r.text.length > 48 ? '…' : ''}" ` +
              `— ${r.color}, ${r.fontSize}px/${r.fontWeight}${r.isLarge ? ' (large)' : ''}, ` +
              `worst ${r.worstRatio.toFixed(2)}:1 (need >=${r.target}:1) vs backdrop ~${bgStr}`
          );
        }
        console.log('');
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log(`verify-rendered-contrast: ${totalChecked} text node(s) checked across ${TARGETS.length} surface(s) x ${VIEWPORTS.length} viewport(s), ${failures} failing.`);
  if (failures > 0) {
    console.error(`\nverify-rendered-contrast: ${failures} node(s) fail their WCAG AA render-based contrast target.\n`);
    process.exitCode = 1;
    return;
  }
  console.log('verify-rendered-contrast: OK — every text node on every checked surface/viewport meets its AA target.');
  process.exitCode = 0;
}

main().catch((err) => {
  console.error('verify-rendered-contrast: crashed —', err);
  process.exitCode = 1;
});
