#!/usr/bin/env node
/**
 * WCAG 2.x contrast gate for the Living Field Design System token layer
 * (T-05, spec harvest-uiux-spec.md §1.2.4 / §6.1).
 *
 * This is a static SOURCE scan, in the same spirit as
 * scripts/verify-api-auth.mjs and scripts/verify-middleware.mjs: it does
 * not hardcode a duplicate table of "expected" hex values that could
 * silently drift from the real CSS. Instead it PARSES the actual custom
 * property declarations out of src/app/tokens.css, resolves `var(...)`
 * chains the same way a browser's cascade would (dark-theme selectors
 * override specific properties on top of the `:root` base), and computes
 * real WCAG relative-luminance contrast ratios from those resolved
 * colors. If someone edits a token's value in tokens.css — including by
 * re-introducing one of the spec's known-bad values — this script's
 * numbers move with it and the gate can fail for real.
 *
 * Two independent guarantees are checked:
 *
 *   1. POSITIVE — every key semantic text-on-surface pairing defined by
 *      the design system (§1.2.2 / §1.2.4), for BOTH themes, meets its
 *      WCAG AA target (normal text >= 4.5:1, non-text/large >= 3:1).
 *
 *   2. NEGATIVE ("teeth") — the two values the spec explicitly flags as
 *      AA failures, if they were used as text-on-canvas, actually DO
 *      fail against the same math and the same 4.5:1 target:
 *        - the scaffold's original muted color, --soil-500 #66736b,
 *          measured ~4.48:1 on canvas (spec's stated defect)
 *        - --harvest-500 #c8852c used as text-on-light, ~2.77:1
 *      This proves the checker can actually fail a pairing — it is not
 *      structurally incapable of reporting failure. Both values are
 *      read from the real ramp tokens in tokens.css (they still exist
 *      there as legitimate non-text-safe ramp steps), not hardcoded.
 *
 * Exits 0 on success, 1 with a descriptive report on any failure.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_CSS_PATH = path.join(__dirname, '..', 'src', 'app', 'tokens.css');

// ---------------------------------------------------------------------------
// 1. Minimal CSS block parser (selector -> { prop: rawValue }), brace-depth
//    aware so it survives the nested `@media (...) { :root { ... } }` block.
// ---------------------------------------------------------------------------

/**
 * @param {string} css
 * @returns {Array<{ selector: string, declarations: Record<string,string> }>}
 * Flattened list of every rule block found at any nesting depth, in
 * source order, with its selector text (the `@media` wrapper itself is
 * not represented as a rule — only the nested rule inside it is, which
 * is all that matters here since we only ever look at `:root`-family
 * selectors).
 */
function parseCssBlocks(css) {
  const blocks = [];
  let i = 0;
  const n = css.length;

  function skipToBlockEnd(start) {
    // start points just after an opening '{'; returns index just after
    // the matching '}'.
    let depth = 1;
    let j = start;
    while (j < n && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    return j;
  }

  function walk(text, offset) {
    let k = 0;
    const len = text.length;
    while (k < len) {
      const brace = text.indexOf('{', k);
      if (brace === -1) break;
      const selector = text.slice(k, brace).trim();
      const end = skipToBlockEnd(brace + 1);
      const body = text.slice(brace + 1, end - 1);

      if (selector.startsWith('@media')) {
        // Recurse into the media block's body to find nested rules.
        walk(body, offset + brace + 1);
      } else if (selector.length > 0) {
        const declarations = {};
        // Split declarations on top-level ';' (values here are simple
        // enough — hex, var(), rgba(), calc(), cubic-bezier() — that a
        // naive split on ';' works because none of our declarations
        // contain a literal ';' inside their value).
        for (const raw of body.split(';')) {
          const decl = raw.trim();
          if (!decl) continue;
          const colon = decl.indexOf(':');
          if (colon === -1) continue;
          const prop = decl.slice(0, colon).trim();
          const value = decl.slice(colon + 1).trim();
          if (prop.startsWith('--')) declarations[prop] = value;
        }
        blocks.push({ selector, declarations });
      }
      k = end;
    }
  }

  walk(css, 0);
  return blocks;
}

// ---------------------------------------------------------------------------
// 2. Build the light-theme and dark-theme custom-property maps the same
//    way the cascade would: start from `:root`, then layer on the dark
//    overrides (`:root[data-theme='dark']` and the `prefers-color-scheme`
//    media variant target the same properties with the same values by
//    construction — verified below rather than assumed).
// ---------------------------------------------------------------------------

function buildThemeMaps(blocks) {
  const light = {};
  const darkOverridesA = {}; // :root[data-theme='dark']
  const darkOverridesB = {}; // @media (prefers-color-scheme: dark) :root:not(...)

  for (const { selector, declarations } of blocks) {
    if (selector === ':root') {
      Object.assign(light, declarations);
    } else if (selector === ":root[data-theme='dark']") {
      Object.assign(darkOverridesA, declarations);
    } else if (selector === ":root:not([data-theme='light'])") {
      Object.assign(darkOverridesB, declarations);
    }
    // :root[data-theme='light'] only sets color-scheme — not relevant here.
  }

  // Multi-line values (e.g. --canvas-wash) pick up different incidental
  // indentation depending on @media nesting depth — insignificant CSS
  // whitespace, not real drift — so compare with whitespace collapsed.
  const normalize = (v) => v.replace(/\s+/g, ' ').trim();

  const darkKeysA = Object.keys(darkOverridesA).sort();
  const darkKeysB = Object.keys(darkOverridesB).sort();
  const sameKeys = JSON.stringify(darkKeysA) === JSON.stringify(darkKeysB);
  const sameValues = darkKeysA.every((k) => normalize(darkOverridesA[k]) === normalize(darkOverridesB[k]));
  if (!sameKeys || !sameValues) {
    throw new Error(
      "Dark-theme drift detected: ':root[data-theme=\"dark\"]' and the " +
        "'@media (prefers-color-scheme: dark)' block must define the exact " +
        'same custom properties with the exact same values (tokens.css §1.2.2 ' +
        'contract) — they have diverged. Fix tokens.css before re-running.'
    );
  }

  const dark = { ...light, ...darkOverridesA };
  return { light, dark };
}

/** Resolves `var(--x)` / `var(--x, fallback)` chains to a literal value. */
function resolveVar(value, map, seen = new Set()) {
  const trimmed = value.trim();
  const match = trimmed.match(/^var\((--[a-zA-Z0-9-]+)\s*(?:,\s*(.+))?\)$/);
  if (!match) return trimmed;
  const [, name, fallback] = match;
  if (seen.has(name)) {
    throw new Error(`Circular var() reference detected at ${name}`);
  }
  if (name in map) {
    return resolveVar(map[name], map, new Set(seen).add(name));
  }
  if (fallback !== undefined) return resolveVar(fallback, map, seen);
  throw new Error(`Unresolved custom property: ${name}`);
}

function resolveToken(tokenName, map) {
  if (!(tokenName in map)) throw new Error(`Token not found: ${tokenName}`);
  return resolveVar(map[tokenName], map);
}

// ---------------------------------------------------------------------------
// 3. WCAG 2.x contrast math.
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const m = hex.trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) throw new Error(`Expected a solid #rrggbb color, got: "${hex}"`);
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// 4. The pairs that matter — mirrors spec §1.2.4's own validated table,
//    for both themes. `level` selects the AA threshold: 'normal' (body
//    text) requires 4.5:1; 'large' / 'nontext' (big numerals, focus
//    rings, icon-only fills) requires 3:1.
// ---------------------------------------------------------------------------

const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

function pair(label, theme, fg, bg, level = 'normal') {
  return { label, theme, fg, bg, level, target: level === 'normal' ? AA_NORMAL : AA_LARGE };
}

const LIGHT_PAIRS = [
  pair('text-primary on surface-canvas (body on canvas)', 'light', '--text-primary', '--surface-canvas'),
  pair('text-secondary on surface-canvas (secondary body — AA-corrected)', 'light', '--text-secondary', '--surface-canvas'),
  pair('color-action text on surface-canvas', 'light', '--color-action', '--surface-canvas'),
  pair('on-action on color-action fill (button label)', 'light', '--on-action', '--color-action'),
  pair('color-harvest-text on cream', 'light', '--color-harvest-text', '--cream'),
  pair('color-harvest-text on surface-canvas', 'light', '--color-harvest-text', '--surface-canvas'),
  pair('text-primary on color-harvest-fill (large numerals on harvest-400)', 'light', '--text-primary', '--color-harvest-fill', 'large'),
  pair('color-blocked-fill text on surface-canvas', 'light', '--color-blocked-fill', '--surface-canvas'),
  pair('on-blocked on color-blocked-fill (button label)', 'light', '--on-blocked', '--color-blocked-fill'),
  pair('color-caution-text on color-caution-bg', 'light', '--color-caution-text', '--color-caution-bg'),
  pair('color-caution-text on surface-canvas', 'light', '--color-caution-text', '--surface-canvas'),
  pair('color-danger-form-text on color-danger-form-bg', 'light', '--color-danger-form-text', '--color-danger-form-bg'),
  pair('focus ring (color-action) vs surface-canvas', 'light', '--color-action', '--surface-canvas', 'nontext'),
];

const DARK_PAIRS = [
  pair('text-primary on surface-canvas', 'dark', '--text-primary', '--surface-canvas'),
  pair('text-primary on surface-2', 'dark', '--text-primary', '--surface-2'),
  pair('text-secondary on surface-canvas', 'dark', '--text-secondary', '--surface-canvas'),
  pair('text-secondary on surface-2', 'dark', '--text-secondary', '--surface-2'),
  pair('color-action text on surface-canvas', 'dark', '--color-action', '--surface-canvas'),
  pair('on-action on color-action fill (button label)', 'dark', '--on-action', '--color-action'),
  pair('color-harvest-text on surface-canvas', 'dark', '--color-harvest-text', '--surface-canvas'),
  pair('color-blocked-fill on surface-canvas', 'dark', '--color-blocked-fill', '--surface-canvas'),
  pair('color-caution-text on surface-canvas', 'dark', '--color-caution-text', '--surface-canvas'),
  pair('focus ring (color-action) vs surface-canvas', 'dark', '--color-action', '--surface-canvas', 'nontext'),
];

// Known-bad pairs the spec explicitly calls out as AA failures (§1.2.4).
// These read the REAL ramp values from tokens.css — they are legitimate
// ramp tokens (decorative-only / fill-only), just not legal as the
// text-secondary / color-harvest-text semantic assignment. Asserting
// these correctly FAIL against the same 4.5:1 target is the "teeth" proof.
const KNOWN_BAD_PAIRS = [
  {
    label: '--soil-500 (#66736b) as body text on --soil-100 (the scaffold\'s original --muted, pre-correction)',
    fg: '--soil-500',
    bg: '--soil-100',
    target: AA_NORMAL,
    expectFail: true,
  },
  {
    label: '--harvest-500 (#c8852c) as text-on-light on --soil-100 (barred by spec §1.2.4)',
    fg: '--harvest-500',
    bg: '--soil-100',
    target: AA_NORMAL,
    expectFail: true,
  },
];

// ---------------------------------------------------------------------------
// 5. Run.
// ---------------------------------------------------------------------------

function evaluatePair(p, maps) {
  const map = p.theme === 'dark' ? maps.dark : maps.light;
  const fgHex = resolveToken(p.fg, map);
  const bgHex = resolveToken(p.bg, map);
  const ratio = contrastRatio(fgHex, bgHex);
  return { ...p, fgHex, bgHex, ratio };
}

function evaluateKnownBad(p, maps) {
  // Known-bad pairs are theme-invariant ramp values; light map is fine.
  const fgHex = resolveToken(p.fg, maps.light);
  const bgHex = resolveToken(p.bg, maps.light);
  const ratio = contrastRatio(fgHex, bgHex);
  return { ...p, fgHex, bgHex, ratio };
}

/**
 * Strips CSS block comments the same way a CSS lexer would, before any
 * brace/selector parsing — otherwise a comment block sitting directly
 * before a selector (as tokens.css's documentation comments do) gets
 * absorbed into the selector text and silently breaks the `:root` /
 * `:root[data-theme='dark']` exact-match lookups below.
 */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function main() {
  const rawCss = readFileSync(TOKENS_CSS_PATH, 'utf8');
  const css = stripCssComments(rawCss);
  const blocks = parseCssBlocks(css);
  const maps = buildThemeMaps(blocks);

  const results = [...LIGHT_PAIRS, ...DARK_PAIRS].map((p) => evaluatePair(p, maps));
  const knownBad = KNOWN_BAD_PAIRS.map((p) => evaluateKnownBad(p, maps));

  let failures = 0;

  console.log('Living Field Design System — contrast verification (spec §1.2.4 / §6.1)\n');

  console.log('POSITIVE — real semantic pairs must meet their AA target:');
  for (const r of results) {
    const pass = r.ratio >= r.target;
    if (!pass) failures++;
    const line = `  [${pass ? 'PASS' : 'FAIL'}] (${r.theme}) ${r.label}: ${r.ratio.toFixed(2)}:1 (target >= ${r.target}:1) — ${r.fgHex} on ${r.bgHex}`;
    console.log(line);
  }

  console.log('\nNEGATIVE ("teeth") — spec-flagged bad values must still FAIL the same math:');
  for (const r of knownBad) {
    const correctlyFails = r.ratio < r.target;
    if (!correctlyFails) {
      failures++;
      console.log(
        `  [FAIL] ${r.label}: computed ${r.ratio.toFixed(2)}:1 — expected this to FAIL (< ${r.target}:1) but it did not. ` +
          'The checker is not distinguishing real failures — investigate the contrast math before trusting the POSITIVE results above.'
      );
    } else {
      console.log(
        `  [OK — correctly fails AA] ${r.label}: computed ${r.ratio.toFixed(2)}:1 (< ${r.target}:1) — matches the spec's stated defect.`
      );
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`verify-contrast: ${failures} check(s) failed.\n`);
    process.exit(1);
  }

  console.log(`verify-contrast: all ${results.length} semantic pairs meet AA, and both known-bad values correctly fail. OK.`);
  process.exit(0);
}

main();
