#!/usr/bin/env node
/**
 * T-57 RE-GATE ROUND-4 hardening, DIMENSION B (i18n; master-spec §17.5; uiux §6.2/§0.5). The
 * convergence guard for the OTHER pervasive pre-existing class the re-gate kept re-discovering
 * (B [aa390f9b] round-4): a rendered English/backend-token i18n LEAK that lives OUTSIDE
 * `guard-no-literals-in-components.mjs`'s reach — hardcoded English spliced into a state/notice
 * chain (`.push(\`…\`)` / `setSyncFailure(\`…\`)`, a template literal, which that guard's
 * StringLiteral-only setState shape can't see), and a raw backend MACHINE TOKEN
 * (`{x.reason}`/`{x.kind}`/`{x.held_reason}`/`{x.status}`/`{x.code}`) rendered as visible text
 * without going through a display-mapper (`errorDisplay`/`errorStateLabel`/`reasonDisplay`/`t`). A
 * Spanish rep sees English or a raw `cfe_held`/`one_or_more_pieces_blocked_by_…` token. Same shape
 * as the sibling guards: real TypeScript-compiler AST walk of every `.tsx`, external shrink-only
 * JSON baseline.
 *
 * WHAT IT DOES — three heuristic shapes, each tuned to the KNOWN class (the round-4 leaks + their
 * siblings) while staying quiet on legit uses (this is a ratchet; the RG4 manual sweep is primary):
 *
 *   (a) HARDCODED ENGLISH IN A STATE/NOTICE SINK — a wordy, MULTI-WORD (contains a space) string- or
 *       template-literal argument to a call whose callee is either a `set[A-Z]…` state setter
 *       (`setSyncFailure(\`…\`)`) or a `.push(…)` (`notices.push(\`…\`)`). This is the exact gap
 *       `guard-no-literals-in-components.mjs` leaves: its setState shape only inspects a plain
 *       `StringLiteral` argument, never a TEMPLATE literal and never `.push`. The multi-word
 *       requirement excludes single-token state/enum keys (`setMode('login')`), same rationale that
 *       guard's own header gives.
 *   (b) RAW MACHINE TOKEN RENDERED AS JSX CONTENT — a JsxExpression CHILD (not an attribute) that is
 *       a property access ending in one of the backend machine-token fields
 *       (`reason`/`kind`/`held_reason`/`heldReason`/`status`/`code`), e.g. `{kit.held_reason}`. Also
 *       matches such a field inside a template-literal child (`{\`… ${x.kind} …\`}`). A render that
 *       goes through a mapper (`{reasonDisplay(t, x.reason)}`, a CallExpression) is NOT matched — the
 *       mapper is exactly the fix.
 *   (c) RAW MACHINE TOKEN INTERPOLATED INTO t() — a `t(key, { … })` / `translate(key, { … })` whose
 *       vars object has a property whose VALUE is a raw machine-token property access
 *       (`t('…', { reason: state.reason })` — the pre-fix `TimeLapseShare` shape). A value that is a
 *       CallExpression (`{ currentState: errorStateLabel(t, x) }`, `{ reason: reasonDisplay(t, r) }`)
 *       is NOT matched — passing the token THROUGH a mapper is the correct pattern.
 *   (d) T-57 RG5-FINAL — HUMANIZED RAW TOKEN RENDERED AS JSX CONTENT: a JsxExpression CHILD (not an
 *       attribute — same scoping as shape (b)) whose expression is (or, for a chained call like
 *       `.replace(/_/g, ' ').toLowerCase()`, CONTAINS anywhere in its callee chain) a call to
 *       `.replace(...)`/`.replaceAll(...)` whose pattern arg is specifically an underscore
 *       (`'_'` or a bare `/_/` regex, any flags) and whose replacement arg is a single space (`' '`)
 *       — i.e. the "de-snake-case a backend enum token" idiom (`{e.type.replaceAll('_', ' ')}`,
 *       CalendarStrip's pre-fix shape). This merely humanizes the token's PUNCTUATION, never its
 *       LANGUAGE — a Spanish rep still sees the raw English word ("opportunity night"), so it is the
 *       same class of leak as (b)/(c), just one AST layer removed (the token is read through a
 *       `.replace*()` call, not a bare property access, which is why TOKEN_FIELDS/shape (b) alone
 *       cannot see it). Scoped deliberately narrow to the underscore→space pattern/replacement pair
 *       so it never flags an unrelated `.replace()` call (digit-stripping, prefix-stripping, router
 *       navigation, etc.) — see `isUnderscoreHumanizeCall` below.
 *
 * NOTE ON `.status`/tabular tokens: shape (b) will flag a raw `{x.status}` render (a raw enum token
 * a rep shouldn't see untranslated) — several such long-tail sites (team-calendar/cockpit status
 * columns) exist and are baselined for burn-down, not fixed this pass. That is the intended
 * behavior: enumerate the whole class, ratchet it, fix the P0 subset, track the rest.
 *
 * T-57 RG5-FINAL also added `type` to `TOKEN_FIELDS` (shape (b)/(c) now also catch a BARE raw
 * `{x.type}` render, not just the humanized-via-`.replace*()` shape (d) above) — verified LOW
 * false-positive: a fresh sweep of every `.tsx` under `src/` for a raw `{…type}` JSX-child render
 * found zero legitimate current hits (the one `.type` usage found, `me/notifications/page.tsx`'s
 * `key={\`${item.type}-${idx}\`}`, is a `key` ATTRIBUTE, already out of shape (b)'s scope).
 *
 * BASELINE (shrink-only — identical policy to the sibling guards' baselines):
 * `RENDERED_I18N_LEAK_BASELINE.json`, checked in beside this script, is the one-time frozen snapshot
 * of every leak found at introduction (RG4). Grandfathered entries print `[WARN-EXEMPT]` and never
 * fail the build; anything NOT an exact fingerprint match is a NEW leak and FAILS. The baseline may
 * ONLY SHRINK — route the site through the catalog / a display-mapper and delete its entry; never add
 * one to silence new code (if it's a false positive, fix this scanner's heuristic instead).
 *
 * Each entry is `relPath::kind::occurrenceIndex::snippet` (content-based, not line-based). Exits
 * 0 / 1. Wired into `postbuild` as `npm run guard:rendered-i18n-leak`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SRC_ROOT = process.env.GUARD_RENDERED_I18N_LEAK_SRC_ROOT
  ? path.resolve(process.env.GUARD_RENDERED_I18N_LEAK_SRC_ROOT)
  : path.join(REPO_ROOT, 'src');
const BASELINE_PATH = process.env.GUARD_RENDERED_I18N_LEAK_BASELINE_PATH
  ? path.resolve(process.env.GUARD_RENDERED_I18N_LEAK_BASELINE_PATH)
  : path.join(__dirname, 'RENDERED_I18N_LEAK_BASELINE.json');
const REPORT_ROOT = process.env.GUARD_RENDERED_I18N_LEAK_SRC_ROOT ? path.join(SRC_ROOT, '..') : REPO_ROOT;

// The backend machine-token field names a raw render of which is a leak (they carry an untranslated
// enum/reason token straight from a route/service to the screen). NOT `message` (that's free English
// prose — the `guard-no-literals`/manual-sweep concern — and legit localized `.message` values also
// exist), NOT `name`/`body` (real content).
//
// T-57 RG7 — BLIND-SPOT (a) CLOSED: the field set is no longer a bare exact list. It now also matches
// by PATTERN — any property name ENDING in `Status`/`State`/`_reason`/`_status` — so the whole
// enum-token class is enumerable, not just the handful of literal names a prior pass happened to list.
// This is what lets the re-gate's surviving leaks (`activationStatus`, `sponsorshipState`,
// `myAttendanceState`, `publish_hold_reason`, `held_reason`, …) all be caught by ONE rule rather than
// slipping through because their exact spelling wasn't in the set. `state`/`channel` are added to the
// exact set too (they carry a raw enum a rep shouldn't see untranslated — `SponsorshipState`,
// `MessageChannel`). Still deliberately EXCLUDES `message`/`body`/`name` (prose/content, above).
const TOKEN_FIELDS = new Set(['reason', 'kind', 'held_reason', 'heldReason', 'status', 'state', 'channel', 'code', 'type']);
// PATTERN half of blind-spot (a): a compound field whose SUFFIX marks it as an enum/reason token
// (`activationStatus`, `sponsorshipState`, `myAttendanceState`, `publish_hold_reason`, `*_status`).
const TOKEN_FIELD_SUFFIX_RE = /(?:Status|State)$|_(?:reason|status)$/;

/** Blind-spot (a): a property name is a raw machine token if it is one of the exact token fields OR
 *  its suffix matches the enum/reason-token pattern. Tuned to enum/reason/status/state/channel — NOT
 *  free-prose fields (`message`/`body`/`name`), which are a different guard's / the manual sweep's
 *  concern (see this const's header note). */
function fieldNameIsToken(name) {
  return TOKEN_FIELDS.has(name) || TOKEN_FIELD_SUFFIX_RE.test(name);
}
const MAPPER_CALLEES = new Set(['errorDisplay', 'errorStateLabel', 'reasonDisplay', 't', 'translate']);

function findTsxFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
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

const WORDY_RE = /[^\s\d\p{P}]{2,}/u;
function isWordyMultiWord(text) {
  const trimmed = text.trim();
  if (!trimmed.includes(' ')) return false; // single token → state/enum key, not prose (see header).
  if (!WORDY_RE.test(trimmed)) return false;
  return true;
}

function unwrapParens(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** The INDIVIDUAL static segments of a template literal ($ {…} substitutions dropped) — head + each
 *  span's literal text, each kept SEPARATE (never space-joined). Keeping them separate is what stops
 *  a technical template like `` `csv-import-${Date.now()}-${rand}` `` (segments `csv-import-`, `-`,
 *  none of which has an internal space) from looking like multi-word prose after a join, while a
 *  genuine copy segment (`"1 item couldn't sync yet ("`) still carries its own internal spaces. */
function staticTemplateSegments(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
  }
  return [];
}

/** Collects every string/template STATIC text reachable from an argument expression — directly, or
 *  through the wrappers a state/notice sink argument routinely uses in this codebase: parens, a
 *  ternary (`cond ? rejections[0].message : \`English\``, the inbox/today first-push shape), and a
 *  `??`/`||` fallback (`body.error ?? \`English\``). Without this, a template literal buried in a
 *  ternary branch (the exact `setSyncFailure(result.failed ? \`…\` : null)` warm-market shape) would
 *  slip past a direct-argument-only check. */
function collectLiteralTexts(node, out) {
  const e = unwrapParens(node);
  if (ts.isStringLiteral(e)) {
    out.push(e.text);
  } else if (ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    out.push(...staticTemplateSegments(e));
  } else if (ts.isConditionalExpression(e)) {
    collectLiteralTexts(e.whenTrue, out);
    collectLiteralTexts(e.whenFalse, out);
  } else if (
    ts.isBinaryExpression(e) &&
    (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    collectLiteralTexts(e.left, out);
    collectLiteralTexts(e.right, out);
  }
}

function snippetOf(raw) {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
}

/** A raw machine-token property access (`x.reason`), unwrapped through parens and optional-chains. */
function isRawTokenAccess(node) {
  const e = unwrapParens(node);
  return ts.isPropertyAccessExpression(e) && fieldNameIsToken(e.name.text);
}

/** Blind-spot (b) CLOSED — classify a JSX-CHILD expression as a raw-token leak, UNWRAPPING the
 *  `??`/`||` fallback and the ternary a leak routinely hides behind (`{x?.status ?? t('…')}`,
 *  `{cond ? x.reason : t('…')}`). Recurses into each operand/branch: the raw token in ONE branch is
 *  the leak; the mapper/`t()` in the other is the intended fix and is (correctly) not a token access,
 *  so it never matches. Returns the leak `kind` (for the fingerprint) or `null`. */
function classifyJsxChildExpr(node) {
  const e = unwrapParens(node);
  if (isRawTokenAccess(e)) return 'raw-token-jsx';
  if (containsUnderscoreHumanize(e)) return 'humanized-raw-token-jsx';
  if (ts.isTemplateExpression(e)) {
    for (const span of e.templateSpans) {
      if (isRawTokenAccess(span.expression)) return 'raw-token-jsx-template';
      if (containsUnderscoreHumanize(span.expression)) return 'humanized-raw-token-jsx-template';
    }
    return null;
  }
  if (
    ts.isBinaryExpression(e) &&
    (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return classifyJsxChildExpr(e.left) ?? classifyJsxChildExpr(e.right);
  }
  if (ts.isConditionalExpression(e)) {
    return classifyJsxChildExpr(e.whenTrue) ?? classifyJsxChildExpr(e.whenFalse);
  }
  return null;
}

/** Shape (d) — is this call ITSELF a `.replace(...)`/`.replaceAll(...)` whose pattern is an
 *  underscore and whose replacement is a single space (the "de-snake-case a token" idiom)? Scoped
 *  tightly to that exact pattern/replacement pair so an unrelated `.replace()` call (digit-stripping
 *  `/\D/g` → `''`, prefix-stripping a named regex constant, `router.replace('/today')` navigation,
 *  etc.) is never matched. */
function isUnderscoreHumanizeCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text !== 'replace' && callee.name.text !== 'replaceAll') return false;
  const [pattern, replacement] = node.arguments;
  if (!pattern || !replacement) return false;
  const patternIsUnderscore =
    (ts.isStringLiteral(pattern) && pattern.text === '_') ||
    (ts.isRegularExpressionLiteral(pattern) && /^\/_\/[a-z]*$/.test(pattern.text));
  const replacementIsSpace = ts.isStringLiteral(replacement) && replacement.text === ' ';
  return patternIsUnderscore && replacementIsSpace;
}

/** Shape (d) — walks a member/call CHAIN (e.g. `e.type.replace(/_/g, ' ').toLowerCase()`) looking
 *  for an `isUnderscoreHumanizeCall` ANYWHERE in it, so a trailing `.toLowerCase()`/similar chained
 *  after the humanize call doesn't hide it. */
function containsUnderscoreHumanize(node) {
  let current = unwrapParens(node);
  for (;;) {
    if (ts.isCallExpression(current)) {
      if (isUnderscoreHumanizeCall(current)) return true;
      current = unwrapParens(current.expression);
      continue;
    }
    if (ts.isPropertyAccessExpression(current)) {
      current = unwrapParens(current.expression);
      continue;
    }
    return false;
  }
}

function scanFile(filePath) {
  const relPath = path.relative(REPORT_ROOT, filePath).split(path.sep).join('/');
  const text = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const raw = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  function visit(node) {
    // (a) hardcoded English in a set*()/.push() state/notice sink.
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isSetter = ts.isIdentifier(callee) && /^set[A-Z]/.test(callee.text);
      const isPush = ts.isPropertyAccessExpression(callee) && callee.name.text === 'push';
      if (isSetter || isPush) {
        for (const arg of node.arguments) {
          const texts = [];
          collectLiteralTexts(arg, texts);
          for (const argText of texts) {
            if (isWordyMultiWord(argText)) {
              raw.push({ kind: 'english-in-state-sink', snippet: snippetOf(argText), line: lineOf(node) });
            }
          }
        }
      }
      // (c) raw machine token interpolated into t()/translate()'s vars object.
      if (ts.isIdentifier(callee) && (callee.text === 't' || callee.text === 'translate')) {
        for (const arg of node.arguments) {
          if (ts.isObjectLiteralExpression(arg)) {
            for (const prop of arg.properties) {
              if (ts.isPropertyAssignment(prop) && isRawTokenAccess(prop.initializer)) {
                const field = unwrapParens(prop.initializer).name.text;
                raw.push({ kind: 'raw-token-in-t-vars', snippet: `${prop.name.getText(sourceFile)}: …${field}`, line: lineOf(prop) });
              }
            }
          }
        }
      }
    }
    // (b) raw machine token rendered as JSX content. (d) the same token merely de-snake-cased via
    // `.replace*('_', ' ')` before rendering — punctuation-humanized, still untranslated. Blind-spot
    // (b): `classifyJsxChildExpr` also unwraps the `??`/`||`/ternary a raw token routinely hides
    // behind, so `{x?.status ?? t('…')}` still flags the raw `x.status`.
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) {
      const kind = classifyJsxChildExpr(node.expression);
      if (kind) {
        raw.push({ kind, snippet: snippetOf(node.getText(sourceFile)), line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const seenCount = new Map();
  return raw.map((v) => {
    const dedupeKey = `${v.kind}::${v.snippet}`;
    const occurrenceIndex = seenCount.get(dedupeKey) ?? 0;
    seenCount.set(dedupeKey, occurrenceIndex + 1);
    return { ...v, relPath, fingerprint: `${relPath}::${v.kind}::${occurrenceIndex}::${v.snippet}` };
  });
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error(`guard:rendered-i18n-leak — ${BASELINE_PATH} must be a JSON array of fingerprint strings.`);
    process.exit(1);
  }
  return new Set(parsed);
}

function main() {
  const emitMode = process.argv.includes('--emit-baseline');
  const baseline = loadBaseline();
  const files = findTsxFiles(SRC_ROOT);
  const violations = [];
  for (const file of files) violations.push(...scanFile(file));

  // Maintenance affordance (never used by `postbuild`): with `--emit-baseline`, print ONLY the
  // CURRENT violation fingerprints as a JSON array so the checked-in baseline can be (re)seeded
  // exactly. Used only to SEED the frozen snapshot at introduction — shrink-only thereafter.
  if (emitMode) {
    console.log(JSON.stringify([...new Set(violations.map((v) => v.fingerprint))].sort(), null, 2));
    process.exit(0);
  }

  console.log('guard:rendered-i18n-leak — T-57 RG4 (i18n; master-spec §17.5, uiux §6.2).\n');
  console.log(`Scanned ${files.length} .tsx file(s) under src/.`);

  const grandfathered = violations.filter((v) => baseline.has(v.fingerprint));
  const fresh = violations.filter((v) => !baseline.has(v.fingerprint));

  if (grandfathered.length > 0) {
    console.log(
      `\n${grandfathered.length} pre-existing rendered-i18n-leak(s) grandfathered via RENDERED_I18N_LEAK_BASELINE.json (tracked for burn-down) — not failing the build:`
    );
    for (const v of grandfathered) {
      console.log(`  [WARN-EXEMPT] ${v.relPath}:${v.line} (${v.kind}) "${v.snippet}"`);
    }
  }

  if (fresh.length > 0) {
    console.error(`\nFAILED — ${fresh.length} NEW rendered-i18n-leak(s) found (not in the baseline):`);
    for (const v of fresh) {
      console.error(`  - ${v.relPath}:${v.line} (${v.kind}) "${v.snippet}"`);
    }
    console.error(
      '\nMove hardcoded English into the catalog (t()), and resolve a backend token through a ' +
        'display-mapper (errorDisplay / errorStateLabel / reasonDisplay in src/lib/i18n/) before ' +
        'rendering — never splice a raw reason/kind/held_reason/status/code/type token into visible ' +
        'text, and never merely de-snake-case one via .replace()/.replaceAll(\'_\', \' \') before ' +
        'rendering it (that changes the punctuation, not the language). Map the token to a catalog ' +
        'key per known value instead (see CalendarStrip.tsx\'s eventTypeLabel for the pattern), with ' +
        'a generic localized fallback for unknown values. Do NOT add these to ' +
        'RENDERED_I18N_LEAK_BASELINE.json — it is frozen debt for burn-down, not an escape hatch for ' +
        'new code.'
    );
    process.exit(1);
  }

  console.log('\nguard:rendered-i18n-leak: no NEW rendered-i18n-leaks found. OK.');
  process.exit(0);
}

main();
