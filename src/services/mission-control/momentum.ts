// WP04 (T-32) — Momentum + Grove computation (uiux §3, master-spec §12.1 "Momentum Score").
//
// §12.1 (the full ten-equally-weighted-criteria engine, decay, and celebration wiring) is WP07 —
// Wave 5, not yet built; nothing in trunk today writes a `MomentumEvent` row (confirmed: the model
// is otherwise referenced only by the GDPR/CCPA deletion cascade in
// src/services/compliance/data-rights/data-rights.ts). This module is a deliberately SIMPLER,
// forward-compatible interim: it reads whatever real `MomentumEvent` rows exist (none, honestly,
// until WP07 or this unit's own real IPAs — see today.service.ts's `recordMomentumEvent` — write
// some) using the SAME shape (`law`, `points`, `created_at`) WP07 will populate at full fidelity, and
// the SAME band cutoffs / decay rule §12.1 states (80-100 thriving / 60-79 growing / 40-59 at-risk
// ["Quiet"/"Resting" in uiux §3.2] / 0-39 critical, decay -1/day after 72h inactivity). It does NOT
// implement the ten weighted criteria themselves (that engine is WP07's to build) — only the
// aggregate score/band/sparkline/per-Law breakdown Mission Control needs to render honestly today.
//
// `cross`-law events (Belief Metric, Habit Consistency, §12.1) deliberately credit ALL THREE Law
// sums, not a third each — doctrine (master spec §1: "The Three Laws must be active
// simultaneously... never celebrates one while another is dark") reads a cross-law event as
// something that genuinely lifts all three at once, not a diluted fractional credit.

import type { GroveState, LawBreakdown, MomentumBand, MomentumResult } from './types';
import {
  ALL_MOMENTUM_CRITERIA,
  criterionForEventType,
  downlineMaxxerLevel,
  MOMENTUM_CRITERION_LAW,
  MOMENTUM_CRITERION_MODE,
  MomentumCriterion,
  type MomentumCriteriaBreakdown,
} from '../gamification/momentum-criteria';

export interface MomentumEventLike {
  law: string; // 'grow' | 'engage' | 'wealth' | 'cross'
  points: number;
  created_at: Date;
  // T-43 (WP07 §12.1): OPTIONAL — the ten-criteria breakdown (`computeMomentumCriteria` below) reads
  // this to attribute an event to one of the ten named criteria. Deliberately optional so every
  // existing caller/fixture that only ever set `law`/`points`/`created_at` (this file's own
  // `computeMomentum`, and every fixture in tests/unit/mission-control-momentum.test.ts) keeps
  // compiling and behaving IDENTICALLY — `computeMomentum`'s score/band/decay/sparkline/Law-total
  // math below is completely unchanged by this addition.
  event_type?: string;
}

export interface MilestoneLike {
  milestone_key: string;
  achieved_at: Date;
  celebrated: boolean;
}

const DECAY_GRACE_DAYS = 3; // §12.1: "decays -1/day after 72h inactivity"
const DECAY_PER_DAY = 1;
const BLOOM_FRESH_WINDOW_MS = 10 * 60 * 1000; // a milestone counts as "just happened" for 10 minutes

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/** One Law's 0-100 score as of `asOf`, from every event at/before that instant (§12.1 decay rule). */
function lawScoreAsOf(events: MomentumEventLike[], law: 'grow' | 'engage' | 'wealth', asOf: Date): number {
  const relevant = events.filter((e) => (e.law === law || e.law === 'cross') && e.created_at.getTime() <= asOf.getTime());
  if (relevant.length === 0) return 0;
  const sum = relevant.reduce((s, e) => s + e.points, 0);
  const lastAt = relevant.reduce((max, e) => (e.created_at > max ? e.created_at : max), relevant[0].created_at);
  const idleDays = daysBetween(asOf, lastAt);
  const decay = Math.max(0, idleDays - DECAY_GRACE_DAYS) * DECAY_PER_DAY;
  return clamp(Math.round(sum - decay), 0, 100);
}

function bandOf(score: number): MomentumBand {
  if (score >= 80) return 'thriving';
  if (score >= 60) return 'growing';
  if (score >= 40) return 'quiet';
  return 'resting';
}

/** Computes the overall score, band, per-Law breakdown, and a 7-day (oldest→newest) sparkline. */
export function computeMomentum(events: MomentumEventLike[], now: Date = new Date()): MomentumResult {
  const laws: LawBreakdown = {
    grow: lawScoreAsOf(events, 'grow', now),
    engage: lawScoreAsOf(events, 'engage', now),
    wealth: lawScoreAsOf(events, 'wealth', now),
  };
  const score = Math.round((laws.grow + laws.engage + laws.wealth) / 3);

  const sparkline: number[] = [];
  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    const asOf = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const g = lawScoreAsOf(events, 'grow', asOf);
    const e = lawScoreAsOf(events, 'engage', asOf);
    const w = lawScoreAsOf(events, 'wealth', asOf);
    sparkline.push(Math.round((g + e + w) / 3));
  }

  return { score, band: bandOf(score), sparkline, laws, totalEventCount: events.length };
}

/** uiux §3.2: Seed (pre-first-action) → Sprout (first IPA) → the ongoing band states. Bloom/Stale
 *  are presentation-layer overrides applied by the caller (a fresh milestone; a degraded fetch),
 *  not something this pure function decides — see `computeBloomOverride` below and
 *  today.service.ts's header-zone assembly. */
export function computeGroveBandState(momentum: MomentumResult): GroveState {
  if (momentum.totalEventCount === 0) return 'seed';
  if (momentum.totalEventCount === 1) return 'sprout';
  return momentum.band;
}

/** uiux §3.2 caption table — "always icon + text", never shaming. */
export function groveCaptionFor(state: GroveState, bloomLabel?: string): string {
  switch (state) {
    case 'seed':
      return 'Your field is planted — the First 48 starts now';
    case 'sprout':
      return "It's alive. Keep going.";
    case 'thriving':
      return 'Thriving';
    case 'growing':
      return 'Growing';
    case 'quiet':
      return 'Your field is quiet — one small action wakes it up';
    case 'resting':
      return 'Resting, ready to regrow';
    case 'bloom':
      return bloomLabel ?? 'Bloom';
    case 'stale':
      return 'as of last update';
    default:
      return 'Resting, ready to regrow';
  }
}

/** A milestone achieved within the last 10 minutes and not yet shown triggers the transient Bloom
 *  overlay (uiux §3.2 "Bloom (transient)"). Pure/testable; does not mutate `celebrated` itself — the
 *  celebration engine that flips that flag is WP07's (master spec §12.3), out of this unit's lane.
 *  `label` (kept, unchanged, for existing callers/tests) is the raw-key fallback caption; `key` is
 *  the raw `milestone_key` itself, ADDITIVE (T-52) so a caller with access to WP07's
 *  celebration.service.ts (e.g. mission-control/zones/header.ts) can build the full uiux §6.1 item 5
 *  "Milestone full-bloom" narration script from it without this module taking on a WP07 dependency
 *  — see this file's header comment on why momentum.ts stays decoupled from the celebration engine. */
export function computeBloomOverride(milestones: MilestoneLike[], now: Date = new Date()): { key: string; label: string } | null {
  const fresh = milestones.find(
    (m) => !m.celebrated && now.getTime() - m.achieved_at.getTime() <= BLOOM_FRESH_WINDOW_MS
  );
  return fresh ? { key: fresh.milestone_key, label: fresh.milestone_key.replaceAll('_', ' ') } : null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T-43 (WP07 §12.1) — the ten-criteria breakdown. ADDITIVE ONLY (see the file-header design note
// and momentum-criteria.ts): does not change `computeMomentum`'s score/band/decay/sparkline output.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** One named criterion's 0-10 score as of `asOf`, from events mapped to it, using the SAME
 *  72h-grace/-1-per-day decay rule `lawScoreAsOf` applies to a whole Law, just capped at 10 instead
 *  of 100 (§12.1: "ten equally-weighted criteria, 10 pts each"). `'sum'`-mode criteria decay-sum every
 *  matching event (count-like); `'latest'`-mode criteria use only the single most recent matching
 *  event's own points as the current reading, decayed toward 0 if it goes stale (state/rate-like —
 *  see MOMENTUM_CRITERION_MODE's doc comment for why summing would be wrong for these four). */
function criterionScoreAsOf(events: MomentumEventLike[], criterion: MomentumCriterion, asOf: Date): number {
  const relevant = events.filter(
    (e) => criterionForEventType(e.event_type) === criterion && e.created_at.getTime() <= asOf.getTime()
  );
  if (relevant.length === 0) return 0;

  if (MOMENTUM_CRITERION_MODE[criterion] === 'latest') {
    const latest = relevant.reduce((max, e) => (e.created_at > max.created_at ? e : max), relevant[0]);
    const idleDays = daysBetween(asOf, latest.created_at);
    const decay = Math.max(0, idleDays - DECAY_GRACE_DAYS) * DECAY_PER_DAY;
    return clamp(Math.round(latest.points - decay), 0, 10);
  }

  const sum = relevant.reduce((s, e) => s + e.points, 0);
  const lastAt = relevant.reduce((max, e) => (e.created_at > max ? e.created_at : max), relevant[0].created_at);
  const idleDays = daysBetween(asOf, lastAt);
  const decay = Math.max(0, idleDays - DECAY_GRACE_DAYS) * DECAY_PER_DAY;
  return clamp(Math.round(sum - decay), 0, 10);
}

export interface MomentumCriteriaResult {
  criteria: MomentumCriteriaBreakdown;
  /** §12.1 "maps to the five Downline-Maxxer levels" — derived from `computeMomentum`'s UNCHANGED
   *  overall score, so there is exactly one authoritative Momentum Score in the product; this is a
   *  five-tier NAME for that same number, not a second score. */
  levelName: string;
  /** The single named criterion, within the CURRENT weakest Law, with the lowest 0-10 score — the
   *  uiux §3.3 "tap-to-expand ... the single action that most improves the weakest Law" driver. */
  weakestCriterion: MomentumCriterion;
}

/** The ten-criteria breakdown + five-level name, layered on top of `computeMomentum`'s existing,
 *  unchanged Law/score/band/decay computation (§12.1's own note: "Recalculates on every IPA" — this
 *  is a pure, synchronous read-time computation, so it is current within the caller's own request
 *  latency, satisfying the <=60s AC by construction, not by a cache/cron). */
export function computeMomentumCriteria(events: MomentumEventLike[], now: Date = new Date()): MomentumCriteriaResult {
  const overall = computeMomentum(events, now);

  const criteria = {} as MomentumCriteriaBreakdown;
  for (const c of ALL_MOMENTUM_CRITERIA) {
    criteria[c] = criterionScoreAsOf(events, c, now);
  }

  const weakestLaw = (Object.entries(overall.laws) as [keyof LawBreakdown, number][]).reduce((min, cur) =>
    cur[1] < min[1] ? cur : min
  )[0];
  const criteriaInWeakestLaw = ALL_MOMENTUM_CRITERIA.filter(
    (c) => MOMENTUM_CRITERION_LAW[c] === weakestLaw || MOMENTUM_CRITERION_LAW[c] === 'cross'
  );
  const weakestCriterion = criteriaInWeakestLaw.reduce((min, c) => (criteria[c] < criteria[min] ? c : min),
    criteriaInWeakestLaw[0] ?? ALL_MOMENTUM_CRITERIA[0]
  );

  return {
    criteria,
    levelName: downlineMaxxerLevel(overall.score),
    weakestCriterion,
  };
}
