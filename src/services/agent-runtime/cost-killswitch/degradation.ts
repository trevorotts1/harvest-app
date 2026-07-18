// T-31 (master-spec §4.4/§4.6, QC checkpoint #14) — the IN-ROSTER degradation ladder.
//
// §4.4: "Degradation stays inside the roster: if Sonnet 5 is saturated or rate-limited,
// non-quality-critical drafting can degrade to Haiku 4.5 with a 'draft quality reduced' flag on the
// Approval Inbox item — never to a non-Claude provider."
// §4.6: "Rate limit (429): the agent backs off and resumes at reduced velocity; within-roster
// degradation may apply; the run is retried idempotently."
//
// This wraps the INJECTED `AgentModelClient` (never constructs one itself — Claude-only, lazy) and
// is itself injected as `AgentRuntimeDeps.modelClient` (a seam T-30 already exposes). It never
// constructs a non-Claude client and never returns a fabricated/stubbed completion:
//   - Sonnet 5 under rate-limit/overload/cost-pressure -> retried ONCE at Haiku 4.5 (in-roster).
//   - Haiku 4.5 (already the floor) or Opus 4.8 (never a degradation target, §4.4 "reserved,
//     sparse, batched") -> no lower rung; a transient failure propagates unchanged, which is exactly
//     T-30's existing "FAILED + rethrow -> the durable queue retries idempotently" path (§4.6) — no
//     regression for those tiers.
//   - The Haiku retry ALSO fails -> the floor is exhausted: this throws
//     `DegradationFloorExhaustedError`, which (like any non-`MissingClaudeCredentialError` model
//     error) causes `AgentRuntime` to record the run FAILED and rethrow for an idempotent retry — no
//     draft is ever created and nothing is ever sent (fail-closed HOLD).
//
// Honesty (§4.6 "honest degradation"): a degraded call returns the REAL Haiku `tier`/`modelId` from
// the underlying client — never a synthesized Sonnet-shaped result. Because agent-handlers.ts
// already writes `reasoning: ... "on ${gen.modelId}"` and AgentRuntime persists `AgentRun.model_used
// = usage.tier`, the actual (degraded) model is automatically the one recorded — a degraded run
// cannot be silently billed or logged as if it ran on Sonnet. `DegradationAnnotatingStore`
// (degradation-store.ts) additionally appends a plain-language note to `reasoning_log` so the rep
// sees an explicit, honest "running on a lighter model" flag, not just an implicit model-id change.

import { AgentGenerationRequest, AgentGenerationResult, AgentModelClient, AgentModelError } from '../claude';
import { ClaudeModelTier } from '../runtime-model-map';

/** The only rung in the ladder (§4.4): Sonnet 5 -> Haiku 4.5. Haiku is the floor; Opus is never a
 *  degradation target. Every value here is a Claude tier — Claude-only, in-roster only. */
export const DEGRADATION_LADDER: Partial<Record<ClaudeModelTier, ClaudeModelTier>> = {
  [ClaudeModelTier.SONNET_5]: ClaudeModelTier.HAIKU_4_5,
};

/** Thrown when the ladder has no lower rung (already at Haiku, or Opus) or the floor ALSO fails.
 *  Deliberately NOT `MissingClaudeCredentialError` — the reason is pressure/rate-limiting, not a
 *  missing key, and the honest-degradation requirement means the reasoning must say so truthfully.
 *  Extends `AgentModelError` so `AgentRuntime`'s existing (T-30, unmodified) catch-all path applies:
 *  the run is recorded FAILED and rethrown for the durable queue to retry idempotently (§4.6) — the
 *  run HOLDS (no draft, no send) rather than fabricating or falling back off-roster. */
export class DegradationFloorExhaustedError extends AgentModelError {
  constructor(tier: ClaudeModelTier, cause: 'rate_limited' | 'overloaded' | 'floor_unavailable') {
    super(
      `In-roster degradation floor exhausted at Claude tier '${tier}' (${cause}) — holding, nothing sent; ` +
        'the durable queue will retry idempotently (§4.6). Never a non-Claude provider, never a fabricated completion.'
    );
    this.name = 'DegradationFloorExhaustedError';
  }
}

/** A rate-limit/overload signal from the Claude API. `AnthropicRuntimeClient` surfaces a non-2xx as
 *  a generic `AgentModelError` whose message embeds the HTTP status (its own comment: "A 429
 *  surfaces as AgentModelError"); this is the one place that needs to distinguish 429/529
 *  specifically, so the ladder degrades ONLY on genuine capacity pressure — never on a 4xx
 *  validation error, a timeout, or a missing-credential failure (which is a distinct error type and
 *  is never caught here). */
export function isRateLimitOrOverloadSignal(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\b(429|529)\b/.test(err.message) || /rate.?limit|overloaded/i.test(err.message);
}

export interface DegradationEvent {
  fromTier: ClaudeModelTier;
  toTier: ClaudeModelTier;
  reason: 'rate_limited' | 'overloaded' | 'cost_pressure';
}

export interface DegradingModelClientOptions {
  ladder?: Partial<Record<ClaudeModelTier, ClaudeModelTier>>;
  /** §4.4 "cost pressure": when true for the requested tier, skip the primary attempt and go
   *  straight to the floor (in-roster, honest) rather than spending on the tier likely to be
   *  throttled anyway. Optional — omitted entirely, only the reactive (rate-limit) path applies. */
  costPressureCheck?: () => Promise<boolean> | boolean;
}

/**
 * Wraps an injected `AgentModelClient` with the in-roster degradation ladder. Constructed fresh per
 * dispatch invocation (same lazy-per-request convention as the rest of the runtime) so its internal
 * degradation-event state never leaks across requests.
 */
export class DegradingModelClient implements AgentModelClient {
  private readonly ladder: Partial<Record<ClaudeModelTier, ClaudeModelTier>>;
  private readonly costPressureCheck?: () => Promise<boolean> | boolean;
  private lastDegradation: DegradationEvent | null = null;

  constructor(private readonly inner: AgentModelClient, opts: DegradingModelClientOptions = {}) {
    this.ladder = opts.ladder ?? DEGRADATION_LADDER;
    this.costPressureCheck = opts.costPressureCheck;
  }

  async generate(req: AgentGenerationRequest): Promise<AgentGenerationResult> {
    const floor = this.ladder[req.tier];

    // Proactive (§4.4 "cost pressure"): only when this tier HAS a lower rung to step to.
    if (floor && this.costPressureCheck) {
      const underPressure = await this.costPressureCheck();
      if (underPressure) {
        const result = await this.inner.generate({ ...req, tier: floor });
        this.lastDegradation = { fromTier: req.tier, toTier: floor, reason: 'cost_pressure' };
        return result;
      }
    }

    // Reactive (§4.6 rate-limit/overload): try the requested tier first.
    try {
      return await this.inner.generate(req);
    } catch (err) {
      if (!isRateLimitOrOverloadSignal(err)) throw err; // not a capacity signal — propagate unchanged

      if (!floor) {
        // Already at the floor (Haiku) or this tier is not on the ladder (Opus) — no in-roster step
        // remains. Fail closed: hold (no send), never fall off-roster.
        throw new DegradationFloorExhaustedError(req.tier, 'floor_unavailable');
      }

      try {
        const result = await this.inner.generate({ ...req, tier: floor });
        this.lastDegradation = {
          fromTier: req.tier,
          toTier: floor,
          reason: /529|overload/i.test((err as Error).message) ? 'overloaded' : 'rate_limited',
        };
        return result;
      } catch {
        // The floor ALSO failed — nothing left in the roster. Hold; never fabricate, never go
        // off-Claude.
        throw new DegradationFloorExhaustedError(floor, 'floor_unavailable');
      }
    }
  }

  /** Reads and clears the last degradation event — consumed once per run by
   *  `DegradationAnnotatingStore` so the honest note is written exactly once per degraded run. */
  consumeDegradation(): DegradationEvent | null {
    const event = this.lastDegradation;
    this.lastDegradation = null;
    return event;
  }
}
