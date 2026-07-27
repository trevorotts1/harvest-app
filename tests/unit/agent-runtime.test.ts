// WP04 (T-30) — proof tests for the nine-agent runtime core. Each block below is a PROOF with TEETH:
// the comment on each critical test states the mutation that makes it fail. All run in a KEY-LESS env
// (no ANTHROPIC_API_KEY / no CONTACT_ENCRYPTION_KEY) — the CI standard.

import type { ClaudeClassifierClient, ClassifierRequest } from '@/services/compliance/claude';
import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ClassifierVerdict } from '@/types/compliance';

import { AgnesMemoryJoggerCategoryClient } from '@/services/warm-market/memory-jogger';
import {
  AgnesSegmentationClient,
  LocalDeterministicSegmentationClient,
} from '@/services/warm-market/segmentation';

import {
  AGENT_DISPATCH_EVENT,
  AGENT_DISPATCH_FUNCTION_ID,
  AGENT_DISPATCH_RETRIES,
  AgentKey,
  AgentRuntime,
  AnthropicRuntimeClient,
  AgentModelError,
  ALL_AGENT_KEYS,
  CLAUDE_MODEL_IDS,
  ClaudeModelTier,
  InMemoryAgentRuntimeStore,
  InMemoryDurableQueue,
  MissingClaudeCredentialError,
  NINE_AGENTS,
  OPUS_MODEL_ID,
  SONNET_MODEL_ID,
  dispatchAgentJob,
  tierForStep,
} from '@/services/agent-runtime';
import type {
  AgentGenerationRequest,
  AgentGenerationResult,
  AgentModelClient,
  RunGate,
} from '@/services/agent-runtime';

// ── Test doubles ────────────────────────────────────────────────────────────────────────────────

/** Records every model call; returns a clean draft, or throws a scripted error. No key needed. */
class ScriptedModelClient implements AgentModelClient {
  readonly calls: AgentGenerationRequest[] = [];
  constructor(private opts: { text?: string; throwError?: Error } = {}) {}
  async generate(req: AgentGenerationRequest): Promise<AgentGenerationResult> {
    this.calls.push(req);
    if (this.opts.throwError) throw this.opts.throwError;
    return {
      text: this.opts.text ?? 'Hi friend — would you be open to a warm chat this week? No worries if not.',
      modelId: CLAUDE_MODEL_IDS[req.tier],
      tier: req.tier,
      tokenInput: 100,
      tokenOutput: 40,
      batched: Boolean(req.batched),
    };
  }
}

/** A CFE classifier client returning a fixed confidence for all five classifiers — controls the band. */
class FixedConfidenceClassifierClient implements ClaudeClassifierClient {
  constructor(private confidence: number) {}
  async classify(): Promise<ClassifierVerdict> {
    return { flagged: this.confidence >= 0.5, confidence: this.confidence, rationale: 'test' };
  }
}

/** Fires ONE classifier at a chosen confidence, the rest at 0 — for a clean single-signal band. */
class SingleClassifierClient implements ClaudeClassifierClient {
  constructor(private target: string, private confidence: number) {}
  async classify(req: ClassifierRequest): Promise<ClassifierVerdict> {
    const c = req.classifier === this.target ? this.confidence : 0;
    return { flagged: c >= 0.5, confidence: c, rationale: 'test' };
  }
}

const clearCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0) });
const blockedCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0.99) });
// income-claim 0.5 alone → score 15 → the 11–70 FLAG band with an FTC disclaimer (§5.3-1/§5.4);
// no insurance signal, so the "any insurance signal blocks unlicensed" rule does not fire.
const flaggedCFE = () => new ComplianceFilterEngine({ classifierClient: new SingleClassifierClient('INCOME_CLAIM', 0.5) });

const REP_CONTEXT = { firstName: 'Tasha', organization: 'primerica' };

function job(overrides: Partial<Parameters<AgentRuntime['runAgent']>[0]> = {}) {
  return {
    agentKey: AgentKey.PROSPECTING,
    userId: 'user-1',
    trigger: 'test',
    idempotencyKey: `idem-${Math.random()}`,
    contactId: 'contact-1',
    channel: 'SMS_HANDOFF' as const,
    rep: REP_CONTEXT,
    contact: { firstName: 'Jordan', relationshipType: 'FRIEND' },
    task: undefined,
    ...overrides,
  };
}

// Every runtime test is KEY-LESS regardless of the ambient shell (deterministic fail-closed proof).
const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (a) — the runtime model map (§4.4): each of the nine agents on its spec-mandated Claude model
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('runtime model map (§4.4) — nine agents, exact per-step models', () => {
  test('exactly nine agents (§4.2)', () => {
    expect(ALL_AGENT_KEYS).toHaveLength(9);
    expect(Object.keys(NINE_AGENTS)).toHaveLength(9);
  });

  // TEETH: if any model is swapped in runtime-model-map.ts, the corresponding expectation below fails.
  test.each<[AgentKey, Record<string, ClaudeModelTier>]>([
    [AgentKey.PROSPECTING, { prioritize_segment: ClaudeModelTier.HAIKU_4_5, draft: ClaudeModelTier.SONNET_5 }],
    [AgentKey.PRE_SALE_NURTURE, { reply_intent: ClaudeModelTier.HAIKU_4_5, draft: ClaudeModelTier.SONNET_5 }],
    [AgentKey.POST_SALE_NURTURE, { draft: ClaudeModelTier.SONNET_5 }],
    [AgentKey.APPOINTMENT_SETTING, { availability_match: ClaudeModelTier.HAIKU_4_5, negotiation_draft: ClaudeModelTier.SONNET_5 }],
    [AgentKey.REPORTING, { aggregation: ClaudeModelTier.HAIKU_4_5, narrative: ClaudeModelTier.SONNET_5 }],
    [AgentKey.QUOTA, { track: ClaudeModelTier.HAIKU_4_5 }],
    [AgentKey.IPA_VALUE, { metrics: ClaudeModelTier.HAIKU_4_5, self_optimization: ClaudeModelTier.OPUS_4_8 }],
    [AgentKey.INACTIVITY_REENGAGEMENT, { detection: ClaudeModelTier.HAIKU_4_5, reengagement_copy: ClaudeModelTier.SONNET_5 }],
    [AgentKey.WARM_MARKET_SUB, { matching: ClaudeModelTier.HAIKU_4_5, draft: ClaudeModelTier.SONNET_5 }],
  ])('%s steps map to the §4.4 tiers', (key, expected) => {
    for (const [role, tier] of Object.entries(expected)) {
      expect(tierForStep(key, role)).toBe(tier);
    }
  });

  test('IPA self-optimization is Opus 4.8 AND batched (§4.4 / §9.9-10)', () => {
    const step = NINE_AGENTS[AgentKey.IPA_VALUE].steps.find((s) => s.role === 'self_optimization');
    expect(step?.tier).toBe(ClaudeModelTier.OPUS_4_8);
    expect(step?.batched).toBe(true);
  });

  test('Appointment Setting is the only sequential agent (§4.1 #3)', () => {
    const sequential = ALL_AGENT_KEYS.filter((k) => NINE_AGENTS[k].mode === 'sequential');
    expect(sequential).toEqual([AgentKey.APPOINTMENT_SETTING]);
  });

  // Claude-only (§0.3): every wire model id is a claude-* id — no non-Claude provider anywhere.
  test('every model id is a Claude id (§0.3)', () => {
    expect(CLAUDE_MODEL_IDS[ClaudeModelTier.SONNET_5]).toBe(SONNET_MODEL_ID);
    expect(CLAUDE_MODEL_IDS[ClaudeModelTier.OPUS_4_8]).toBe(OPUS_MODEL_ID);
    for (const id of Object.values(CLAUDE_MODEL_IDS)) {
      expect(id).toMatch(/^claude-/);
    }
  });

  // The runtime actually CALLS the mandated tier — proof at execution time, not just the static map.
  test('the runtime drafts each content agent on Sonnet 5 (§4.4)', async () => {
    for (const key of [AgentKey.PROSPECTING, AgentKey.POST_SALE_NURTURE, AgentKey.INACTIVITY_REENGAGEMENT, AgentKey.WARM_MARKET_SUB]) {
      const model = new ScriptedModelClient();
      const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store: new InMemoryAgentRuntimeStore() });
      await runtime.runAgent(job({ agentKey: key }));
      expect(model.calls.at(-1)?.tier).toBe(ClaudeModelTier.SONNET_5);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (b) — CFE on the synchronous path (§2.3/§5): a non-released verdict HOLDS, never surfaces
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('CFE on the synchronous path (§2.3/§5)', () => {
  // TEETH: if the `cfe.evaluateContent(...)` call is removed from AgentRuntime, this held-on-block
  // draft would instead surface as PENDING — this expectation (`outcome === 'held'`) then fails.
  test('a BLOCKED verdict holds the draft — not sendable, not surfaced', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const runtime = new AgentRuntime({ modelClient: new ScriptedModelClient(), cfe: blockedCFE(), store });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('held');
    expect(res.cfe?.released).toBe(false);
    // A DraftMessage was recorded (so the Approval Inbox shows the held item, §9.2) but is HELD.
    expect(store.draftMessages).toHaveLength(1);
    expect(store.draftMessages[0].approval_state).toBe('HELD');
    expect(store.draftMessages[0].cfe_outcome).toBe('BLOCK');
    expect(store.agentRuns.at(-1)?.status).toBe('HELD');
  });

  test('a CLEAR verdict surfaces the draft to the Approval Inbox (PENDING, still needs human OK)', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const runtime = new AgentRuntime({ modelClient: new ScriptedModelClient(), cfe: clearCFE(), store });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('surfaced');
    expect(res.cfe?.released).toBe(true);
    expect(store.draftMessages[0].approval_state).toBe('PENDING');
    expect(store.draftMessages[0].cfe_outcome).toBe('PASS');
  });

  // §2.3: 11–70 FLAG enters the Approval Inbox flagged (NOT blocked) — PENDING, carrying its FLAG
  // band so T-33 can render the Sonnet-adjudication + upline-review path.
  test('a FLAGGED (11–70) verdict enters the Approval Inbox flagged, not blocked', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const runtime = new AgentRuntime({ modelClient: new ScriptedModelClient(), cfe: flaggedCFE(), store });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('surfaced');
    expect(res.cfe?.band).toBe('review');
    expect(store.draftMessages[0].approval_state).toBe('PENDING');
    expect(store.draftMessages[0].cfe_outcome).toBe('FLAG');
  });

  // §9.9-9 / §5.2 fail-closed dominance: CFE non-responsive → the agent HOLDS and produces NO output.
  test('CFE unavailable → agent holds and never generates (fail-closed, within the sync path)', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const cfe = clearCFE();
    cfe.setAvailability(false);
    const model = new ScriptedModelClient();
    const runtime = new AgentRuntime({ modelClient: model, cfe, store });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('held');
    expect(model.calls).toHaveLength(0); // paused BEFORE spending any Claude tokens
    expect(store.draftMessages).toHaveLength(0);
    expect(res.reasoningLog).toMatch(/compliance|nothing was lost/i);
  });

  test('no contact-bound draft is ever created without a CFE band (no bypass)', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const runtime = new AgentRuntime({ modelClient: new ScriptedModelClient(), cfe: clearCFE(), store });
    await runtime.runAgent(job());
    expect(store.draftMessages[0].cfe_outcome).toBeDefined();
    expect(store.draftMessages[0].cfe_risk_score).toBeGreaterThanOrEqual(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (c) — Agnes seg/jogger clients INJECTED (runtime uses Agnes, not the local heuristic)
// T-R55b (operator directive 2026-07-27): the former Haiku (Anthropic) defaults for these two seams
// are superseded by their Agnes siblings; `HaikuSegmentationClient`/`HaikuMemoryJoggerCategoryClient`
// are retained, unused, for revertability (see tests/unit/warm-market.test.ts for their own coverage).
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('Agnes injection for segmentation/jogger (HARD REQ §7.2/§4.4, T-R55b)', () => {
  // TEETH (structural): if the injection is dropped, these default to the LOCAL heuristic clients and
  // the instanceof checks fail.
  test('the runtime holds the AGNES clients (not the local heuristic, not the retained Haiku clients)', () => {
    const runtime = new AgentRuntime();
    expect(runtime.segmentationClient).toBeInstanceOf(AgnesSegmentationClient);
    expect(runtime.memoryJoggerClient).toBeInstanceOf(AgnesMemoryJoggerCategoryClient);
  });

  // TEETH (functional): the injected segmentation client is the Agnes one → it FAILS CLOSED with no
  // key. The LOCAL heuristic needs no key and would RESOLVE — so if the injection were dropped, this
  // "expect rejects" would fail.
  test('the injected segmentation client fails closed with no key (proves Agnes, not local)', async () => {
    const runtime = new AgentRuntime();
    await expect(
      runtime.segmentationClient.inferRelationshipType({
        contactId: 'c1',
        hints: { notes: 'we play in the same church band', industry: 'Music', groupMembership: null },
      })
    ).rejects.toBeInstanceOf(MissingClaudeCredentialError);
  });

  test('the injected Memory Jogger client fails closed with no key (proves Agnes, not local)', async () => {
    const runtime = new AgentRuntime({ encryptionKeyProvider: () => 'dummy-key-not-read-on-this-path' });
    const jogger = runtime.buildMemoryJoggerService({});
    await expect(jogger.selectNextCategoryPrompt([])).rejects.toBeInstanceOf(MissingClaudeCredentialError);
  });

  // Contrast that pins the teeth: the LOCAL client (the thing we must NOT default to) RESOLVES with no
  // key — this is exactly the silent-regex behavior the injection prevents.
  test('contrast: the local heuristic resolves with no key (the behavior the injection avoids)', async () => {
    const local = new LocalDeterministicSegmentationClient();
    await expect(
      local.inferRelationshipType({ contactId: 'c1', hints: { notes: 'church band', industry: null, groupMembership: null } })
    ).resolves.toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (d) — Claude-only, fail-closed (§0.3): missing key HOLDS; no non-Claude fallback, no stub
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('Claude-only, fail-closed (§0.3)', () => {
  // TEETH: if the runtime fell back to any non-Claude provider or a silent stub, the outcome would be
  // 'surfaced' with a draft — this expectation ('held', zero drafts) fails.
  test('missing ANTHROPIC_API_KEY → the run HOLDS, sends nothing (default real client)', async () => {
    const store = new InMemoryAgentRuntimeStore();
    // No modelClient injected → the DEFAULT is AnthropicRuntimeClient (the live path), which fails closed.
    const runtime = new AgentRuntime({ cfe: clearCFE(), store });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('held');
    expect(store.draftMessages).toHaveLength(0);
    expect(store.agentRuns.at(-1)?.status).toBe('HELD');
    expect(res.reasoningLog).toMatch(/resting|not configured|nothing was lost/i);
  });

  test('AnthropicRuntimeClient throws BEFORE any network attempt when the key is unset', async () => {
    const fetchSpy = jest.fn();
    const client = new AnthropicRuntimeClient({ fetchImpl: fetchSpy as never });
    await expect(
      client.generate({ tier: ClaudeModelTier.SONNET_5, systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toBeInstanceOf(MissingClaudeCredentialError);
    expect(fetchSpy).not.toHaveBeenCalled(); // no send, no fallback
  });

  test('AnthropicRuntimeClient refuses a non-Claude model id (defensive Claude-only)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-used-on-this-path';
    const fetchSpy = jest.fn();
    const client = new AnthropicRuntimeClient({
      fetchImpl: fetchSpy as never,
      modelIds: { haiku_4_5: 'gpt-4', sonnet_5: 'gpt-4', opus_4_8: 'gpt-4' } as never,
    });
    await expect(
      client.generate({ tier: ClaudeModelTier.SONNET_5, systemPrompt: 's', userPrompt: 'u' })
    ).rejects.toBeInstanceOf(AgentModelError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (e) — durable queue (Inngest, D-4): registered + retriable + idempotent; no live infra
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('durable queue (Inngest, D-4)', () => {
  test('the dispatch function is registered with an id + retries and a stable event name', () => {
    expect(AGENT_DISPATCH_FUNCTION_ID).toBe('agent-dispatch');
    expect(AGENT_DISPATCH_RETRIES).toBeGreaterThanOrEqual(1); // retriable/durable
    expect(AGENT_DISPATCH_EVENT).toBe('agent/dispatch.requested');
  });

  test('runs end-to-end through the in-memory queue with NO live infra', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const model = new ScriptedModelClient();
    const queue = new InMemoryDurableQueue();
    await queue.send({ agentKey: AgentKey.PROSPECTING, userId: 'u1', trigger: 'wave', idempotencyKey: 'k1', contactId: 'c1', rep: REP_CONTEXT });
    const [res] = await queue.drain({ modelClient: model, cfe: clearCFE(), store });
    expect(res.outcome).toBe('surfaced');
    expect(store.draftMessages).toHaveLength(1);
  });

  // TEETH: if the idempotency check is removed from AgentRuntime, the replay creates a SECOND draft
  // (length 2) and the second outcome is 'surfaced' — both expectations below then fail.
  test('idempotent handler: a replayed event with the same key never double-processes', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const model = new ScriptedModelClient();
    const deps = { modelClient: model, cfe: clearCFE(), store };
    const data = { agentKey: AgentKey.PROSPECTING, userId: 'u1', trigger: 'wave', idempotencyKey: 'dup-key', contactId: 'c1', rep: REP_CONTEXT };
    const first = await dispatchAgentJob(data, deps);
    const second = await dispatchAgentJob(data, deps); // replay / retry with same key
    expect(first.outcome).toBe('surfaced');
    expect(second.outcome).toBe('idempotent_replay');
    expect(store.draftMessages).toHaveLength(1); // no duplicate send
    expect(model.calls).toHaveLength(1); // no duplicate Claude spend
  });

  // §4.6: a transient model error RETHROWS (so Inngest retries) and does NOT mark the key processed.
  test('a transient model error is retriable (rethrown; key not deduped)', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const model = new ScriptedModelClient({ throwError: new AgentModelError('429 rate limited') });
    const data = { agentKey: AgentKey.PROSPECTING, userId: 'u1', trigger: 'wave', idempotencyKey: 'retry-key', contactId: 'c1', rep: REP_CONTEXT };
    await expect(dispatchAgentJob(data, { modelClient: model, cfe: clearCFE(), store })).rejects.toBeInstanceOf(AgentModelError);
    expect(await store.wasProcessed('retry-key')).toBe(false); // a genuine retry will re-run
  });

  // T-58 — event-bus contract: PAYLOAD SHAPE AT THE BOUNDARY. `AgentDispatchEventData`
  // (durable-queue.ts) declares exactly: agentKey, userId, trigger, idempotencyKey, and the
  // OPTIONAL contactId/channel/task/rep/contact/segmentContactId. The real Inngest handler
  // (inngest-functions.ts's `agentDispatchFunction`) does `event.data as unknown as
  // AgentDispatchEventData` with NO validation/whitelist step — so anything a caller smuggles
  // onto the wire is exactly what `dispatchAgentJob` receives. `dispatchAgentJob` (dispatch.ts)
  // forwards ONLY the named fields it destructures — no spread — so a phantom field a caller adds
  // must be silently dropped, never read by the runtime. This asserts that boundary holds by
  // publishing THROUGH the real queue with an extra, undeclared field riding along.
  test('an event with a phantom undeclared field is delivered through the real queue with the phantom ignored', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const model = new ScriptedModelClient();
    const queue = new InMemoryDurableQueue();
    const withPhantomField = {
      agentKey: AgentKey.PROSPECTING,
      userId: 'u1',
      trigger: 'wave',
      idempotencyKey: 'phantom-key',
      contactId: 'c1',
      rep: REP_CONTEXT,
      // Not part of AgentDispatchEventData — simulates a forged/legacy field riding the wire.
      // A handler that (incorrectly) read this instead of `userId`/`contactId` would corrupt
      // whose draft gets created; asserting draftMessages below proves it never does.
      impersonateUserId: 'attacker-controlled',
    } as unknown as Parameters<InMemoryDurableQueue['send']>[0];
    await queue.send(withPhantomField);
    const [res] = await queue.drain({ modelClient: model, cfe: clearCFE(), store });
    expect(res.outcome).toBe('surfaced');
    expect(store.draftMessages).toHaveLength(1);
    expect(store.draftMessages[0].user_id).toBe('u1'); // the REAL declared field, not the phantom
  });

  // T-58 — event-bus contract: FAIL-CLOSED (§0.3) THROUGH THE REAL BUS, not via a hand-constructed
  // `AgentRuntime`. Publishing a real `agent/dispatch.requested` event and draining it with NO
  // `modelClient` override means `dispatchAgentJob`/`AgentRuntime` falls back to its default —
  // the LIVE `AnthropicRuntimeClient` — which must fail closed with no ANTHROPIC_API_KEY: the run
  // HOLDS, nothing is fabricated, no non-Claude fallback is ever reached.
  test('missing ANTHROPIC_API_KEY, published through the real queue, HOLDS (no fallback, no draft)', async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined(); // beforeEach() above deletes it
    const store = new InMemoryAgentRuntimeStore();
    const queue = new InMemoryDurableQueue();
    await queue.send({ agentKey: AgentKey.PROSPECTING, userId: 'u2', trigger: 'wave', idempotencyKey: 'k-no-key', contactId: 'c2', rep: REP_CONTEXT });
    // No modelClient in deps -> AgentRuntime's default AnthropicRuntimeClient (the live path).
    const [res] = await queue.drain({ cfe: clearCFE(), store });
    expect(res.outcome).toBe('held');
    expect(store.draftMessages).toHaveLength(0);
    expect(res.reasoningLog).toMatch(/resting|not configured|nothing was lost/i);
  });

  // T-58 — event-bus contract invariant (3): "a handler that throws doesn't corrupt other
  // subscribers." This codebase's real bus (Inngest) invokes one function execution PER EVENT —
  // a crash processing event A can never touch the separate invocation processing event B (that
  // isolation is Inngest's own platform guarantee, not something this app's code implements).
  // Deliberately NOT exercised via a single `queue.drain()` call over a multi-item queue: this
  // dev/test harness's `drain()` is a plain sequential loop with no per-item try/catch (durable-
  // queue.ts), so an earlier item's throw would abort the loop before later items run — that is a
  // characteristic of the IN-MEMORY TEST HARNESS ONLY (worth hardening — see build report), not a
  // claim about production Inngest, which this test instead models faithfully: two INDEPENDENT
  // dispatchAgentJob invocations (exactly what two separate Inngest function calls look like),
  // proving the failing one's error never corrupts the succeeding one's state.
  test('two independently-dispatched events: one throws, the other is fully unaffected (isolation)', async () => {
    const store = new InMemoryAgentRuntimeStore(); // shared store, as production shares one DB
    const throwingModel = new ScriptedModelClient({ throwError: new AgentModelError('429 rate limited') });
    const healthyModel = new ScriptedModelClient();

    const failing = { agentKey: AgentKey.PROSPECTING, userId: 'u-fail', trigger: 'wave', idempotencyKey: 'iso-fail-key', contactId: 'c-fail', rep: REP_CONTEXT };
    const healthy = { agentKey: AgentKey.PROSPECTING, userId: 'u-ok', trigger: 'wave', idempotencyKey: 'iso-ok-key', contactId: 'c-ok', rep: REP_CONTEXT };

    await expect(dispatchAgentJob(failing, { modelClient: throwingModel, cfe: clearCFE(), store })).rejects.toBeInstanceOf(AgentModelError);
    const healthyResult = await dispatchAgentJob(healthy, { modelClient: healthyModel, cfe: clearCFE(), store });

    expect(healthyResult.outcome).toBe('surfaced');
    expect(await store.wasProcessed('iso-fail-key')).toBe(false); // failing event stays retriable
    expect(await store.wasProcessed('iso-ok-key')).toBe(true);
    // The healthy event's own draft exists, addressed to the healthy contact/user only — the
    // failing sibling contributed nothing to it and blocked nothing on it.
    expect(store.draftMessages).toHaveLength(1);
    expect(store.draftMessages[0].contact_id).toBe('c-ok');
    expect(store.draftMessages[0].user_id).toBe('u-ok');
    expect(healthyModel.calls).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Per-contact controls (§9.4), IPA Opus-batched off the per-message path, and the RunGate seam (T-31)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('per-contact controls (§9.4)', () => {
  test('do_not_contact halts the run immediately — no generation, no draft', async () => {
    const store = new InMemoryAgentRuntimeStore();
    store.contactControls.set('contact-1', { do_not_contact: true, agents_paused: false, manual_mode: false });
    const model = new ScriptedModelClient();
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('skipped_dnc');
    expect(model.calls).toHaveLength(0);
    expect(store.draftMessages).toHaveLength(0);
  });

  test('agents_paused halts the run immediately', async () => {
    const store = new InMemoryAgentRuntimeStore();
    store.contactControls.set('contact-1', { do_not_contact: false, agents_paused: true, manual_mode: false });
    const model = new ScriptedModelClient();
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('skipped_paused');
    expect(model.calls).toHaveLength(0);
  });

  // T-57 R3c-2: closes the gap the R3c-2 write-path (contact-controls.service.ts) left open — the
  // toggle persisted `Contact.manual_mode` but the runtime never read it. TEETH: if the manual_mode
  // branch is removed from AgentRuntime, this run falls through to generation — the model gets
  // called, a draft is created, and the outcome is 'surfaced' instead of 'skipped_manual'.
  test('manual_mode halts the run immediately — no generation, no draft', async () => {
    const store = new InMemoryAgentRuntimeStore();
    store.contactControls.set('contact-1', { do_not_contact: false, agents_paused: false, manual_mode: true });
    const model = new ScriptedModelClient();
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('skipped_manual');
    expect(model.calls).toHaveLength(0);
    expect(store.draftMessages).toHaveLength(0);
  });
});

describe('IPA Value self-optimization (§9.9-10/-11)', () => {
  test('runs on Opus 4.8, batched, and OFF the per-message (outbound) path', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const model = new ScriptedModelClient();
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store });
    const res = await runtime.runAgent(job({ agentKey: AgentKey.IPA_VALUE, trigger: 'periodic_self_optimization', contactId: undefined }));
    expect(model.calls.at(-1)?.tier).toBe(ClaudeModelTier.OPUS_4_8);
    expect(model.calls.at(-1)?.batched).toBe(true);
    expect(res.outcome).toBe('completed_internal'); // no outbound draft — off the per-message path
    expect(store.draftMessages).toHaveLength(0);
  });
});

describe('RunGate budget/kill-switch seam (T-31, §4.5)', () => {
  test('a denying gate defers the run before any Claude spend', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const model = new ScriptedModelClient();
    const denyGate: RunGate = { check: () => ({ allowed: false, reason: 'budget_exhausted' }) };
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, runGate: denyGate });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('deferred');
    expect(model.calls).toHaveLength(0);
    expect(store.draftMessages).toHaveLength(0);
  });
});
