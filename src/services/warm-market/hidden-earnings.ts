// WP02 §7.3 (+ §8.4, §17.1, §18.5, §4.13/uiux, §0.5) — the Hidden Earnings engine (T-24).
//
// This is the ONE place the platform computes an earnings-POTENTIAL figure from a Vault contact
// count. Every surface that renders a Hidden Earnings number — the onboarding Reveal (uiux §5.1
// O-8), the `/api/contacts/hidden-earnings` route, and any future outreach copy referencing it —
// consumes this module rather than re-deriving the math, so there is exactly one implementation of
// the formula, the growth-path guard, and the safe-harbor guarantee to audit.
//
// Four load-bearing rules, each enforced STRUCTURALLY (not by convention) below:
//
//   1. FTC-SAFE UNIVERSAL FORMULA (§7.3): appointments = floor(count×0.25), clients =
//      floor(appointments×0.20), value = clients × avg_client_value. Framed as potential/
//      illustrative ONLY — nothing in this module ever asserts a guaranteed or promised outcome.
//
//   2. PRIMERICA CALIBRATION BEHIND THE ORG GATE (§8.4, §17.1): the recalibrated multipliers
//      (×0.35 / ×0.30 / ×$350) apply ONLY when (a) `org_type = primerica` (the T-17 branch lock,
//      `isPrimericaBranch`) AND (b) a valid (format-checked-at-entry, §6.3) solution number is on
//      file. `computePrimericaFigure` independently re-asserts the org gate (`assertPrimericaGate`)
//      so even a direct call bypassing `computeHiddenEarnings`'s own branch fails CLOSED (throws)
//      rather than silently leaking a Primerica-calibrated figure to a universal user — the named
//      §17.1 "Primerica leak" critical concern.
//
//   3. THE 0–3-CONTACT GROWTH PATH, NEVER `NaN`/`$0` (§7.3, §18.5): below the threshold — or
//      whenever the floor-rounding chain would otherwise compute a non-positive value at ANY contact
//      count (the literal formula floors `estimated_clients` to 0 for every universal count below
//      20 and every Primerica count below 12, well past "3" — see `computeHiddenEarnings` below) —
//      the engine returns the SAME growth-path presentation, never a literal `$0`/`NaN`. Every
//      numeric input is sanitized against non-finite/negative/zero-denominator values before it ever
//      reaches a division or multiplication.
//
//   4. SAFE-HARBOR ON EVERY RENDER (§4.13, §18.5 "safe harbor always", the named WP02 critical
//      failure "Hidden Earnings w/o safe-harbor or NaN/$0"): `safeHarborLine` is set ONLY by the two
//      private factories below (`mkFigure`/`mkGrowthPath`) — there is no public constructor for a
//      `HiddenEarningsResult` that omits it, and both the figure AND the growth-path variant carry
//      it (§18.5 is explicit that the growth path is not exempt). `assertSafeHarborPresent` is the
//      one guard every render/serialize/outreach boundary in this module calls before handing a
//      result to a caller, so a future refactor that hand-builds a result object outside the
//      factories is caught here rather than silently shipping a disclaimer-free figure.

import { OrgType } from '@prisma/client';

import { assertPrimericaGate, isPrimericaBranch } from '../onboarding/wp01/org-gate';
import type { CFEInput, CFEVerdict } from '../../types/compliance';

// ─── The exact, mandatory FTC safe-harbor copy (§4.13 uiux / §7.3 / §0.5) ─────────────────────────

/** Visual form (two sentences) — uiux §4.13 / AC-4-6 / AC-5.1-8. Verbatim; never paraphrased. */
export const SAFE_HARBOR_LINE =
  'This is potential, not a promise. It depends on your effort, consistency, and market.';

/**
 * Spoken/screen-reader form — uiux §5.1 O-8: "the em-dash joining the safe-harbor sentences here is
 * an intentional spoken-utterance adaptation of the visual copy's two-sentence form — the words are
 * identical; only the punctuation differs so the disclaimer reads as one continuous utterance."
 */
export const SAFE_HARBOR_LINE_SPOKEN =
  'This is potential, not a promise — it depends on your effort, consistency, and market.';

// ─── Growth-path threshold & copy (§7.3, §18.5) ───────────────────────────────────────────────────

/** §7.3/§18.5: 0–3 contacts always renders the growth path (never a dollar figure). */
export const GROWTH_PATH_CONTACT_THRESHOLD = 3;

export const GROWTH_PATH_HEADLINE = 'Your field is just getting planted.';
export const GROWTH_PATH_BODY =
  "As your community grows, so does this number. Add 20 people to see your field's potential.";

// ─── Formula constants (§7.3 universal; §8.4 Primerica overlay) ──────────────────────────────────

/** §7.3: "avg_client_value // $200–$500 default" — the mid/high point of that band, overridable
 *  per caller (e.g. a future ICP/pricing config) via `HiddenEarningsInput.avgClientValueUsd`. */
export const DEFAULT_AVG_CLIENT_VALUE_USD = 350;

export const UNIVERSAL_MULTIPLIERS = {
  appointmentsRate: 0.25,
  clientsRate: 0.2,
} as const;

export const PRIMERICA_MULTIPLIERS = {
  appointmentsRate: 0.35,
  clientsRate: 0.3,
  fixedClientValueUsd: 350,
} as const;

// ─── Result shapes ─────────────────────────────────────────────────────────────────────────────

export type HiddenEarningsCalibration = 'universal' | 'primerica';

export interface HiddenEarningsFigure {
  kind: 'figure';
  contactCount: number;
  estimatedAppointments: number;
  estimatedClients: number;
  estimatedMonthlyValueUsd: number;
  calibration: HiddenEarningsCalibration;
  /** ALWAYS the exact `SAFE_HARBOR_LINE` — see the module header, rule 4. */
  safeHarborLine: string;
}

export interface HiddenEarningsGrowthPath {
  kind: 'growth_path';
  contactCount: number;
  headline: string;
  body: string;
  /** ALWAYS present, even in the growth path (§18.5 "safe harbor always"). */
  safeHarborLine: string;
}

export type HiddenEarningsResult = HiddenEarningsFigure | HiddenEarningsGrowthPath;

export interface HiddenEarningsInput {
  /** Raw Vault contact count — sanitized against negative/non-finite/huge-N below. */
  contactCount: number;
  orgType: OrgType;
  /**
   * Presence = a format-valid solution number is on file (§8.4/§6.3). The RAW digits are never
   * passed to this engine — `solution-number.ts`'s own invariant is that nothing is persisted to
   * `User.solution_number` unless `checkSolutionNumberForOrg(...).formatValid` already passed, so
   * "a row exists" already implies "format-valid" without ever re-decrypting/re-checking here.
   */
  hasValidSolutionNumber?: boolean;
  /** Universal-branch override for the per-client monthly value; guarded against non-finite/<=0. */
  avgClientValueUsd?: number;
}

// ─── Guards (edge-case doctrine: never NaN/Infinity/0-denominator/negative) ───────────────────────

function sanitizeContactCount(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // Huge-N guard: floor to an integer; JS floating point stays exact/finite for any realistic Vault
  // size (the CSV/native import limits cap a single batch at 10,000 — §7.1), so no further clamp is
  // needed to avoid NaN/Infinity — only non-finite input (e.g. a caller passing `Infinity`) is a
  // real risk, and that is caught by `Number.isFinite` above.
  return Math.floor(raw);
}

function sanitizeAvgClientValue(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_AVG_CLIENT_VALUE_USD;
  }
  return raw;
}

// ─── The two, and only two, places `safeHarborLine` is ever set ──────────────────────────────────

function mkGrowthPath(contactCount: number): HiddenEarningsGrowthPath {
  return {
    kind: 'growth_path',
    contactCount,
    headline: GROWTH_PATH_HEADLINE,
    body: GROWTH_PATH_BODY,
    safeHarborLine: SAFE_HARBOR_LINE,
  };
}

function mkFigure(
  contactCount: number,
  estimatedAppointments: number,
  estimatedClients: number,
  estimatedMonthlyValueUsd: number,
  calibration: HiddenEarningsCalibration
): HiddenEarningsFigure {
  return {
    kind: 'figure',
    contactCount,
    estimatedAppointments,
    estimatedClients,
    estimatedMonthlyValueUsd,
    calibration,
    safeHarborLine: SAFE_HARBOR_LINE,
  };
}

// ─── Formula passes ────────────────────────────────────────────────────────────────────────────

/**
 * The Primerica-calibrated multiplier pass (§8.4). ORG-GATE ENFORCED even though
 * `computeHiddenEarnings` already branches on `isPrimericaBranch` before ever calling this —
 * `assertPrimericaGate` re-asserts the gate HERE too (defense-in-depth, mirrors org-gate.ts's own
 * "guard the service, not just the caller" doctrine), so a future refactor that calls this directly,
 * or a bug in the branch below, fails CLOSED (throws `OrgBranchViolation`) instead of silently
 * leaking a Primerica-calibrated figure to a universal user.
 */
export function computePrimericaFigure(
  orgType: OrgType,
  sanitizedContactCount: number
): { estimatedAppointments: number; estimatedClients: number; estimatedMonthlyValueUsd: number } {
  assertPrimericaGate(orgType, 'hidden_earnings.primerica_calibration');
  const estimatedAppointments = Math.floor(sanitizedContactCount * PRIMERICA_MULTIPLIERS.appointmentsRate);
  const estimatedClients = Math.floor(estimatedAppointments * PRIMERICA_MULTIPLIERS.clientsRate);
  return {
    estimatedAppointments,
    estimatedClients,
    estimatedMonthlyValueUsd: estimatedClients * PRIMERICA_MULTIPLIERS.fixedClientValueUsd,
  };
}

/** The universal formula pass (§7.3), open to every organization. */
export function computeUniversalFigure(
  sanitizedContactCount: number,
  avgClientValueUsd: number
): { estimatedAppointments: number; estimatedClients: number; estimatedMonthlyValueUsd: number } {
  const estimatedAppointments = Math.floor(sanitizedContactCount * UNIVERSAL_MULTIPLIERS.appointmentsRate);
  const estimatedClients = Math.floor(estimatedAppointments * UNIVERSAL_MULTIPLIERS.clientsRate);
  return {
    estimatedAppointments,
    estimatedClients,
    estimatedMonthlyValueUsd: estimatedClients * avgClientValueUsd,
  };
}

/**
 * The single entry point every consumer (Reveal UI, API route, future outreach copy) calls.
 *
 * Decision order:
 *   1. Sanitize `contactCount` (negative/NaN/Infinity → 0) — never trust the caller.
 *   2. §7.3/§18.5: `contactCount <= 3` → growth path, before any multiplication runs.
 *   3. Org-gated calibration choice (§8.4/§17.1): Primerica multipliers apply ONLY for a Primerica-
 *      branch org WITH a valid solution number on file; every other case uses the universal formula
 *      — including a Primerica-branch user who has not yet entered a valid solution number, which is
 *      the spec's own "replacing the universal WP02 multipliers WHEN a valid solution number is
 *      present" (i.e. universal is the default even inside the Primerica branch until that gate
 *      clears).
 *   4. NEVER emit a literal `$0` (or `NaN`): the floor-rounding chain in both formulas legitimately
 *      computes `estimated_clients = 0` for a wide band of real contact counts above 3 (universal:
 *      every count from 4–19; Primerica: every count from 4–11) before the multiplier first clears a
 *      whole client. ANY non-positive computed value — for any reason — falls back to the SAME
 *      growth-path presentation used for 0–3 contacts, which is what makes "never `$0`" true for
 *      every input, not only the smallest ones.
 */
export function computeHiddenEarnings(input: HiddenEarningsInput): HiddenEarningsResult {
  const contactCount = sanitizeContactCount(input.contactCount);

  if (contactCount <= GROWTH_PATH_CONTACT_THRESHOLD) {
    return mkGrowthPath(contactCount);
  }

  const usePrimerica = isPrimericaBranch(input.orgType) && input.hasValidSolutionNumber === true;

  const raw = usePrimerica
    ? computePrimericaFigure(input.orgType, contactCount)
    : computeUniversalFigure(contactCount, sanitizeAvgClientValue(input.avgClientValueUsd));

  const value = Number.isFinite(raw.estimatedMonthlyValueUsd) ? raw.estimatedMonthlyValueUsd : 0;
  if (value <= 0) {
    return mkGrowthPath(contactCount);
  }

  return mkFigure(
    contactCount,
    raw.estimatedAppointments,
    raw.estimatedClients,
    value,
    usePrimerica ? 'primerica' : 'universal'
  );
}

// ─── The safe-harbor guarantee: one guard every render/serialize/outreach path calls ─────────────

export class SafeHarborOmittedError extends Error {
  constructor(where: string) {
    super(
      `Hidden Earnings render at "${where}" is missing (or has altered) the mandatory FTC ` +
        'safe-harbor line (§7.3/§18.5/§4.13) — refusing to emit. This is the named WP02 critical ' +
        'failure ("Hidden Earnings w/o safe-harbor") and this guard exists specifically to trip on it.'
    );
    this.name = 'SafeHarborOmittedError';
  }
}

/**
 * The ONE guard every render/serialize/outreach boundary in this module calls before a result is
 * allowed to reach a caller. `safeHarborLine` is set only by `mkFigure`/`mkGrowthPath` above — this
 * assertion is what turns "we intended not to omit it" into "an omission is structurally caught
 * before it reaches the wire," exactly mirroring `org-gate.ts`'s `assertNoPrimericaLeak` pattern for
 * the sibling §17.1 law. Throws `SafeHarborOmittedError` (never silently repairs/re-injects) if the
 * line is missing or has been altered by anything downstream of the factories.
 */
export function assertSafeHarborPresent(
  result: HiddenEarningsResult,
  where = 'hidden_earnings'
): HiddenEarningsResult {
  if (result.safeHarborLine !== SAFE_HARBOR_LINE) {
    throw new SafeHarborOmittedError(where);
  }
  return result;
}

// T-57 BLOCKER-B8 DECISION (documented, not routed through the locale layer) — this module's ONLY
// two consumers of `formatUsd` are `buildScreenReaderUtterance` (feeds the currently-unconsumed-by-
// any-.tsx `/api/contacts/hidden-earnings` route's JSON payload — grep confirms zero live UI callers
// today) and `composeHiddenEarningsOutreachLine` (contact-facing OUTREACH copy, CFE-gated,
// `routeHiddenEarningsToOutreach`). Both compose sentences AROUND the mandatory, compliance-verbatim
// `SAFE_HARBOR_LINE`/`SAFE_HARBOR_LINE_SPOKEN`/`GROWTH_PATH_HEADLINE`/`GROWTH_PATH_BODY` — every one
// of which is a FIXED ENGLISH STRING by design (this file's own header: "Verbatim; never
// paraphrased" — §4.13/§0.5). Making just the currency figure locale-variant while the sentence
// wrapped around it stays English-fixed would produce a mixed-language Frankenstein string, not a
// genuine translation — worse than the status quo, not better. The REP-facing surface that actually
// needs (and gets) locale-aware currency is `HiddenEarningsReveal.tsx` (uiux §5.1 O-8), which
// already routes its OWN, independent `formatUsd` through `formatCurrencyUSD(locale, value)` (see
// that component) — this engine-level `formatUsd` never feeds that component at all. `'en-US'`
// stays fixed here deliberately, matching the fixed-English prose it is always composed inside.
function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * The single screen-reader utterance (uiux §5.1 O-8 / §6.1): the figure/growth copy AND the
 * disclaimer as ONE utterance, never announced separately, in either the figure or growth-path
 * case. Guarded by `assertSafeHarborPresent` — a result that somehow reached this function without
 * the mandatory line throws rather than narrating a disclaimer-free number.
 */
export function buildScreenReaderUtterance(result: HiddenEarningsResult): string {
  assertSafeHarborPresent(result, 'screen_reader_utterance');

  if (result.kind === 'growth_path') {
    return `${result.headline} ${result.body} ${SAFE_HARBOR_LINE_SPOKEN}`;
  }

  return (
    `From the ${result.contactCount} people in your community: an estimated ` +
    `${result.estimatedAppointments} conversations, ${result.estimatedClients} families you could ` +
    `help, and ${formatUsd(result.estimatedMonthlyValueUsd)} of potential monthly value. ` +
    `${SAFE_HARBOR_LINE_SPOKEN}`
  );
}

/**
 * The JSON-safe payload an API route returns — re-validated by `assertSafeHarborPresent` immediately
 * before crossing the API boundary, with the one-utterance SR narration attached so a caller never
 * has to reconstruct it (and risk drifting from the visual copy).
 */
export function renderHiddenEarningsPayload(
  result: HiddenEarningsResult
): HiddenEarningsResult & { screenReaderUtterance: string } {
  assertSafeHarborPresent(result, 'api_payload');
  return { ...result, screenReaderUtterance: buildScreenReaderUtterance(result) };
}

// ─── CFE bridge for any future outreach/send path (charter item 5; master-spec §5, §18.1) ────────

/** The narrow CFE surface this module depends on — satisfied by `ComplianceFilterEngine.evaluateContent`
 *  or any mock in tests (mirrors `seven-whys/outreach-gate.ts`'s `CFEContentEvaluator`). */
export interface HiddenEarningsCFEEvaluator {
  evaluateContent(input: CFEInput): Promise<CFEVerdict>;
}

export type HiddenEarningsOutreachDecision =
  | { allowed: true; text: string; verdict: CFEVerdict }
  | { allowed: false; reason: 'cfe_held' | 'cfe_blocked'; verdict: CFEVerdict };

/**
 * Composes a copy-safe outreach sentence from a computed result — framed as potential ("could
 * represent," "estimated"), never a guarantee, and carrying the exact safe-harbor line. This is
 * text composition ONLY; it is never itself "cleared to send" — `routeHiddenEarningsToOutreach`
 * below is the only function that may hand back send-ready text, and only after a released CFE
 * verdict.
 */
export function composeHiddenEarningsOutreachLine(result: HiddenEarningsResult): string {
  assertSafeHarborPresent(result, 'outreach_compose');

  if (result.kind === 'growth_path') {
    return `${result.headline} ${result.body} ${result.safeHarborLine}`;
  }

  return (
    `Your community could represent an estimated ${formatUsd(result.estimatedMonthlyValueUsd)} a ` +
    `month in potential — ${result.estimatedClients} families you could help from ` +
    `${result.estimatedAppointments} conversations. ${result.safeHarborLine}`
  );
}

/**
 * §5 "any AI-generated content on a send/store path must route through the CFE," §18.1 fail-closed —
 * and this unit's own charter item 5: earnings content headed to outreach/send is CFE-gated. There
 * is NO code path here that returns `allowed: true` without a CFE verdict that itself set
 * `released: true` — a held (fail-closed-unavailable) or blocked verdict always yields
 * `allowed: false`, mirroring `routeAnchorToOutreach`'s contract exactly.
 */
export async function routeHiddenEarningsToOutreach(
  result: HiddenEarningsResult,
  cfe: HiddenEarningsCFEEvaluator,
  userContext: CFEInput['userContext'],
  channel: CFEInput['channel'] = 'SMS'
): Promise<HiddenEarningsOutreachDecision> {
  const text = composeHiddenEarningsOutreachLine(result);
  const verdict = await cfe.evaluateContent({ content: text, channel, userContext });

  if (verdict.released) {
    return { allowed: true, text, verdict };
  }
  return { allowed: false, reason: verdict.held ? 'cfe_held' : 'cfe_blocked', verdict };
}
