// WP04 (T-30) — the clean seams the WP04 companions consume. This file OWNS no policy; it only
// defines the injectable boundaries so T-31/T-32/T-33/T-34 can plug in without touching the runtime.
//
//   • RunGate  (T-31 cost model & kill-switch, §4.5/§4.6) — the runtime asks the gate BEFORE it
//     spends any Claude tokens. The default gate allows everything (the runtime core does not itself
//     implement budgets); T-31 supplies a gate that denies a non-critical run when the per-rep daily
//     budget is exhausted or the org/platform kill-switch has tripped, while letting CRITICAL runs
//     (CFE, inbound handling, appointment confirmations, §4.5) through.
//   • CostModel (T-31, §4.5) — turns a run's token usage + tier into `cost_cents`. The default is a
//     coarse, honest per-token estimate; T-31 replaces it with the real tier pricing + Batch API
//     discount. Every AgentRun already records token_input/token_output/model_used/batched, so the
//     cost roll-up (Sponsor Cockpit, §14) reads straight off the run stream.

import { ClaudeModelTier } from './runtime-model-map';

/** Runs on the critical path stay alive even when the kill-switch trips (§4.5). */
export type RunCriticality = 'critical' | 'non_critical';

export interface RunGateRequest {
  userId: string;
  agentKey: string;
  criticality: RunCriticality;
  /** §4.4 tier the run's primary step will use — lets a budget gate price the run before spending. */
  primaryTier: ClaudeModelTier;
}

export interface RunGateDecision {
  allowed: boolean;
  /** Machine reason when denied, e.g. 'budget_exhausted' | 'kill_switch' (rep-honest copy in §4.6). */
  reason?: string;
  /**
   * T-R27 (§4.5 concurrency hardening) — present only when `check()` placed an outstanding
   * RESERVATION against the rep's budget as part of admitting this run (closes T-56's documented
   * per-rep concurrent-burst gap: a reservation-aware gate, not just check-then-spend). The caller
   * MUST invoke this exactly once, on EVERY exit path (successful completion, CFE hold, missing
   * credential, thrown error alike) — typically via `try { ... } finally { await decision.release?.() }`
   * — so the hold is dropped once the run's real cost has landed (or the run failed) and never leaks.
   * Absent/undefined when no reservation was made (denied, critical-path bypass, an unresolvable rep,
   * or a gate implementation — like `AllowAllRunGate` — that doesn't reserve at all).
   */
  release?: () => Promise<void>;
}

/**
 * The budget / kill-switch seam (T-31). The runtime consults this before it generates. Deny → the
 * run defers (recorded, not run) with an honest reason; it never fabricates output.
 */
export interface RunGate {
  check(req: RunGateRequest): Promise<RunGateDecision> | RunGateDecision;
}

/** Default: allow every run. The runtime core does NOT implement budgets — that is T-31's lane. */
export class AllowAllRunGate implements RunGate {
  check(): RunGateDecision {
    return { allowed: true };
  }
}

export interface CostInput {
  tier: ClaudeModelTier;
  tokenInput: number;
  tokenOutput: number;
  batched: boolean;
}

/** The cost seam (T-31). Turns token usage into `cost_cents` for the per-rep/per-org roll-up (§4.5). */
export interface CostModel {
  costCents(input: CostInput): number;
}

/**
 * Default coarse estimate — deliberately simple and never zero for real usage, so T-31 can drop in
 * real tier pricing without the runtime having baked a fake number in. Batched work is halved to
 * reflect the ~50% Batch API target (§4.4/§4.5); the real rates are T-31's to set.
 */
export class EstimatingCostModel implements CostModel {
  // Rough relative per-1K-token weights (cents), Haiku << Sonnet << Opus — placeholders for T-31.
  private static readonly PER_1K_CENTS: Record<ClaudeModelTier, { in: number; out: number }> = {
    [ClaudeModelTier.HAIKU_4_5]: { in: 0.1, out: 0.4 },
    [ClaudeModelTier.SONNET_5]: { in: 0.3, out: 1.5 },
    [ClaudeModelTier.OPUS_4_8]: { in: 1.5, out: 7.5 },
  };

  costCents(input: CostInput): number {
    const rate = EstimatingCostModel.PER_1K_CENTS[input.tier];
    const raw = (input.tokenInput / 1000) * rate.in + (input.tokenOutput / 1000) * rate.out;
    const adjusted = input.batched ? raw * 0.5 : raw;
    return Math.max(0, Math.round(adjusted));
  }
}
