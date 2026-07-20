// T-43 (WP07, master-spec §12.1) — the ten equally-weighted Momentum criteria.
//
// DESIGN NOTE (read before touching `mission-control/momentum.ts`): the existing WP04 interim
// (`computeMomentum` in that file) already implements the §12.1 OVERALL score/band/decay/sparkline
// correctly (per-Law sums, 72h-grace -1/day decay, 0-100 clamp, cross-law crediting all three Laws)
// and is proven by `tests/unit/mission-control-momentum.test.ts` — real, valuable, currently-green
// coverage this build does NOT touch or regress. What that interim explicitly does NOT do (its own
// header comment: "It does NOT implement the ten weighted criteria themselves — that engine is
// WP07's to build") is decompose the score into the ten NAMED criteria §12.1 lists. This module adds
// exactly that: a canonical criterion→Law map and a canonical `event_type`→criterion map, used by
// `computeMomentumCriteria` (added alongside the untouched `computeMomentum` in momentum.ts) to
// produce the ten 0-10 sub-scores for the "tap-to-expand ... per-Law breakdown" / "single action
// that most improves the weakest Law" UI (uiux §3.3) and for course/celebration crediting elsewhere
// in this package. The OVERALL 0-100 score and its band/decay/sparkline/Law totals remain exactly
// `computeMomentum`'s unchanged output — this is a strictly ADDITIVE breakdown lens over the same
// `MomentumEvent` stream, not a second, competing score.

export type MomentumLaw = 'grow' | 'engage' | 'wealth' | 'cross';

/** §12.1's ten named criteria, in the document's own listed order. */
export enum MomentumCriterion {
  OUTREACH_CONSISTENCY = 'OUTREACH_CONSISTENCY',
  ENGAGEMENT_FREQUENCY = 'ENGAGEMENT_FREQUENCY',
  BASE_RETENTION = 'BASE_RETENTION',
  WEALTH_VELOCITY = 'WEALTH_VELOCITY',
  DOWNLINE_MULTIPLIER = 'DOWNLINE_MULTIPLIER',
  BELIEF_METRIC = 'BELIEF_METRIC',
  PIPELINE_HEALTH = 'PIPELINE_HEALTH',
  COLLECTIVE_BENEFIT = 'COLLECTIVE_BENEFIT',
  ANTI_HOARDER_COMPLIANCE = 'ANTI_HOARDER_COMPLIANCE',
  HABIT_CONSISTENCY = 'HABIT_CONSISTENCY',
}

export const ALL_MOMENTUM_CRITERIA: MomentumCriterion[] = [
  MomentumCriterion.OUTREACH_CONSISTENCY,
  MomentumCriterion.ENGAGEMENT_FREQUENCY,
  MomentumCriterion.BASE_RETENTION,
  MomentumCriterion.WEALTH_VELOCITY,
  MomentumCriterion.DOWNLINE_MULTIPLIER,
  MomentumCriterion.BELIEF_METRIC,
  MomentumCriterion.PIPELINE_HEALTH,
  MomentumCriterion.COLLECTIVE_BENEFIT,
  MomentumCriterion.ANTI_HOARDER_COMPLIANCE,
  MomentumCriterion.HABIT_CONSISTENCY,
];

/** Human labels — doctrine-safe (§0.5), never "lead"/"prospect"/"closing" language. */
export const MOMENTUM_CRITERION_LABEL: Record<MomentumCriterion, string> = {
  [MomentumCriterion.OUTREACH_CONSISTENCY]: 'Outreach Consistency',
  [MomentumCriterion.ENGAGEMENT_FREQUENCY]: 'Engagement Frequency',
  [MomentumCriterion.BASE_RETENTION]: 'Base Retention',
  [MomentumCriterion.WEALTH_VELOCITY]: 'Wealth Velocity',
  [MomentumCriterion.DOWNLINE_MULTIPLIER]: 'Downline Multiplier',
  [MomentumCriterion.BELIEF_METRIC]: 'Belief Metric',
  [MomentumCriterion.PIPELINE_HEALTH]: 'Pipeline Health',
  [MomentumCriterion.COLLECTIVE_BENEFIT]: 'Collective Benefit',
  [MomentumCriterion.ANTI_HOARDER_COMPLIANCE]: 'Anti-Hoarder Compliance',
  [MomentumCriterion.HABIT_CONSISTENCY]: 'Habit Consistency',
};

/** §12.1's own Law mapping, verbatim ("cross-law" for Belief Metric and Habit Consistency). */
export const MOMENTUM_CRITERION_LAW: Record<MomentumCriterion, MomentumLaw> = {
  [MomentumCriterion.OUTREACH_CONSISTENCY]: 'grow',
  [MomentumCriterion.ENGAGEMENT_FREQUENCY]: 'engage',
  [MomentumCriterion.BASE_RETENTION]: 'engage',
  [MomentumCriterion.WEALTH_VELOCITY]: 'wealth',
  [MomentumCriterion.DOWNLINE_MULTIPLIER]: 'grow',
  [MomentumCriterion.BELIEF_METRIC]: 'cross',
  [MomentumCriterion.PIPELINE_HEALTH]: 'grow',
  [MomentumCriterion.COLLECTIVE_BENEFIT]: 'engage',
  [MomentumCriterion.ANTI_HOARDER_COMPLIANCE]: 'engage',
  [MomentumCriterion.HABIT_CONSISTENCY]: 'cross',
};

/**
 * `MomentumEvent.event_type` → criterion. This is the canonical vocabulary every real production
 * writer of a `MomentumEvent` row (today.service.ts's `recordMomentumEvent`, the agent runtime, this
 * package's own services) should use going forward. `draft_approved`/`appointment_confirmed`/
 * `attendance_marked` are the THREE event types WP04's `today.service.ts` already writes in trunk
 * (T-32) — kept here unchanged so those real, already-shipping IPAs keep crediting a criterion
 * instead of falling into the unattributed bucket the moment this ships.
 */
export const EVENT_TYPE_CRITERION: Record<string, MomentumCriterion> = {
  // §12.1 "introduction sent +1-3"
  introduction_sent: MomentumCriterion.OUTREACH_CONSISTENCY,
  draft_approved: MomentumCriterion.OUTREACH_CONSISTENCY,
  // §12.1 "response +2-5"
  response_received: MomentumCriterion.ENGAGEMENT_FREQUENCY,
  attendance_marked: MomentumCriterion.ENGAGEMENT_FREQUENCY,
  // §12.1 "appointment set +5-8"
  appointment_set: MomentumCriterion.PIPELINE_HEALTH,
  appointment_confirmed: MomentumCriterion.PIPELINE_HEALTH,
  // §12.1 "appointment held +3-6"
  appointment_held: MomentumCriterion.WEALTH_VELOCITY,
  client_signed: MomentumCriterion.WEALTH_VELOCITY,
  // §12.1 "recruit joined +8-10"
  recruit_joined: MomentumCriterion.DOWNLINE_MULTIPLIER,
  // §12.1 "daily login + review +1"
  daily_login_review: MomentumCriterion.HABIT_CONSISTENCY,
  course_module_completed: MomentumCriterion.HABIT_CONSISTENCY,
  // Derived/periodic criteria (§12.1 "Belief Metric ... Haiku 4.5 sentiment on rep notes + script
  // acceptance"; "Anti-Hoarder Compliance ... flags wealth-distribution imbalance"; "Collective
  // Benefit") — written by the nightly momentum-reconciliation job (momentum-engine.service.ts),
  // not the per-IPA real-time path. Still ordinary `MomentumEvent` rows, same decay math.
  belief_sentiment_reviewed: MomentumCriterion.BELIEF_METRIC,
  base_retained: MomentumCriterion.BASE_RETENTION,
  collective_benefit_action: MomentumCriterion.COLLECTIVE_BENEFIT,
  balanced_giving_check: MomentumCriterion.ANTI_HOARDER_COMPLIANCE,
};

export function criterionForEventType(eventType: string | undefined | null): MomentumCriterion | null {
  if (!eventType) return null;
  return EVENT_TYPE_CRITERION[eventType] ?? null;
}

/**
 * §12.1 "Maps to the five Downline-Maxxer levels (Seed That Never Sprouted 0–19 → Full Harvest
 * Maxxer 80–100)." The spec names only the two endpoints verbatim; the three interior names below
 * are this build's documented, doctrine-consistent completion of that table (Grove-metaphor
 * consistent with the existing seed→sprout→thriving vocabulary already in momentum.ts/Grove.tsx) —
 * never shaming language, matching the non-shame rule that already governs every other named state
 * in this product (uiux AC-3-2/AC-4-9).
 */
const DOWNLINE_MAXXER_LEVELS: { min: number; name: string }[] = [
  { min: 80, name: 'Full Harvest Maxxer' },
  { min: 60, name: 'Thriving Grove' },
  { min: 40, name: 'Steady Grower' },
  { min: 20, name: 'Sprouting Seedling' },
  { min: 0, name: 'Seed That Never Sprouted' },
];

export function downlineMaxxerLevel(score: number): string {
  const clamped = Math.max(0, Math.min(100, score));
  const level = DOWNLINE_MAXXER_LEVELS.find((l) => clamped >= l.min);
  return level?.name ?? 'Seed That Never Sprouted';
}

export type MomentumCriteriaBreakdown = Record<MomentumCriterion, number>;

/**
 * How `computeMomentumCriteria` (momentum.ts) aggregates a criterion's events into its 0-10 score:
 *   - `sum` — count-like criteria: every matching event is a genuinely additional contribution
 *     (another introduction sent, another recruit joined), so their decayed POINTS SUM (clamped at
 *     10) is the right model — identical in kind to how a whole Law total is computed today.
 *   - `latest` — state/rate-like criteria (a ratio or a periodic reading, not a count of discrete
 *     actions): Base Retention, Collective Benefit, Anti-Hoarder Compliance, and Belief Metric are
 *     each written ONCE PER DAY by the nightly reconciliation job (momentum-engine.service.ts) as a
 *     fresh snapshot of a percentage/ratio at that moment. Summing repeated daily snapshots of the
 *     SAME underlying ratio would double-count and saturate at 10 within days regardless of the
 *     rep's real trend — the correct read is "the most recent reading, decayed toward 0 if stale"
 *     (the same 72h-grace/-1-per-day rule, so a reconciliation job that stops running honestly fades
 *     rather than freezing a possibly-stale high score forever — no fabricated content, §18.6).
 */
export const MOMENTUM_CRITERION_MODE: Record<MomentumCriterion, 'sum' | 'latest'> = {
  [MomentumCriterion.OUTREACH_CONSISTENCY]: 'sum',
  [MomentumCriterion.ENGAGEMENT_FREQUENCY]: 'sum',
  [MomentumCriterion.BASE_RETENTION]: 'latest',
  [MomentumCriterion.WEALTH_VELOCITY]: 'sum',
  [MomentumCriterion.DOWNLINE_MULTIPLIER]: 'sum',
  [MomentumCriterion.BELIEF_METRIC]: 'latest',
  [MomentumCriterion.PIPELINE_HEALTH]: 'sum',
  [MomentumCriterion.COLLECTIVE_BENEFIT]: 'latest',
  [MomentumCriterion.ANTI_HOARDER_COMPLIANCE]: 'latest',
  [MomentumCriterion.HABIT_CONSISTENCY]: 'sum',
};
