// WP03 §8.4 — the Primerica overlay: additive method context that activates ONLY behind the
// `organization = primerica` org-branch check locked at WP01 (§17.1, §8 preamble). This module adds
// NOTHING to the universal three-layer method or the readiness formula (§8.1/§8.2 are identical for
// every org) — it only supplies the extra rank-tiered-velocity framing §8.4 names, and it does so
// through the existing `org-gate.ts` primitives rather than a second, parallel gate:
//
//   - `gatePrimericaValue` — the overlay object is `undefined` outright for a universal user (not a
//     null-with-Primerica-shaped-key), so the "Primerica leak" critical failure has no field to leak
//     into for the 4/5 of users who are universal.
//   - `assertNoPrimericaLeak` — a second, data-layer tripwire callers run on the FULL assembled queue
//     payload (contacts + overlay) before it crosses the API boundary for a non-Primerica caller.
//
// The overlay is deliberately thin here: full rank-tiered queue REORDERING and the upline-visibility
// aggregate surface (§8.4's other two clauses) are the next seam (WP04's action-queue consumption,
// §8.3) — this build unit's job is the method + readiness ENGINE, and the overlay's contract point is
// that engine never assumes Primerica by default (§17.1's "fail-closed: anything not explicitly
// PRIMERICA is universal").

import { OrgType } from '@prisma/client';

import { gatePrimericaValue, isPrimericaBranch } from '../onboarding/wp01/org-gate';

export interface PrimericaVelocityContext {
  /** §8.4: "rank-tiered velocity (queue urgency accounts for rank + promotion target)." */
  rank: string | null;
  urgencyNote: string;
}

/**
 * Builds the Primerica-only velocity context for a queue render. Returns `undefined` for a
 * universal (non-Primerica) user — the field is simply absent, never a null Primerica-shaped stub —
 * per `org-gate.ts`'s own `OrgContext.solutionNumberField` pattern (§17.1).
 */
export function buildPrimericaVelocityContext(orgType: OrgType, rank: string | null): PrimericaVelocityContext | undefined {
  return gatePrimericaValue(orgType, {
    rank,
    urgencyNote: rank
      ? `Queue urgency is weighted toward your next promotion target at ${rank}.`
      : 'Queue urgency will weight toward your next promotion target once your rank is on file.',
  });
}

export { isPrimericaBranch };
