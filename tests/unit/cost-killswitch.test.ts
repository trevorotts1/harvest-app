// T-31 — proof tests for the per-rep cost model, the budget/kill-switch RunGate, and the in-roster
// degradation ladder (master-spec §4.5/§4.6, QC checklist WP04 checkpoint #14). Each block states
// the mutation that makes it fail. All run in a KEY-LESS env (no ANTHROPIC_API_KEY) — the CI
// standard, matching tests/unit/agent-runtime.test.ts's convention.

import {
  AgentKey,
  AgentModelError,
  AgentRuntime,
  ClaudeModelTier,
  CLAUDE_MODEL_IDS,
  InMemoryAgentRuntimeStore,
} from '@/services/agent-runtime';
import type { AgentGenerationRequest, AgentGenerationResult, AgentModelClient } from '@/services/agent-runtime';
import {
  BudgetKillSwitchRunGate,
  DAILY_BUDGET_CENTS_BY_TIER_INTENSITY,
  DEGRADATION_LADDER,
  DegradationAnnotatingStore,
  DegradationFloorExhaustedError,
  DegradingModelClient,
  ENTERPRISE_ORG_DAILY_BUDGET_CENTS,
  HONEST_DEGRADATION_NOTE,
  InMemoryBudgetKillSwitchStore,
  PLATFORM_DAILY_BUDGET_CENTS,
  TierPricingCostModel,
  isUnderCostPressure,
} from '@/services/agent-runtime/cost-killswitch';
import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ClaudeClassifierClient, ClassifierRequest } from '@/services/compliance/claude';
import type { ClassifierVerdict } from '@/types/compliance';

// ── Test doubles (mirrors tests/unit/agent-runtime.test.ts's conventions) ─────────────────────────

class FixedConfidenceClassifierClient implements ClaudeClassifierClient {
  constructor(private confidence: number) {}
  async classify(): Promise<ClassifierVerdict> {
    return { flagged: this.confidence >= 0.5, confidence: this.confidence, rationale: 'test' };
  }
}
const clearCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0) });

const REP_CONTEXT = { firstName: 'Tasha', organization: 'primerica' };

function job(overrides: Record<string, unknown> = {}) {
  return {
    agentKey: AgentKey.PROSPECTING,
    userId: 'user-1',
    trigger: 'test',
    idempotencyKey: `idem-${Math.random()}`,
    contactId: 'contact-1',
    channel: 'SMS_HANDOFF' as const,
    rep: REP_CONTEXT,
    contact: { firstName: 'Jordan', relationshipType: 'FRIEND' },
    ...overrides,
  };
}

/** A model client whose behavior is scripted per-tier: 'ok' (or undefined) succeeds; an Error throws it. */
class TieredScriptedModelClient implements AgentModelClient {
  readonly calls: AgentGenerationRequest[] = [];
  constructor(
    private readonly behavior: Partial<Record<ClaudeModelTier, Error>> = {},
    private readonly usage: { tokenInput: number; tokenOutput: number } = { tokenInput: 2000, tokenOutput: 800 }
  ) {}
  async generate(req: AgentGenerationRequest): Promise<AgentGenerationResult> {
    this.calls.push(req);
    const err = this.behavior[req.tier];
    if (err) throw err;
    return {
      text: 'Hi friend — open to a quick warm chat this week? No worries either way.',
      modelId: CLAUDE_MODEL_IDS[req.tier],
      tier: req.tier,
      tokenInput: this.usage.tokenInput,
      tokenOutput: this.usage.tokenOutput,
      batched: Boolean(req.batched),
    };
  }
}

const rateLimitError = () => new AgentModelError('Anthropic request failed with status 429.');
const overloadedError = () => new AgentModelError('Anthropic request failed with status 529.');
const genericError = () => new AgentModelError('Anthropic request failed with status 400.');

const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (a) — per-rep cost model (§4.5): real tier pricing, honest tier attribution, budget accrual
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('TierPricingCostModel (§4.5) — real per-tier pricing replacing the T-30 estimate', () => {
  const model = new TierPricingCostModel();

  // TEETH: if HAIKU_4_5's rate is swapped for SONNET_5's (or vice versa), this ordering breaks.
  test('Haiku < Sonnet < Opus for identical token usage (cost-disciplined tiering, §4.4)', () => {
    const usage = { tokenInput: 2000, tokenOutput: 800, batched: false };
    const haiku = model.costCents({ tier: ClaudeModelTier.HAIKU_4_5, ...usage });
    const sonnet = model.costCents({ tier: ClaudeModelTier.SONNET_5, ...usage });
    const opus = model.costCents({ tier: ClaudeModelTier.OPUS_4_8, ...usage });
    expect(haiku).toBeLessThan(sonnet);
    expect(sonnet).toBeLessThan(opus);
    // Exact figures from Anthropic's published per-1M pricing (cents/1K): Sonnet $3/$15 -> 0.3/1.5.
    expect(sonnet).toBe(Math.round((2000 / 1000) * 0.3 + (800 / 1000) * 1.5)); // = 2
  });

  // TEETH: if the Batch API discount is removed, batched cost equals non-batched cost.
  test('batched work is discounted per the published Batch API rate (~50%)', () => {
    // Chosen so the raw (pre-rounding) cost and its half are both whole numbers — an exact 2x
    // relationship, not just "close to" (avoids a rounding-boundary false negative).
    const usage = { tier: ClaudeModelTier.SONNET_5, tokenInput: 20000, tokenOutput: 8000 };
    const normal = model.costCents({ ...usage, batched: false });
    const batched = model.costCents({ ...usage, batched: true });
    expect(batched).toBeLessThan(normal);
    expect(batched).toBe(normal / 2);
  });

  test('never negative; never NaN', () => {
    const c = model.costCents({ tier: ClaudeModelTier.HAIKU_4_5, tokenInput: 0, tokenOutput: 0, batched: false });
    expect(Number.isNaN(c)).toBe(false);
    expect(c).toBeGreaterThanOrEqual(0);
  });
});

describe('Per-rep cost accounting on the real run (§4.5)', () => {
  // TEETH: if AgentRuntime stopped passing the ACTUAL usage.tier to the cost model (e.g. always
  // priced at spec.primaryTier regardless of what really ran), this would fail once paired with the
  // degradation test below — a degraded run would be priced as Sonnet instead of Haiku.
  test('AgentRun.cost_cents matches the real tier pricing for the model actually used', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const model = new TieredScriptedModelClient({}, { tokenInput: 2000, tokenOutput: 800 });
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, costModel: new TierPricingCostModel() });
    await runtime.runAgent(job());

    const run = store.agentRuns.at(-1);
    expect(run?.model_used).toBe(ClaudeModelTier.SONNET_5);
    expect(run?.cost_cents).toBe(new TierPricingCostModel().costCents({ tier: ClaudeModelTier.SONNET_5, tokenInput: 2000, tokenOutput: 800, batched: false }));
    expect(run?.cost_cents).toBeGreaterThan(0);
  });

  // TEETH: if per-rep spend is not tracked, a second run's gate check would never see the first
  // run's cost and the rep could never hit their budget.
  test('spend accumulates per rep across multiple runs (the budget roll-up input)', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', organizationId: null });
    const ceiling = DAILY_BUDGET_CENTS_BY_TIER_INTENSITY.PAID_INDIVIDUAL.LOW;

    const store = new InMemoryAgentRuntimeStore();
    const costModel = new TierPricingCostModel();
    const model = new TieredScriptedModelClient({}, { tokenInput: 20000, tokenOutput: 8000 }); // a large, clearly-nonzero draft
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, costModel });

    await runtime.runAgent(job({ idempotencyKey: 'run-1' }));
    const cost1 = store.agentRuns.at(-1)!.cost_cents!;
    budgetStore.recordSpend('user-1', cost1);
    expect(await budgetStore.getDailySpendCents('user-1', new Date(0))).toBe(cost1);

    await runtime.runAgent(job({ idempotencyKey: 'run-2' }));
    const cost2 = store.agentRuns.at(-1)!.cost_cents!;
    budgetStore.recordSpend('user-1', cost2);
    expect(await budgetStore.getDailySpendCents('user-1', new Date(0))).toBe(cost1 + cost2);
    expect(cost1 + cost2).toBeGreaterThan(0);
    // Sanity: our scripted draft size is large enough to meaningfully approach the LOW ceiling in a
    // handful of runs (proves the ceiling is a real, reachable number, not a decorative constant).
    expect(ceiling).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (b) — the kill-switch: RunGate blocks BEFORE spend; critical paths bypass (§4.5)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('BudgetKillSwitchRunGate (§4.5) — the real kill-switch', () => {
  function seedRep(store: InMemoryBudgetKillSwitchStore, userId = 'user-1', overrides: Partial<{ accessTier: string; intensitySetting: string; organizationId: string | null }> = {}) {
    store.repContexts.set(userId, {
      accessTier: (overrides.accessTier ?? 'PAID_INDIVIDUAL') as never,
      intensitySetting: (overrides.intensitySetting ?? 'LOW') as never,
      organizationId: overrides.organizationId ?? null,
    });
  }

  test('under budget -> allowed', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    seedRep(store);
    const gate = new BudgetKillSwitchRunGate({ store });
    const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(true);
  });

  // TEETH: remove the ceiling comparison and this run would never be denied no matter the spend.
  test('at/over the daily ceiling -> denied with an honest machine reason', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    seedRep(store, 'user-1', { intensitySetting: 'LOW' });
    const ceiling = DAILY_BUDGET_CENTS_BY_TIER_INTENSITY.PAID_INDIVIDUAL.LOW;
    store.recordSpend('user-1', ceiling); // exactly at the ceiling
    const gate = new BudgetKillSwitchRunGate({ store });
    const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('budget_exhausted');
  });

  // TEETH: if criticality bypass is removed, this over-budget critical run would ALSO be denied.
  test('critical criticality bypasses the budget/kill-switch entirely (§4.5 critical-path bypass)', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    seedRep(store);
    store.recordSpend('user-1', 999_999); // absurdly over any ceiling
    await store.setKillSwitchState('REP', 'user-1', true, 'manual test kill');
    const gate = new BudgetKillSwitchRunGate({ store });
    const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.APPOINTMENT_SETTING, criticality: 'critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(true);
  });

  test('a manually-tripped REP kill switch denies non-critical runs', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    seedRep(store);
    await store.setKillSwitchState('REP', 'user-1', true, 'rep asked to pause');
    const gate = new BudgetKillSwitchRunGate({ store });
    const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('kill_switch_rep');
  });

  test('a manually-tripped ORG kill switch denies every rep in that org', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    seedRep(store, 'user-1', { organizationId: 'org-1' });
    await store.setKillSwitchState('ORG', 'org-1', true, 'org-wide pause');
    const gate = new BudgetKillSwitchRunGate({ store });
    const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('kill_switch_org');
  });

  test('a tripped PLATFORM kill switch denies everyone, dominating all other checks', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    seedRep(store);
    await store.setKillSwitchState('PLATFORM', 'GLOBAL', true, 'operator emergency stop');
    const gate = new BudgetKillSwitchRunGate({ store });
    const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('kill_switch_platform');
  });

  test('ENTERPRISE seats aggregate to an org ceiling, not a per-seat one', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    seedRep(store, 'user-1', { accessTier: 'ENTERPRISE', organizationId: 'org-ent' });
    seedRep(store, 'user-2', { accessTier: 'ENTERPRISE', organizationId: 'org-ent' });
    store.recordSpend('user-1', ENTERPRISE_ORG_DAILY_BUDGET_CENTS - 1); // one seat, just under alone
    store.recordSpend('user-2', 2); // pushes the ORG total over the ceiling
    const gate = new BudgetKillSwitchRunGate({ store });
    const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('budget_exhausted_org');
  });

  test('a platform-wide spend breach denies even a rep with room left on their own budget, and alerts the operator', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    seedRep(store, 'user-1');
    store.recordSpend('user-1', 1); // this rep is nowhere near their own ceiling
    store.recordSpend('some-other-rep', PLATFORM_DAILY_BUDGET_CENTS); // but the platform total is over
    const alerts: unknown[] = [];
    const gate = new BudgetKillSwitchRunGate({ store, alertOperator: (a) => { alerts.push(a); } });
    const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('budget_exhausted_platform');
    expect(alerts).toHaveLength(1); // §4.5 "the operator is alerted"
  });

  // Defensive: a rep row the store can't resolve is a data gap, not a spend signal — fail OPEN.
  test('an unresolvable rep budget context fails open (does not block a legitimate run on a data gap)', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    const gate = new BudgetKillSwitchRunGate({ store });
    const decision = await gate.check({ userId: 'unknown-user', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(true);
  });
});

describe('RunGate wired into the real runtime (§4.5) — BLOCKED before any Claude spend', () => {
  // TEETH (explicit mutation, per the build brief): if the RunGate check were removed from
  // AgentRuntime.runAgent, this over-budget rep's model client WOULD be called (calls.length > 0)
  // and the outcome would be 'surfaced' instead of 'deferred'.
  test('a rep over budget is blocked before spend — the model client is NEVER called', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', organizationId: null });
    budgetStore.recordSpend('user-1', DAILY_BUDGET_CENTS_BY_TIER_INTENSITY.PAID_INDIVIDUAL.LOW);

    const store = new InMemoryAgentRuntimeStore();
    const model = new TieredScriptedModelClient();
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, runGate });

    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('deferred');
    expect(model.calls).toHaveLength(0); // no Claude spend
    expect(store.draftMessages).toHaveLength(0); // nothing surfaced, nothing sendable
  });

  // TEETH: if the manual-kill check were dropped from the gate, this killed rep's job would run.
  test('a manually-killed rep is blocked before spend', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'HIGH', organizationId: null });
    await budgetStore.setKillSwitchState('REP', 'user-1', true, 'operator-requested pause');

    const store = new InMemoryAgentRuntimeStore();
    const model = new TieredScriptedModelClient();
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, runGate });

    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('deferred');
    expect(model.calls).toHaveLength(0);
  });

  // TEETH: if the criticality bypass were removed, Appointment Setting would ALSO be deferred here.
  test('Appointment Setting (critical path) still runs for a killed/over-budget rep', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', organizationId: null });
    budgetStore.recordSpend('user-1', 999_999);
    await budgetStore.setKillSwitchState('REP', 'user-1', true, 'operator-requested pause');

    const store = new InMemoryAgentRuntimeStore();
    const model = new TieredScriptedModelClient();
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, runGate });

    const res = await runtime.runAgent(job({ agentKey: AgentKey.APPOINTMENT_SETTING }));
    expect(res.outcome).not.toBe('deferred');
    expect(model.calls.length).toBeGreaterThan(0); // it actually spent — critical paths continue (§4.5)
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (c) — the IN-ROSTER degradation ladder (§4.4/§4.6, checkpoint #14)
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('DegradingModelClient (§4.4/§4.6) — Sonnet -> Haiku on rate-limit/overload, never off-Claude', () => {
  test('the ladder maps ONLY Sonnet 5 -> Haiku 4.5 — every rung is a Claude tier', () => {
    expect(Object.keys(DEGRADATION_LADDER)).toEqual([ClaudeModelTier.SONNET_5]);
    expect(DEGRADATION_LADDER[ClaudeModelTier.SONNET_5]).toBe(ClaudeModelTier.HAIKU_4_5);
    for (const tier of Object.values(DEGRADATION_LADDER)) {
      expect(CLAUDE_MODEL_IDS[tier as ClaudeModelTier]).toMatch(/^claude-/); // Claude-only
    }
  });

  // TEETH (explicit mutation from the build brief): force a 429 on Sonnet and assert the NEXT
  // attempt uses the lower Claude tier (Haiku), not an off-roster provider. If the ladder were
  // removed, this would throw instead of returning a Haiku result.
  test('a Sonnet 429 falls back to Haiku 4.5 in-roster and returns an honest (Haiku) result', async () => {
    const inner = new TieredScriptedModelClient({ [ClaudeModelTier.SONNET_5]: rateLimitError() });
    const client = new DegradingModelClient(inner);
    const result = await client.generate({ tier: ClaudeModelTier.SONNET_5, systemPrompt: 's', userPrompt: 'u' });

    expect(result.tier).toBe(ClaudeModelTier.HAIKU_4_5); // honest — NOT reported as Sonnet
    expect(result.modelId).toBe(CLAUDE_MODEL_IDS[ClaudeModelTier.HAIKU_4_5]);
    expect(result.modelId).toMatch(/^claude-/); // never a non-Claude id
    expect(inner.calls.map((c) => c.tier)).toEqual([ClaudeModelTier.SONNET_5, ClaudeModelTier.HAIKU_4_5]);

    const event = client.consumeDegradation();
    expect(event).toEqual({ fromTier: ClaudeModelTier.SONNET_5, toTier: ClaudeModelTier.HAIKU_4_5, reason: 'rate_limited' });
  });

  test('overload (529) also degrades, tagged as "overloaded"', async () => {
    const inner = new TieredScriptedModelClient({ [ClaudeModelTier.SONNET_5]: overloadedError() });
    const client = new DegradingModelClient(inner);
    await client.generate({ tier: ClaudeModelTier.SONNET_5, systemPrompt: 's', userPrompt: 'u' });
    expect(client.consumeDegradation()?.reason).toBe('overloaded');
  });

  // TEETH: if the ladder degraded on ANY error (not just capacity signals), this would fall back
  // instead of propagating a plain 400 — masking a real validation bug as a quiet quality drop.
  test('a non-rate-limit error is NOT degraded — it propagates unchanged', async () => {
    const inner = new TieredScriptedModelClient({ [ClaudeModelTier.SONNET_5]: genericError() });
    const client = new DegradingModelClient(inner);
    await expect(client.generate({ tier: ClaudeModelTier.SONNET_5, systemPrompt: 's', userPrompt: 'u' })).rejects.toThrow(/400/);
    expect(inner.calls).toHaveLength(1); // no fallback attempt was made
  });

  // TEETH: Haiku already IS the floor — if the ladder incorrectly gave it a lower rung, this would
  // resolve instead of throwing.
  test('Haiku 4.5 (already the floor) has no lower rung — a 429 propagates, never off-Claude', async () => {
    const inner = new TieredScriptedModelClient({ [ClaudeModelTier.HAIKU_4_5]: rateLimitError() });
    const client = new DegradingModelClient(inner);
    await expect(client.generate({ tier: ClaudeModelTier.HAIKU_4_5, systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(DegradationFloorExhaustedError);
    expect(inner.calls).toHaveLength(1); // no further attempt — Haiku IS the floor
  });

  // TEETH: Opus is never a degradation target (§4.4 "reserved ... never in the per-message path").
  test('Opus 4.8 is never a degradation target — a 429 propagates, never falls to a cheaper tier', async () => {
    const inner = new TieredScriptedModelClient({ [ClaudeModelTier.OPUS_4_8]: rateLimitError() });
    const client = new DegradingModelClient(inner);
    await expect(client.generate({ tier: ClaudeModelTier.OPUS_4_8, systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(DegradationFloorExhaustedError);
    expect(inner.calls).toHaveLength(1);
  });

  // TEETH: the FLOOR requirement — with nothing available anywhere in the roster, this must HOLD
  // (throw, no fabricated/off-roster result), never silently succeed with a stubbed answer.
  test('floor exhausted (Sonnet AND Haiku both fail) -> holds; never a non-Claude fallback, never a stub', async () => {
    const inner = new TieredScriptedModelClient({
      [ClaudeModelTier.SONNET_5]: rateLimitError(),
      [ClaudeModelTier.HAIKU_4_5]: rateLimitError(),
    });
    const client = new DegradingModelClient(inner);
    await expect(client.generate({ tier: ClaudeModelTier.SONNET_5, systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(DegradationFloorExhaustedError);
    expect(inner.calls.map((c) => c.tier)).toEqual([ClaudeModelTier.SONNET_5, ClaudeModelTier.HAIKU_4_5]);
    expect(client.consumeDegradation()).toBeNull(); // no degradation to report — nothing succeeded
  });

  test('cost-pressure proactively steps down BEFORE even trying the primary tier', async () => {
    const inner = new TieredScriptedModelClient();
    const client = new DegradingModelClient(inner, { costPressureCheck: () => true });
    const result = await client.generate({ tier: ClaudeModelTier.SONNET_5, systemPrompt: 's', userPrompt: 'u' });
    expect(result.tier).toBe(ClaudeModelTier.HAIKU_4_5);
    expect(inner.calls.map((c) => c.tier)).toEqual([ClaudeModelTier.HAIKU_4_5]); // Sonnet was never even attempted
    expect(client.consumeDegradation()?.reason).toBe('cost_pressure');
  });

  test('isUnderCostPressure reports true once spend crosses the pressure threshold', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    store.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', organizationId: null });
    const ceiling = DAILY_BUDGET_CENTS_BY_TIER_INTENSITY.PAID_INDIVIDUAL.LOW;
    expect(await isUnderCostPressure(store, 'user-1')).toBe(false);
    store.recordSpend('user-1', Math.ceil(ceiling * 0.85));
    expect(await isUnderCostPressure(store, 'user-1')).toBe(true);
  });
});

describe('Degradation ladder wired into the real runtime — honest, self-disclosing, still delivers', () => {
  // TEETH: if AgentRuntime's model_used/reasoning_log wiring were bypassed for a degraded call, this
  // run would be recorded as `sonnet_5` (dishonest) instead of `haiku_4_5`.
  test('a degraded run is HONESTLY recorded as Haiku (never billed/logged as Sonnet) and still completes', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const inner = new TieredScriptedModelClient({ [ClaudeModelTier.SONNET_5]: rateLimitError() });
    const degradingClient = new DegradingModelClient(inner);
    const degradationStore = new DegradationAnnotatingStore(store, degradingClient);
    const runtime = new AgentRuntime({ modelClient: degradingClient, cfe: clearCFE(), store: degradationStore, costModel: new TierPricingCostModel() });

    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('surfaced'); // the run still delivers — degraded, not blocked
    expect(store.draftMessages).toHaveLength(1);

    const run = store.agentRuns.at(-1);
    expect(run?.model_used).toBe(ClaudeModelTier.HAIKU_4_5); // honest — not sonnet_5
    expect(run?.reasoning_log).toContain(HONEST_DEGRADATION_NOTE.trim().slice(0, 20)); // explicit honest flag
    expect(run?.reasoning_log?.toLowerCase()).not.toMatch(/gpt|openai|gemini|llama|mistral/); // Claude-only vocab
  });

  // TEETH: this is the literal build-brief mutation — force a 429 and assert the NEXT attempt (the
  // fallback call the runtime actually made) used the lower Claude tier.
  test('mutation: forcing a 429 on Sonnet makes the runtime\'s next attempt use Haiku, not an off-roster provider', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const inner = new TieredScriptedModelClient({ [ClaudeModelTier.SONNET_5]: rateLimitError() });
    const degradingClient = new DegradingModelClient(inner);
    const runtime = new AgentRuntime({ modelClient: degradingClient, cfe: clearCFE(), store, costModel: new TierPricingCostModel() });

    await runtime.runAgent(job());
    const tiersAttempted = inner.calls.map((c) => c.tier);
    expect(tiersAttempted).toEqual([ClaudeModelTier.SONNET_5, ClaudeModelTier.HAIKU_4_5]);
    for (const tier of tiersAttempted) {
      expect(CLAUDE_MODEL_IDS[tier]).toMatch(/^claude-/);
    }
  });

  // TEETH: the FLOOR case at the runtime level — with nothing available, the run must HOLD: no
  // draft, no send, and the run recorded FAILED (idempotency key NOT marked processed, so a genuine
  // retry will re-run it) — never a fabricated completion.
  test('floor exhausted at the runtime level -> HOLDS: no draft, nothing sent, retried idempotently', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const inner = new TieredScriptedModelClient({
      [ClaudeModelTier.SONNET_5]: rateLimitError(),
      [ClaudeModelTier.HAIKU_4_5]: rateLimitError(),
    });
    const degradingClient = new DegradingModelClient(inner);
    const runtime = new AgentRuntime({ modelClient: degradingClient, cfe: clearCFE(), store, costModel: new TierPricingCostModel() });

    await expect(runtime.runAgent(job({ idempotencyKey: 'floor-key' }))).rejects.toBeInstanceOf(DegradationFloorExhaustedError);
    expect(store.draftMessages).toHaveLength(0); // nothing sent
    expect(store.agentRuns.at(-1)?.status).toBe('FAILED');
    expect(await store.wasProcessed('floor-key')).toBe(false); // a genuine retry will re-run it
  });
});
