// T-31 (master-spec §4.5) — the REAL per-tier Claude pricing, replacing T-30's placeholder
// `EstimatingCostModel` (src/services/agent-runtime/seams.ts). Claude-only (§0.3): every rate below
// is keyed to a `ClaudeModelTier`; there is no non-Claude row and nothing here can price a
// non-Claude model id.
//
// Rates are cents per 1,000 tokens, derived from Anthropic's published per-model-family list
// pricing (cached 2026-06-24):
//   Haiku 4.5:  $1.00  / $5.00  per 1M tokens (input / output)
//   Sonnet 5:   $3.00  / $15.00 per 1M tokens (input / output) — the DURABLE rate. Anthropic also
//               publishes a temporary introductory rate ($2.00 / $10.00) through 2026-08-31;
//               deliberately NOT used here so this table stays correct after that date without a
//               follow-up edit (an operator who wants the temporary discount reflected can lower
//               these two numbers until then — see PRICING_INTRO_NOTE below).
//   Opus 4.8:   $5.00  / $25.00 per 1M tokens (input / output)
// Batch API: Anthropic's published Batch API discount is 50% off both input and output tokens.
//
// These are business-facing dollar figures, not a build-time constant Anthropic hands us in code —
// an operator should re-check them against platform.claude.com/docs/pricing on a cadence; this file
// is the single place that would need updating if list prices change.

import { ClaudeModelTier } from '../runtime-model-map';
import { CostInput, CostModel } from '../seams';

export const PRICING_INTRO_NOTE =
  'Sonnet 5 durable rate ($3.00/$15.00 per 1M) is used, not the temporary $2.00/$10.00 intro rate (expires 2026-08-31).';

/** Cents per 1,000 tokens, by Claude tier. Claude-only — every key is a `ClaudeModelTier`. */
export const CLAUDE_PRICING_CENTS_PER_1K: Record<ClaudeModelTier, { in: number; out: number }> = {
  [ClaudeModelTier.HAIKU_4_5]: { in: 0.1, out: 0.5 }, // $1.00 / $5.00 per 1M
  [ClaudeModelTier.SONNET_5]: { in: 0.3, out: 1.5 }, // $3.00 / $15.00 per 1M
  [ClaudeModelTier.OPUS_4_8]: { in: 0.5, out: 2.5 }, // $5.00 / $25.00 per 1M
};

/** Anthropic's published Batch API discount (§4.4/§4.5: "targets ~50% cost reduction on bulk work"). */
export const BATCH_API_DISCOUNT = 0.5;

/**
 * The real per-rep/per-org cost model (§4.5). Turns actual token usage on the ACTUAL Claude tier
 * used into `cost_cents` for the `AgentRun` roll-up (Sponsor Cockpit ROI story, §14). "Actual tier
 * used" matters: when the T-31 degradation ladder (degradation.ts) steps a run down from Sonnet to
 * Haiku, the generation result honestly reports `tier: HAIKU_4_5` — so a degraded run is priced (and
 * recorded) as Haiku, never silently billed as if it ran on Sonnet.
 *
 * Whole-cent granularity (`AgentRun.cost_cents` is an `Int`): a single cheap Haiku call can round to
 * 0 cents individually — that mirrors real whole-cent invoicing rather than fabricating a non-zero
 * minimum charge; the per-rep/day roll-up is dominated by Sonnet drafts and batched Opus work, which
 * round to a visible non-zero cost per call.
 */
export class TierPricingCostModel implements CostModel {
  costCents(input: CostInput): number {
    const rate = CLAUDE_PRICING_CENTS_PER_1K[input.tier];
    const raw = (input.tokenInput / 1000) * rate.in + (input.tokenOutput / 1000) * rate.out;
    const adjusted = input.batched ? raw * (1 - BATCH_API_DISCOUNT) : raw;
    return Math.max(0, Math.round(adjusted));
  }
}
