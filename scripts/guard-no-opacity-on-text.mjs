#!/usr/bin/env node
/**
 * Small, targeted lint (T-05 QC defect 3 hardening, spec §1.2.4 / §6.1):
 * fails if any CSS Module under src/ applies a sub-1 `opacity` to a plain
 * (non-animation) rule.
 *
 * Why this exists: `scripts/verify-contrast.mjs` checks the raw token hex
 * values defined in tokens.css — it has no idea that a component then
 * dims the *rendered* text with `opacity`, which composites the glyph
 * against whatever sits behind it and silently lowers its EFFECTIVE
 * contrast below whatever the token-level check asserted. That is
 * exactly what happened with `design-tokens.module.css`'s
 * `.pairMeta { opacity: 0.85; }`: two captions measured 5.1:1 and 5.7:1
 * at the token level but rendered at ~3.76:1 and ~4.18:1 — both AA
 * failures — because of the opacity. This guard closes that specific
 * blind spot. It is deliberately NOT a general contrast checker or a
 * CSS/rendering engine — just a brace-depth-aware block split plus one
 * regex per declaration, proportionate to the one failure mode it
 * exists to catch.
 *
 * The one legitimate use of `opacity` in this codebase is a transient
 * enter/exit *animation* (e.g. this app's `@keyframes unfurl`, which
 * fades a panel in from 0 to 1 and settles at full opacity) — those are
 * exempted because the at-rest state is opaque and the dip is momentary,
 * not a static reduction of a color's effective luminance. Everywhere
 * else, `opacity` on a rule that isn't `1` / `100%` is presumed to be
 * dimming text (this app's CSS Modules style text-bearing elements
 * almost exclusively) and is barred — use a real, lower-luminance
 * AA-passing color token instead (see tokens.css's --text-secondary /
 * --soil-550 for the pattern).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.join(__dirname, '..', 'src');

// ---------------------------------------------------------------------------
// 1. Find every CSS Module under src/.
// ---------------------------------------------------------------------------

function findModuleCssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      out.push(...findModuleCssFiles(full));
    } else if (entry.endsWith('.module.css')) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Brace-depth-aware block split (same approach as verify-contrast.mjs),
//    so a nested `@keyframes name { 0% {...} 100% {...} }` is walked as
//    ONE animation block rather than confused for plain rules.
// ---------------------------------------------------------------------------

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * @returns {Array<{ selector: string, body: string, inKeyframes: boolean }>}
 */
function parseBlocks(css) {
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
        // Recurse — the body is a series of `0% { ... }` / `from {...}` /
        // `to {...}` blocks, all exempt (transient animation, not a
        // static dimming of a text color).
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
// 3. Check each plain (non-keyframes) block for a sub-1 `opacity`.
// ---------------------------------------------------------------------------

function findOpacityViolations(body) {
  const violations = [];
  for (const raw of body.split(';')) {
    const decl = raw.trim();
    const m = decl.match(/^opacity\s*:\s*(.+)$/);
    if (!m) continue;
    const value = m[1].trim();
    const isFullyOpaque = value === '1' || value === '1.0' || value === '100%';
    if (!isFullyOpaque) violations.push(value);
  }
  return violations;
}

function main() {
  const files = findModuleCssFiles(SRC_ROOT);
  let failures = 0;
  let checkedRules = 0;

  console.log('No-opacity-on-text guard (T-05 QC defect 3 hardening, spec §1.2.4 / §6.1)\n');

  for (const file of files) {
    const css = stripComments(readFileSync(file, 'utf8'));
    const blocks = parseBlocks(css);
    const relPath = path.relative(path.join(__dirname, '..'), file);

    for (const { selector, body, inKeyframes } of blocks) {
      checkedRules++;
      if (inKeyframes) continue; // transient animation — exempt, see header.
      const violations = findOpacityViolations(body);
      for (const value of violations) {
        failures++;
        console.error(
          `  [FAIL] ${relPath} — "${selector}" sets opacity: ${value}. ` +
            'Dimming text via `opacity` lowers its EFFECTIVE contrast below ' +
            'whatever verify-contrast.mjs asserts at the token level — use an ' +
            'explicit, lower-luminance AA-passing color token instead.'
        );
      }
    }
  }

  console.log(`Checked ${files.length} CSS Module file(s), ${checkedRules} rule(s).`);
  if (failures > 0) {
    console.error(`\nguard-no-opacity-on-text: ${failures} violation(s) found.\n`);
    process.exit(1);
  }
  console.log('guard-no-opacity-on-text: no sub-1 opacity found on any plain (non-animation) rule. OK.');
  process.exit(0);
}

main();
