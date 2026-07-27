// WP04 (T-30) — the agent runtime's model-client boundary.
//
// Mirrors the DI-mockable client pattern already used by the CFE (src/services/compliance/
// claude/*), WP01 Seven Whys, and WP02 segmentation/jogger: ONE interface the runtime depends on,
// and injectable production/test implementations. `AnthropicRuntimeClient` (this file) is RETAINED
// but is NO LONGER the default (see below); it consumes the compliance module's already-exported
// `MissingClaudeCredentialError` (read-only reuse) so there is exactly one definition of "what a
// missing-key failure looks like" across the whole app.
//
// §0.3 AMENDED (operator directive 2026-07-27): the prior Claude-only doctrine is retired. The
// DEFAULT production AI provider is now Agnes (`AgnesRuntimeClient`, src/services/agent-runtime/
// agnes/, model `agnes-2.0-flash`, key AGNES_AI_API_KEY). This Anthropic implementation is kept as
// an unused alternate for revertability. The FAIL-CLOSED property is provider-independent and
// UNCHANGED: a missing key throws — it never degrades to another provider and never returns a
// fabricated/stubbed completion on the live path.

import { MissingClaudeCredentialError } from '@/services/compliance/claude';
import { ClaudeModelTier } from '../runtime-model-map';

export { MissingClaudeCredentialError };

/** A single agent model call (§4.3 prompt assembly: cached system prompt + per-call user prompt). */
export interface AgentGenerationRequest {
  /** Which Claude tier §4.4 mandates for this step. The client maps it to the wire model id. */
  tier: ClaudeModelTier;
  /** Cached, stable doctrine + compliance + org-context system prompt (§4.3, prompt-cached). */
  systemPrompt: string;
  /** Per-call user prompt (the specific contact/task context, §4.3). */
  userPrompt: string;
  /** §4.4: batched (Batch API) work — Opus periodic + overnight waves. Recorded on the run. */
  batched?: boolean;
  /**
   * Optional per-call output-token budget. NOT a way to exceed the cost-killswitch's worst-case
   * reservation bound: `AnthropicRuntimeClient` (the only production implementation) CLAMPS this to
   * `HARD_MAX_OUTPUT_TOKENS_PER_RUN` (runtime-model-map.ts) on the wire regardless of what is passed
   * here (T-R27 fix) — this field can only ever REQUEST a smaller budget than the hard cap, never a
   * larger one.
   */
  maxTokens?: number;
}

export interface AgentGenerationResult {
  text: string;
  /** The exact Anthropic model id used (a `claude-*` id) — recorded on `AgentRun.model_used`'s tier. */
  modelId: string;
  tier: ClaudeModelTier;
  tokenInput: number;
  tokenOutput: number;
  batched: boolean;
}

/**
 * The runtime's dependency-injected model boundary. Exactly one real path (AnthropicRuntimeClient)
 * and test/dev fakes implement this. The runtime never constructs a provider inline — it calls
 * `generate` on whatever client was injected, so fail-closed behavior is provable with no live key.
 */
export interface AgentModelClient {
  generate(req: AgentGenerationRequest): Promise<AgentGenerationResult>;
}

/** A Claude model call failed transport-side (non-2xx, bad body, no fetch). Fails the run CLOSED. */
export class AgentModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentModelError';
  }
}

/** A Claude model call timed out. Fails the run CLOSED (no fabricated completion). */
export class AgentModelTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Agent model call timed out after ${timeoutMs}ms.`);
    this.name = 'AgentModelTimeoutError';
  }
}
