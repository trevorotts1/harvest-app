// WP04 (T-30) — the agent runtime's Claude model-client boundary.
//
// Mirrors the DI-mockable Claude-client pattern already used by the CFE (src/services/compliance/
// claude/*), WP01 Seven Whys, and WP02 segmentation/jogger: ONE interface the runtime depends on,
// ONE real production implementation (AnthropicRuntimeClient) that calls the Anthropic Messages API
// and fails CLOSED with no key, and test/dev fakes injected in place of it. This file CONSUMES the
// compliance module's already-exported `MissingClaudeCredentialError` (read-only reuse) so there is
// exactly one definition of "what a missing-key failure looks like" across the whole app.
//
// Claude-only (§0.3, ABSOLUTE): the only production implementation targets the Anthropic API on a
// tier from `CLAUDE_MODEL_IDS`. There is no non-Claude implementation and no outside-provider
// fallback anywhere in this boundary. A missing key throws — it never degrades to a non-Claude
// provider and never returns a fabricated/stubbed completion on the live path.

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
