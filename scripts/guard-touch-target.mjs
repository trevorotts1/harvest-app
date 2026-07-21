#!/usr/bin/env node
/**
 * T-57 remediation, WAVE R1b, defect MINOR-A7 (uiux §6.1 "no automated 44px touch-target guard").
 * Analogous in shape/spirit to `guard-no-opacity-on-text.mjs` (declaration-level CSS lint, exact
 * per-instance fingerprinted exemptions) and to `guard-no-literals-in-components.mjs` (external,
 * shrink-only JSON baseline for pre-existing debt).
 *
 * WHAT IT DOES: fails the build if an INTERACTIVE element's CSS module rule explicitly declares a
 * `height`/`min-height`/`width`/`min-width` below the `--touch-target-min` floor (44px, tokens.css).
 *
 * WHY TWO PHASES (TSX then CSS), not just a CSS-selector-name heuristic: this repo's CSS Modules use
 * arbitrary camelCase class names (`.btn`, `.pill`, `.tab`, `.iconAction`, ...) that don't reliably
 * encode "this is a tappable element" in the selector text itself the way, say, `.opacity` or
 * `.color` property names are unambiguous in the opacity guard. So:
 *
 *   PHASE 1 (TSX) — walk every `.tsx` file with the real TypeScript compiler (already a repo
 *   dependency, same convention as `guard-no-literals-in-components.mjs`) and flag JSX elements that
 *   are semantically INTERACTIVE: `<button>`, `<a>`, `<input>`, a `<Link>` component (next/link), or
 *   any element carrying a literal `role="button"`. For each one, resolve its `className`:
 *     - a plain string literal → space-split tokens, looked up against `globals.css`
 *     - a `{...}` expression (the near-universal case here: `styles.foo`, `` `${styles.a} ${styles.b}` ``,
 *       `cx(styles.a, cond && styles.b)`) → every `identifier.member` token found in the expression's
 *       own text is a candidate, filtered down to identifiers this file actually imports from a
 *       `*.module.css` file (`import styles from './x.module.css'`).
 *   This builds a per-CSS-file set of "class names that are known, from real usage, to be applied to
 *   an interactive element."
 *
 *   PHASE 2 (CSS) — walk every `*.module.css` file + `globals.css` (same file set as the opacity
 *   guard), brace-depth-aware block split (same approach as `verify-contrast.mjs` /
 *   `guard-no-opacity-on-text.mjs`, so a rule nested in `@media`/`@keyframes` is walked correctly:
 *   `@keyframes` contents are skipped — transient/none tappable; `@media` contents are flattened in,
 *   same rationale as the opacity guard, since a floor violation that only reproduces at one
 *   breakpoint is still a real violation, arguably the mobile one that matters most). For every block
 *   whose selector's class token(s) intersect Phase 1's "known interactive" set for that file, check
 *   its declared `height`/`min-height`/`width`/`min-width`. A literal `NNpx` below 44, or
 *   `var(--touch-target-min)` (resolved from tokens.css, not hardcoded) below 44 — cannot happen today
 *   since the token itself is 44px, but resolved generically in case the token ever changes — fails.
 *   Any other unit (`%`, `rem`, `em`, `vh`, an unresolvable `var()`) is left alone: this is a static
 *   lint, not a layout engine, and guessing at those would risk false positives, same proportionality
 *   call the opacity guard's own header comment makes for what it does and doesn't attempt.
 *
 * WHAT THIS GUARD DELIBERATELY DOES NOT DO (documented limitation, not an oversight): it cannot see
 * an interactive element that has NO explicit height/width-family declaration at all (sized purely by
 * padding + line-height, which is this codebase's dominant real pattern and is usually fine) — it only
 * catches an EXPLICIT sub-floor declaration, exactly mirroring how `guard-no-opacity-on-text.mjs` only
 * catches an explicit sub-1 `opacity`/sub-1-alpha `color`, not "text that happens to render too
 * lightly for some other reason." It also cannot resolve a `className` built from anything other than
 * a string literal or an `identifier.member` token referencing an imported CSS Module (e.g. a fully
 * dynamic class name computed by a helper function) — those elements are silently skipped, not
 * flagged, to avoid false positives on a shape it cannot statically resolve.
 *
 * BASELINE (shrink-only, mirrors `NO_LITERALS_BASELINE.json` / `guard-no-literals-in-components.mjs`
 * exactly): `TOUCH_TARGET_BASELINE.json`, checked in alongside this script, is a one-time frozen
 * snapshot of every violation this scanner found in the repo the moment this guard was introduced.
 * Those are grandfathered (`[WARN-EXEMPT]`, never fail the build). Anything this scanner finds that is
 * NOT an exact fingerprint match in that file is a genuinely NEW sub-floor interactive element and
 * FAILS the build. The baseline must only ever SHRINK (delete an entry once the underlying rule is
 * actually fixed to meet the 44px floor) — never grow to silence a new violation; if the scanner is
 * flagging a false positive, fix the scanner's resolution/exclusion logic instead.
 *
 * Each baseline entry is `${relCssPath}::${selector}::${fingerprint(prop+': '+value)}` — same
 * per-instance, content-based fingerprinting rationale as the opacity guard (a selector that has BOTH
 * a bad height and a bad width gets two independent, individually-gradfatherable entries; unrelated
 * line-shifting edits elsewhere in the file never spuriously touch an existing entry since nothing is
 * line-number-keyed).
 *
 * THE CURRENT BASELINE, IN FULL (10 entries, frozen at this guard's introduction, T-57 R1b) — every
 * one is a REAL pre-existing sub-floor interactive element, not a scanner false positive (those are
 * excluded structurally via `isVisuallyHiddenRule`, below, not baselined):
 *   - `.flagToggle` (community.module.css) — `min-height: 36px` report-flag toggle button.
 *   - `.retryButton` (community.module.css, conversation.module.css, content.module.css,
 *     inbox.module.css — 4 separate files/selectors, same shared 36px pattern) — the "retry failed
 *     send/load" button used across several error states.
 *   - `.filterChip` (content.module.css, inbox.module.css) — content/inbox filter-pill chips.
 *   - `.reasonChip` (inbox.module.css) — CFE-hold reason chip in the Approval Inbox.
 *   - `.controlToggle` (inbox.module.css) — an inbox control toggle button.
 *   - `.toggle` (onboarding.module.css) — the 48×28px pill switch behind `<OutreachConsentToggle>`
 *     (`role="switch"`) and `<GdprConsentStep>`'s consent toggle; `height: 28px`.
 * ALL TEN are OUT OF SCOPE for T-57 R1b, which owns only `onboarding.module.css` (for the unrelated
 * A2 seedPulse fix), `verify-rendered-contrast.mjs`, and this new guard — not `community/*`,
 * `content/*`, or `inbox/*`, and not a redesign of `onboarding.module.css`'s `.toggle` visual (bumping
 * a pill switch from 28px to 44px tall is a real design change, not a trivial CSS tweak). FLAGGED for
 * a follow-up remediation wave to actually fix these nine `min-height`/one `height` values (real
 * WCAG 2.2 AA §2.5.8 Target Size gaps) — not fixed here. See TOUCH_TARGET_BASELINE.json for the exact
 * fingerprints; delete an entry there once its rule is genuinely fixed to meet the 44px floor.
 *
 * Exits 0 (all violations grandfathered or none found) / 1 (>=1 new violation) — wired into
 * `postbuild` as `npm run guard:touch-target`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
// Overridable ONLY for tests (tests/unit/guard-touch-target-script.test.ts), same convention as
// GUARD_NO_LITERALS_SRC_ROOT — lets the real script (and its real `typescript` resolution via this
// repo's own node_modules) run against small, disposable fixture trees.
const SRC_ROOT = process.env.GUARD_TOUCH_TARGET_SRC_ROOT
  ? path.resolve(process.env.GUARD_TOUCH_TARGET_SRC_ROOT)
  : path.join(REPO_ROOT, 'src');
const BASELINE_PATH = process.env.GUARD_TOUCH_TARGET_BASELINE_PATH
  ? path.resolve(process.env.GUARD_TOUCH_TARGET_BASELINE_PATH)
  : path.join(__dirname, 'TOUCH_TARGET_BASELINE.json');
const REPORT_ROOT = process.env.GUARD_TOUCH_TARGET_SRC_ROOT ? path.join(SRC_ROOT, '..') : REPO_ROOT;
const TOKENS_CSS_PATH = process.env.GUARD_TOUCH_TARGET_TOKENS_PATH
  ? path.resolve(process.env.GUARD_TOUCH_TARGET_TOKENS_PATH)
  : path.join(SRC_ROOT, 'app', 'tokens.css');
const GLOBALS_CSS_PATH = path.join(SRC_ROOT, 'app', 'globals.css');

/** First 10 hex chars of the sha256 of `text` — same disambiguation-not-security rationale as the
 *  opacity guard's own `fingerprint()`. */
function fingerprint(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 10);
}

// ---------------------------------------------------------------------------
// 0. The floor. Read from tokens.css rather than hardcoded, so this guard
//    never silently drifts from the real design-token value it enforces.
// ---------------------------------------------------------------------------
function readTouchTargetFloorPx() {
  if (!existsSync(TOKENS_CSS_PATH)) return 44; // fallback if tokens.css is unreachable (test fixtures)
  const css = readFileSync(TOKENS_CSS_PATH, 'utf8');
  const m = css.match(/--touch-target-min:\s*([\d.]+)px/);
  return m ? parseFloat(m[1]) : 44;
}
const FLOOR_PX = readTouchTargetFloorPx();

// ---------------------------------------------------------------------------
// 1. File discovery.
// ---------------------------------------------------------------------------
function findFiles(dir, predicate) {
  const out = [];
  if (!existsSync(dir)) return out;
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

const tsxFiles = findFiles(SRC_ROOT, (name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'));
const moduleCssFiles = findFiles(SRC_ROOT, (name) => name.endsWith('.module.css'));

// ---------------------------------------------------------------------------
// 2. PHASE 1 — TSX: find interactive elements, resolve their className(s)
//    to (cssAbsPath, classToken) candidates.
// ---------------------------------------------------------------------------
const INTRINSIC_INTERACTIVE_TAGS = new Set(['button', 'a', 'input']);
const COMPONENT_INTERACTIVE_TAGS = new Set(['Link']); // next/link — the canonical <a> stand-in here.

/** `import X from './y.module.css'` → { X: absPathToY }. Regex over raw text (not the AST) is
 *  sufficient and matches this repo's exclusively-static import convention for CSS Modules. */
function findCssModuleImportMap(tsxSrc, tsxAbsPath) {
  const map = {};
  const re = /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g;
  let m;
  while ((m = re.exec(tsxSrc))) {
    const [, ident, importPath] = m;
    const resolved = path.resolve(path.dirname(tsxAbsPath), importPath);
    map[ident] = resolved;
  }
  return map;
}

function isInteractiveJsxElement(node) {
  const tagName = node.tagName.getText();
  if (INTRINSIC_INTERACTIVE_TAGS.has(tagName) || COMPONENT_INTERACTIVE_TAGS.has(tagName)) return true;
  for (const attr of node.attributes.properties) {
    if (
      ts.isJsxAttribute(attr) &&
      attr.name.getText() === 'role' &&
      attr.initializer &&
      ts.isStringLiteral(attr.initializer) &&
      attr.initializer.text === 'button'
    ) {
      return true;
    }
  }
  return false;
}

/** @returns {Array<{ cssAbsPath: string, className: string } | { cssAbsPath: 'GLOBALS', className: string }>} */
function resolveClassNameCandidates(node, cssModuleImportMap) {
  const classAttr = node.attributes.properties.find(
    (attr) => ts.isJsxAttribute(attr) && (attr.name.getText() === 'className' || attr.name.getText() === 'class')
  );
  if (!classAttr || !classAttr.initializer) return [];

  if (ts.isStringLiteral(classAttr.initializer)) {
    return classAttr.initializer.text
      .split(/\s+/)
      .filter(Boolean)
      .map((className) => ({ cssAbsPath: GLOBALS_CSS_PATH, className }));
  }

  if (ts.isJsxExpression(classAttr.initializer) && classAttr.initializer.expression) {
    const exprText = classAttr.initializer.expression.getText();
    const out = [];
    const re = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b/g;
    let m;
    while ((m = re.exec(exprText))) {
      const [, ident, member] = m;
      if (cssModuleImportMap[ident]) {
        out.push({ cssAbsPath: cssModuleImportMap[ident], className: member });
      }
    }
    return out;
  }

  return [];
}

/**
 * @returns {{ interactiveClassesByFile: Map<string, Set<string>>, unresolvedCount: number, interactiveElementCount: number }}
 */
function scanTsxForInteractiveClasses(files) {
  const interactiveClassesByFile = new Map();
  let unresolvedCount = 0;
  let interactiveElementCount = 0;

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const cssModuleImportMap = findCssModuleImportMap(src, file);
    const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (isInteractiveJsxElement(node)) {
          interactiveElementCount++;
          const candidates = resolveClassNameCandidates(node, cssModuleImportMap);
          if (candidates.length === 0) {
            unresolvedCount++;
          } else {
            for (const { cssAbsPath, className } of candidates) {
              if (!interactiveClassesByFile.has(cssAbsPath)) interactiveClassesByFile.set(cssAbsPath, new Set());
              interactiveClassesByFile.get(cssAbsPath).add(className);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  return { interactiveClassesByFile, unresolvedCount, interactiveElementCount };
}

// ---------------------------------------------------------------------------
// 3. PHASE 2 — CSS: brace-depth-aware block split (same approach as
//    guard-no-opacity-on-text.mjs / verify-contrast.mjs).
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
      } else if (selector.startsWith('@media') || selector.startsWith('@supports')) {
        walk(body, inKeyframes);
      } else if (selector.length > 0 && !selector.startsWith('@')) {
        blocks.push({ selector, body, inKeyframes });
      }
      k = end;
    }
  }

  walk(css, false);
  return blocks;
}

/** Does `selector` (possibly comma-separated, possibly compound like `.btn:hover` or `.wrapper .btn`)
 *  target `className` anywhere in one of its simple selectors' class list? */
function selectorTargetsClass(selector, className) {
  const needle = `.${className}`;
  for (const commaPart of selector.split(',')) {
    // Split the simple selector on whitespace/combinators into compound-selector tokens, then check
    // each compound token's dot-segments — `.btn:hover` and `.btn.active` both contain `.btn`, but
    // `.btnGroup` must NOT match `className = 'btn'` (that's why we require an exact `.btn` token
    // boundary, not a substring match).
    const compoundTokens = commaPart.trim().split(/[\s>+~]+/).filter(Boolean);
    for (const token of compoundTokens) {
      const dotSegments = token.split('.').slice(1); // drop leading tag/empty segment before first '.'
      for (const seg of dotSegments) {
        const bare = seg.split(':')[0]; // strip :hover/::after etc.
        if (bare === className && `.${bare}` === needle) return true;
      }
    }
  }
  return false;
}

const DIMENSION_PROPS = ['height', 'min-height', 'width', 'min-width'];

/**
 * The standard "visually-hidden but present for assistive tech / a native-control proxy" idiom
 * (`position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0);` — this
 * repo's `.srOnly` and `.hiddenFileInput`, e.g. onboarding.module.css:501, community.module.css:324).
 * A rule shaped like this is DELIBERATELY not a real tap target — either it's sr-only text with no
 * interaction at all, or (the file-input case) the actual clickable surface is a separate, properly
 * sized visible `<label>`/button that proxies the click, not the 1x1 input itself. Flagging this
 * would be a false positive of the static heuristic, not a real violation — per this guard's own
 * documented policy ("if the scanner is flagging a false positive, fix the SCANNER's exclusion rules
 * instead of the baseline"), it is excluded here rather than grandfathered in the baseline JSON.
 */
function isVisuallyHiddenRule(body) {
  const hasClip = /\bclip(?:-path)?\s*:\s*(?:rect\(\s*0[\s,]+0[\s,]+0[\s,]+0\s*\)|inset\(\s*50%)/i.test(body);
  const hasOverflowHidden = /\boverflow\s*:\s*hidden\b/i.test(body);
  const hasAbsolute = /\bposition\s*:\s*absolute\b/i.test(body);
  return hasClip && hasOverflowHidden && hasAbsolute;
}

/** Resolves a CSS length value to a px number, or null if not statically resolvable (a unit other
 *  than px, or an unresolvable var()). `var(--touch-target-min)` resolves via FLOOR_PX (read from
 *  tokens.css, not hardcoded — see readTouchTargetFloorPx). */
function resolvePxValue(value) {
  const varMatch = value.match(/^var\(\s*--touch-target-min\s*(?:,.*)?\)$/);
  if (varMatch) return FLOOR_PX;
  const pxMatch = value.match(/^(-?[\d.]+)px$/);
  if (pxMatch) return parseFloat(pxMatch[1]);
  return null; // %, rem, em, vh, other var(), calc(), etc. — not statically comparable here.
}

/** @returns {Array<{ prop: string, value: string, px: number }>} */
function findSubFloorDeclarations(body) {
  const out = [];
  for (const raw of body.split(';')) {
    const decl = raw.trim();
    if (!decl) continue;
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!DIMENSION_PROPS.includes(prop)) continue;
    const px = resolvePxValue(value);
    if (px !== null && px < FLOOR_PX) out.push({ prop, value, px });
  }
  return out;
}

function checkCssFile(absPath, relPath, interactiveClasses) {
  if (!interactiveClasses || interactiveClasses.size === 0) return { reports: [], checkedRules: 0, skippedHidden: 0 };
  const css = stripCssComments(readFileSync(absPath, 'utf8'));
  const blocks = parseCssBlocks(css);
  const reports = [];
  let checkedRules = 0;
  let skippedHidden = 0;

  for (const { selector, body, inKeyframes } of blocks) {
    if (inKeyframes) continue; // transient animation frame, not a static box size.
    const isInteractiveRule = [...interactiveClasses].some((cn) => selectorTargetsClass(selector, cn));
    if (!isInteractiveRule) continue;
    if (isVisuallyHiddenRule(body)) {
      skippedHidden++;
      continue; // sr-only / hidden-proxy-input idiom — not a real tap target, see isVisuallyHiddenRule.
    }
    checkedRules++;
    for (const v of findSubFloorDeclarations(body)) {
      const decl = `${v.prop}: ${v.value}`;
      reports.push({
        relPath,
        selector,
        prop: v.prop,
        value: v.value,
        px: v.px,
        exemptionKey: `${relPath}::${selector}::${fingerprint(decl)}`,
      });
    }
  }
  return { reports, checkedRules, skippedHidden };
}

// ---------------------------------------------------------------------------
// 4. Baseline (shrink-only — see header comment).
// ---------------------------------------------------------------------------
function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error(`guard:touch-target — ${BASELINE_PATH} must be a JSON array of fingerprint strings.`);
    process.exit(1);
  }
  return new Set(parsed);
}

// ---------------------------------------------------------------------------
// 5. Run.
// ---------------------------------------------------------------------------
function main() {
  console.log('guard:touch-target — T-57 R1b (MINOR-A7, uiux §6.1 "44px touch-target guard").\n');
  console.log(`Floor: ${FLOOR_PX}px (read from tokens.css --touch-target-min).\n`);

  const baseline = loadBaseline();
  const { interactiveClassesByFile, unresolvedCount, interactiveElementCount } =
    scanTsxForInteractiveClasses(tsxFiles);

  const allCssFiles = [...moduleCssFiles, GLOBALS_CSS_PATH];
  const violations = [];
  let checkedRules = 0;
  let skippedHiddenTotal = 0;
  for (const file of allCssFiles) {
    const relPath = path.relative(REPORT_ROOT, file).split(path.sep).join('/');
    const { reports, checkedRules: n, skippedHidden } = checkCssFile(file, relPath, interactiveClassesByFile.get(file));
    checkedRules += n;
    skippedHiddenTotal += skippedHidden;
    violations.push(...reports);
  }

  console.log(
    `Scanned ${tsxFiles.length} .tsx file(s): ${interactiveElementCount} interactive element(s) found ` +
      `(${unresolvedCount} with an unresolvable className, skipped — see header comment).`
  );
  console.log(
    `Scanned ${allCssFiles.length} CSS file(s), ${checkedRules} interactive-linked rule(s) checked ` +
      `(${skippedHiddenTotal} visually-hidden sr-only/proxy-input rule(s) excluded — see isVisuallyHiddenRule).`
  );

  const grandfathered = violations.filter((v) => baseline.has(v.exemptionKey));
  const fresh = violations.filter((v) => !baseline.has(v.exemptionKey));

  if (grandfathered.length > 0) {
    console.log(`\n${grandfathered.length} pre-existing sub-floor rule(s) grandfathered via TOUCH_TARGET_BASELINE.json — not failing the build:`);
    for (const v of grandfathered) {
      console.log(`  [WARN-EXEMPT] ${v.relPath} — "${v.selector}" sets ${v.prop}: ${v.value} (< ${FLOOR_PX}px floor).`);
    }
  }

  if (fresh.length > 0) {
    console.error(`\nFAILED — ${fresh.length} NEW interactive element(s) below the ${FLOOR_PX}px touch-target floor:`);
    for (const v of fresh) {
      console.error(`  - ${v.relPath} — "${v.selector}" sets ${v.prop}: ${v.value} (< ${FLOOR_PX}px floor).`);
    }
    console.error(
      '\nUse `min-height: var(--touch-target-min)` / `min-width: var(--touch-target-min)` (tokens.css) ' +
        'on interactive elements, or size them to at least the floor. Do NOT add these to ' +
        'TOUCH_TARGET_BASELINE.json — that baseline is frozen pre-existing debt, not an escape hatch for new code.'
    );
    process.exit(1);
  }

  console.log('\nguard:touch-target: no NEW sub-floor interactive elements found. OK.');
  process.exit(0);
}

main();
