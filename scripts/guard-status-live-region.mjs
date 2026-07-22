#!/usr/bin/env node
/**
 * T-57 RE-GATE ROUND-4 hardening, DIMENSION A (WCAG 2.2 SC 4.1.3 "Status Messages"; uiux §6.1).
 * The convergence guard for a PERVASIVE PRE-EXISTING class the re-gate kept re-discovering one site
 * at a time (A [a67e4ee9]): an error/status/notice value rendered as visible text with NO ARIA live
 * region, so a screen-reader user is never told the state changed. Whack-a-mole per round would
 * never converge — this is the durable ratchet, shaped exactly like `guard-touch-target.mjs` /
 * `guard-no-literals-in-components.mjs` (real TypeScript-compiler AST walk of every `.tsx`, external
 * shrink-only JSON baseline of pre-existing debt).
 *
 * WHAT IT DOES: flags a JSX element that RENDERS A DYNAMIC STATUS/ERROR/NOTICE VALUE as its content
 * while NEITHER that element NOR any enclosing JSX ancestor carries an ARIA live region
 * (`role="alert"`, `role="status"`, `role="log"`, or any `aria-live`). "Renders a dynamic status
 * value" = a JsxExpression CHILD (not an attribute value — an `aria-label={error}` is an attribute,
 * not announced-as-it-changes visible text) whose expression is one of:
 *   - a bare identifier whose name is a known status/error/notice var — `error`, `result`, `status`,
 *     `notice`, `syncNotice`, `syncFailure` — or ENDS in `Error`/`Message`/`Notice`/`Failure`
 *     (`coachingMessage`, `appointmentMessage`, `revokeError`, `syncFailure`, …);
 *   - a property access ending in `.message` (`result.message`, `err.message`) or in one of those
 *     same suffixes;
 *   - a `??` / `||` fallback (`{error ?? t('…')}`) — the left operand is checked (this is the exact
 *     `content/launch-kit/[id]/page.tsx:74` shape, `{error ?? t('…notFound')}`).
 * A CallExpression child is deliberately NOT matched (`{inboxEmptyStateMessage(filter, locale)}`,
 * `{t('…')}`) — an empty-state/computed string rendered through a function is not the "a mutation
 * just failed, announce it" class this SC-4.1.3 guard targets, and matching it would false-positive
 * on every `t()` call. The heuristic is intentionally tuned to the real recurring class (bare
 * `{error}` / `{result.message}` / `{someMessage}` state vars), not to be exhaustive — the RG4
 * manual sweep is the primary coverage; this guard is the regression ratchet.
 *
 * WHY THE ANCESTOR WALK (not just the element itself): a live region is frequently declared on a
 * WRAPPER (`<div role="alert"><p>{msg}</p></div>` — the warm-market ritual's soft-gate does exactly
 * this). Checking only the immediate element would false-positive on those. So a violation requires
 * that NEITHER the rendering element NOR any JSX-element ancestor up to the component root declares a
 * live region. Conversely, adding `role="status"`/`role="alert"`/`aria-live` to EITHER the element
 * or a wrapper clears it — matching how the fixes in this same unit (and the landed RG3-fix-A /
 * team-calendar / content-page precedents) were applied.
 *
 * BASELINE (shrink-only — identical policy to `NO_LITERALS_BASELINE.json` / `TOUCH_TARGET_BASELINE`):
 * `STATUS_LIVE_REGION_BASELINE.json`, checked in beside this script, is a one-time frozen snapshot of
 * every violation this scanner found the moment the guard was introduced (RG4). Those are
 * grandfathered (`[WARN-EXEMPT]`, never fail the build) and tracked for burn-down. Anything NOT an
 * exact fingerprint match is a genuinely NEW un-announced status render and FAILS the build. The
 * baseline may ONLY SHRINK — delete an entry once the site gets a role/aria-live; never add one to
 * silence a new site (fix the site, or, if it's a false positive, fix this scanner's heuristic).
 *
 * Each entry is `relPath::occurrenceIndex::snippet` (content-based, not line-based — same rationale
 * the other guards give: line-shifting edits elsewhere never spuriously un-exempt a grandfathered
 * entry). Exits 0 (all grandfathered / none) / 1 (>=1 new). Wired into `postbuild` as
 * `npm run guard:status-live-region`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
// Overridable ONLY for tests (tests/unit/guard-status-live-region-script.test.ts) — same convention
// as GUARD_NO_LITERALS_SRC_ROOT: the real script (and its real `typescript` resolution via this
// repo's node_modules) runs against small disposable fixture trees.
const SRC_ROOT = process.env.GUARD_STATUS_LIVE_REGION_SRC_ROOT
  ? path.resolve(process.env.GUARD_STATUS_LIVE_REGION_SRC_ROOT)
  : path.join(REPO_ROOT, 'src');
const BASELINE_PATH = process.env.GUARD_STATUS_LIVE_REGION_BASELINE_PATH
  ? path.resolve(process.env.GUARD_STATUS_LIVE_REGION_BASELINE_PATH)
  : path.join(__dirname, 'STATUS_LIVE_REGION_BASELINE.json');
const REPORT_ROOT = process.env.GUARD_STATUS_LIVE_REGION_SRC_ROOT ? path.join(SRC_ROOT, '..') : REPO_ROOT;

// ─────────────────────────────────────────────────────────────────────────────
// File discovery — every .tsx under src/, excluding tests/stories/build output.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// The "is this a dynamic status/error/notice value" heuristic.
// ─────────────────────────────────────────────────────────────────────────────
/** Bare status/error/notice var names (whole-name match). Deliberately NOT `status`: a `.status`
 *  render is overwhelmingly a steady-state table-cell value (calendar-connection status, appointment
 *  status column) in this codebase, not an async "a thing just happened, announce it" message — and
 *  a raw backend `status` token is the rendered-i18n-leak guard's concern, not this SC-4.1.3 one. */
const STATUS_IDENT_RE = /^(error|result|notice|syncNotice|syncFailure|syncError|loadError)$/;
/** Names ENDING in one of these are status/error/notice values (`coachingMessage`, `revokeError`,
 *  `appointmentMessage`, `syncFailure`, `uploadNotice`, …). */
const STATUS_SUFFIX_RE = /(Error|Message|Notice|Failure)$/;

function identIsStatus(name) {
  return STATUS_IDENT_RE.test(name) || STATUS_SUFFIX_RE.test(name);
}

/** Does an expression rendered as JSX content look like a dynamic status/error/notice value? */
function exprIsStatusValue(expr) {
  if (!expr) return false;
  if (ts.isParenthesizedExpression(expr)) return exprIsStatusValue(expr.expression);
  if (ts.isIdentifier(expr)) return identIsStatus(expr.text);
  if (ts.isPropertyAccessExpression(expr)) {
    const member = expr.name.text;
    return member === 'message' || identIsStatus(member);
  }
  // `{error ?? t('…')}` / `{error || fallback}` — the status var is the left operand.
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return exprIsStatusValue(expr.left);
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live-region detection (element + ancestor walk).
// ─────────────────────────────────────────────────────────────────────────────
const LIVE_ROLE_VALUES = new Set(['alert', 'status', 'log']);

/** Does this opening/self-closing element declare an ARIA live region (role=alert/status/log or any
 *  aria-live)? A `role`/`aria-live` written as a `{expr}` (dynamic) is conservatively treated as a
 *  live region too — we cannot statically prove it isn't, and this guard errs toward NOT
 *  false-positiving a site that clearly intends one. */
function elementHasLiveRegion(openingLike) {
  for (const attr of openingLike.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    const name = attr.name.getText();
    if (name === 'aria-live') return true;
    if (name === 'role') {
      const init = attr.initializer;
      if (init && ts.isStringLiteral(init)) {
        if (LIVE_ROLE_VALUES.has(init.text)) return true;
      } else if (init && ts.isJsxExpression(init)) {
        return true; // dynamic role — don't second-guess; treat as intentional live region.
      }
    }
  }
  return false;
}

/** Walk up every JSX-element ancestor of `node` (inclusive of the element it renders in) and return
 *  true if any declares a live region. */
function ancestorHasLiveRegion(node) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      if (elementHasLiveRegion(current.openingElement)) return true;
    } else if (ts.isJsxSelfClosingElement(current)) {
      if (elementHasLiveRegion(current)) return true;
    }
    current = current.parent;
  }
  return false;
}

/** Truncated, whitespace-collapsed snippet for reporting + fingerprinting. */
function snippetOf(raw) {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// The scanner — one file in, its violations out.
// ─────────────────────────────────────────────────────────────────────────────
function scanFile(filePath) {
  const relPath = path.relative(REPORT_ROOT, filePath).split(path.sep).join('/');
  const text = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const raw = [];

  function lineOf(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function visit(node) {
    if (ts.isJsxExpression(node)) {
      // Only a JSX CHILD (rendered content) — never an attribute value (`aria-label={error}`).
      const isAttributeValue = ts.isJsxAttribute(node.parent);
      if (!isAttributeValue && exprIsStatusValue(node.expression)) {
        if (!ancestorHasLiveRegion(node)) {
          raw.push({ snippet: snippetOf(node.getText(sourceFile)), line: lineOf(node) });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const seenCount = new Map();
  return raw.map((v) => {
    const occurrenceIndex = seenCount.get(v.snippet) ?? 0;
    seenCount.set(v.snippet, occurrenceIndex + 1);
    return { ...v, relPath, fingerprint: `${relPath}::${occurrenceIndex}::${v.snippet}` };
  });
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    console.error(`guard:status-live-region — ${BASELINE_PATH} must be a JSON array of fingerprint strings.`);
    process.exit(1);
  }
  return new Set(parsed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Run.
// ─────────────────────────────────────────────────────────────────────────────
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

  console.log('guard:status-live-region — T-57 RG4 (WCAG SC 4.1.3 "Status Messages", uiux §6.1).\n');
  console.log(`Scanned ${files.length} .tsx file(s) under src/.`);

  const grandfathered = violations.filter((v) => baseline.has(v.fingerprint));
  const fresh = violations.filter((v) => !baseline.has(v.fingerprint));

  if (grandfathered.length > 0) {
    console.log(
      `\n${grandfathered.length} pre-existing un-announced status render(s) grandfathered via STATUS_LIVE_REGION_BASELINE.json (tracked for burn-down) — not failing the build:`
    );
    for (const v of grandfathered) {
      console.log(`  [WARN-EXEMPT] ${v.relPath}:${v.line} "${v.snippet}"`);
    }
  }

  if (fresh.length > 0) {
    console.error(`\nFAILED — ${fresh.length} NEW status/error render(s) with no ARIA live region (not in the baseline):`);
    for (const v of fresh) {
      console.error(`  - ${v.relPath}:${v.line} "${v.snippet}"`);
    }
    console.error(
      '\nAdd role="alert" (assertive — hard failures/compliance holds) or role="status" (polite — ' +
        'graceful degradation) — or aria-live — to the element rendering the value, or to an enclosing ' +
        'wrapper. Do NOT add these to STATUS_LIVE_REGION_BASELINE.json — that baseline is frozen ' +
        'pre-existing debt for burn-down, not an escape hatch for new code.'
    );
    process.exit(1);
  }

  console.log('\nguard:status-live-region: no NEW un-announced status renders found. OK.');
  process.exit(0);
}

main();
