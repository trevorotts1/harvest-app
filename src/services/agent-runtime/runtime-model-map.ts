// WP04 (T-30) — the RUNTIME MODEL MAP (master-spec §4.4) + the nine-agent suite (§4.2).
//
// This file is the single source of truth for two things the whole agent runtime keys off:
//   1. Which Claude model tier each agent's each step runs on (§4.4 "Runtime model mapping").
//   2. The nine agents themselves (§4.2) — their keys, display names, run mode, and whether they
//      produce content that reaches a human/contact (and therefore MUST pass the CFE, §2.3/§5).
//
// Claude-only (§0.3, ABSOLUTE): every tier below is a Claude model. There is no non-Claude tier and
// no non-Claude model id anywhere in `CLAUDE_MODEL_IDS`. `tests/unit/agent-runtime.test.ts` asserts
// each agent's per-step tier against this map (teeth: swapping any model fails that test), and that
// every model id is a `claude-*` id.

import { HAIKU_MODEL_ID } from '@/types/compliance';

/**
 * The three-model Claude roster (§0.3 / §4.4). The string values match the tokens the schema stores
 * in `AgentDefinition.default_model` / `AgentRun.model_used` (`haiku_4_5 | sonnet_5 | opus_4_8`), so
 * a run record and this map speak the same vocabulary.
 */
export enum ClaudeModelTier {
  HAIKU_4_5 = 'haiku_4_5',
  SONNET_5 = 'sonnet_5',
  OPUS_4_8 = 'opus_4_8',
}

// The Haiku id is imported (single-sourced with the CFE, §5.3/§4.4); Sonnet matches WP01's
// SEVEN_WHYS_MODEL_ID ('claude-sonnet-5'); Opus is the reserved hard-reasoning tier (§4.4).
export const SONNET_MODEL_ID = 'claude-sonnet-5';
export const OPUS_MODEL_ID = 'claude-opus-4-8';

/** Tier → the exact Anthropic model id sent on the wire. Claude-only: all three are `claude-*`. */
export const CLAUDE_MODEL_IDS: Record<ClaudeModelTier, string> = {
  [ClaudeModelTier.HAIKU_4_5]: HAIKU_MODEL_ID, // claude-haiku-4-5-20251001
  [ClaudeModelTier.SONNET_5]: SONNET_MODEL_ID, // claude-sonnet-5
  [ClaudeModelTier.OPUS_4_8]: OPUS_MODEL_ID, // claude-opus-4-8
};

/**
 * T-R27 FIX (closes the QC#1 reject of the original reservation primitive) — the HARD, ENFORCED
 * per-run output-token cap. This is the load-bearing half of making the cost-killswitch's admission
 * reservation (`cost-killswitch/run-gate.ts` `RESERVATION_TOKEN_BUDGET`/`reservationEstimateCentsFor`)
 * a TRUE worst-case upper bound instead of a "typical/generous average" guess:
 *
 *   `claude/anthropic-runtime-client.ts` CLAMPS every real Anthropic Messages API call's wire
 *   `max_tokens` to this value — regardless of what a caller passes (or omits) — so NO real run in
 *   this runtime can ever generate more than `HARD_MAX_OUTPUT_TOKENS_PER_RUN` output tokens. That is
 *   what makes "reserve for the maximum a run could cost" a provable claim rather than a hope: Claude
 *   itself is instructed to hard-stop at this many output tokens, and the client refuses to ask for
 *   more even if some future caller tries to.
 *
 * Sized well above every real step's actual usage in this lane (the nine agents' drafts/briefings/
 * analyses run ~800-2,000 output tokens in practice, per prompt-assembly.ts's short, templated
 * prompts) so a legitimately large single-step generation is never truncated mid-thought — this is a
 * cost-control ceiling, not a quality throttle.
 */
export const HARD_MAX_OUTPUT_TOKENS_PER_RUN = 8_192;

/**
 * T-R27 FIX — a conservative, DOCUMENTED upper bound on a single run's INPUT token count. Unlike
 * output, the Anthropic Messages API has no per-request wire parameter that caps input size, so this
 * bound is not mechanically enforced the way `HARD_MAX_OUTPUT_TOKENS_PER_RUN` is — instead it is sized
 * from `prompt-assembly.ts`'s actual, current shape: a short fixed doctrine system prompt plus a
 * handful of short, hard-coded template lines (rep/contact first names, org, a literal task string
 * from `agent-handlers.ts`, at most a few reflected-quality words) — nothing in this runtime builds an
 * unbounded prompt (no full conversation history, no document/attachment ingestion, no user-supplied
 * free text reaching the prompt). Real usage is on the order of a few hundred tokens; this constant is
 * set at a wide, deliberate multiple of that so admission stays conservative even if prompt content
 * grows somewhat — but it is NOT a hard ceiling the way the output cap is. If a future change adds
 * unbounded prompt content (e.g. full thread history, document RAG context), this bound — and the
 * "make admission conservative enough" argument that justifies skipping wire-level enforcement here —
 * MUST be revisited alongside it, or a real input cap/truncation must be added.
 */
export const RESERVATION_SAFE_MAX_INPUT_TOKENS = 24_000;

/** The nine agents (§4.2), keyed by the stable `AgentDefinition.key` value the schema expects. */
export enum AgentKey {
  PROSPECTING = 'prospecting',
  PRE_SALE_NURTURE = 'pre_sale_nurture',
  POST_SALE_NURTURE = 'post_sale_nurture',
  APPOINTMENT_SETTING = 'appointment_setting',
  REPORTING = 'reporting',
  QUOTA = 'quota',
  IPA_VALUE = 'ipa_value',
  INACTIVITY_REENGAGEMENT = 'inactivity_reengagement',
  WARM_MARKET_SUB = 'warm_market_sub',
}

export type AgentMode = 'parallel' | 'sequential';

/**
 * How an agent step's output surfaces — this decides whether it must pass the CFE (§2.3/§5):
 *   - `contact_outbound` — text destined for a contact/community member (SMS/email/social). MUST
 *     pass the CFE fail-closed before it can become a sendable DraftMessage.
 *   - `rep_facing`       — natural-language text shown to the rep (briefing narrative, motivational
 *     copy). Also passes the CFE (§5.4: "motivational/celebration copy and quotes also pass the
 *     CFE — an income promise dressed as encouragement is still an income claim").
 *   - `internal`         — pure structured/numeric analytics with no free-text that reaches a human
 *     (e.g. a raw ratio number). Does not require a CFE content decision.
 */
export type OutputSurface = 'contact_outbound' | 'rep_facing' | 'internal';

/** One modelled step of an agent, with the Claude tier §4.4 mandates for it. */
export interface AgentModelStep {
  /** Stable role id within the agent, e.g. 'segment', 'draft', 'self_optimization'. */
  role: string;
  tier: ClaudeModelTier;
  /** §4.4: batched (Batch API) work — true for all periodic Opus 4.8 work and overnight waves. */
  batched?: boolean;
  /** Human-readable trace back to the §4.4 clause this step implements. */
  spec: string;
}

export interface AgentSpec {
  key: AgentKey;
  displayName: string;
  mode: AgentMode;
  /** §4.2 function summary — doctrine-clean (§0.5). */
  fn: string;
  /**
   * The tier of the step whose output actually surfaces (the drafting/narrative step for content
   * agents; the metrics/detection step for analytics agents). Persisted as `AgentRun.model_used`.
   */
  primaryTier: ClaudeModelTier;
  /** What the primary output is — decides the CFE gate (see OutputSurface). */
  primarySurface: OutputSurface;
  /** The full per-role tier map for this agent (§4.4). */
  steps: AgentModelStep[];
}

/**
 * THE NINE AGENTS + THE §4.4 RUNTIME MODEL MAP.
 *
 * Traceability (§4.2 table, right-hand "Default model" column → §4.4):
 *   1 Prospecting            Haiku (prioritize/segment) → Sonnet (draft)          [parallel]
 *   2 Pre-Sale Nurture       Haiku (reply intent)       + Sonnet (draft)          [parallel]
 *   3 Post-Sale Nurture      Sonnet (draft)                                        [parallel]
 *   4 Appointment Setting    Haiku (availability match) + Sonnet (negotiation)     [SEQUENTIAL]
 *   5 Reporting              Haiku (aggregation)        → Sonnet (narrative)       [parallel]
 *   6 Quota                  Haiku                                                 [parallel]
 *   7 IPA Value              Haiku (metrics)            + Opus (self-opt, BATCHED) [parallel]
 *   8 Inactivity/Re-engage   Haiku (detection)          + Sonnet (re-engage copy)  [parallel]
 *   9 Warm Market Sub-Agent  Haiku (matching)           + Sonnet (draft)           [parallel]
 */
export const NINE_AGENTS: Record<AgentKey, AgentSpec> = {
  [AgentKey.PROSPECTING]: {
    key: AgentKey.PROSPECTING,
    displayName: 'Prospecting Agent',
    mode: 'parallel',
    fn: 'Identifies high-readiness warm-market contacts and drafts first-touch community introductions.',
    primaryTier: ClaudeModelTier.SONNET_5,
    primarySurface: 'contact_outbound',
    steps: [
      { role: 'prioritize_segment', tier: ClaudeModelTier.HAIKU_4_5, spec: '§4.4 segmentation/prioritize → Haiku 4.5' },
      { role: 'draft', tier: ClaudeModelTier.SONNET_5, spec: '§4.4 outbound draft generation → Sonnet 5' },
    ],
  },
  [AgentKey.PRE_SALE_NURTURE]: {
    key: AgentKey.PRE_SALE_NURTURE,
    displayName: 'Pre-Sale Nurture Agent',
    mode: 'parallel',
    fn: 'Keeps introduced-but-not-scheduled contacts warm with a non-harassing cadence.',
    primaryTier: ClaudeModelTier.SONNET_5,
    primarySurface: 'contact_outbound',
    steps: [
      { role: 'reply_intent', tier: ClaudeModelTier.HAIKU_4_5, spec: '§4.4 reply intent/sentiment → Haiku 4.5' },
      { role: 'draft', tier: ClaudeModelTier.SONNET_5, spec: '§4.4 nurture-touch draft → Sonnet 5' },
    ],
  },
  [AgentKey.POST_SALE_NURTURE]: {
    key: AgentKey.POST_SALE_NURTURE,
    displayName: 'Post-Sale Nurture Agent',
    mode: 'parallel',
    fn: 'Onboards and retains new clients and recruits: check-ins, referral asks, renewals.',
    primaryTier: ClaudeModelTier.SONNET_5,
    primarySurface: 'contact_outbound',
    steps: [{ role: 'draft', tier: ClaudeModelTier.SONNET_5, spec: '§4.4 follow-up draft → Sonnet 5' }],
  },
  [AgentKey.APPOINTMENT_SETTING]: {
    key: AgentKey.APPOINTMENT_SETTING,
    displayName: 'Appointment Setting Agent',
    mode: 'sequential', // §4.1 principle 3: strictly sequential (depends on a response + synced calendars)
    fn: 'Finds dual-calendar overlap and proposes/confirms meetings.',
    primaryTier: ClaudeModelTier.SONNET_5,
    primarySurface: 'contact_outbound',
    steps: [
      { role: 'availability_match', tier: ClaudeModelTier.HAIKU_4_5, spec: '§4.4 calendar availability matching → Haiku 4.5' },
      { role: 'negotiation_draft', tier: ClaudeModelTier.SONNET_5, spec: '§4.4 appointment-negotiation drafts → Sonnet 5' },
    ],
  },
  [AgentKey.REPORTING]: {
    key: AgentKey.REPORTING,
    displayName: 'Reporting Agent',
    mode: 'parallel',
    fn: 'Composes the overnight briefing and evening recap; pipeline snapshots.',
    primaryTier: ClaudeModelTier.SONNET_5,
    primarySurface: 'rep_facing', // the briefing narrative is shown to the rep (a human) → CFE gates it (§5.4)
    steps: [
      { role: 'aggregation', tier: ClaudeModelTier.HAIKU_4_5, spec: '§4.4 aggregation → Haiku 4.5' },
      { role: 'narrative', tier: ClaudeModelTier.SONNET_5, spec: '§4.4 briefing/recap composition → Sonnet 5' },
    ],
  },
  [AgentKey.QUOTA]: {
    key: AgentKey.QUOTA,
    displayName: 'Quota Agent',
    mode: 'parallel',
    fn: 'Tracks weekly targets vs. actuals; flags underperformance early.',
    primaryTier: ClaudeModelTier.HAIKU_4_5,
    primarySurface: 'internal', // numeric target/actual tracking; any rep-facing note it emits is CFE-gated at emit time
    steps: [{ role: 'track', tier: ClaudeModelTier.HAIKU_4_5, spec: '§4.4 Quota Agent → Haiku 4.5' }],
  },
  [AgentKey.IPA_VALUE]: {
    key: AgentKey.IPA_VALUE,
    displayName: 'IPA Value Agent',
    mode: 'parallel',
    fn: "Computes the Agent's Ratio and the Field Trainer's Ratio; self-optimizes messaging/timing.",
    primaryTier: ClaudeModelTier.HAIKU_4_5, // real-time metrics path is Haiku; the Opus step is sparse/periodic/batched
    primarySurface: 'internal',
    steps: [
      { role: 'metrics', tier: ClaudeModelTier.HAIKU_4_5, spec: '§4.4 IPA metrics (real-time) → Haiku 4.5' },
      // §4.4/§9.9-10: periodic self-optimization is the ONLY Opus 4.8 runtime workload here, and is
      // BATCHED and OFF the per-message path.
      { role: 'self_optimization', tier: ClaudeModelTier.OPUS_4_8, batched: true, spec: '§4.4 IPA periodic self-optimization → Opus 4.8, batched' },
    ],
  },
  [AgentKey.INACTIVITY_REENGAGEMENT]: {
    key: AgentKey.INACTIVITY_REENGAGEMENT,
    displayName: 'Inactivity & Re-engagement Agent',
    mode: 'parallel',
    fn: 'Detects stalled reps/contacts; runs anchor-tied win-back at 3/5/7 days.',
    primaryTier: ClaudeModelTier.SONNET_5,
    primarySurface: 'contact_outbound',
    steps: [
      { role: 'detection', tier: ClaudeModelTier.HAIKU_4_5, spec: '§4.4 detection → Haiku 4.5' },
      { role: 'reengagement_copy', tier: ClaudeModelTier.SONNET_5, spec: '§4.4 re-engagement copy → Sonnet 5' },
    ],
  },
  [AgentKey.WARM_MARKET_SUB]: {
    key: AgentKey.WARM_MARKET_SUB,
    displayName: 'Warm Market Sub-Agent',
    mode: 'parallel',
    fn: 'Receives highlighted names from the Harvest Method and executes the first community introductions on the rep’s behalf.',
    primaryTier: ClaudeModelTier.SONNET_5,
    primarySurface: 'contact_outbound',
    steps: [
      { role: 'matching', tier: ClaudeModelTier.HAIKU_4_5, spec: '§4.4 matching → Haiku 4.5' },
      { role: 'draft', tier: ClaudeModelTier.SONNET_5, spec: '§4.4 introduction draft → Sonnet 5' },
    ],
  },
};

/** All nine agent keys, in the §4.2 table order. */
export const ALL_AGENT_KEYS: AgentKey[] = [
  AgentKey.PROSPECTING,
  AgentKey.PRE_SALE_NURTURE,
  AgentKey.POST_SALE_NURTURE,
  AgentKey.APPOINTMENT_SETTING,
  AgentKey.REPORTING,
  AgentKey.QUOTA,
  AgentKey.IPA_VALUE,
  AgentKey.INACTIVITY_REENGAGEMENT,
  AgentKey.WARM_MARKET_SUB,
];

export function getAgentSpec(key: AgentKey): AgentSpec {
  return NINE_AGENTS[key];
}

/** The tier §4.4 mandates for a given agent step (throws if the role is not modelled — no silent default). */
export function tierForStep(key: AgentKey, role: string): ClaudeModelTier {
  const step = NINE_AGENTS[key].steps.find((s) => s.role === role);
  if (!step) {
    throw new Error(`No §4.4 model mapping for agent '${key}' step '${role}'.`);
  }
  return step.tier;
}

/**
 * Rows suitable for upserting into `AgentDefinition` (the DB mirror of this in-code map). Provided as
 * a seam — an admin/seed task (or T-32 Mission Control) can persist these; the runtime itself keys off
 * the in-code map so it never depends on the table being seeded.
 */
export function agentDefinitionRows(): {
  key: string;
  display_name: string;
  default_model: string;
  mode: AgentMode;
}[] {
  return ALL_AGENT_KEYS.map((key) => {
    const spec = NINE_AGENTS[key];
    return {
      key: spec.key,
      display_name: spec.displayName,
      default_model: spec.primaryTier,
      mode: spec.mode,
    };
  });
}
