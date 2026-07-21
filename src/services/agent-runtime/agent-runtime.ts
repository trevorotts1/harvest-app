// WP04 (T-30) — THE AGENT RUNTIME (master-spec §4.1–§4.4, §2.3).
//
// A stateless executor for one unit of durable agent work. It is the SINGLE place that:
//   • enforces idempotency / crash-safe resume (§9.9-1) — a replayed event never double-processes;
//   • honours per-contact controls (§9.4) — do_not_contact / agents_paused halt a run immediately;
//   • consults the RunGate (T-31 budget/kill-switch seam, §4.5) before spending Claude tokens;
//   • generates via the INJECTED Claude client on the tier §4.4 mandates — Claude-only, fail-closed
//     (§0.3): no key → HOLD, never a non-Claude provider and never a silent stub;
//   • routes EVERY human/contact-bound output through the CFE (§2.3/§5) before it can surface — a
//     non-released verdict HOLDS the item (fail-closed); no agent output bypasses the CFE;
//   • persists the AgentRun (Activity Ledger + cost roll-up seams) and, for contact-bound drafts, a
//     DraftMessage carrying its CFE band/outcome (the Approval Inbox seam).
//
// It wires the WP02 SegmentationService / MemoryJoggerService with the HAIKU clients INJECTED (HARD
// REQ) — those services otherwise default to a LOCAL heuristic, which would silently run regex
// instead of Haiku 4.5 (§7.2/§4.4).

import type { Role } from '@prisma/client';

import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { CFEVerdict, Channel } from '@/types/compliance';

import {
  MemoryJoggerCategoryClient,
  HaikuMemoryJoggerCategoryClient,
} from '@/services/warm-market/memory-jogger';
import { MemoryJoggerService } from '@/services/warm-market/memory-jogger.service';
import {
  SegmentationClient,
  HaikuSegmentationClient,
  SegmentationService,
  type SegmentationPrismaClient,
} from '@/services/warm-market/segmentation';
import { getContactEncryptionKey } from '@/services/warm-market/vault/vault-encryption';

import {
  AgentModelClient,
  AnthropicRuntimeClient,
  MissingClaudeCredentialError,
} from './claude';
import { AGENT_HANDLERS } from './agent-handlers';
import { assemblePrompt } from './prompt-assembly';
import {
  AgentKey,
  AgentSpec,
  ClaudeModelTier,
  CLAUDE_MODEL_IDS,
  getAgentSpec,
  OutputSurface,
  tierForStep,
} from './runtime-model-map';
import {
  AllowAllRunGate,
  CostModel,
  EstimatingCostModel,
  RunCriticality,
  RunGate,
} from './seams';
import {
  AgentRuntimeStore,
  PersistedChannel,
  PersistedCfeOutcome,
  PrismaAgentRuntimeStore,
} from './store';
import { AgentJobInput, AgentOutput } from './types';

export type RunOutcome =
  | 'surfaced' // clear/flagged → Approval Inbox / rep-facing shown (still needs human OK before send)
  | 'held' // non-released CFE verdict, CFE unavailable, or missing key → NOT sendable
  | 'skipped_paused' // Contact.agents_paused
  | 'skipped_dnc' // Contact.do_not_contact
  | 'deferred' // RunGate denied (budget / kill-switch, T-31)
  | 'idempotent_replay' // key already processed
  | 'completed_internal'; // numeric/analytic output (no CFE content decision needed)

export interface AgentJobResult {
  agentKey: AgentKey;
  outcome: RunOutcome;
  runId: string | null;
  draftMessageId: string | null;
  reasoningLog: string;
  cfe: { band: CFEVerdict['band']; released: boolean; held: boolean; score: number } | null;
}

const IDEMPOTENCY_SOURCE = 'agent_dispatch';

/** Human-honest hold copy (§4.6 / §5.2) — no fabrication, nothing lost. */
const HELD_NO_KEY_REASON =
  'Held: your agents are resting — the Claude connection is not configured. Nothing was lost.';
const HELD_CFE_DOWN_REASON =
  'Held for review: your agents are paused while we double-check compliance — nothing was lost.';

export interface AgentRuntimeDeps {
  /** Claude client. Default = AnthropicRuntimeClient (fails CLOSED with no key). Claude-only. */
  modelClient?: AgentModelClient;
  /** The already-merged CFE (§5). Default = a fresh engine (its default classifier client is Haiku). */
  cfe?: ComplianceFilterEngine;
  store?: AgentRuntimeStore;
  /** T-31 budget/kill-switch seam. Default = allow all (the runtime core implements no budgets). */
  runGate?: RunGate;
  /** T-31 cost seam. Default = a coarse estimate; T-31 supplies real tier pricing. */
  costModel?: CostModel;
  // ── HARD REQ (T-23 advisory): the Haiku seg/jogger clients, INJECTED (not the local heuristic) ──
  segmentationClient?: SegmentationClient;
  memoryJoggerClient?: MemoryJoggerCategoryClient;
  /** Prisma delegate the injected SegmentationService reads through (DI-mockable). */
  segmentationPrisma?: SegmentationPrismaClient;
  /** Contact PII key provider — read LAZILY (never at module scope; getContactEncryptionKey throws with no key). */
  encryptionKeyProvider?: () => string;
  clock?: () => Date;
}

export class AgentRuntime {
  private readonly modelClient: AgentModelClient;
  private readonly cfe: ComplianceFilterEngine;
  private readonly store: AgentRuntimeStore;
  private readonly runGate: RunGate;
  private readonly costModel: CostModel;
  private readonly segmentationPrisma?: SegmentationPrismaClient;
  private readonly encryptionKeyProvider: () => string;
  private readonly clock: () => Date;

  /** Exposed so tests can assert the runtime holds the HAIKU clients, not the local heuristic (HARD REQ). */
  readonly segmentationClient: SegmentationClient;
  readonly memoryJoggerClient: MemoryJoggerCategoryClient;

  constructor(deps: AgentRuntimeDeps = {}) {
    this.modelClient = deps.modelClient ?? new AnthropicRuntimeClient();
    this.cfe = deps.cfe ?? new ComplianceFilterEngine();
    this.store = deps.store ?? new PrismaAgentRuntimeStore();
    this.runGate = deps.runGate ?? new AllowAllRunGate();
    this.costModel = deps.costModel ?? new EstimatingCostModel();
    // Construction takes no key (both Haiku clients read the key lazily at call time) — build-safe.
    this.segmentationClient = deps.segmentationClient ?? new HaikuSegmentationClient();
    this.memoryJoggerClient = deps.memoryJoggerClient ?? new HaikuMemoryJoggerCategoryClient();
    this.segmentationPrisma = deps.segmentationPrisma;
    this.encryptionKeyProvider = deps.encryptionKeyProvider ?? getContactEncryptionKey;
    this.clock = deps.clock ?? (() => new Date());
  }

  // ── Injected-service factories (prove the Haiku wiring; §7.2/§4.4 HARD REQ) ────────────────────
  /** Builds the WP02 SegmentationService with the INJECTED Haiku client (never the local heuristic). */
  buildSegmentationService(): SegmentationService {
    return new SegmentationService(
      this.segmentationPrisma,
      this.segmentationClient, // ← HaikuSegmentationClient by default (HARD REQ)
      this.encryptionKeyProvider()
    );
  }

  /** Builds the WP02 MemoryJoggerService with the INJECTED Haiku category client. */
  buildMemoryJoggerService(prismaOverride?: unknown): MemoryJoggerService {
    return new MemoryJoggerService(
      prismaOverride as never,
      this.memoryJoggerClient, // ← HaikuMemoryJoggerCategoryClient by default (HARD REQ)
      this.encryptionKeyProvider()
    );
  }

  // ── The single entry point: execute one agent job (§2.3 critical path) ─────────────────────────
  async runAgent(input: AgentJobInput): Promise<AgentJobResult> {
    const spec = getAgentSpec(input.agentKey);

    // 1. Idempotency / crash-safe resume (§9.9-1): a replayed/retried event no-ops.
    if (await this.store.wasProcessed(input.idempotencyKey)) {
      return this.result(spec.key, 'idempotent_replay', null, null, 'Already processed; skipped (idempotent replay).', null);
    }

    // 2. Per-contact controls (§9.4) — do_not_contact / agents_paused halt a contact-bound run at once.
    if (input.contactId && spec.primarySurface === 'contact_outbound') {
      const controls = await this.store.getContactControls(input.contactId, input.userId);
      if (controls?.do_not_contact) {
        const runId = await this.recordTerminalRun(spec, input, 'HELD', `${spec.displayName} stood down: this contact is marked do-not-contact.`);
        await this.store.markProcessed(input.idempotencyKey, IDEMPOTENCY_SOURCE);
        return this.result(spec.key, 'skipped_dnc', runId, null, 'Do-not-contact — no outreach produced.', null);
      }
      if (controls?.agents_paused) {
        const runId = await this.recordTerminalRun(spec, input, 'HELD', `${spec.displayName} stood down: agents are paused for this contact.`);
        await this.store.markProcessed(input.idempotencyKey, IDEMPOTENCY_SOURCE);
        return this.result(spec.key, 'skipped_paused', runId, null, 'Agents paused for this contact — no outreach produced.', null);
      }
    }

    // 3. RunGate — budget / kill-switch seam (T-31, §4.5). Critical paths always pass a default gate.
    const criticality = criticalityFor(spec.key);
    const gate = await this.runGate.check({ userId: input.userId, agentKey: spec.key, criticality, primaryTier: spec.primaryTier });
    if (!gate.allowed) {
      const runId = await this.recordTerminalRun(spec, input, 'HELD', `${spec.displayName} deferred: ${gate.reason ?? 'budget/kill-switch'}.`);
      await this.store.markProcessed(input.idempotencyKey, IDEMPOTENCY_SOURCE);
      return this.result(spec.key, 'deferred', runId, null, gate.reason ?? 'Deferred to the next budget window.', null);
    }

    // T-R27 (§4.5 concurrency hardening): step 3's gate may have placed an outstanding RESERVATION
    // against this rep's budget (see seams.ts `RunGateDecision.release`). Every remaining exit path
    // below — successful surfacing, an internal-only completion, a CFE hold, a missing-credential
    // hold, AND a rethrown transient error — must release it exactly once, so a run's hold is dropped
    // once its REAL cost has landed (or the run failed) and never leaks. `try/finally` covers the
    // `throw` path too (finally always runs on the way out, success or exception alike).
    try {
      // 4. CFE fast-pause (§4.6 / §9.9-9): if the CFE is non-responsive, content agents HOLD immediately
      //    — no generation, no output. (The authoritative gate is still the evaluateContent call below.)
      if (spec.primarySurface !== 'internal' && !this.cfe.isAvailable()) {
        const runId = await this.recordTerminalRun(spec, input, 'HELD', HELD_CFE_DOWN_REASON);
        await this.store.markProcessed(input.idempotencyKey, IDEMPOTENCY_SOURCE);
        return this.result(spec.key, 'held', runId, null, HELD_CFE_DOWN_REASON, null);
      }

      // Create the RUNNING run row now, so a crash mid-generation is visible as an interrupted run.
      const runId = await this.store.createAgentRun({
        agent_key: spec.key,
        user_id: input.userId,
        trigger: input.trigger,
        model_used: spec.primaryTier,
        batched: false,
        status: 'RUNNING',
        input_summary: input.task ?? null,
        reasoning_log: null,
      });

      // 5. Generate on the INJECTED Claude client. Claude-only, fail-closed (§0.3/§4.6).
      let output: AgentOutput;
      try {
        output = await AGENT_HANDLERS[spec.key].handle({
          input,
          spec,
          modelClient: this.modelClient,
          segment: (contactId) => this.segment(contactId),
          assemble: (surface, task) => assemblePrompt({ spec, surface, rep: input.rep ?? {}, contact: input.contact, task }),
          generateStep: (role, surface, task) => this.generateStep(spec, role, surface, task, input),
        });
      } catch (err) {
        if (err instanceof MissingClaudeCredentialError) {
          // Fail CLOSED (§0.3 rule 3): no key → the run HOLDS. Never a non-Claude provider, never a stub.
          await this.store.updateAgentRun(runId, { status: 'HELD', reasoning_log: HELD_NO_KEY_REASON, finished_at: this.clock() });
          await this.store.markProcessed(input.idempotencyKey, IDEMPOTENCY_SOURCE); // terminal: a key won't appear on retry
          return this.result(spec.key, 'held', runId, null, HELD_NO_KEY_REASON, null);
        }
        // Transient (429 / timeout / network): record FAILED and RETHROW so the durable queue RETRIES
        // (§4.6). Deliberately NOT marked processed, so the retry genuinely re-runs (no false dedup).
        await this.store.updateAgentRun(runId, { status: 'FAILED', reasoning_log: 'Transient model error; the durable queue will retry.', finished_at: this.clock() });
        throw err;
      }

      const usage = output.usage;
      const modelUsed = usage?.tier ?? spec.primaryTier;
      const costCents = usage ? this.costModel.costCents({ tier: usage.tier, tokenInput: usage.tokenInput, tokenOutput: usage.tokenOutput, batched: usage.batched }) : 0;

      // 6. Internal/analytic output (numbers, no free-text reaching a human) → no CFE content decision.
      if (output.surface === 'internal' || !output.text) {
        await this.store.updateAgentRun(runId, {
          status: 'COMPLETED',
          model_used: modelUsed,
          token_input: usage?.tokenInput ?? 0,
          token_output: usage?.tokenOutput ?? 0,
          cost_cents: costCents,
          reasoning_log: output.reasoning,
          finished_at: this.clock(),
        });
        await this.store.markProcessed(input.idempotencyKey, IDEMPOTENCY_SOURCE);
        return this.result(spec.key, 'completed_internal', runId, null, output.reasoning, null);
      }

      // 7. THE CFE SYNC-PATH GATE (§2.3/§5) — the single choke point. No human/contact-bound agent
      //    output surfaces without a CFE decision; a non-released verdict HOLDS it (fail-closed §5.2).
      const verdict = await this.cfe.evaluateContent({
        content: output.text,
        channel: cfeChannelFor(output.surface, output.channel),
        userContext: { user_id: input.userId, role: 'REP' as Role, content_id: runId },
      });

      // §2.3 banding → surfacing: 0–10 (clear) and 11–70 (flag) both ENTER the Approval Inbox (still
      // needing human/upline OK); only 71–100 (blocked) and any FAIL-CLOSED hold (CFE unavailable/
      // timeout/exception, verdict.held) are withheld. So a held/blocked verdict is never sendable
      // (fail-closed §5.2), while a flagged draft reaches the rep carrying its FLAG band (§9.2, T-33's
      // upline-review path). A verdict is NEVER surfaced without this CFE decision (the choke point).
      const held = verdict.held || verdict.band === 'blocked';
      const approvalState = held ? 'HELD' : 'PENDING';
      const cfeOutcome = bandToOutcome(verdict);

      let draftMessageId: string | null = null;
      if (output.surface === 'contact_outbound' && input.contactId) {
        // Every agent-drafted outbound becomes an Approval-Inbox item CARRYING its CFE band (§9.2) —
        // and it is created ONLY here, after a CFE decision. A held/blocked verdict lands as HELD
        // (not sendable); clear/flag lands as PENDING (still needs a human OK before send, §5.1).
        draftMessageId = await this.store.createDraftMessage({
          user_id: input.userId,
          contact_id: input.contactId,
          channel: output.channel ?? 'SMS_HANDOFF',
          body: output.text,
          cfe_outcome: cfeOutcome,
          cfe_risk_score: verdict.score,
          cfe_classifier_data: verdict.classifierResults,
          approval_state: approvalState,
        });
      }

      const reasoning = `${output.reasoning} CFE ${verdict.band} (score ${verdict.score}) → ${held ? 'HELD for review' : 'entered the Approval Inbox'}.`;
      await this.store.updateAgentRun(runId, {
        status: held ? 'HELD' : 'COMPLETED',
        model_used: modelUsed,
        token_input: usage?.tokenInput ?? 0,
        token_output: usage?.tokenOutput ?? 0,
        cost_cents: costCents,
        output_ref: draftMessageId,
        reasoning_log: reasoning,
        finished_at: this.clock(),
      });
      await this.store.markProcessed(input.idempotencyKey, IDEMPOTENCY_SOURCE);

      return this.result(spec.key, held ? 'held' : 'surfaced', runId, draftMessageId, reasoning, {
        band: verdict.band,
        released: verdict.released,
        held: verdict.held,
        score: verdict.score,
      });
    } finally {
      // Reconcile (T-R27): drop the admission-time hold now that this run's real cost has landed on
      // the ledger (or the run failed) — on EVERY exit path, exactly once (release() itself guards
      // against a double-call). A gate that never reserved (critical bypass, `AllowAllRunGate`, an
      // unresolvable rep) leaves `gate.release` undefined — the `?.()` is then simply a no-op.
      await gate.release?.();
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────
  private async segment(contactId: string): Promise<{ relationshipType: string }> {
    const service = this.buildSegmentationService();
    const res = await service.segmentContact(contactId);
    return { relationshipType: res?.relationshipType ?? 'OTHER' };
  }

  private generateStep(spec: AgentSpec, role: string, surface: OutputSurface, task: string, input: AgentJobInput) {
    const tier: ClaudeModelTier = tierForStep(spec.key, role);
    const step = spec.steps.find((s) => s.role === role);
    const prompt = assemblePrompt({ spec, surface, rep: input.rep ?? {}, contact: input.contact, task });
    return this.modelClient.generate({
      tier,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      batched: step?.batched ?? false,
    });
  }

  private async recordTerminalRun(spec: AgentSpec, input: AgentJobInput, status: 'HELD' | 'FAILED', reasoning: string): Promise<string> {
    return this.store.createAgentRun({
      agent_key: spec.key,
      user_id: input.userId,
      trigger: input.trigger,
      model_used: spec.primaryTier,
      batched: false,
      status,
      input_summary: input.task ?? null,
      reasoning_log: reasoning,
    });
  }

  private result(
    agentKey: AgentKey,
    outcome: RunOutcome,
    runId: string | null,
    draftMessageId: string | null,
    reasoningLog: string,
    cfe: AgentJobResult['cfe']
  ): AgentJobResult {
    return { agentKey, outcome, runId, draftMessageId, reasoningLog, cfe };
  }
}

/** §4.5: critical paths (CFE, inbound handling, appointment confirmations) survive the kill-switch. */
export function criticalityFor(key: AgentKey): RunCriticality {
  return key === AgentKey.APPOINTMENT_SETTING ? 'critical' : 'non_critical';
}

function cfeChannelFor(surface: OutputSurface, channel?: PersistedChannel): Channel {
  if (surface === 'rep_facing') return 'EMAIL';
  switch (channel) {
    case 'EMAIL':
      return 'EMAIL';
    case 'SOCIAL_DM':
      return 'SOCIAL';
    case 'SMS_HANDOFF':
    case 'SMS_PLATFORM':
    case 'IN_APP':
    default:
      return 'SMS';
  }
}

function bandToOutcome(verdict: CFEVerdict): PersistedCfeOutcome {
  if (verdict.held || verdict.band === 'blocked') return 'BLOCK';
  if (verdict.band === 'review') return 'FLAG';
  return 'PASS';
}

/** Tier → the wire model id (a `claude-*` id). Re-exported for callers that log the model used. */
export function modelIdForTier(tier: ClaudeModelTier): string {
  return CLAUDE_MODEL_IDS[tier];
}
