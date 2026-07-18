// WP03 §8.4 / §16.6 — "upline visibility of aggregate stats only (counts by tier, avg readiness,
// method completion %) — never individual names, background, or scores without explicit rep
// opt-in." This module is the ONE place an upline-facing view of a downline rep's method progress
// is assembled, and it is built so the named critical failure ("upline non-aggregate visibility")
// is structurally impossible, not merely avoided by convention:
//
//   - The input type (`RepMethodSummary[]`) carries ONLY tier + a per-contact readiness score (for
//     averaging) — no name, no contactId, no background tiles, no note. There is no contact-
//     identifying field anywhere in this module's input surface for a bug to accidentally forward.
//   - `assertAggregateOnly` is a second, defense-in-depth tripwire (mirrors `readiness-
//     engine.ts`'s `assertNoRawScoreLeak` / `org-gate.ts`'s `assertNoPrimericaLeak`) that scans the
//     ASSEMBLED aggregate payload for any key that looks contact-identifying and throws rather than
//     silently letting one through.
//
// RBAC gating (who may even call this) is `downline_visibility` in src/lib/auth/rbac-matrix.ts
// (§16.6 row 2: upline=team, rvp=org-wide, admin=full) — this module does not re-implement RBAC, it
// is the data-shaping layer §8.4 describes; the route wrapper is responsible for the role check plus
// the "without explicit rep opt-in" consent gate (deferred to the WP04/WP09 Mission Control surface
// that actually renders an upline dashboard — this build unit's job is the guarantee that whatever IS
// exposed can only ever be an aggregate).

import { ReadinessTier } from '@prisma/client';

import type { MethodLayer } from '../../types/harvest-method';
import { METHOD_LAYER_ORDER } from '../../types/harvest-method';

/** Deliberately NOT contact-identifying: no contactId, no name, no tiles, no note. */
export interface RepMethodSummaryEntry {
  tier: ReadinessTier;
  /** The HIDDEN per-contact score — consumed ONLY to compute the aggregate average below; never
   *  itself returned to a caller (see `computeUplineAggregateStats`'s return shape). */
  score: number;
}

export interface RepMethodSummary {
  entries: RepMethodSummaryEntry[];
  layersCompleted: MethodLayer[];
}

export interface UplineAggregateStats {
  countsByTier: Record<ReadinessTier, number>;
  /** Rounded average of the (still-hidden) per-contact scores — an AGGREGATE statistic, distinct
   *  from ever exposing one contact's individual score (§8.4 explicitly permits "avg readiness" at
   *  the aggregate level while forbidding individual scores). */
  avgReadiness: number;
  methodCompletionPercent: number;
}

const EMPTY_TIER_COUNTS: Record<ReadinessTier, number> = {
  [ReadinessTier.A]: 0,
  [ReadinessTier.B]: 0,
  [ReadinessTier.SLOW_BURN]: 0,
  [ReadinessTier.EXCLUDED]: 0,
  // T-29R2 — an aggregate count only (no contact identity), same as every other tier bucket here.
  [ReadinessTier.NEEDS_JURISDICTION]: 0,
};

/**
 * Computes the aggregate-only stats §8.4 permits an upline to see for one downline rep. Input is
 * intentionally a summary that never carried contact identity in the first place — this function
 * cannot leak what it was never given.
 */
export function computeUplineAggregateStats(summary: RepMethodSummary): UplineAggregateStats {
  const countsByTier = { ...EMPTY_TIER_COUNTS };
  let scoreSum = 0;
  for (const entry of summary.entries) {
    countsByTier[entry.tier] += 1;
    scoreSum += entry.score;
  }
  const avgReadiness = summary.entries.length > 0 ? Math.round(scoreSum / summary.entries.length) : 0;
  const methodCompletionPercent = Math.round((summary.layersCompleted.length / METHOD_LAYER_ORDER.length) * 100);

  return { countsByTier, avgReadiness, methodCompletionPercent };
}

export class UplineVisibilityLeakError extends Error {
  constructor(keys: string[]) {
    super(
      `Upline-facing aggregate payload would carry contact-identifying field(s): ${keys.join(', ')} ` +
        '— this is the named WP03 critical failure ("upline non-aggregate visibility", §8.4/§16.6). ' +
        'Only tier counts, avgReadiness, and methodCompletionPercent may cross this boundary.'
    );
    this.name = 'UplineVisibilityLeakError';
  }
}

/** Field-name patterns that would indicate a per-contact identifying value reached an upline-facing
 *  aggregate payload. */
const IDENTIFYING_KEY_RE =
  /(^|_)(contact[_]?id|first[_]?name|last[_]?name|name|note|background|career[_]?stage|financial[_]?situation|family[_]?context|community[_]?role|phone|email)($|_)/i;

/**
 * The tripwire every route/serializer for an upline aggregate view must run before returning. Scans
 * recursively (keys AND nested objects/arrays) and throws `UplineVisibilityLeakError` — never
 * silently strips — the same "catch it at the data layer" doctrine as `assertNoPrimericaLeak` /
 * `assertNoRawScoreLeak`.
 */
export function assertAggregateOnly(payload: unknown): void {
  const hits: string[] = [];

  const walk = (node: unknown): void => {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (IDENTIFYING_KEY_RE.test(key)) {
        hits.push(key);
      } else if (value && typeof value === 'object') {
        walk(value);
      }
    }
  };
  walk(payload);

  if (hits.length > 0) {
    throw new UplineVisibilityLeakError(hits);
  }
}
