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

export interface MomentumEventLike {
  law: string; // 'grow' | 'engage' | 'wealth' | 'cross'
  points: number;
  created_at: Date;
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
 *  celebration engine that flips that flag is WP07's (master spec §12.3), out of this unit's lane. */
export function computeBloomOverride(milestones: MilestoneLike[], now: Date = new Date()): { label: string } | null {
  const fresh = milestones.find(
    (m) => !m.celebrated && now.getTime() - m.achieved_at.getTime() <= BLOOM_FRESH_WINDOW_MS
  );
  return fresh ? { label: fresh.milestone_key.replaceAll('_', ' ') } : null;
}
