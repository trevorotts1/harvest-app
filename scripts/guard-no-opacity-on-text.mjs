#!/usr/bin/env node
/**
 * Small, targeted lint (T-05 QC defect 3 hardening, spec §1.2.4 / §6.1):
 * fails if text-bearing CSS applies a sub-1 `opacity`, or a sub-1-alpha
 * `color: rgba(...)` / `hsla(...)`, to a plain (non-animation) rule.
 *
 * Why this exists: `scripts/verify-contrast.mjs` checks the raw token hex
 * values defined in tokens.css — it has no idea that a component then
 * dims the *rendered* text with `opacity`, or paints it with a
 * translucent `rgba()`/`hsla()` color, either of which composites the
 * glyph against whatever sits behind it and silently lowers its
 * EFFECTIVE contrast below whatever the token-level check asserted.
 *
 * Two confirmed real-world instances of this exact class:
 *   - `design-tokens.module.css`'s `.pairMeta { opacity: 0.85; }`: two
 *     captions measured 5.1:1 and 5.7:1 at the token level but rendered
 *     at ~3.76:1 and ~4.18:1 — both AA failures — because of opacity.
 *   - `src/app/page.tsx`'s `.score-ring` paragraph:
 *     `<p style={{ color: 'rgba(255,255,255,0.78)' }}>` on a gradient —
 *     survived TWO prior fix attempts because nothing scanned inline
 *     `style=` attributes in `.tsx` files, or plain (non-Module) `.css`
 *     like `globals.css`, for this pattern; only `.module.css` files
 *     were ever scanned, and only the bare `opacity` property, not a
 *     translucent `color:` value.
 *
 * SCAN SCOPE (as of this hardening pass):
 *   1. Every `*.module.css` file under src/         (opacity + color-alpha)
 *   2. `src/app/globals.css`                        (opacity + color-alpha)
 *   3. Every `*.tsx` file under src/, inline
 *      `style={{ ... }}` attributes only            (opacity + color-alpha)
 *
 * This is deliberately NOT a general contrast checker or a CSS/rendering
 * engine — no gradient/background awareness, no computed-style cascade —
 * just brace-depth-aware block splitting (CSS) / brace-matching (JSX
 * inline style objects) plus one regex per declaration, proportionate to
 * the one failure mode it exists to catch. For the real, render-based,
 * cascade-aware check that catches text-on-GRADIENT contrast specifically
 * (which this static lint cannot see — it doesn't know what's behind an
 * opaque, fully-solid-color piece of text), see
 * `scripts/verify-rendered-contrast.mjs` / `npm run verify:rendered-contrast`.
 *
 * The one legitimate use of `opacity` in this codebase is a transient
 * enter/exit *animation* (e.g. this app's `@keyframes unfurl`, which
 * fades a panel in from 0 to 1 and settles at full opacity) — those are
 * exempted because the at-rest state is opaque and the dip is momentary,
 * not a static reduction of a color's effective luminance. Everywhere
 * else, `opacity` on a rule that isn't `1` / `100%`, or a `color:`
 * declared as `rgba()`/`hsla()` with an alpha below 1, is presumed to be
 * dimming text and is barred — use a real, lower-luminance AA-passing
 * color token instead (see tokens.css's --text-secondary / --soil-550
 * for the pattern), or an opaque backing surface if the text sits on a
 * non-flat background (see `.score-ring .score-stat` / `.score-copy` in
 * globals.css for that pattern).
 *
 * KNOWN PRE-EXISTING EXEMPTIONS — read before adding to this list:
 * Widening this guard's scan coverage (T-05 QC defect-3, 3rd recurrence
 * hardening pass) surfaced the SAME defect pattern
 * (`color: rgba(255,255,255,.72)` / `.78`, translucent white text on a
 * dark fill) already present in code this build unit does not own and
 * is explicitly barred from touching: `src/app/auth/page.tsx`,
 * `src/app/onboarding/page.tsx`, and two rules in `globals.css`
 * (`.side-link`, `.visual-root span`) used by screens outside T-05's
 * remit (`/`'s `.score-ring` widget and `/design-tokens` only — see
 * harvest-uiux-spec.md §6.1 scope note). Per that scope boundary, this
 * script GRANDFATHERS exactly those pre-existing instances below —
 * printed loudly every run as `[WARN-EXEMPT]`, not silently — so the
 * gate stays green for THIS build unit's actual scope while the defect
 * remains visible (not swept away) for whichever unit inherits the
 * full-site accessibility pass (T-52). Any NEW instance of this pattern,
 * anywhere else in the tree, still fails the gate. Do not add to this
 * list without a linked tracking ticket, and only remove entries when
 * the underlying code is actually fixed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

// Pre-existing, out-of-scope-for-T-05 violations. Keys are
// `${relativeFilePath}::${selectorOrElementDescription}`. See the header
// comment above for the rationale and the rule for touching this list.
const KNOWN_PRE_EXISTING_EXEMPTIONS = new Set([
  'src/app/auth/page.tsx::style={{...}} (inline <p>)',
  'src/app/onboarding/page.tsx::style={{...}} (inline <p>)',
  'src/app/globals.css::.side-link',
  'src/app/globals.css::.visual-root span',
]);

// ---------------------------------------------------------------------------
// 1. Find target files.
// ---------------------------------------------------------------------------

function findFiles(dir, predicate) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...findFiles(full, predicate));
    } else if (predicate(entry)) {
      out.push(full);
    }
  }
  return out;
}

const moduleCssFiles = findFiles(SRC_ROOT, (name) => name.endsWith('.module.css'));
const globalsCssPath = path.join(SRC_ROOT, 'app', 'globals.css');
const tsxFiles = findFiles(SRC_ROOT, (name) => name.endsWith('.tsx'));

// ---------------------------------------------------------------------------
// 2. CSS: brace-depth-aware block split (same approach as
//    verify-contrast.mjs), so a nested `@keyframes name { 0% {...} }` is
//    walked as ONE animation block rather than confused for plain rules.
// ---------------------------------------------------------------------------

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** @returns {Array<{ selector: string, body: string, inKeyframes: boolean }>} */
function parseCssBlocks(css) {
  const blocks = [];
  const n = css.length;

  function skipToBlockEnd(start) {
    let depth = 1;
    let j = start;
    while (j < n && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    return j;
  }

  function walk(text, inKeyframes) {
    let k = 0;
    const len = text.length;
    while (k < len) {
      const brace = text.indexOf('{', k);
      if (brace === -1) break;
      const selector = text.slice(k, brace).trim();
      const end = skipToBlockEnd(brace + 1);
      const body = text.slice(brace + 1, end - 1);

      if (/^@(?:-\w+-)?keyframes\b/.test(selector)) {
        walk(body, true);
      } else if (selector.startsWith('@media')) {
        walk(body, inKeyframes);
      } else if (selector.length > 0) {
        blocks.push({ selector, body, inKeyframes });
      }
      k = end;
    }
  }

  walk(css, false);
  return blocks;
}

// ---------------------------------------------------------------------------
// 3. Shared declaration-level checks: sub-1 `opacity`, sub-1-alpha
//    `color: rgba()/hsla()`. Used for both CSS rule bodies and JSX
//    inline style object bodies — same declaration grammar
//    (`prop: value`, split on top-level `;` for CSS / `,` for JS
//    objects handled by the caller before these run per-declaration).
// ---------------------------------------------------------------------------

function isFullyOpaqueOpacityValue(value) {
  return value === '1' || value === '1.0' || value === '100%';
}

/** Extracts the alpha channel (0-1) from an `rgba(...)` / `hsla(...)` value string, or null if not that shape / already opaque-only (rgb()/hsl() with 3 args). */
function alphaOf(value) {
  const m = value.match(/^(rgba?|hsla?)\(([^)]*)\)$/i);
  if (!m) return null;
  const fn = m[1].toLowerCase();
  const parts = m[2].split(',').map((s) => s.trim());
  if ((fn === 'rgba' || fn === 'hsla') && parts.length === 4) {
    const a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return Number.isFinite(a) ? a : null;
  }
  return null; // rgb()/hsl() (3-arg) — fully opaque by construction, nothing to flag.
}

/**
 * @param {string} body declarations separated by `;` (CSS rule body)
 * @returns {Array<{ kind: 'opacity'|'color-alpha', raw: string }>}
 */
function findCssDeclViolations(body) {
  const violations = [];
  for (const raw of body.split(';')) {
    const decl = raw.trim();
    if (!decl) continue;
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();

    if (prop === 'opacity' && !isFullyOpaqueOpacityValue(value)) {
      violations.push({ kind: 'opacity', raw: value });
    } else if (prop === 'color') {
      const a = alphaOf(value);
      if (a !== null && a < 1) violations.push({ kind: 'color-alpha', raw: value });
    }
  }
  return violations;
}

function checkCssFile(absPath, relPath, exemptionKeyFor) {
  const css = stripCssComments(readFileSync(absPath, 'utf8'));
  const blocks = parseCssBlocks(css);
  const reports = [];
  let checkedRules = 0;
  for (const { selector, body, inKeyframes } of blocks) {
    checkedRules++;
    if (inKeyframes) continue; // transient animation — exempt, see header.
    for (const v of findCssDeclViolations(body)) {
      const exemptionKey = exemptionKeyFor(selector);
      reports.push({ relPath, selector, ...v, exempt: KNOWN_PRE_EXISTING_EXEMPTIONS.has(exemptionKey) });
    }
  }
  return { reports, checkedRules };
}

// ---------------------------------------------------------------------------
// 4. TSX: find `style={{ ... }}` inline objects via brace-matching (not a
//    JS/TS parser — proportionate to this one failure mode), then run the
//    same declaration-level checks against each `key: value` pair split
//    on top-level commas (so `rgba(a, b, c, d)`'s internal commas don't
//    get mistaken for object-property separators).
// ---------------------------------------------------------------------------

function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** @returns {string[]} the raw text inside each `style={{ ... }}` found in `src`, braces excluded. */
function findInlineStyleObjects(src) {
  const out = [];
  const marker = 'style={{';
  let searchFrom = 0;
  while (true) {
    const start = src.indexOf(marker, searchFrom);
    if (start === -1) break;
    let depth = 2; // already inside `{{`
    let j = start + marker.length;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    // j now points just past the matching `}}` (depth hit 0 after the 2nd closing brace)
    out.push(src.slice(start + marker.length, j - 2));
    searchFrom = j;
  }
  return out;
}

/** Splits a JS object-literal body into `key: value` pairs on top-level commas (parens/brackets-aware, so `rgba(...)` survives intact). */
function splitTopLevelObjectEntries(body) {
  const entries = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      entries.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) entries.push(current);
  return entries;
}

function unquote(str) {
  const s = str.trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

/** @returns {Array<{ kind: 'opacity'|'color-alpha', raw: string }>} */
function findInlineStyleViolations(objectBody) {
  const violations = [];
  for (const entry of splitTopLevelObjectEntries(objectBody)) {
    const colon = entry.indexOf(':');
    if (colon === -1) continue;
    const key = entry.slice(0, colon).trim();
    const rawValue = entry.slice(colon + 1).trim();

    if (key === 'opacity') {
      // Only a literal numeric constant is in scope — a dynamic
      // expression (`isVisible ? 1 : 0`, a prop, a computed value) is a
      // runtime animation/state toggle, not the static "someone typed a
      // dim value" mistake this guard exists to catch, and can't be
      // evaluated statically anyway.
      const numeric = rawValue.replace(/,\s*$/, '');
      if (/^[0-9]*\.?[0-9]+%?$/.test(numeric) && !isFullyOpaqueOpacityValue(numeric)) {
        violations.push({ kind: 'opacity', raw: numeric });
      }
    } else if (key === 'color') {
      const value = unquote(rawValue.replace(/,\s*$/, ''));
      const a = alphaOf(value);
      if (a !== null && a < 1) violations.push({ kind: 'color-alpha', raw: value });
    }
  }
  return violations;
}

function checkTsxFile(absPath, relPath, exemptionKeyFor) {
  const src = stripJsComments(readFileSync(absPath, 'utf8'));
  const objects = findInlineStyleObjects(src);
  const reports = [];
  for (const obj of objects) {
    for (const v of findInlineStyleViolations(obj)) {
      const exemptionKey = exemptionKeyFor();
      reports.push({ relPath, selector: 'style={{...}} (inline)', ...v, exempt: KNOWN_PRE_EXISTING_EXEMPTIONS.has(exemptionKey) });
    }
  }
  return { reports, checkedRules: objects.length };
}

// ---------------------------------------------------------------------------
// 5. Run.
// ---------------------------------------------------------------------------

function describe(v) {
  return v.kind === 'opacity' ? `opacity: ${v.raw}` : `color: ${v.raw}`;
}

function main() {
  let failures = 0;
  let exemptCount = 0;
  let checkedRules = 0;
  const filesChecked = moduleCssFiles.length + 1 /* globals.css */ + tsxFiles.length;

  console.log('No-opacity-on-text guard (T-05 QC defect 3 hardening, spec §1.2.4 / §6.1)\n');

  const allCssFiles = [...moduleCssFiles, globalsCssPath];
  for (const file of allCssFiles) {
    const relPath = path.relative(REPO_ROOT, file);
    const { reports, checkedRules: n } = checkCssFile(file, relPath, (selector) => `${relPath}::${selector}`);
    checkedRules += n;
    for (const r of reports) {
      if (r.exempt) {
        exemptCount++;
        console.warn(
          `  [WARN-EXEMPT] ${r.relPath} — "${r.selector}" sets ${describe(r)}. ` +
            'Pre-existing, out of T-05 scope (see this script\'s header comment) — tracked, not fixed here.'
        );
      } else {
        failures++;
        console.error(
          `  [FAIL] ${r.relPath} — "${r.selector}" sets ${describe(r)}. ` +
            'Dimming/translucing text lowers its EFFECTIVE contrast below ' +
            'whatever verify-contrast.mjs asserts at the token level — use an ' +
            'explicit, lower-luminance AA-passing color token, or an opaque ' +
            'backing surface, instead.'
        );
      }
    }
  }

  for (const file of tsxFiles) {
    const relPath = path.relative(REPO_ROOT, file);
    const { reports, checkedRules: n } = checkTsxFile(file, relPath, () => `${relPath}::style={{...}} (inline <p>)`);
    checkedRules += n;
    for (const r of reports) {
      if (r.exempt) {
        exemptCount++;
        console.warn(
          `  [WARN-EXEMPT] ${r.relPath} — ${r.selector} sets ${describe(r)}. ` +
            'Pre-existing, out of T-05 scope (see this script\'s header comment) — tracked, not fixed here.'
        );
      } else {
        failures++;
        console.error(
          `  [FAIL] ${r.relPath} — ${r.selector} sets ${describe(r)}. ` +
            'Dimming/translucing text lowers its EFFECTIVE contrast below ' +
            'whatever verify-contrast.mjs asserts at the token level — use an ' +
            'explicit, lower-luminance AA-passing color token, or an opaque ' +
            'backing surface, instead.'
        );
      }
    }
  }

  console.log(
    `\nChecked ${filesChecked} file(s) (${moduleCssFiles.length} *.module.css + globals.css + ${tsxFiles.length} *.tsx), ${checkedRules} rule/style-object(s).`
  );
  if (exemptCount > 0) {
    console.log(`${exemptCount} pre-existing, out-of-scope violation(s) grandfathered (see WARN-EXEMPT above) — tracked for T-52.`);
  }
  if (failures > 0) {
    console.error(`\nguard-no-opacity-on-text: ${failures} violation(s) found.\n`);
    process.exit(1);
  }
  console.log('guard-no-opacity-on-text: no NEW sub-1 opacity / translucent text color found. OK.');
  process.exit(0);
}

main();
