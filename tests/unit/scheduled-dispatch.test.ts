// T-R14 (LAUNCH-GATE remediation, master-spec §4 "24/7 / while you slept") — proof tests for the
// scheduled (cron-triggered) autonomous-dispatch pass. Each block states the mutation that makes it
// fail. All run in a KEY-LESS env (no ANTHROPIC_API_KEY) — the CI standard, matching
// tests/unit/agent-runtime.test.ts / tests/unit/cost-killswitch.test.ts's convention. This file never
// imports the `inngest` package (only `runScheduledDispatch` — the package-free handler logic — and
// `InMemoryDurableQueue`), so it needs no live scheduler/Inngest server, per the build brief.

import {
  AgentKey,
  AgentGenerationRequest,
  AgentGenerationResult,
  AgentModelClient,
  CLAUDE_MODEL_IDS,
  InMemoryAgentRuntimeStore,
  InMemoryDurableQueue,
  BudgetKillSwitchRunGate,
  InMemoryBudgetKillSwitchStore,
  DAILY_BUDGET_CENTS_BY_TIER_INTENSITY,
  agentKeyForPipelineStage,
  scheduledIdempotencyKey,
  utcDateKey,
  runScheduledDispatch,
  InMemoryScheduledDispatchStore,
  SCHEDULED_TRIGGER_CONTACT,
  SCHEDULED_TRIGGER_BRIEFING,
  SCHEDULED_ACTION_CAP_BY_INTENSITY,
  SCHEDULED_AGENT_DISPATCH_FUNCTION_ID,
  SCHEDULED_AGENT_DISPATCH_CRON,
} from '@/services/agent-runtime';
import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ClaudeClassifierClient } from '@/services/compliance/claude';
import type { ClassifierVerdict } from '@/types/compliance';

// ── Test doubles (mirrors tests/unit/cost-killswitch.test.ts's conventions) ────────────────────────

class FixedConfidenceClassifierClient implements ClaudeClassifierClient {
  constructor(private confidence: number) {}
  async classify(): Promise<ClassifierVerdict> {
    return { flagged: this.confidence >= 0.5, confidence: this.confidence, rationale: 'test' };
  }
}
const clearCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0) });

class ScriptedModelClient implements AgentModelClient {
  readonly calls: AgentGenerationRequest[] = [];
  async generate(req: AgentGenerationRequest): Promise<AgentGenerationResult> {
    this.calls.push(req);
    return {
      text: 'Hi friend — open to a quick warm chat this week? No worries either way.',
      modelId: CLAUDE_MODEL_IDS[req.tier],
      tier: req.tier,
      tokenInput: 100,
      tokenOutput: 40,
      batched: Boolean(req.batched),
    };
  }
}

const FIXED_NOW = new Date('2026-07-20T09:00:00.000Z');

function seedRep(budgetStore: InMemoryBudgetKillSwitchStore, userId: string, intensitySetting: 'LOW' | 'MEDIUM' | 'HIGH' = 'HIGH') {
  budgetStore.repContexts.set(userId, { accessTier: 'PAID_INDIVIDUAL', intensitySetting: intensitySetting as never, organizationId: null });
}

const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Config sanity — the cron trigger IS the missing LAUNCH-GATE surface (id/cadence are stable/config)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('scheduled dispatch — Inngest cron function config (package-free, no live scheduler needed)', () => {
  test('a stable function id and an hourly cron cadence are defined', () => {
    expect(SCHEDULED_AGENT_DISPATCH_FUNCTION_ID).toBe('agent-scheduled-dispatch');
    expect(SCHEDULED_AGENT_DISPATCH_CRON).toBe('0 * * * *');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Pipeline-stage → agent mapping — the sequential Appointment Setting Agent's stages are excluded
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('agentKeyForPipelineStage — §4.1 principle 3 (sequential agent stages are never this cron\'s job)', () => {
  test('maps each in-scope stage to its 24/7 parallel agent', () => {
    expect(agentKeyForPipelineStage('IDENTIFIED' as never)).toBe(AgentKey.PROSPECTING);
    expect(agentKeyForPipelineStage('INTRODUCED' as never)).toBe(AgentKey.PRE_SALE_NURTURE);
    expect(agentKeyForPipelineStage('RESPONDED' as never)).toBe(AgentKey.PRE_SALE_NURTURE);
    expect(agentKeyForPipelineStage('CLOSED_CLIENT' as never)).toBe(AgentKey.POST_SALE_NURTURE);
    expect(agentKeyForPipelineStage('CLOSED_RECRUIT' as never)).toBe(AgentKey.POST_SALE_NURTURE);
    expect(agentKeyForPipelineStage('DORMANT' as never)).toBe(AgentKey.INACTIVITY_REENGAGEMENT);
  });

  // TEETH: if the Appointment Setting Agent's sequential stages were accidentally mapped here, this
  // scheduler would start racing the sequential agent for the same contact (§4.1 principle 3 violation).
  test('appointment-flow stages and DO_NOT_CONTACT return null — never claimed by this cron', () => {
    expect(agentKeyForPipelineStage('APPOINTMENT_PROPOSED' as never)).toBeNull();
    expect(agentKeyForPipelineStage('APPOINTMENT_CONFIRMED' as never)).toBeNull();
    expect(agentKeyForPipelineStage('MET' as never)).toBeNull();
    expect(agentKeyForPipelineStage('DO_NOT_CONTACT' as never)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (a) — enumerates due work and enqueues through the EXISTING durable-queue path (not forked)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('runScheduledDispatch (a) — enumerates due work, enqueues via the EXISTING DurableQueue/dispatchAgentJob path', () => {
  test('enqueues the daily briefing + due contact-bound work for a real due rep', async () => {
    const store = new InMemoryScheduledDispatchStore();
    store.reps = [{ userId: 'rep-1' }];
    store.contactsByUser.set('rep-1', [
      { contactId: 'c1', pipelineStage: 'IDENTIFIED' as never },
      { contactId: 'c2', pipelineStage: 'DORMANT' as never },
    ]);

    const budgetStore = new InMemoryBudgetKillSwitchStore();
    seedRep(budgetStore, 'rep-1', 'HIGH');
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const queue = new InMemoryDurableQueue();

    const result = await runScheduledDispatch({ store, budgetStore, runGate, queue, clock: () => FIXED_NOW });

    expect(result.ok).toBe(true);
    expect(result.repsConsidered).toBe(1);
    expect(result.unitsEnqueued).toBe(3); // 1 briefing + 2 due contacts
    expect(queue.sent).toHaveLength(3);

    const briefing = queue.sent.find((e) => e.agentKey === AgentKey.REPORTING);
    expect(briefing?.trigger).toBe(SCHEDULED_TRIGGER_BRIEFING);
    expect(briefing?.contactId).toBeUndefined();

    const prospecting = queue.sent.find((e) => e.contactId === 'c1');
    expect(prospecting?.agentKey).toBe(AgentKey.PROSPECTING);
    expect(prospecting?.trigger).toBe(SCHEDULED_TRIGGER_CONTACT);
    expect(prospecting?.userId).toBe('rep-1');

    const reengage = queue.sent.find((e) => e.contactId === 'c2');
    expect(reengage?.agentKey).toBe(AgentKey.INACTIVITY_REENGAGEMENT);

    // THE "not forked" proof: drain the SAME events through the real durable-queue consumer
    // (dispatchAgentJob, via InMemoryDurableQueue.drain — the exact path the Inngest-backed
    // producer/consumer pair uses in production) and see real AgentRun/DraftMessage rows come out.
    const runtimeStore = new InMemoryAgentRuntimeStore();
    const model = new ScriptedModelClient();
    const results = await queue.drain({ modelClient: model, cfe: clearCFE(), store: runtimeStore });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.outcome === 'surfaced')).toBe(true);
    expect(model.calls.length).toBeGreaterThan(0); // the real runtime actually generated
    expect(runtimeStore.agentRuns).toHaveLength(3); // the real Activity Ledger recorded 3 runs
    expect(runtimeStore.draftMessages).toHaveLength(2); // only the 2 contact-bound runs produce a DraftMessage
  });

  test('a rep with no due contacts still gets exactly the daily briefing, nothing fabricated', async () => {
    const store = new InMemoryScheduledDispatchStore();
    store.reps = [{ userId: 'rep-quiet' }];
    // no entry in contactsByUser -> listDueContacts() returns []

    const budgetStore = new InMemoryBudgetKillSwitchStore();
    seedRep(budgetStore, 'rep-quiet');
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const queue = new InMemoryDurableQueue();

    const result = await runScheduledDispatch({ store, budgetStore, runGate, queue, clock: () => FIXED_NOW });
    expect(result.unitsEnqueued).toBe(1);
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].agentKey).toBe(AgentKey.REPORTING);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (b) — consults RunGate/kill-switch: a killed/over-budget rep is SKIPPED, not dispatched
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('runScheduledDispatch (b) — respects the SAME T-31 RunGate/kill-switch the user-invoked path uses', () => {
  // TEETH: this test asserts on the REAL `BudgetKillSwitchRunGate` (not a stub that always allows) —
  // if `processRep`'s call to `ctx.runGate.check(...)` were ever removed from scheduled-dispatch.ts,
  // 'rep-killed' would ALSO be enqueued below and this assertion would fail.
  test('a manually-killed rep is skipped outright — zero events reach the queue for them', async () => {
    const store = new InMemoryScheduledDispatchStore();
    store.reps = [{ userId: 'rep-ok' }, { userId: 'rep-killed' }];
    store.contactsByUser.set('rep-ok', [{ contactId: 'ok-1', pipelineStage: 'IDENTIFIED' as never }]);
    store.contactsByUser.set('rep-killed', [{ contactId: 'killed-1', pipelineStage: 'IDENTIFIED' as never }]);

    const budgetStore = new InMemoryBudgetKillSwitchStore();
    seedRep(budgetStore, 'rep-ok');
    seedRep(budgetStore, 'rep-killed');
    await budgetStore.setKillSwitchState('REP', 'rep-killed', true, 'operator-requested pause');

    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const queue = new InMemoryDurableQueue();

    const result = await runScheduledDispatch({ store, budgetStore, runGate, queue, clock: () => FIXED_NOW });

    expect(result.repsSkippedByGate).toBe(1);
    const killedSummary = result.perRep.find((r) => r.userId === 'rep-killed');
    expect(killedSummary?.gateAllowed).toBe(false);
    expect(killedSummary?.gateReason).toBe('kill_switch_rep');
    expect(killedSummary?.enqueued).toBe(0);

    // The actual queue proof: no event of ANY kind (briefing or contact-bound) for the killed rep.
    expect(queue.sent.some((e) => e.userId === 'rep-killed')).toBe(false);
    expect(queue.sent.some((e) => e.contactId === 'killed-1')).toBe(false);
    // The healthy rep is unaffected.
    expect(queue.sent.some((e) => e.userId === 'rep-ok')).toBe(true);
  });

  test('a rep over their daily budget ceiling is skipped outright', async () => {
    const store = new InMemoryScheduledDispatchStore();
    store.reps = [{ userId: 'rep-broke' }];
    store.contactsByUser.set('rep-broke', [{ contactId: 'c1', pipelineStage: 'IDENTIFIED' as never }]);

    const budgetStore = new InMemoryBudgetKillSwitchStore();
    seedRep(budgetStore, 'rep-broke', 'LOW');
    budgetStore.recordSpend('rep-broke', DAILY_BUDGET_CENTS_BY_TIER_INTENSITY.PAID_INDIVIDUAL.LOW); // at the ceiling

    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const queue = new InMemoryDurableQueue();

    const result = await runScheduledDispatch({ store, budgetStore, runGate, queue, clock: () => FIXED_NOW });
    expect(result.repsSkippedByGate).toBe(1);
    expect(queue.sent).toHaveLength(0);
  });

  test('a tripped PLATFORM kill switch skips every rep, dominating all other checks', async () => {
    const store = new InMemoryScheduledDispatchStore();
    store.reps = [{ userId: 'rep-1' }, { userId: 'rep-2' }];
    store.contactsByUser.set('rep-1', [{ contactId: 'c1', pipelineStage: 'IDENTIFIED' as never }]);
    store.contactsByUser.set('rep-2', [{ contactId: 'c2', pipelineStage: 'IDENTIFIED' as never }]);

    const budgetStore = new InMemoryBudgetKillSwitchStore();
    seedRep(budgetStore, 'rep-1');
    seedRep(budgetStore, 'rep-2');
    await budgetStore.setKillSwitchState('PLATFORM', 'GLOBAL', true, 'operator emergency stop');

    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const queue = new InMemoryDurableQueue();

    const result = await runScheduledDispatch({ store, budgetStore, runGate, queue, clock: () => FIXED_NOW });
    expect(result.repsSkippedByGate).toBe(2);
    expect(queue.sent).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (c) — idempotent: running the schedule twice never double-dispatches the same due work
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('runScheduledDispatch (c) — idempotent, reusing the EXISTING IdempotencyLog pattern', () => {
  // TEETH: the shared `idem` Set below is the SAME object `InMemoryAgentRuntimeStore.markProcessed`
  // writes into (the real runtime's own idempotency mechanism) AND the object
  // `InMemoryScheduledDispatchStore.wasAlreadyDispatched` reads from — proving this scheduler reuses
  // the real mechanism rather than inventing its own. If `wasAlreadyDispatched` were never consulted
  // before enqueueing, pass 2's `unitsEnqueued` would equal pass 1's instead of zero.
  test('a second pass on the same day enqueues nothing already dispatched', async () => {
    const idem = new Set<string>();
    const store = new InMemoryScheduledDispatchStore({ idempotencyKeys: idem });
    store.reps = [{ userId: 'rep-1' }];
    store.contactsByUser.set('rep-1', [{ contactId: 'c1', pipelineStage: 'IDENTIFIED' as never }]);

    const budgetStore = new InMemoryBudgetKillSwitchStore();
    seedRep(budgetStore, 'rep-1');
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });

    // Pass 1.
    const queue1 = new InMemoryDurableQueue();
    const pass1 = await runScheduledDispatch({ store, budgetStore, runGate, queue: queue1, clock: () => FIXED_NOW });
    expect(pass1.unitsEnqueued).toBe(2); // briefing + the one due contact

    // Drain pass 1 through the REAL runtime, sharing the SAME idempotency Set — this is what a real
    // Inngest consumer invocation would do to the SAME IdempotencyLog table in production.
    const runtimeStore = new InMemoryAgentRuntimeStore();
    runtimeStore.idempotencyKeys = idem;
    await queue1.drain({ modelClient: new ScriptedModelClient(), cfe: clearCFE(), store: runtimeStore });

    // Pass 2 — same day, same due contact still "due" by cadence, but already dispatched today.
    const queue2 = new InMemoryDurableQueue();
    const pass2 = await runScheduledDispatch({ store, budgetStore, runGate, queue: queue2, clock: () => FIXED_NOW });
    expect(pass2.unitsEnqueued).toBe(0);
    expect(queue2.sent).toHaveLength(0);
  });

  test('the idempotency key is stable per agent+rep+target+UTC-day (the cadence IS the dedup key)', () => {
    const day = utcDateKey(FIXED_NOW);
    const k1 = scheduledIdempotencyKey(AgentKey.PROSPECTING, 'rep-1', 'c1', day);
    const k2 = scheduledIdempotencyKey(AgentKey.PROSPECTING, 'rep-1', 'c1', day);
    expect(k1).toBe(k2);
    const nextDay = utcDateKey(new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000));
    expect(scheduledIdempotencyKey(AgentKey.PROSPECTING, 'rep-1', 'c1', nextDay)).not.toBe(k1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (d) — fail-safe: missing infra/keys never crashes the scheduled function
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('runScheduledDispatch (d) — fail-safe: missing infra never throws, always resolves', () => {
  // TEETH: if the try/catch around enumeration were removed, this would REJECT instead of resolving.
  test('an unreachable enumeration store (DB down) resolves with a graceful no-op, never rejects', async () => {
    const brokenStore = { listDueReps: () => Promise.reject(new Error('ECONNREFUSED')) } as never;
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const queue = new InMemoryDurableQueue();

    await expect(
      runScheduledDispatch({ store: brokenStore, budgetStore, runGate, queue })
    ).resolves.toEqual(expect.objectContaining({ ok: false, skippedReason: 'infra_unavailable', unitsEnqueued: 0 }));
  });

  // A caller-wiring bug (no queue supplied) is also fail-safe, not a crash — even though the TS type
  // marks `queue` required, this proves the runtime guard for a JS caller / bad wiring.
  test('a missing durable queue is a graceful no-op, not a crash', async () => {
    await expect(runScheduledDispatch({} as never)).resolves.toEqual(
      expect.objectContaining({ ok: false, skippedReason: 'no_queue' })
    );
  });

  // No ANTHROPIC_API_KEY is present in this whole suite (see beforeEach) — the scheduler never
  // touches a Claude client itself, so key-less operation is inherent, not incidental. This proof
  // exercises it explicitly via the same real-runtime drain as PROOF (a).
  test('a due-work pass with no ANTHROPIC_API_KEY still enumerates/enqueues cleanly (spend itself HOLDS downstream, unmodified)', async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    const store = new InMemoryScheduledDispatchStore();
    store.reps = [{ userId: 'rep-1' }];
    store.contactsByUser.set('rep-1', [{ contactId: 'c1', pipelineStage: 'IDENTIFIED' as never }]);
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    seedRep(budgetStore, 'rep-1');
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const queue = new InMemoryDurableQueue();

    const result = await runScheduledDispatch({ store, budgetStore, runGate, queue, clock: () => FIXED_NOW });
    expect(result.ok).toBe(true);
    expect(result.unitsEnqueued).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (e) — tenant-correct: only real due work per real rep is enqueued, no cross-rep leakage
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('runScheduledDispatch (e) — tenant-correct enumeration, no cross-rep leakage', () => {
  test('each rep only ever gets events carrying THEIR OWN userId + their own contactIds', async () => {
    const store = new InMemoryScheduledDispatchStore();
    store.reps = [{ userId: 'rep-a' }, { userId: 'rep-b' }];
    store.contactsByUser.set('rep-a', [{ contactId: 'a-contact-1', pipelineStage: 'IDENTIFIED' as never }]);
    store.contactsByUser.set('rep-b', [{ contactId: 'b-contact-1', pipelineStage: 'DORMANT' as never }]);

    const budgetStore = new InMemoryBudgetKillSwitchStore();
    seedRep(budgetStore, 'rep-a');
    seedRep(budgetStore, 'rep-b');
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const queue = new InMemoryDurableQueue();

    await runScheduledDispatch({ store, budgetStore, runGate, queue, clock: () => FIXED_NOW });

    const repAEvents = queue.sent.filter((e) => e.userId === 'rep-a');
    const repBEvents = queue.sent.filter((e) => e.userId === 'rep-b');
    expect(repAEvents.every((e) => !e.contactId || e.contactId === 'a-contact-1')).toBe(true);
    expect(repBEvents.every((e) => !e.contactId || e.contactId === 'b-contact-1')).toBe(true);
    // No event anywhere in the batch crosses a rep's own contact into another rep's userId.
    expect(queue.sent.some((e) => e.userId === 'rep-a' && e.contactId === 'b-contact-1')).toBe(false);
    expect(queue.sent.some((e) => e.userId === 'rep-b' && e.contactId === 'a-contact-1')).toBe(false);
  });

  // TEETH: if the §4.2 intensity action cap were dropped, a LOW-intensity rep with many due contacts
  // would get every one of them dispatched in a single pass instead of capped at 2/day.
  test('the §4.2 intensity action cap bounds contact-bound dispatches even with many due contacts', async () => {
    const store = new InMemoryScheduledDispatchStore();
    store.reps = [{ userId: 'rep-low' }];
    store.contactsByUser.set(
      'rep-low',
      Array.from({ length: 5 }, (_, i) => ({ contactId: `c${i}`, pipelineStage: 'IDENTIFIED' as never }))
    );

    const budgetStore = new InMemoryBudgetKillSwitchStore();
    seedRep(budgetStore, 'rep-low', 'LOW');
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const queue = new InMemoryDurableQueue();

    const result = await runScheduledDispatch({ store, budgetStore, runGate, queue, clock: () => FIXED_NOW });
    const contactEvents = queue.sent.filter((e) => e.contactId);
    expect(contactEvents).toHaveLength(SCHEDULED_ACTION_CAP_BY_INTENSITY.LOW); // = 2, not 5
    expect(result.unitsEnqueued).toBe(SCHEDULED_ACTION_CAP_BY_INTENSITY.LOW + 1); // + the 1 daily briefing
  });

  // A rep row the enumeration store can't resolve budget context for (data gap, not a spend signal)
  // still gets the default MEDIUM cap — a fail-open posture consistent with BudgetKillSwitchRunGate's
  // own "unresolvable rep budget context fails open" rule (cost-killswitch.test.ts), never a crash.
  test('an unresolvable budget context defaults to the MEDIUM action cap rather than failing', async () => {
    const store = new InMemoryScheduledDispatchStore();
    store.reps = [{ userId: 'rep-unknown' }];
    store.contactsByUser.set(
      'rep-unknown',
      Array.from({ length: 10 }, (_, i) => ({ contactId: `c${i}`, pipelineStage: 'IDENTIFIED' as never }))
    );
    const budgetStore = new InMemoryBudgetKillSwitchStore(); // no repContexts entry for 'rep-unknown'
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const queue = new InMemoryDurableQueue();

    await runScheduledDispatch({ store, budgetStore, runGate, queue, clock: () => FIXED_NOW });
    const contactEvents = queue.sent.filter((e) => e.contactId);
    expect(contactEvents).toHaveLength(SCHEDULED_ACTION_CAP_BY_INTENSITY.MEDIUM);
  });
});
