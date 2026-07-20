// WP08 §13.1/§13.4 — per-node health (Three-Law tint) + stagnation detection.
//
// Deliberately REUSES `computeMomentum` (src/services/mission-control/momentum.ts, WP04) as the
// SOLE Three-Law scoring engine — the same band cutoffs (80-100 thriving / 60-79 growing / 40-59
// quiet / 0-39 resting) that drive the Grove/Mission-Control header drive an orchard node's health
// tint here. This module does not reimplement scoring; it only maps that one existing result onto
// the §13.1 tint vocabulary (green/yellow/red) and layers the §13.4 stagnation (>30 days no
// advance) signal on top.

import { computeMomentum, type MomentumEventLike } from '@/services/mission-control/momentum';
import type { HealthTint, NodeHealth } from '@/types/taprooting';

/** §13.4 "Stagnation (no advance > 30 days)". */
export const STAGNATION_THRESHOLD_DAYS = 30;

/**
 * §13.1 "green active/growth, yellow stagnant/retention-risk, red reverse-maxxing" — mapped onto
 * `computeMomentum`'s existing four-band model: thriving/growing => green (actively maxxing);
 * quiet => yellow (stagnant, at retention risk but not yet declining); resting => red (the node has
 * gone dark — reverse-maxxing, per the §1 doctrine that growth/engagement/wealth must all stay lit).
 */
function tintForBand(band: 'thriving' | 'growing' | 'quiet' | 'resting'): HealthTint {
  if (band === 'thriving' || band === 'growing') return 'green';
  if (band === 'quiet') return 'yellow';
  return 'red';
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Computes a node's health from its OWN MomentumEvent rows (never a downline aggregate — §13.1
 * "real recruits as growing trees whose size/foliage reflect THEIR OWN activity"). `lastActivityAt`
 * may come from a wider signal than momentum events alone (e.g. the most recent OrgTreeEdge this
 * node produced as a sponsor) — passed in explicitly so callers can combine signals without this
 * module needing to know about every activity source.
 */
export function computeNodeHealth(
  events: MomentumEventLike[],
  now: Date,
  extraLastActivityAt?: Date | null
): NodeHealth {
  const momentum = computeMomentum(events, now);
  const tint = tintForBand(momentum.band);

  const momentumLastActivity = events.reduce<Date | null>((max, e) => {
    if (!max || e.created_at > max) return e.created_at;
    return max;
  }, null);
  const lastActivityAt =
    extraLastActivityAt && (!momentumLastActivity || extraLastActivityAt > momentumLastActivity)
      ? extraLastActivityAt
      : momentumLastActivity;

  const daysSinceLastActivity = lastActivityAt ? daysBetween(now, lastActivityAt) : null;
  const stagnant = daysSinceLastActivity !== null && daysSinceLastActivity > STAGNATION_THRESHOLD_DAYS;

  return {
    tint,
    score: momentum.score,
    laws: momentum.laws,
    stagnant,
    daysSinceLastActivity: daysSinceLastActivity === null ? null : Math.round(daysSinceLastActivity),
  };
}

/** A node with zero events and no other activity signal — the honest "no data yet" default (a
 *  brand-new recruit, day one) rather than a fabricated score. */
export function emptyNodeHealth(): NodeHealth {
  return { tint: 'green', score: 0, laws: { grow: 0, engage: 0, wealth: 0 }, stagnant: false, daysSinceLastActivity: null };
}
