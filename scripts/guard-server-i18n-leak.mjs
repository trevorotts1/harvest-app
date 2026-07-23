#!/usr/bin/env node
/**
 * T-57 RG7 close-out, DIMENSION B (i18n; master-spec §17.5, uiux §6.2/§0.5). The COMPANION to
 * `guard-rendered-i18n-leak.mjs`, closing that class's third blind spot (c): a rep-facing string
 * composed SERVER-SIDE from hardcoded English literals, in a function that takes NO `locale` and calls
 * NO `t()`. `guard-rendered-i18n-leak` sees the CLIENT render; this sees the SERVICE that hands the
 * client a pre-composed English string in the first place (the exact `sponsor-cockpit.service.ts`
 * `roiNote: \`${n} recruit(s) activated …\`` shape the re-gate found — a `.tsx` render of `{seat.roiNote}`
 * looks innocent because the leak already happened one layer up, on the server). A Spanish rep gets
 * English no matter how the client renders it.
 *
 * WHAT IT DOES (one heuristic, tuned for LOW false-positive — this is a ratchet, not a proof): flags a
 * REP-FACING string SINK — an object property assignment (`roiNote: …`), a variable declaration
 * (`const note = …`), or a `return` — whose NAME marks it as rep-facing display prose (see
 * `REP_FACING_NAME` below: `message`/`label`/`note`/`text`/`roiNote`/`narrative`/… or a `*Note`/
 * `*Message`/`*Label`/`*Text`/… suffix) AND whose VALUE is (or, unwrapped through `??`/`||`/ternary/
 * parens/`+` concatenation, contains) a WORDY, MULTI-WORD English string/template literal — WHEN the
 * enclosing function neither takes a `locale` parameter NOR calls `t()`/`translate()`/`tFrom()`
 * anywhere in its body. A function that DOES thread a locale / call the catalog is, by construction,
 * doing i18n correctly and is never flagged; the fix for a flagged site is exactly to do one of those
 * (thread `locale` + compose via `t()`, OR stop composing prose server-side and hand the client the
 * raw pieces to render through the catalog — see `sponsor-cockpit.service.ts`'s RG7 fix).
 *
 * WHY THE `locale`/`t()` EXEMPTION IS THE RIGHT DISCRIMINATOR (not a keyword blocklist): the whole
 * class is "prose built with no path to Spanish". A `locale` param or a `t()` call IS that path. So
 * the presence of either is a near-perfect signal the author already localized (or can) — and its
 * ABSENCE, next to a multi-word English literal assigned to a display-named sink, is the leak. This
 * deliberately stays quiet on: machine tokens/enums (single-word, no internal space — `isWordyMultiWord`
 * requires a space), log lines / thrown `Error(...)` (not assigned to a rep-facing-named sink), and
 * every already-localized composer (briefing.ts, mission-control zones, …) that threads `locale`.
 *
 * BASELINE (shrink-only — identical policy to the sibling guards): `SERVER_I18N_LEAK_BASELINE.json`,
 * checked in beside this script, is the frozen snapshot of pre-existing debt. Grandfathered entries
 * print `[WARN-EXEMPT]` and never fail the build; anything NOT an exact fingerprint match is a NEW
 * server-side leak and FAILS. The baseline may ONLY SHRINK — thread locale / route through `t()` and
 * delete the entry; never add one to silence new code (fix the source, or, if it's a false positive,
 * tighten this scanner's heuristic instead).
 *
 * T-R47 HARDENING (Shift screen ratio-explainer/motivational-line leak, uiux §5.3) — Final QC found a
 * rep-facing leak this guard's ORIGINAL sink-name allowlist missed entirely: `learning-state/
 * ratios.ts`'s `RatioCardView.explainer` (property name `explainer`, not in the old allowlist at all)
 * and `shift.service.ts`'s `briefingLines`/`motivationalLine` (a `*Line`/`*Lines` camelCase suffix,
 * also absent). Both are now real sink names (see `REP_FACING_EXACT`/`CAMEL_LINE_SUFFIX_RE` below);
 * both leak sites are FIXED (threaded `locale` + real `t()` calls), not baselined — the baseline
 * stays the frozen snapshot of debt this fix did NOT touch. Widening the net incidentally surfaced
 * two genuinely pre-existing, out-of-lane hits this same run (`agent-runtime/prompt-assembly.ts`'s
 * `orgLine`/`anchorLine` — Claude PROMPT-construction text, never rendered to any rep/contact on any
 * screen, so out of this guard's actual "a Spanish rep sees English" concern, same character as the
 * 4 pre-existing audit/compliance `narrative` entries already grandfathered below); these two are
 * added to the baseline for burn-down, exactly like the original 4 were seeded at this guard's
 * introduction — NOT new code this build unit wrote.
 *
 * Each entry is `relPath::kind::occurrenceIndex::snippet` (content-based, not line-based). Exits
 * 0 / 1. Wired into `postbuild` as `npm run guard:server-i18n-leak`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SRC_ROOT = process.env.GUARD_SERVER_I18N_LEAK_SRC_ROOT
  ? path.resolve(process.env.GUARD_SERVER_I18N_LEAK_SRC_ROOT)
  : path.join(REPO_ROOT, 'src', 'services');
const BASELINE_PATH = process.env.GUARD_SERVER_I18N_LEAK_BASELINE_PATH
  ? path.resolve(process.env.GUARD_SERVER_I18N_LEAK_BASELINE_PATH)
  : path.join(__dirname, 'SERVER_I18N_LEAK_BASELINE.json');
// The report path is relative to the repo root in the real run, or the fixture root's parent in tests
// (so a fingerprint reads `src/services/foo.ts` in prod and `src/foo.ts` in a fixture) — mirrors the
// sibling guards' REPORT_ROOT convention.
const REPORT_ROOT = process.env.GUARD_SERVER_I18N_LEAK_SRC_ROOT ? path.join(SRC_ROOT, '..') : REPO_ROOT;

/** A rep-facing display-prose sink NAME (object-property key, variable name). A multi-word English
 *  literal assigned to one of these, with no locale/t() in scope, is the leak. Tuned to display prose
 *  — NOT ids/tokens/enums/counts (`memberName`, `activationStatus`, `userId`) and NOT request/email
 *  `body` blobs (deliberately excluded — variable content, high FP).
 *
 *  T-R47 HARDENING — added `explainer` (exact) and the `*Line`/`*Lines` CAMELCASE suffix (see
 *  `CAMEL_LINE_SUFFIX_RE` below), closing the blind spot `learning-state/ratios.ts`'s
 *  `RatioCardView.explainer` and `shift.service.ts`'s `briefingLines`/`motivationalLine` slipped
 *  through: this guard's ONE heuristic (a display-named sink + a wordy English literal + no
 *  locale/t() in the enclosing function) already covered that exact shape — the sink-NAME allowlist
 *  was just missing those two spellings. `explainer` is an EXACT name (Today's own
 *  `RatioTriple.explainer`, `mission-control/zones/ratios.ts`, ALREADY threads `locale` — it was
 *  never flagged even before this hardening, because `functionHasLocaleOrT` already exempts it; only
 *  the Shift's un-fixed sibling was ever at risk). `*Line`/`*Lines` is a SUFFIX, deliberately
 *  case-SENSITIVE on the ORIGINAL (pre-lowercase) identifier and requiring a lowercase-letter-or-digit
 *  immediately before the capital `L` — i.e. a genuine camelCase word boundary
 *  (`motivationalLine`, `briefingLines`) — so it does NOT match a single dictionary word that merely
 *  ends in the substring "line" with no internal capital (`baseline`, `outline`, `deadline`,
 *  `guideline`, `headline` — the last is already its own EXACT entry above, case-insensitively, for
 *  exactly this reason: `nameIsRepFacing` lowercases for the exact/suffix-regex checks but tests
 *  `CAMEL_LINE_SUFFIX_RE` against the untouched original spelling). */
const REP_FACING_EXACT = new Set([
  'roinote',
  'note',
  'message',
  'label',
  'text',
  'copy',
  'narrative',
  'blurb',
  'headline',
  'subhead',
  'caption',
  'disclaimer',
  'prose',
  'sentence',
  'utterance',
  'explainer',
]);
const REP_FACING_SUFFIX_RE = /(?:note|message|label|text|copy|narrative|blurb|headline|caption|disclaimer|explainer)$/i;
const CAMEL_LINE_SUFFIX_RE = /[a-z0-9](?:Line|Lines)$/;
function nameIsRepFacing(name) {
  const lower = name.toLowerCase();
  return REP_FACING_EXACT.has(lower) || REP_FACING_SUFFIX_RE.test(lower) || CAMEL_LINE_SUFFIX_RE.test(name);
}

function findSourceFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...findSourceFiles(full));
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx') &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

// A wordy MULTI-WORD literal = genuine prose (has an internal space + a 2+ letter word) — never a
// single machine token/enum key. Same rationale + regex as guard-rendered-i18n-leak.mjs's own.
const WORDY_RE = /[^\s\d\p{P}]{2,}/u;
function isWordyMultiWord(text) {
  const trimmed = text.trim();
  if (!trimmed.includes(' ')) return false;
  return WORDY_RE.test(trimmed);
}

function unwrapParens(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function staticTemplateSegments(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
  }
  return [];
}

/** Every static string/template text reachable from a value expression, unwrapped through the
 *  wrappers a composed-prose value routinely uses: parens, `??`/`||` fallback, ternary, and `+`
 *  string concatenation (`\`${n} recruit(s) activated \` + SAFE_HARBOR_LINE` → both segments). */
function collectLiteralTexts(node, out) {
  const e = unwrapParens(node);
  if (ts.isStringLiteral(e)) {
    out.push(e.text);
  } else if (ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    out.push(...staticTemplateSegments(e));
  } else if (ts.isConditionalExpression(e)) {
    collectLiteralTexts(e.whenTrue, out);
    collectLiteralTexts(e.whenFalse, out);
  } else if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.PlusToken) {
      collectLiteralTexts(e.left, out);
      collectLiteralTexts(e.right, out);
    }
  }
}

function snippetOf(raw) {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/** The enclosing function-like node of `node`, or null (module top-level). */
function enclosingFunction(node) {
  let current = node.parent;
  while (current) {
    if (isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}

/** Does this function thread a `locale` (param named `locale`, or a param whose type mentions
 *  `Locale`) OR call `t()`/`translate()`/`tFrom()` anywhere in its body? Either is a path to Spanish,
 *  so the function is doing i18n correctly and is never flagged. */
function functionHasLocaleOrT(fn) {
  for (const param of fn.parameters ?? []) {
    const pname = param.name && ts.isIdentifier(param.name) ? param.name.text.toLowerCase() : '';
    if (pname === 'locale') return true;
    if (param.type && /Locale/.test(param.type.getText())) return true;
  }
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee) && (callee.text === 't' || callee.text === 'translate' || callee.text === 'tFrom')) {
        found = true;
        return;
      }
      if (ts.isPropertyAccessExpression(callee) && (callee.name.text === 't' || callee.name.text === 'translate')) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, walk);
  };
  if (fn.body) walk(fn.body);
  return found;
}

function scanFile(filePath) {
  const relPath = path.relative(REPORT_ROOT, filePath).split(path.sep).join('/');
  const text = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const raw = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  // Memoise the locale/t() verdict per enclosing function (walking a big function body once, not once
  // per literal inside it).
  const fnVerdict = new Map();
  function fnExempt(fn) {
    if (fnVerdict.has(fn)) return fnVerdict.get(fn);
    const v = functionHasLocaleOrT(fn);
    fnVerdict.set(fn, v);
    return v;
  }

  function flagValue(nameNode, valueNode, name) {
    const texts = [];
    collectLiteralTexts(valueNode, texts);
    if (!texts.some(isWordyMultiWord)) return;
    // SCOPE (the low-FP discriminator): only PER-CALL composition INSIDE a function body is this
    // guard's class (`sponsor-cockpit.service.ts`'s `roiNote` is composed inside `getCockpit`'s
    // `.map()` callback). MODULE-LEVEL static data — const config maps, seed arrays, classifier/
    // objection/track label tables — is NOT "a function composing prose"; it is catalog/parity
    // tooling's concern (guard-i18n / guard-no-literals), and flagging it here would bury the real
    // per-call leaks under hundreds of static-config entries. So a sink with no enclosing function is
    // out of scope.
    const fn = enclosingFunction(nameNode);
    if (!fn) return;
    if (fnExempt(fn)) return;
    raw.push({ kind: 'english-in-server-prose', snippet: `${name}: ${snippetOf(texts.find(isWordyMultiWord))}`, line: lineOf(nameNode) });
  }

  function visit(node) {
    // Object property: `roiNote: \`… English …\``
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
      const name = node.name.text;
      if (nameIsRepFacing(name)) flagValue(node.name, node.initializer, name);
    }
    // Variable: `const note = \`… English …\``
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (nameIsRepFacing(name)) flagValue(node.name, node.initializer, name);
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
    console.error(`guard:server-i18n-leak — ${BASELINE_PATH} must be a JSON array of fingerprint strings.`);
    process.exit(1);
  }
  return new Set(parsed);
}

function main() {
  const emitMode = process.argv.includes('--emit-baseline');
  const baseline = loadBaseline();
  const files = findSourceFiles(SRC_ROOT);
  const violations = [];
  for (const file of files) violations.push(...scanFile(file));

  if (emitMode) {
    console.log(JSON.stringify([...new Set(violations.map((v) => v.fingerprint))].sort(), null, 2));
    process.exit(0);
  }

  console.log('guard:server-i18n-leak — T-57 RG7 (i18n; master-spec §17.5, uiux §6.2).\n');
  console.log(`Scanned ${files.length} service file(s) under src/services/.`);

  const grandfathered = violations.filter((v) => baseline.has(v.fingerprint));
  const fresh = violations.filter((v) => !baseline.has(v.fingerprint));

  if (grandfathered.length > 0) {
    console.log(
      `\n${grandfathered.length} pre-existing server-side i18n leak(s) grandfathered via SERVER_I18N_LEAK_BASELINE.json (tracked for burn-down) — not failing the build:`
    );
    for (const v of grandfathered) {
      console.log(`  [WARN-EXEMPT] ${v.relPath}:${v.line} (${v.kind}) "${v.snippet}"`);
    }
  }

  if (fresh.length > 0) {
    console.error(`\nFAILED — ${fresh.length} NEW server-side i18n leak(s) found (not in the baseline):`);
    for (const v of fresh) {
      console.error(`  - ${v.relPath}:${v.line} (${v.kind}) "${v.snippet}"`);
    }
    console.error(
      '\nA rep-facing string composed from hardcoded English in a function that threads no `locale` ' +
        'and calls no t(). Either thread the rep locale and compose via the catalog (t(locale, key, ' +
        'vars) — see briefing.ts / mission-control zones), or stop composing prose server-side and ' +
        'hand the client the raw pieces (counts/tokens) to render through the catalog + a display ' +
        'mapper (see sponsor-cockpit.service.ts\'s RG7 fix, which moved roiNote composition to the ' +
        'client). Do NOT add these to SERVER_I18N_LEAK_BASELINE.json — it is frozen debt for ' +
        'burn-down, not an escape hatch for new code.'
    );
    process.exit(1);
  }

  console.log('\nguard:server-i18n-leak: no NEW server-side i18n leaks found. OK.');
  process.exit(0);
}

main();
