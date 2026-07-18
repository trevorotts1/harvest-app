// WP03 §8.2 — the readiness engine: the exact documented weighted formula, producing a HIDDEN 0-100
// score that drives queue ordering/tiering internally and is NEVER itself shown to the rep (the
// named WP03 critical failure this module exists to prevent is "readiness score SHOWN to user" —
// the same invisible-score doctrine as the Seven Whys >70 gate, per this build unit's brief).
//
// Formula (§8.2, verbatim):
//   readiness = quality_cluster_strength×0.30 + background_context_completeness×0.25
//             + relationship_recency_normalized×0.20 + career_stage_alignment×0.15
//             + financial_situation_alignment×0.10
//
// Every sub-score below is computed EXACTLY per §8.2's own inputs list — no invented weighting.
// Where §8.2 does not enumerate a value (e.g. a career/financial stage tile left unfilled), the
// alignment credits 0 rather than fabricating a mid-range guess — "no data" earns no alignment
// credit, which is also why `background_context_completeness` (25% of the total) independently
// penalizes an incomplete Layer 3 regardless of what the filled tiles say.

import { ReadinessTier } from '@prisma/client';

import type { ReadinessInputs, ReadinessResult, PublicQueueItem } from '../../types/harvest-method';
import { checkContactHardExclusion, type EligibilityContactRow } from './eligibility';

// ─── Sub-score passes (§8.2 "Inputs:") ────────────────────────────────────────────────────────────

const CLUSTER_STRENGTH_UNIT = 33;
const MAX_CREDITED_CLUSTERS = 3;

/** "cluster strength (matching clusters 1-3 x33)" — credits at most 3 clusters. */
export function clusterStrength(assignedClusterCount: number): number {
  const credited = Math.max(0, Math.min(assignedClusterCount, MAX_CREDITED_CLUSTERS));
  return credited * CLUSTER_STRENGTH_UNIT;
}

const TOTAL_TILES = 4;

/** "context completeness (% tiles filled)" — tilesFilledCount is 0-4. */
export function contextCompleteness(tilesFilledCount: number): number {
  const filled = Math.max(0, Math.min(tilesFilledCount, TOTAL_TILES));
  return (filled / TOTAL_TILES) * 100;
}

/** "recency (100 if < 30d, 75 if 30-90d, 50 if > 90d, 25 if never)". */
export function relationshipRecency(daysSinceLastInteraction: number | null): number {
  if (daysSinceLastInteraction === null) return 25; // "never"
  if (daysSinceLastInteraction < 30) return 100;
  if (daysSinceLastInteraction <= 90) return 75;
  return 50;
}

const CAREER_STAGE_ALIGNMENT: Record<string, number> = {
  transitioning: 100,
  early: 100,
  established: 60,
  near_retirement: 40,
};

/** "career alignment (100 transitioning/early, 60 established, 40 near-retirement)". */
export function careerStageAlignment(careerStage: string | null): number {
  if (!careerStage) return 0;
  return CAREER_STAGE_ALIGNMENT[careerStage] ?? 0;
}

const FINANCIAL_SITUATION_ALIGNMENT: Record<string, number> = {
  building: 100,
  stuck: 100,
  just_starting: 60,
  wealth_building: 40,
};

/** "financial alignment (100 building/stuck, 60 just-starting, 40 wealth-building)". */
export function financialSituationAlignment(financialSituation: string | null): number {
  if (!financialSituation) return 0;
  return FINANCIAL_SITUATION_ALIGNMENT[financialSituation] ?? 0;
}

// ─── The weighted formula itself ──────────────────────────────────────────────────────────────────

export const READINESS_WEIGHTS = {
  clusterStrength: 0.3,
  contextCompleteness: 0.25,
  recency: 0.2,
  careerAlignment: 0.15,
  financialAlignment: 0.1,
} as const;

/** The raw 0-100 HIDDEN score, per the exact §8.2 formula. Rounded to the nearest integer (a
 *  Score is never a fractional/floating datum in this engine). */
export function computeReadinessScore(inputs: ReadinessInputs): number {
  const raw =
    clusterStrength(inputs.assignedClusterCount) * READINESS_WEIGHTS.clusterStrength +
    contextCompleteness(inputs.tilesFilledCount) * READINESS_WEIGHTS.contextCompleteness +
    relationshipRecency(inputs.daysSinceLastInteraction) * READINESS_WEIGHTS.recency +
    careerStageAlignment(inputs.careerStage) * READINESS_WEIGHTS.careerAlignment +
    financialSituationAlignment(inputs.financialSituation) * READINESS_WEIGHTS.financialAlignment;

  return Math.max(0, Math.min(100, Math.round(raw)));
}

// ─── §8.2 priority-tier mapping ────────────────────────────────────────────────────────────────────

export const TIER_A_THRESHOLD = 75;
export const TIER_B_THRESHOLD = 50;

export interface TierInputs {
  score: number;
  contextComplete: boolean;
  needsTime: boolean;
  /** True if EITHER the hard-exclusion boundary (eligibility.ts) OR the Layer-3
   *  "existing licensee" soft-exclusion flag (§8.1) applies to this contact. */
  excluded: boolean;
}

const TIER_LABELS: Record<ReadinessTier, string> = {
  [ReadinessTier.A]: 'Ready now',
  [ReadinessTier.B]: 'Ready soon',
  [ReadinessTier.SLOW_BURN]: 'Still building',
  [ReadinessTier.EXCLUDED]: 'Not eligible',
};

export function tierLabel(tier: ReadinessTier): string {
  return TIER_LABELS[tier];
}

/**
 * Maps the hidden score + context to the §8.2 tier table. Precedence (highest first):
 *   1. EXCLUDED — a hard/soft exclusion always wins regardless of score (§8.2's own tier row:
 *      "licensee/state-unlicensed/minor").
 *   2. SLOW_BURN — `needs_time` (Layer 2 "need more time") or an incomplete Layer-3 context, per
 *      §8.2's own row ("needs_time or context incomplete").
 *   3. A — score >= 75 AND context complete.
 *   4. B — score 50-74 AND context complete.
 *   5. SLOW_BURN — the remaining case (context complete, not excluded/needs_time, but score < 50):
 *      §8.2 does not name a fifth tier for "context-complete but not yet ready," and Slow Burn's own
 *      description ("deferred 30+ days ... a watch list") is the correct home for a not-yet-ready
 *      contact — never silently promoted to B.
 */
export function mapScoreToTier(inputs: TierInputs): ReadinessTier {
  if (inputs.excluded) return ReadinessTier.EXCLUDED;
  if (inputs.needsTime || !inputs.contextComplete) return ReadinessTier.SLOW_BURN;
  if (inputs.score >= TIER_A_THRESHOLD) return ReadinessTier.A;
  if (inputs.score >= TIER_B_THRESHOLD) return ReadinessTier.B;
  return ReadinessTier.SLOW_BURN;
}

/**
 * The single entry point orchestrating score -> tier -> label. `excluded` must already have been
 * decided by the caller (eligibility.ts's hard-exclusion check + the Layer-3 existing-licensee soft
 * flag) — this function does not re-derive exclusion, it only reacts to it, so there is exactly one
 * place (eligibility.ts) that owns "is this contact excluded."
 */
export function computeReadiness(inputs: ReadinessInputs, excluded: boolean, needsTime: boolean): ReadinessResult {
  const score = computeReadinessScore(inputs);
  const contextComplete = inputs.tilesFilledCount >= TOTAL_TILES;
  const tier = mapScoreToTier({ score, contextComplete, needsTime, excluded });
  return {
    score,
    tier,
    label: tierLabel(tier),
    contextComplete,
  };
}

// ─── The hidden-score tripwire — mirrors org-gate.ts's assertNoPrimericaLeak pattern ──────────────

export class ReadinessScoreLeakError extends Error {
  constructor(where: string, keys: string[]) {
    super(
      `Readiness render at "${where}" would leak the HIDDEN 0-100 score (key(s): ${keys.join(', ')}) ` +
        'to a rep-facing payload (§8.1/§8.2) — this is the named WP03 critical failure ("readiness ' +
        'score SHOWN to user") and this guard exists specifically to trip on it. Only `tier`/`label` ' +
        'may cross this boundary.'
    );
    this.name = 'ReadinessScoreLeakError';
  }
}

/** Field-name patterns that would indicate a raw numeric score reached a rep-facing payload. Scoped
 *  to this module's own vocabulary (never a generic "any number is suspicious" scan, which would
 *  false-positive on legitimate counts/timestamps elsewhere in a queue payload). */
const SCORE_KEY_RE = /(^|_)(readiness[_]?score|score)($|_)/i;

/**
 * Recursively scans an about-to-be-returned payload for any key matching the readiness-score
 * vocabulary whose value is a number — the data-layer tripwire that turns "we intended not to leak
 * the score" into "a leak is structurally caught before it reaches the wire" (exactly mirroring
 * `org-gate.ts`'s `assertNoPrimericaLeak`). Throws `ReadinessScoreLeakError` (never silently strips)
 * so a future refactor that accidentally spreads a raw DB row into a response is caught here.
 */
export function assertNoRawScoreLeak(payload: unknown, where = 'harvest_method_payload'): void {
  const hits: string[] = [];

  const walk = (node: unknown): void => {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'number' && SCORE_KEY_RE.test(key)) {
        hits.push(key);
      } else if (value && typeof value === 'object') {
        walk(value);
      }
    }
  };
  walk(payload);

  if (hits.length > 0) {
    throw new ReadinessScoreLeakError(where, hits);
  }
}

/** Builds the structurally-safe public projection of one queued contact — the ONLY function in this
 *  module that is allowed to construct a `PublicQueueItem`, so there is exactly one seam that could
 *  ever add a score field back in (and `assertNoRawScoreLeak` catches it if it does). */
export function toPublicQueueItem(
  input: Omit<PublicQueueItem, 'needsAcknowledgment'> & { tier: ReadinessTier }
): PublicQueueItem {
  const item: PublicQueueItem = {
    ...input,
    needsAcknowledgment: input.tier === ReadinessTier.EXCLUDED,
  };
  assertNoRawScoreLeak(item, 'toPublicQueueItem');
  return item;
}

/** Re-exported so callers of this module don't also need a direct eligibility.ts import just to
 *  read the hard-exclusion reason when assembling `TierInputs.excluded`. */
export function isHardExcluded(contact: EligibilityContactRow): boolean {
  return checkContactHardExclusion(contact) !== null;
}
