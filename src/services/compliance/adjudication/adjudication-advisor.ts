// T-09 (master-spec §5.5 AC-2 "Sonnet-5 FLAG adjudication + compliant-rewrite" and AC-7 "Opus
// novel-pattern / classifier-conflict escalation"). The AI ADVISORY layer (provider: Agnes,
// §0.3 amended 2026-07-27) for a flagged item.
//
// ABSOLUTE INVARIANTS (violating any is a gate failure):
//   • SINGLE-PROVIDER AI (§0.3, AMENDED by operator directive 2026-07-27: the AI provider is now
//     Agnes, model `agnes-2.0-flash`, key AGNES_AI_API_KEY — the prior Claude-only doctrine is
//     retired at the operator's explicit direction). The only model path is the agent-runtime's
//     `AgentModelClient` (`AgnesRuntimeClient` by default — fails CLOSED with no key). There is no
//     off-provider fallback and no fabricated/stubbed completion anywhere here. Provider identity is
//     doctrine; the FAIL-CLOSED property below is provider-independent and unchanged.
//   • ADVISORY, NEVER AUTO-CLEARING (§5.5). `recommend()` returns a recommendation OR `null`. It
//     never approves, never clears, never mutates a draft's CFE band or approval state — the human
//     adjudicator (upline) still decides. A `null` return simply means "no recommendation is
//     available"; the item stays exactly as fail-closed as it was.
//   • FAIL-SAFE on a missing key (§0.3 rule 3 / §4.6). No AGNES_AI_API_KEY → the model call throws
//     `MissingClaudeCredentialError` (legacy class name; provider-agnostic), which is caught here and
//     turned into `null` (recommendation ABSENT). It is NEVER turned into an auto-approval and NEVER
//     falls back to another provider.
//   • COST KILL-SWITCH / RESERVATION respected (§4.5). Every advisory Claude call is admitted through
//     the same T-31 `RunGate` the agent runtime uses; a denial (kill-switch tripped / budget
//     exhausted) skips the call and returns `null`. Any reservation the gate places is released on
//     every exit path.
//   • THE REWRITE IS CONTENT (§5, §5.5). A `suggested_rewrite` is a proposed contact-bound message,
//     so it is re-run through the CFE before it is ever returned/stored; a rewrite that does not
//     itself CLEAR the CFE is dropped (`suggestedRewrite: null`) — an advisory suggestion can never
//     smuggle non-compliant content past the gate.

import type { Role } from '@prisma/client';

import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { Channel, ClassifierResult } from '@/types/compliance';
import {
  AgentModelClient,
  MissingClaudeCredentialError,
} from '@/services/agent-runtime/claude';
import { AgnesRuntimeClient } from '@/services/agent-runtime/agnes';
import { ClaudeModelTier } from '@/services/agent-runtime/runtime-model-map';
import { AllowAllRunGate, type RunGate } from '@/services/agent-runtime/seams';

import { detectEscalationTrigger, type EscalationReason } from './escalation-triggers';

/** The stable RunGate agent-key this advisory work bills against (§4.5 budget/kill-switch roll-up). */
export const ADJUDICATION_ADVISOR_AGENT_KEY = 'cfe_adjudication_advisor';

export interface AdjudicationRecommendation {
  /** The ADVISORY recommended action for the human reviewer (e.g. "Approve with the income
   *  safe-harbor disclaimer added" / "Decline — unlicensed insurance recommendation"). Advisory
   *  only; the upline still decides. */
  recommendedAction: string;
  /** A suggested compliant rewrite of the flagged content — ONLY present when the rewrite itself
   *  CLEARED the CFE (a rewrite is contact-bound content). `null` when no rewrite was produced or
   *  the produced rewrite did not clear the gate. */
  suggestedRewrite: string | null;
  /** Which Claude tier produced this — `sonnet_5` (standard FLAG adjudication, AC-2) or `opus_4_8`
   *  (classifier-conflict / novel-pattern escalation, AC-7). */
  model: 'sonnet_5' | 'opus_4_8';
  /** Set only when Opus was invoked (AC-7); null for a standard Sonnet adjudication. */
  escalationReason: EscalationReason | null;
}

export interface AdjudicationAdvisorDeps {
  /** AI model client. Default = `AgnesRuntimeClient` (Agnes agnes-2.0-flash, fails CLOSED with no
   *  key). Constructed LAZILY (no key read at construction) — build-safe. */
  modelClient?: AgentModelClient;
  /** The CFE used to re-gate a suggested rewrite (a rewrite is content). Default = a fresh engine
   *  (its default classifier client is Haiku; lazy, no key at construction). */
  cfe?: ComplianceFilterEngine;
  /** T-31 cost/kill-switch gate. Default = allow-all (a caller wires the real
   *  `BudgetKillSwitchRunGate`). */
  runGate?: RunGate;
  clock?: () => Date;
}

export interface AdjudicationRequest {
  /** The flagged draft's body — the content to adjudicate + (optionally) rewrite. */
  content: string;
  /** The draft's channel (for the CFE re-gate of any suggested rewrite). */
  channel: Channel;
  /** The rep who owns the draft — the RunGate bills the advisory call to their budget. */
  userId: string;
  role: Role;
  /** The per-classifier results the flagged draft carries (drives AC-7 escalation routing). */
  classifierResults: ClassifierResult[];
  riskScore: number;
}

const SONNET_TIER = ClaudeModelTier.SONNET_5;
const OPUS_TIER = ClaudeModelTier.OPUS_4_8;

const SYSTEM_PROMPT = [
  'You are a FINRA/state-insurance compliance ADJUDICATION assistant for a relationship-first',
  'financial-services network. A message drafted by an AI agent has been FLAGGED by the Compliance',
  'Filter Engine and is awaiting a human principal (the rep’s upline) for review.',
  '',
  'Your job is ADVISORY ONLY. You do not approve, clear, or send anything — a human decides.',
  'Produce (1) a concise recommended action for the reviewer and (2), when it is genuinely possible,',
  'a compliant rewrite that would pass compliance. If the content cannot be made compliant (e.g. an',
  'unlicensed insurance recommendation, a guaranteed-income claim), do NOT invent a rewrite — leave',
  'it empty and recommend declining.',
  '',
  'Never use forbidden sales vocabulary (prospect, lead, pitch, sales call, guaranteed income).',
  'Any earnings/opportunity language must stay potential-only with safe-harbor framing.',
  '',
  'Respond with ONLY a single JSON object, no prose, of exactly this shape:',
  '{"recommended_action": string, "suggested_rewrite": string}',
  'Use an empty string for suggested_rewrite when no compliant rewrite is appropriate.',
].join('\n');

export class AdjudicationAdvisor {
  private readonly modelClient: AgentModelClient;
  private readonly cfe: ComplianceFilterEngine;
  private readonly runGate: RunGate;

  constructor(deps: AdjudicationAdvisorDeps = {}) {
    // Lazy defaults — none of these read a key at construction (build-safety rule).
    this.modelClient = deps.modelClient ?? new AgnesRuntimeClient();
    this.cfe = deps.cfe ?? new ComplianceFilterEngine();
    this.runGate = deps.runGate ?? new AllowAllRunGate();
  }

  /**
   * Produce the ADVISORY recommendation for a flagged item, or `null` when none is available
   * (missing key, kill-switch/budget denial, a model/parse error). NEVER throws, NEVER approves,
   * NEVER falls back to another provider.
   */
  async recommend(req: AdjudicationRequest): Promise<AdjudicationRecommendation | null> {
    const trigger = detectEscalationTrigger(req.classifierResults);
    const tier = trigger.escalate ? OPUS_TIER : SONNET_TIER;
    const model: AdjudicationRecommendation['model'] = trigger.escalate ? 'opus_4_8' : 'sonnet_5';

    // §4.5 cost kill-switch / reservation — admitted through the SAME gate the agent runtime uses.
    // A denial (kill-switch tripped / budget exhausted) means the advisory is simply absent — never
    // an auto-clear. Any reservation is released on every exit path.
    const gate = await this.runGate.check({
      userId: req.userId,
      agentKey: ADJUDICATION_ADVISOR_AGENT_KEY,
      criticality: 'non_critical',
      primaryTier: tier,
    });
    if (!gate.allowed) {
      await gate.release?.();
      return null;
    }

    try {
      const raw = await this.modelClient.generate({
        tier, // model tier (ClaudeModelTier enum name retained; routes to Agnes per §0.3 amended 2026-07-27)
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: this.buildUserPrompt(req),
      });

      const parsed = parseRecommendation(raw.text);
      if (!parsed) return null;

      const suggestedRewrite = await this.gateRewrite(parsed.suggestedRewrite, req);

      return {
        recommendedAction: parsed.recommendedAction,
        suggestedRewrite,
        model,
        escalationReason: trigger.reason,
      };
    } catch (err) {
      // FAIL-SAFE (§0.3 rule 3 / §4.6): a missing key, a transient model error, a timeout, a bad
      // body — all resolve to "no recommendation", NEVER an auto-approval and NEVER off-provider.
      void (err instanceof MissingClaudeCredentialError);
      return null;
    } finally {
      await gate.release?.();
    }
  }

  /**
   * THE REWRITE-IS-CONTENT GATE (§5/§5.5): a suggested rewrite is a proposed contact-bound message,
   * so it is re-run through the CFE before it can be returned/stored. Only a rewrite that CLEARS the
   * CFE (`released`) survives; anything else — held, flagged, or blocked — is dropped
   * (`null`). An error in the re-gate also drops the rewrite (fail-safe), so the advisory never
   * surfaces un-vetted content.
   */
  private async gateRewrite(rewrite: string, req: AdjudicationRequest): Promise<string | null> {
    const trimmed = rewrite.trim();
    if (trimmed.length === 0) return null;
    try {
      const verdict = await this.cfe.evaluateContent({
        content: trimmed,
        channel: req.channel,
        userContext: { user_id: req.userId, role: req.role, content_id: 'cfe_adjudication_rewrite' },
      });
      return verdict.released ? trimmed : null;
    } catch {
      return null;
    }
  }

  private buildUserPrompt(req: AdjudicationRequest): string {
    const signals = req.classifierResults
      .filter((r) => r.confidence > 0)
      .map((r) => `- ${r.classifier}: confidence ${(r.confidence * 100).toFixed(0)}%`)
      .join('\n');
    return [
      `CFE risk score: ${req.riskScore} (FLAG band).`,
      'Classifier signals:',
      signals || '- (no individual classifier above zero)',
      '',
      'Flagged message:',
      '"""',
      req.content,
      '"""',
    ].join('\n');
  }
}

/**
 * Tolerant JSON extraction from a model completion (the model is instructed to return only JSON, but
 * a defensive parser tolerates a code-fence wrapper or leading/trailing prose). Returns `null` if no
 * usable object with a non-empty `recommended_action` is found — a parse miss is fail-safe (the
 * recommendation is simply absent), never a crash.
 */
export function parseRecommendation(
  text: string
): { recommendedAction: string; suggestedRewrite: string } | null {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const recommendedAction = typeof o.recommended_action === 'string' ? o.recommended_action.trim() : '';
  if (recommendedAction.length === 0) return null;
  const suggestedRewrite = typeof o.suggested_rewrite === 'string' ? o.suggested_rewrite : '';
  return { recommendedAction, suggestedRewrite };
}
