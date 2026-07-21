#!/usr/bin/env node
/**
 * T-53 QC#1 fixer (master-spec §17.5; uiux §6.2 "String catalog: every user-facing string
 * externalized from day one (no literals in components — A LINT RULE)") — this is that lint rule.
 *
 * WHAT IT DOES: parses every `.tsx` file under `src/` with the real TypeScript compiler API (this
 * repo already depends on `typescript` for `tsc --noEmit`; no new dependency) and flags these
 * shapes of hardcoded, user-facing string literal that bypass the i18n catalog (`t()` /
 * `src/lib/i18n/catalog.ts`):
 *
 *   (1) JSX TEXT — a raw text child of an element (`<p>Hello</p>`) that contains real, "wordy" text
 *       (at least two consecutive letters, in EITHER script — Spanish diacritics included), not
 *       just punctuation/whitespace/a lone symbol/digits.
 *   (2) CONTENT ATTRIBUTES — a plain string-literal value (never a `{…}` expression, which is
 *       already exempt — `placeholder={t('x')}` is fine) on one of a small, curated set of
 *       user-facing attributes: `placeholder`, `alt`, `title`, `aria-label`.
 *   (3) A bare string-literal JSX EXPRESSION CHILD (`<span>{'Hello'}</span>`) — the same violation
 *       as (1), just spelled with braces. `{t('x')}` / `{someVar}` / `{fn('x')}` are NOT flagged —
 *       only a DIRECT string literal as the entire expression is (i.e. `expr.expression` is itself
 *       a `StringLiteral`, not a call/identifier/etc).
 *   (4) T-57 BLOCKER-B5 fix — TERNARY STRING-LITERAL BRANCHES (`{cond ? 'A' : 'B'}`): a
 *       ConditionalExpression sitting DIRECTLY as a JsxExpression's `.expression` (this covers both
 *       a JSX child, `{cond ? 'A' : 'B'}`, and a content-attribute value, `aria-label={cond ? 'A' :
 *       'B'}` — both are the same `JsxExpression` node shape in the TS AST) whose `whenTrue`/
 *       `whenFalse` branch (parens-unwrapped) is a plain string literal. Deliberately scoped to
 *       DIRECT JsxExpression children — a ternary buried inside a template-literal substitution
 *       (`` className={`btn ${cond ? 'a' : 'b'}`} ``, a technical class-name toggle, not copy) sits
 *       one level deeper (inside a `TemplateExpression`/`TemplateSpan`) and is correctly NOT matched
 *       by this shape, avoiding a className-toggle false-positive.
 *   (5) T-57 BLOCKER-B5 fix — TEMPLATE-LITERAL CONTENT ATTRIBUTES: the previous scanner only ever
 *       looked at a content attribute (`placeholder`/`alt`/`title`/`aria-label`) written as a plain
 *       `StringLiteral` (`aria-label="Foo"`); it had no visibility at all into the exact same
 *       attribute written as a template literal (`` aria-label={`Foo ${name}`} `` or even a
 *       substitution-free `` aria-label={`Foo`} ``) — a real, live blind spot (BLOCKER-B5). This
 *       shape inspects the STATIC text of a template literal initializer on a content attribute (the
 *       head + every span's literal text, i.e. everything that ISN'T a `${…}` substitution) for real
 *       wordy prose.
 *   (6) T-57 BLOCKER-B5 fix — STRING LITERALS PASSED TO SETSTATE-SHAPED CALLS: a `CallExpression`
 *       whose callee is a bare identifier matching `/^set[A-Z]/` (the `const [x, setX] =
 *       useState(...)` naming convention used throughout this codebase) with a direct `StringLiteral`
 *       argument that is both wordy AND contains at least one space — e.g. `setLoginError('Invalid
 *       email or password.')`. The space requirement is deliberate: single-token setState arguments
 *       in this codebase are overwhelmingly internal state/enum keys (`setMode('register')`,
 *       `setFilter('ALL')`), never real prose — real user-facing sentences passed to a setter
 *       virtually always contain a space. Requiring one keeps this shape from false-positiving on
 *       every mode/state-key setter in the app while still catching the real, multi-word error/toast
 *       strings BLOCKER-B5/B6 exist to surface (an enum-key false negative here is an acceptable
 *       trade — a human/QC pass, or a future tightening, still catches it; a wave of enum-key false
 *       positives would make the guard's real signal unusable).
 *
 * BASELINE ALLOWLIST (mirrors `guard-no-opacity-on-text.mjs`'s `KNOWN_PRE_EXISTING_EXEMPTIONS`
 * pattern exactly): full pre-existing component-string coverage across this whole app is a large,
 * separate body of work (tracked as follow-up T-R32 — 100% ES component-string coverage of deep
 * conditional copy: inbox per-filter, subscription flows, etc.) and is explicitly OUT OF SCOPE for
 * this fixer. `NO_LITERALS_BASELINE.json` (checked in alongside this script) is a ONE-TIME, frozen
 * snapshot of every violation this scanner found in the repo at the moment this guard was
 * introduced — those are grandfathered (printed as `[WARN-EXEMPT]`, never fail the build). Anything
 * this scanner finds that is NOT an exact match in that baseline is a genuinely NEW literal and
 * FAILS the build.
 *
 * THE BASELINE MUST ONLY SHRINK, NEVER GROW:
 *   - Fixing a grandfathered literal (routing it through `t()`)? Delete its entry from the baseline
 *     file — do not leave stale entries.
 *   - Writing new component code? It must ship through the catalog from the start — do NOT add a
 *     new entry to the baseline to silence this guard. That defeats the entire point of the rule
 *     (uiux §6.2's "no literals in components" AC). If the scanner is flagging a false positive
 *     (something that is genuinely not user-facing text), fix the SCANNER's exclusion rules instead
 *     of the baseline.
 *
 * Each baseline entry is keyed by `relPath::kind::occurrenceIndex::snippet` (content-based, not
 * line-based, so unrelated line-shifting edits elsewhere in the file never spuriously "un-exempt" an
 * already-grandfathered literal — same rationale `guard-no-opacity-on-text.mjs`'s own fingerprint
 * gives for hashing the declaration text rather than using a line number).
 *
 * Exits 0 (all violations grandfathered or none found) / 1 (>=1 genuinely new violation) — wired
 * into `postbuild` as `npm run guard:no-literals-in-components`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
// Overridable ONLY for tests (tests/unit/guard-no-literals-in-components-script.test.ts) so the
// REAL script file — and therefore its real `import ts from 'typescript'` resolution via this
// repo's own node_modules — can be exercised against small, disposable fixture trees that live
// anywhere on disk, without copying the script itself out of the repo (unlike this repo's other
// guard scripts' own scratch-copy convention, copying THIS script elsewhere would break the
// `typescript` package resolution its scan depends on).
const SRC_ROOT = process.env.GUARD_NO_LITERALS_SRC_ROOT
  ? path.resolve(process.env.GUARD_NO_LITERALS_SRC_ROOT)
  : path.join(REPO_ROOT, 'src');
const BASELINE_PATH = process.env.GUARD_NO_LITERALS_BASELINE_PATH
  ? path.resolve(process.env.GUARD_NO_LITERALS_BASELINE_PATH)
  : path.join(__dirname, 'NO_LITERALS_BASELINE.json');
// relPath fingerprints/report lines are relative to THIS (test fixture root's parent), not the
// real REPO_ROOT, when overridden — so a fixture's own reported paths read naturally.
const REPORT_ROOT = process.env.GUARD_NO_LITERALS_SRC_ROOT ? path.join(SRC_ROOT, '..') : REPO_ROOT;

// ─────────────────────────────────────────────────────────────────────────────
// File discovery — every .tsx under src/, excluding tests/stories/build output.
// ─────────────────────────────────────────────────────────────────────────────
function findTsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...findTsxFiles(full));
    } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx') && !entry.endsWith('.stories.tsx')) {
      out.push(full);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The "is this real, translatable text" heuristic — shared by all three shapes.
// ─────────────────────────────────────────────────────────────────────────────
/** At least two consecutive letters (either Latin-with-diacritics or any other Unicode letter) —
 *  i.e. looks like a WORD, not a bare symbol/number/whitespace run. Deliberately permissive of
 *  Spanish (á é í ó ú ñ ü ¿ ¡ etc. all pass the Unicode letter class) so ES literals are caught
 *  exactly like EN ones — no language gets a free pass. */
const WORDY_RE = /[^\s\d\p{P}]{2,}/u;

/** Strings that look like real text per WORDY_RE but are still not user-facing prose — technical
 *  tokens this scanner should not waste a violation (or a baseline slot) on. Deliberately narrow: a
 *  false negative here just means a genuinely bad literal slips through (caught by human review /
 *  future tightening); a false positive would wrongly fail the build on non-issues. */
function isTechnicalToken(trimmed) {
  if (trimmed.length === 0) return true;
  if (/^[\d\s.,:;/\\%+\-*()#_|<>=~^$@!?[\]{}'"`&]*$/.test(trimmed)) return true; // punctuation/digits only
  if (/^[A-Z0-9_-]+$/.test(trimmed) && trimmed.length <= 6) return true; // short CONST-like tokens (e.g. "OK", "N/A", "USD")
  if (/^https?:\/\//.test(trimmed)) return true; // URL
  if (/^\/[\w/:-]*$/.test(trimmed)) return true; // a path, e.g. "/api/settings/locale"
  if (/^[\w.-]+@[\w.-]+$/.test(trimmed)) return true; // email-shaped
  return false;
}

function isWordyUserFacingText(raw) {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return false;
  if (!WORDY_RE.test(trimmed)) return false;
  if (isTechnicalToken(trimmed)) return false;
  return true;
}

/** Truncated, whitespace-collapsed snippet for reporting + fingerprinting (never the full raw text
 *  — keeps report lines readable and baseline entries stable against incidental whitespace). */
function snippetOf(raw) {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
}

// A small, curated, user-facing-content attribute allowlist — deliberately NOT every string-valued
// JSX attribute (that would flag className/id/data-testid/href/etc, none of which are translatable
// copy). aria-label is legitimately user-facing (assistive tech reads it aloud). alt/title/
// placeholder are the standard HTML user-facing-string attributes.
const CONTENT_ATTRS = new Set(['placeholder', 'alt', 'title', 'aria-label']);

// ─────────────────────────────────────────────────────────────────────────────
// The scanner — one file in, its violations out.
// ─────────────────────────────────────────────────────────────────────────────
/** Strips one layer of `ParenthesizedExpression` wrapping (`('A')` → `'A'`) — a ternary branch is
 *  sometimes deliberately parenthesized for readability; the literal underneath is what matters. */
function unwrapParens(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** The concatenated STATIC text of a template literal (`NoSubstitutionTemplateLiteral` or
 *  `TemplateExpression`) — every `${…}` substitution is dropped entirely (dynamic, unreviewable
 *  here), leaving only the literal text authored around them. A space joins adjacent static spans
 *  so `` `Hello ${name}!` ``'s "Hello" and "!" don't accidentally fuse into "Hello!" and dodge the
 *  wordy-text check by losing their natural word boundary. */
function staticTemplateText(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
  }
  return '';
}

function scanFile(filePath) {
  const relPath = path.relative(REPORT_ROOT, filePath).split(path.sep).join('/');
  const text = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const raw = []; // { kind, snippet, line }

  function lineOf(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      const value = node.getText(sourceFile);
      if (isWordyUserFacingText(value)) {
        raw.push({ kind: 'jsx-text', snippet: snippetOf(value), line: lineOf(node) });
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (CONTENT_ATTRS.has(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          const value = node.initializer.text;
          if (isWordyUserFacingText(value)) {
            raw.push({ kind: `attr:${name}`, snippet: snippetOf(value), line: lineOf(node) });
          }
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression &&
          (ts.isTemplateExpression(node.initializer.expression) ||
            ts.isNoSubstitutionTemplateLiteral(node.initializer.expression))
        ) {
          // Shape (5) — a template-literal content attribute, e.g. `aria-label={`Foo ${name}`}`.
          // Handled here (not the generic JsxExpression branch below) because this needs the
          // attribute NAME to stay content-attr-scoped, exactly like the plain-string-literal case
          // just above — a template literal on `className`/`href`/etc is still not copy.
          const value = staticTemplateText(node.initializer.expression);
          if (isWordyUserFacingText(value)) {
            raw.push({ kind: `attr-template:${name}`, snippet: snippetOf(value), line: lineOf(node) });
          }
        }
      }
    } else if (ts.isJsxExpression(node)) {
      const expr = node.expression;
      if (expr && ts.isStringLiteral(expr) && isWordyUserFacingText(expr.text)) {
        raw.push({ kind: 'jsx-expr-literal', snippet: snippetOf(expr.text), line: lineOf(node) });
      } else if (expr && ts.isConditionalExpression(expr)) {
        // Shape (4) — ternary string-literal branches, `{cond ? 'A' : 'B'}`. Covers both a JSX
        // CHILD and a content-attribute value (`aria-label={cond ? 'A' : 'B'}` is the same
        // JsxExpression node shape) — but when this JsxExpression IS an attribute initializer, it's
        // only in-scope when that attribute is one of CONTENT_ATTRS, exactly like (2)/(5) above. A
        // JSX child ternary is unconditionally in-scope (no attribute name to check) because
        // rendering straight into JSX content is copy by construction. Without this attribute-name
        // guard, a ternary picking between two ARIA-vocabulary tokens on a STATE attribute —
        // `aria-current={active ? 'page' : undefined}` is the exact real-world case this repo hit —
        // would false-positive: `'page'` passes the wordy-text heuristic but is a fixed WAI-ARIA
        // enum value, not authored prose, same category as `className`'s own literal class tokens.
        const parent = node.parent;
        const isAttributeValue = ts.isJsxAttribute(parent) && parent.initializer === node;
        const inScope = !isAttributeValue || CONTENT_ATTRS.has(parent.name.getText(sourceFile));
        if (inScope) {
          for (const branch of [expr.whenTrue, expr.whenFalse]) {
            const unwrapped = unwrapParens(branch);
            if (ts.isStringLiteral(unwrapped) && isWordyUserFacingText(unwrapped.text)) {
              raw.push({ kind: 'jsx-ternary-branch', snippet: snippetOf(unwrapped.text), line: lineOf(node) });
            }
          }
        }
      }
    } else if (ts.isCallExpression(node)) {
      // Shape (6) — a string-literal argument to a setState-shaped call, e.g.
      // `setLoginError('Invalid email or password.')`. See this file's header for the
      // "must contain a space" rationale (excludes single-token state/enum-key setters).
      const callee = node.expression;
      if (ts.isIdentifier(callee) && /^set[A-Z]/.test(callee.text)) {
        for (const arg of node.arguments) {
          if (ts.isStringLiteral(arg) && arg.text.includes(' ') && isWordyUserFacingText(arg.text)) {
            raw.push({ kind: 'setstate-literal', snippet: snippetOf(arg.text), line: lineOf(node) });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  // Stable, content-based, per-file occurrence index (mirrors guard-no-opacity-on-text.mjs's own
  // "each must be individually grandfathered" fingerprint rationale) — disambiguates the SAME
  // literal appearing more than once in one file without relying on a line number.
  const seenCount = new Map();
  return raw.map((v) => {
    const dedupeKey = `${v.kind}::${v.snippet}`;
    const occurrenceIndex = seenCount.get(dedupeKey) ?? 0;
    seenCount.set(dedupeKey, occurrenceIndex + 1);
    const fingerprint = `${relPath}::${v.kind}::${occurrenceIndex}::${v.snippet}`;
    return { ...v, relPath, fingerprint };
  });
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error(`guard:no-literals-in-components — ${BASELINE_PATH} must be a JSON array of fingerprint strings.`);
    process.exit(1);
  }
  return new Set(parsed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Run.
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  console.log('guard:no-literals-in-components — T-53 (uiux §6.2 "no literals in components — a lint rule").\n');

  const baseline = loadBaseline();
  const files = findTsxFiles(SRC_ROOT);
  const violations = [];
  for (const file of files) violations.push(...scanFile(file));
  console.log(`Scanned ${files.length} .tsx file(s) under src/.`);

  const grandfathered = violations.filter((v) => baseline.has(v.fingerprint));
  const fresh = violations.filter((v) => !baseline.has(v.fingerprint));

  if (grandfathered.length > 0) {
    console.log(
      `\n${grandfathered.length} pre-existing literal(s) grandfathered via NO_LITERALS_BASELINE.json (tracked for T-R32) — not failing the build:`
    );
    for (const v of grandfathered) {
      console.log(`  [WARN-EXEMPT] ${v.relPath}:${v.line} (${v.kind}) "${v.snippet}"`);
    }
  }

  if (fresh.length > 0) {
    console.error(`\nFAILED — ${fresh.length} NEW hardcoded user-facing literal(s) found (not in the baseline):`);
    for (const v of fresh) {
      console.error(`  - ${v.relPath}:${v.line} (${v.kind}) "${v.snippet}"`);
    }
    console.error(
      '\nRoute each of these through the i18n catalog (src/lib/i18n/catalog.ts / messages/en.json + es.json) ' +
        "via t('namespaced.key') instead of a hardcoded literal. Do NOT add these to NO_LITERALS_BASELINE.json " +
        '— that baseline is frozen pre-existing debt (T-R32), not an escape hatch for new code.'
    );
    process.exit(1);
  }

  console.log('\nguard:no-literals-in-components: no NEW hardcoded literals found. OK.');
  process.exit(0);
}

main();
