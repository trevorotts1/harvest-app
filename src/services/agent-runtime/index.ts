// WP04 (T-30) — the nine-agent runtime core public surface.
//
// SEAMS FOR THE WP04 COMPANIONS (exposed here, implemented by them — this unit builds none of them):
//   • T-31 cost/kill-switch — inject a `RunGate` (deny non-critical runs on budget/kill-switch;
//     critical paths pass) and a `CostModel` (real tier pricing + Batch API discount) into
//     `AgentRuntime`. Every AgentRun already records token_input/token_output/model_used/batched/
//     cost_cents for the per-rep + per-org roll-up (§4.5).
//   • T-32 Mission Control UI — reads the AgentRun stream (the Activity Ledger: reasoning_log per
//     run) and the Reporting agent's rep-facing briefing output. `agentDefinitionRows()` mirrors the
//     §4.4 map into the AgentDefinition table if a surface wants it.
//   • T-33 Approval Inbox — reads DraftMessage rows; each carries cfe_outcome / cfe_risk_score /
//     cfe_classifier_data / approval_state (per-item CFE band + classifiers, §9.2). Edit-after-
//     approval re-enters the CFE by calling `ComplianceFilterEngine.evaluateContent` again before send.
//   • T-34 The Shift — drives the run/queue: enqueue jobs via the DurableQueue, read AgentRun/
//     DraftMessage state for the one-card-at-a-time ritual.

export {
  AgentKey,
  ClaudeModelTier,
  CLAUDE_MODEL_IDS,
  SONNET_MODEL_ID,
  OPUS_MODEL_ID,
  NINE_AGENTS,
  ALL_AGENT_KEYS,
  getAgentSpec,
  tierForStep,
  agentDefinitionRows,
  HARD_MAX_OUTPUT_TOKENS_PER_RUN,
  RESERVATION_SAFE_MAX_INPUT_TOKENS,
} from './runtime-model-map';
export type { AgentSpec, AgentModelStep, AgentMode, OutputSurface } from './runtime-model-map';

export { AgentRuntime, criticalityFor, modelIdForTier } from './agent-runtime';
export type { AgentRuntimeDeps, AgentJobResult, RunOutcome } from './agent-runtime';

export type { AgentJobInput, AgentOutput, AgentHandler, AgentHandlerContext } from './types';
export { AGENT_HANDLERS } from './agent-handlers';

export { assemblePrompt, DOCTRINE_SYSTEM_PROMPT } from './prompt-assembly';
export type { RepContext, ContactContext, AssembledPrompt } from './prompt-assembly';

export {
  AnthropicRuntimeClient,
  AgentModelError,
  AgentModelTimeoutError,
  MissingClaudeCredentialError,
} from './claude';
export type { AgentModelClient, AgentGenerationRequest, AgentGenerationResult } from './claude';

export { PrismaAgentRuntimeStore, InMemoryAgentRuntimeStore } from './store';
export type {
  AgentRuntimeStore,
  ContactControls,
  CreateAgentRunInput,
  UpdateAgentRunInput,
  CreateDraftMessageInput,
  AgentRunStatus,
  ApprovalState,
  PersistedCfeOutcome,
  PersistedChannel,
} from './store';

export { AllowAllRunGate, EstimatingCostModel } from './seams';
export type { RunGate, RunGateRequest, RunGateDecision, CostModel, CostInput, RunCriticality } from './seams';

export {
  AGENT_DISPATCH_EVENT,
  AGENT_DISPATCH_FUNCTION_ID,
  AGENT_DISPATCH_RETRIES,
  InMemoryDurableQueue,
} from './durable-queue';
export type { DurableQueue, AgentDispatchEventData } from './durable-queue';

export { dispatchAgentJob } from './dispatch';

// T-R14 (LAUNCH-GATE, §4 "24/7 / while you slept") — the scheduled (cron-triggered) dispatch pass.
// See scheduled-dispatch.ts for the full design doc comment. The Inngest `{ cron }` wrapper
// (`scheduledAgentDispatchFunction`, `SCHEDULED_AGENT_DISPATCH_CRON`) lives in inngest-functions.ts
// (imports the `inngest` package, so it is intentionally NOT re-exported here — same convention as
// `agentDispatchFunction`/`InngestDurableQueue` today).
export {
  runScheduledDispatch,
  agentKeyForPipelineStage,
  scheduledIdempotencyKey,
  utcDateKey,
  PrismaScheduledDispatchStore,
  InMemoryScheduledDispatchStore,
  SCHEDULED_TRIGGER_CONTACT,
  SCHEDULED_TRIGGER_BRIEFING,
  SCHEDULED_ACTION_CAP_BY_INTENSITY,
  DEFAULT_OUTREACH_CADENCE_DAYS,
  SCHEDULED_AGENT_DISPATCH_FUNCTION_ID,
  SCHEDULED_AGENT_DISPATCH_CRON,
} from './scheduled-dispatch';
export type {
  ScheduledDispatchStore,
  ScheduledDispatchDeps,
  ScheduledDispatchResult,
  ScheduledDispatchRepSummary,
  DueRep,
  DueContactCandidate,
} from './scheduled-dispatch';

// T-31 (§4.5/§4.6) — the REAL cost model, budget/kill-switch RunGate, in-roster degradation ladder,
// and the production dep-builder that wires them into a dispatch invocation. See ./cost-killswitch
// for the full surface (this re-export is a convenience; nothing here is duplicated).
export * from './cost-killswitch';
