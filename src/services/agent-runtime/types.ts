// WP04 (T-30) — shared agent-runtime types (kept separate so the runtime and the nine handlers can
// both import them without a cycle).

import { AgentGenerationResult, AgentModelClient } from './claude';
import { AssembledPrompt, ContactContext, RepContext } from './prompt-assembly';
import { AgentKey, AgentSpec, ClaudeModelTier, OutputSurface } from './runtime-model-map';
import { PersistedChannel } from './store';

/** One unit of durable agent work (§2.3: one scheduled/evented trigger → one agent job). */
export interface AgentJobInput {
  agentKey: AgentKey;
  userId: string;
  /** Why this run fired (e.g. 'overnight_wave', 'reply_received', 'cron:evening_recap'). */
  trigger: string;
  /** Dedup key (§9.9-1). A replayed event with the same key no-ops (no duplicate send). */
  idempotencyKey: string;
  /** The community member this run targets, when the agent produces contact-bound output. */
  contactId?: string;
  /** The channel a produced draft targets (§10). Defaults to SMS_HANDOFF for first-touch. */
  channel?: PersistedChannel;
  rep?: RepContext;
  contact?: ContactContext;
  task?: string;
  /**
   * If set, the Prospecting / Warm-Market handlers run the Haiku 4.5 segmentation step over this
   * contact (via the injected HaikuSegmentationClient) before drafting. Left unset, the run skips
   * straight to drafting with the context already provided.
   */
  segmentContactId?: string;
}

/** What a handler produces. The runtime — NOT the handler — decides surfacing (CFE gate). */
export interface AgentOutput {
  surface: OutputSurface;
  /** The natural-language text (a draft, a briefing, an analysis). Absent for pure-numeric runs. */
  text?: string;
  channel?: PersistedChannel;
  /** Plain-language reasoning surfaced in the Activity Ledger (§4.1 #5 / §9.3). */
  reasoning: string;
  /** Token/tier usage from the model call, for the cost roll-up (§4.5) and the model-map test. */
  usage?: {
    tier: ClaudeModelTier;
    tokenInput: number;
    tokenOutput: number;
    batched: boolean;
    modelId: string;
  };
}

/** Everything a handler is handed. The handler never touches persistence or the CFE directly. */
export interface AgentHandlerContext {
  input: AgentJobInput;
  spec: AgentSpec;
  modelClient: AgentModelClient;
  /** Runs the Haiku 4.5 segmentation step (proves the injected Haiku client, HARD REQ). */
  segment: (contactId: string) => Promise<{ relationshipType: string }>;
  assemble: (surface: OutputSurface, task: string) => AssembledPrompt;
  /** Convenience: generate with a tier taken from this agent's §4.4 step map. */
  generateStep: (role: string, surface: OutputSurface, task: string) => Promise<AgentGenerationResult>;
}

export interface AgentHandler {
  key: AgentKey;
  handle(ctx: AgentHandlerContext): Promise<AgentOutput>;
}

export type { AgentKey, RepContext, ContactContext };
