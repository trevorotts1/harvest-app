// WP08 §13.2 — the override-income math sheet a Rules-of-Building chip tap opens, "always FTC-
// safe-harbor-framed." Reuses the WP11 CFE's own `SAFE_HARBOR_DISCLAIMERS.income` text (never a
// second, drifting copy of the disclaimer) and computes STRUCTURE-only figures (a multiplication
// table under the 3-wide × 4-deep model) — never a dollar amount, which this codebase has no
// honest comp-plan/commission model to source (fabricating one would violate §18.6 "no fabricated
// content" and §0.5's "guaranteed income" ban).

import { SAFE_HARBOR_DISCLAIMERS } from '@/types/compliance';
import type { OverrideMathSheet } from '@/types/taprooting';
import { VISION_LEGS, VISION_DEPTH } from './tree-builder';

/** Illustrative team-size-at-depth under the idealized 3-wide × 4-deep model: `3^depth` — the
 *  textbook multiplication figure the Rules-of-Building math sheet visualizes, capped to the
 *  vision's own depth (tapping a level beyond `VISION_DEPTH` still returns a value; the model does
 *  not stop being illustrative just because a real leg has grown past the base vision). */
export function potentialTeamSizeAtDepth(depth: number): number {
  const safeDepth = Math.max(0, Math.round(depth));
  return Math.pow(VISION_LEGS, safeDepth);
}

/**
 * Builds the depth-scoped override-math sheet (uiux §4.8 "always FTC-safe-harbor-framed"). Never
 * includes a dollar figure — "potential" framing only (§0.5's forbidden→required vocabulary map:
 * "guaranteed income / you will earn" -> "potential (with the FTC safe-harbor line attached)").
 */
export function buildOverrideMathSheet(depth: number): OverrideMathSheet {
  const safeDepth = Math.max(1, Math.min(Math.round(depth), 10));
  const potential = potentialTeamSizeAtDepth(safeDepth);
  return {
    depth: safeDepth,
    potentialTeamSizeAtDepth: potential,
    narrative:
      `At depth ${safeDepth}, the ${VISION_LEGS}-wide × ${VISION_DEPTH}-deep multiplication model illustrates a ` +
      `potential structure of ${potential} team members — a structural illustration of the model, not a forecast ` +
      `or promise of any individual's results.`,
    safeHarborDisclaimer: SAFE_HARBOR_DISCLAIMERS.income,
  };
}
