// T-31 — proof tests for the per-rep cost model, the budget/kill-switch RunGate, and the in-roster
// degradation ladder (master-spec §4.5/§4.6, QC checklist WP04 checkpoint #14). Each block states
// the mutation that makes it fail. All run in a KEY-LESS env (no ANTHROPIC_API_KEY) — the CI
// standard, matching tests/unit/agent-runtime.test.ts's convention.

import {
  AgentKey,
  AgentModelError,
  AgentRuntime,
  AnthropicRuntimeClient,
  ClaudeModelTier,
  CLAUDE_MODEL_IDS,
  HARD_MAX_OUTPUT_TOKENS_PER_RUN,
  InMemoryAgentRuntimeStore,
  RESERVATION_SAFE_MAX_INPUT_TOKENS,
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
  dailyBudgetCentsFor,
  isUnderCostPressure,
  reservationEstimateCentsFor,
} from '@/services/agent-runtime/cost-killswitch';
import type { CreateAgentRunInput, UpdateAgentRunInput } from '@/services/agent-runtime';
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
const blockedCFE = () => new ComplianceFilterEngine({ classifierClient: new FixedConfidenceClassifierClient(0.99) });

/** Wraps InMemoryAgentRuntimeStore so a run's completed cost_cents is recorded onto the paired
 *  budget ledger the moment the run finishes — mirroring the live relationship the real Prisma
 *  stores have via `AgentRun.cost_cents` (§4.5: "every AgentRun records... giving a live per-rep
 *  roll-up"), but in-memory so a load/concurrency drill needs no DB. */
class SpendRecordingStore extends InMemoryAgentRuntimeStore {
  private readonly userByRunId = new Map<string, string>();
  constructor(private readonly budgetStore: InMemoryBudgetKillSwitchStore) {
    super();
  }
  async createAgentRun(input: CreateAgentRunInput): Promise<string> {
    const id = await super.createAgentRun(input);
    this.userByRunId.set(id, input.user_id);
    return id;
  }
  async updateAgentRun(id: string, patch: UpdateAgentRunInput): Promise<void> {
    await super.updateAgentRun(id, patch);
    if (typeof patch.cost_cents === 'number') {
      const userId = this.userByRunId.get(id);
      if (userId) this.budgetStore.recordSpend(userId, patch.cost_cents);
    }
  }
}

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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// T-56 VERIFICATION DRILL — additive load/concurrency/adversarial proofs for §4.5/§4.6. Everything
// below strengthens the T-31 proof suite above under many-run/concurrent/mis-configured conditions
// it did not originally exercise. One real, non-trivial architectural gap is documented (not
// papered over) at the bottom, left as a deliberately failing, clearly-labeled test.
// ══════════════════════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (d) — per-rep budget accuracy under load (drill requirement #1): many sequential AND
// concurrent runs, plus per-rep isolation under concurrent load (drill requirement #4).
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('Per-rep budget accuracy under load (§4.5) — sequential + concurrent runs', () => {
  // TEETH: if any run's cost silently failed to attribute, the ledger total would be LESS than the
  // sum of the individually-recorded per-run costs.
  test('20 SEQUENTIAL runs for one rep: the ledger total is exactly the sum of every individual run cost', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'HIGH', organizationId: null });
    const store = new SpendRecordingStore(budgetStore);
    const model = new TieredScriptedModelClient({}, { tokenInput: 2000, tokenOutput: 800 }); // 2 cents/run at Sonnet (exact, non-zero)
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, costModel: new TierPricingCostModel() });

    let expectedTotal = 0;
    for (let i = 0; i < 20; i++) {
      await runtime.runAgent(job({ idempotencyKey: `seq-${i}` }));
      expectedTotal += store.agentRuns.at(-1)!.cost_cents!;
    }
    expect(await budgetStore.getDailySpendCents('user-1', new Date(0))).toBe(expectedTotal);
    expect(expectedTotal).toBeGreaterThan(0);
  });

  // TEETH: if concurrent writes clobbered/duplicated a run's cost, the ledger total would NOT equal
  // (per-run cost) x N — either lower (lost writes) or higher (double-counted).
  test('20 CONCURRENT runs for one rep: every run is attributed exactly once (no lost/duplicated spend)', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'ENTERPRISE', intensitySetting: 'HIGH', organizationId: null }); // no per-rep ceiling in play — accounting accuracy only
    const store = new SpendRecordingStore(budgetStore);
    const model = new TieredScriptedModelClient({}, { tokenInput: 2000, tokenOutput: 800 }); // 2 cents/run at Sonnet (exact, non-zero)
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, costModel: new TierPricingCostModel() });

    const N = 20;
    await Promise.all(Array.from({ length: N }, (_, i) => runtime.runAgent(job({ idempotencyKey: `conc-${i}` }))));

    expect(store.agentRuns).toHaveLength(N);
    const perRunCost = store.agentRuns[0].cost_cents!;
    expect(perRunCost).toBeGreaterThan(0);
    expect(await budgetStore.getDailySpendCents('user-1', new Date(0))).toBe(perRunCost * N);
  });

  // TEETH: if per-rep isolation broke (e.g. spend keyed by a constant instead of userId, or a
  // kill-switch check used the wrong scopeId), rep B's concurrent runs would be wrongly blocked by
  // rep A's trip, or rep A's trip would fail to hold while running concurrently with rep B.
  test('per-rep isolation holds under concurrent load: rep A tripped + rep B clear, running concurrently', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('rep-a', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', organizationId: null });
    // T-R27 FIX: rep B is on HIGH (ceiling 600), not LOW (150) — this test is about per-rep
    // ISOLATION, not ceiling capacity, so it needs enough headroom for all N runs to fit under the
    // now-TRUE-worst-case reservation (~19c/run at Sonnet; N=10 needs ~190, which LOW's 150 no longer
    // comfortably admits now that the reservation isn't a "generous average" that under-reserves).
    budgetStore.repContexts.set('rep-b', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'HIGH', organizationId: null });
    await budgetStore.setKillSwitchState('REP', 'rep-a', true, 'rep A manually paused');

    const store = new SpendRecordingStore(budgetStore);
    const modelA = new TieredScriptedModelClient();
    const modelB = new TieredScriptedModelClient();
    const runtimeA = new AgentRuntime({ modelClient: modelA, cfe: clearCFE(), store, runGate: new BudgetKillSwitchRunGate({ store: budgetStore }) });
    const runtimeB = new AgentRuntime({ modelClient: modelB, cfe: clearCFE(), store, runGate: new BudgetKillSwitchRunGate({ store: budgetStore }) });

    const N = 10;
    const [resultsA, resultsB] = await Promise.all([
      Promise.all(Array.from({ length: N }, (_, i) => runtimeA.runAgent(job({ userId: 'rep-a', idempotencyKey: `a-${i}` })))),
      Promise.all(Array.from({ length: N }, (_, i) => runtimeB.runAgent(job({ userId: 'rep-b', idempotencyKey: `b-${i}` })))),
    ]);

    expect(resultsA.every((r) => r.outcome === 'deferred')).toBe(true);
    expect(modelA.calls).toHaveLength(0); // rep A: kill-switch held, zero spend, even under concurrent load
    expect(resultsB.every((r) => r.outcome === 'surfaced')).toBe(true);
    expect(modelB.calls).toHaveLength(N); // rep B: entirely unaffected by rep A's trip
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (e) — kill-switch fail-CLOSED hardening (drill requirement #2): a missing/mis-set threshold
// must halt, never allow unlimited spend; once tripped, it stays tripped for subsequent runs.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('Kill-switch fail-CLOSED hardening (§4.5) — a missing/mis-set threshold halts, never allows unlimited spend', () => {
  // REAL GAP FOUND BY THIS DRILL, FIXED HERE (trivial, one-line, in the existing fallback pattern):
  // `dailyBudgetCentsFor` already fell back to a safe table on an unrecognized accessTier (via `??`)
  // but had NO equivalent fallback on the intensitySetting dimension. `table[intensitySetting]` on
  // an unrecognized/corrupt value resolved to `undefined`, and `spend >= undefined` is ALWAYS false
  // in JS (any comparison with NaN is false) — so the budget check could NEVER trip: a mis-set
  // threshold silently became UNLIMITED spend (fail-open), the opposite of §4.5. Hardened to return
  // 0 (halt immediately) instead of `undefined` (never trip) when the ceiling can't be resolved.
  test('an unrecognized/corrupt intensitySetting yields a fail-CLOSED (0-cent) ceiling, not an unlimited one', () => {
    const ceiling = dailyBudgetCentsFor('PAID_INDIVIDUAL', 'BOGUS' as never);
    expect(ceiling).toBe(0);
    expect(Number.isFinite(ceiling)).toBe(true);
  });

  test('a rep with a corrupt intensitySetting is DENIED regardless of spend (halt, never unlimited)', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    store.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'BOGUS' as never, organizationId: null });
    // Deliberately well under PLATFORM_DAILY_BUDGET_CENTS so the (unrelated) platform circuit
    // breaker can't independently save this check — this test must fail/pass on the
    // intensitySetting-ceiling fallback ALONE, not be masked by a different gate tripping too.
    store.recordSpend('user-1', 10_000);
    expect(10_000).toBeLessThan(PLATFORM_DAILY_BUDGET_CENTS);
    const gate = new BudgetKillSwitchRunGate({ store });
    const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(false); // fail CLOSED
  });

  // Fail-closed even at literally zero recorded spend: "no known safe ceiling" must mean HALT, not
  // "assume the largest one" — a brand-new rep with a corrupt threshold must still halt.
  test('a rep with a corrupt intensitySetting is DENIED even at zero recorded spend', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    store.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'BOGUS' as never, organizationId: null });
    const gate = new BudgetKillSwitchRunGate({ store });
    const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('budget_exhausted');
  });

  // "Once tripped, subsequent runs are blocked — not silently allowed": a manual REP trip must deny
  // every check call for as long as it stays tripped, not just the first.
  test('once manually tripped, EVERY subsequent check call denies (not a one-shot deny)', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    store.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', organizationId: null });
    await store.setKillSwitchState('REP', 'user-1', true, 'operator pause');
    const gate = new BudgetKillSwitchRunGate({ store });
    for (let i = 0; i < 5; i++) {
      const decision = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('kill_switch_rep');
    }
  });

  // "Once tripped" via budget exhaustion (not a manual toggle) is equally sticky: the ledger never
  // decreases, so a second immediately-following check (no new spend recorded) must ALSO deny.
  test('once budget-exhausted, a SECOND immediately-following check call ALSO denies (sticky, not a fluke)', async () => {
    const store = new InMemoryBudgetKillSwitchStore();
    store.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', organizationId: null });
    store.recordSpend('user-1', DAILY_BUDGET_CENTS_BY_TIER_INTENSITY.PAID_INDIVIDUAL.LOW);
    const gate = new BudgetKillSwitchRunGate({ store });
    const first = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    const second = await gate.check({ userId: 'user-1', agentKey: AgentKey.PROSPECTING, criticality: 'non_critical', primaryTier: ClaudeModelTier.SONNET_5 });
    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
  });

  // A missing ANTHROPIC_API_KEY is a different flavor of "missing threshold" (no credential at
  // all): it must halt via AgentRuntime, never fall back to a non-Claude provider or a stub, even
  // when the budget/kill-switch gate itself would have allowed the run.
  test('missing Claude credential halts the run (fail-closed) even when the budget/kill-switch gate allows it', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const runtime = new AgentRuntime({ cfe: clearCFE(), store, costModel: new TierPricingCostModel() }); // real AnthropicRuntimeClient, no key
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('held');
    expect(store.draftMessages).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (f) — compliance is never traded away for cost (drill requirement #3): a degraded or
// critical-bypassed run is STILL CFE-gated; the cost lane can never suppress the compliance lane.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('Compliance is never traded away for cost (§2.3/§4.5/§4.6) — CFE still gates degraded/critical-bypass runs', () => {
  // TEETH: if DegradingModelClient or AgentRuntime ever short-circuited the CFE call for a
  // cost-pressure-degraded run, this blocked-content run would surface instead of holding.
  test('a cost-pressure-degraded (Sonnet->Haiku) run is STILL CFE-gated: a blocked verdict still HOLDS', async () => {
    const store = new InMemoryAgentRuntimeStore();
    const inner = new TieredScriptedModelClient(); // succeeds at any tier — no rate-limit involved
    const degradingClient = new DegradingModelClient(inner, { costPressureCheck: () => true });
    const runtime = new AgentRuntime({ modelClient: degradingClient, cfe: blockedCFE(), store, costModel: new TierPricingCostModel() });

    const res = await runtime.runAgent(job());
    expect(inner.calls.map((c) => c.tier)).toEqual([ClaudeModelTier.HAIKU_4_5]); // degraded proactively, in-roster
    expect(res.outcome).toBe('held'); // CFE still blocked — cost pressure never bypasses compliance
    // A blocked verdict still lands as a DraftMessage row (§9.2 — it carries its CFE band for the
    // record) but it is HELD, never sendable/approvable — that's the fail-closed contract.
    expect(store.draftMessages.at(-1)?.approval_state).toBe('HELD');
    expect(store.draftMessages.at(-1)?.cfe_outcome).toBe('BLOCK');
  });

  // TEETH: if the RunGate's critical-path bypass (§4.5) were mistakenly wired to also bypass the
  // CFE (instead of only the budget/kill-switch gate), this over-budget/killed critical run's
  // blocked content would surface instead of holding.
  test('the critical-path budget/kill-switch bypass does NOT bypass the CFE — a blocked Appointment Setting draft still HOLDS', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', organizationId: null });
    budgetStore.recordSpend('user-1', 999_999);
    await budgetStore.setKillSwitchState('REP', 'user-1', true, 'operator-requested pause');

    const store = new InMemoryAgentRuntimeStore();
    const model = new TieredScriptedModelClient();
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const runtime = new AgentRuntime({ modelClient: model, cfe: blockedCFE(), store, runGate });

    const res = await runtime.runAgent(job({ agentKey: AgentKey.APPOINTMENT_SETTING }));
    expect(model.calls.length).toBeGreaterThan(0); // RunGate let it spend (critical path, §4.5)
    expect(res.outcome).toBe('held'); // but the CFE still blocked it — never sendable
    expect(store.draftMessages.at(-1)?.approval_state).toBe('HELD'); // carries the BLOCK band, never approvable
    expect(store.draftMessages.at(-1)?.cfe_outcome).toBe('BLOCK');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PROOF (g) — UNDER LOAD (drill requirement #4): the kill-switch trips at the right point, degraded
// calls stay in-roster even under a heavy concurrent adversarial burst on ONE shared client, and —
// documented rather than papered over — the one real gap this drill found in the cost lane (T-56),
// CLOSED by T-R27's reservation primitive (run-gate.ts `tryReserve`/`releaseReservation`) below.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('UNDER LOAD (§4.5/§4.6, drill requirement #4)', () => {
  // T-R27 UPDATE: before the reservation fix, this test asserted the SAME overshoot pattern as the
  // (then-failing) KNOWN GAP test below — just with a smaller burst (6, not 10) and a looser bound
  // ("crosses the ceiling" rather than "never overshoots by more than one run's cost"). A burst of 6
  // x 18 cents against this 40-cent ceiling is EXACTLY the class of concurrent-burst overshoot §4.5
  // rules out ("no path spends past the cap"), so once the reservation primitive closes that gap for
  // real, this scenario's admitted spend is bounded too — it no longer "comfortably clears" the
  // ceiling; admission stops itself at 2 runs (2 x 18 = 36 <= the 40-cent ceiling, ZERO overshoot),
  // denying the other 4 WITHIN the burst itself (not merely after it settles). The still-valid part
  // of this test's original intent — "once at/near the ceiling, a run fired after settling is denied"
  // — is preserved below.
  test('a concurrent burst for ONE rep is admission-bounded by the reservation, not just denied after it settles (the trip point is honored)', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'FREE_ORG_LINKED', intensitySetting: 'LOW', organizationId: null });
    const ceiling = DAILY_BUDGET_CENTS_BY_TIER_INTENSITY.FREE_ORG_LINKED.LOW; // 40 cents
    const store = new SpendRecordingStore(budgetStore);
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const model = new TieredScriptedModelClient({}, { tokenInput: 20000, tokenOutput: 8000 }); // 18 cents/run at Sonnet (exact)
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, runGate, costModel: new TierPricingCostModel() });

    // A burst of 6 concurrent runs; unmitigated (T-56's gap) 6 x 18 = 108 cents would comfortably
    // clear the 40-cent ceiling. WITH the reservation fix, admission itself stays inside the cap.
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => runtime.runAgent(job({ idempotencyKey: `burst-${i}` }))));
    const totalAfterBurst = await budgetStore.getDailySpendCents('user-1', new Date(0));

    expect(totalAfterBurst).toBeLessThanOrEqual(ceiling); // NO overshoot at all — the fix is exact here
    expect(totalAfterBurst).toBeGreaterThan(0); // sanity: SOME of the burst legitimately ran
    const surfaced = results.filter((r) => r.outcome === 'surfaced');
    const deferred = results.filter((r) => r.outcome === 'deferred');
    expect(surfaced.length).toBeGreaterThan(0); // some of the burst was admitted...
    expect(deferred.length).toBeGreaterThan(0); // ...and the rest was denied WITHIN the burst itself
    expect(model.calls).toHaveLength(surfaced.length); // exactly the admitted subset actually spent
    expect(await budgetStore.getOutstandingReservationCents('user-1')).toBe(0); // no leaked reservations

    // Now that the ledger has settled, a FRESH run fired after the burst MUST be denied.
    const after = await runtime.runAgent(job({ idempotencyKey: 'after-burst' }));
    expect(after.outcome).toBe('deferred');
    expect(model.calls).toHaveLength(surfaced.length); // the post-settlement run added ZERO further spend
  });

  // Adversarial (worse than production wiring, which builds a fresh DegradingModelClient per
  // dispatch invocation, §4.5/§4.6 wiring.ts): even sharing ONE instance across a heavy concurrent
  // burst, every individual call still independently resolves in-roster — never off-Claude.
  test('a heavy concurrent 429 burst on a SHARED DegradingModelClient: every call still resolves in-roster (Haiku), never off-Claude', async () => {
    const inner = new TieredScriptedModelClient({ [ClaudeModelTier.SONNET_5]: rateLimitError() });
    const client = new DegradingModelClient(inner);
    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, () => client.generate({ tier: ClaudeModelTier.SONNET_5, systemPrompt: 's', userPrompt: 'u' }))
    );
    for (const r of results) {
      expect(r.tier).toBe(ClaudeModelTier.HAIKU_4_5); // every call individually degraded correctly
      expect(r.modelId).toMatch(/^claude-/); // never off-Claude, even under a shared-instance burst
    }
    expect(inner.calls.every((c) => CLAUDE_MODEL_IDS[c.tier].startsWith('claude-'))).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // FIXED (T-56 drill finding → T-R27 reservation fix, run-gate.ts). Was: "KNOWN GAP: a concurrent
  // burst for ONE rep can overshoot the daily ceiling by more than one run's cost."
  //
  // The RunGate USED TO BE a "check-then-spend" gate with no reservation/lock: `AgentRuntime.runAgent`
  // consulted `RunGate.check()` ONCE, near the top of the run, and a run's cost was only attributed
  // to the per-rep ledger at the very END (after generation + CFE complete). Under a concurrent
  // burst for the SAME rep, every call's `check()` could observe the SAME pre-burst spend (because
  // none of the others had recorded its cost yet) and all of them would pass — so the per-rep daily
  // ceiling could be overshot by up to (burst size - 1) extra runs' worth of spend. A genuine
  // violation of "no path spends past the cap" under concurrent load for ONE rep, not observable from
  // sequential traffic, only from real concurrency.
  //
  // FIXED by `BudgetKillSwitchStore.tryReserve`/`releaseReservation` (budget-store.ts's
  // `ReservationLedger`) + `BudgetKillSwitchRunGate.check()` (run-gate.ts): admission now atomically
  // folds in every OTHER admitted-but-not-yet-committed run's outstanding reservation, so concurrent
  // admissions for the SAME rep see each other's in-flight holds — the burst is now bounded AT
  // ADMISSION TIME, not just after it settles. `AgentRuntime.runAgent` releases the hold in a
  // `try/finally` on every exit path once the run's real cost lands (or it fails), so nothing leaks.
  // NOT covered by this fix (documented, not papered over): the ENTERPRISE org-aggregate ceiling and
  // the platform-wide ceiling remain check-then-spend (same theoretical gap under a concurrent
  // MULTI-rep burst against those shared caps) — the T-56 gap was specifically the PER-REP ceiling,
  // and preserving per-rep isolation was the explicit scope here. Also out of scope: cross-Node-
  // instance atomicity (the reservation tally is in-process only — see `ReservationLedger`'s doc
  // comment) — a separate, larger concern (T-R5).
  // ────────────────────────────────────────────────────────────────────────────────────────────
  test('a concurrent burst for ONE rep can no longer overshoot the daily ceiling by more than one run\'s cost', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'FREE_ORG_LINKED', intensitySetting: 'LOW', organizationId: null });
    const ceiling = DAILY_BUDGET_CENTS_BY_TIER_INTENSITY.FREE_ORG_LINKED.LOW; // 40 cents
    const store = new SpendRecordingStore(budgetStore);
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const model = new TieredScriptedModelClient({}, { tokenInput: 20000, tokenOutput: 8000 }); // 18 cents/run
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, runGate, costModel: new TierPricingCostModel() });

    const BURST = 10; // pre-fix, if the race fired, 10 x 18 = 180 cents against a 40-cent cap
    await Promise.all(Array.from({ length: BURST }, (_, i) => runtime.runAgent(job({ idempotencyKey: `race-${i}` }))));

    const totalSpend = await budgetStore.getDailySpendCents('user-1', new Date(0));
    // Fail-closed behavior: spend never lands more than one run's cost past the cap. Pre-fix this
    // FAILED (every run in the burst observed spend=0 at check time and all spent, landing at 180).
    expect(totalSpend).toBeLessThan(ceiling + 18);
    // TIGHTER bound, now provable: with a burst LARGER than the ceiling can admit, the reservation
    // fix actually holds spend at-or-under the ceiling exactly (no overshoot at all in this case) —
    // burst size beyond what fits is irrelevant, admission stops itself the same way regardless.
    expect(totalSpend).toBeLessThanOrEqual(ceiling);
    expect(await budgetStore.getOutstandingReservationCents('user-1')).toBe(0); // no leaked reservations
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// T-R27 FIX (closes the QC#1 reject — "reservation estimate is a fixed generic average, so a per-rep
// concurrent burst can STILL overshoot the daily cost ceiling"). run-gate.ts's `RESERVATION_TOKEN_BUDGET`
// is no longer a "typical/generous average" — it is now the TRUE worst-case per-run bound:
//   tokenOutput = HARD_MAX_OUTPUT_TOKENS_PER_RUN — ENFORCED on the wire (AnthropicRuntimeClient
//     clamps every real call's max_tokens to this, regardless of what a caller passes/omits).
//   tokenInput  = RESERVATION_SAFE_MAX_INPUT_TOKENS — a documented, conservative bound on
//     prompt-assembly.ts's actual (small, templated) prompt shape.
// THE INVARIANT: for every admitted run, real_cost <= reservationEstimateCentsFor(tier). Since the
// ledger's admission test is committed + outstanding + estimate <= ceiling (budget-store.ts
// `tryReserve`), and every admitted run's real cost is now bounded by its own reservation, the sum of
// real costs across an admitted burst can never exceed the ceiling either.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('T-R27 FIX: the reservation is a TRUE worst-case bound (real_cost <= reserved_estimate)', () => {
  const costModel = new TierPricingCostModel();

  // THE INVARIANT, proven for all three Claude tiers — at the QC break-case usage (20000in/8000out,
  // the EXACT numbers that produced the pre-fix 180-cent and 756-cent overshoots) and at the true
  // wire-enforced worst case. TEETH: mutating RESERVATION_TOKEN_BUDGET back toward a smaller
  // "generous average" (e.g. the old {15_000, 6_000}) makes the first assertion fail for Sonnet
  // (14 < 18) — proven manually during verification (see build report), then reverted via
  // `git checkout --`.
  test.each([ClaudeModelTier.HAIKU_4_5, ClaudeModelTier.SONNET_5, ClaudeModelTier.OPUS_4_8])(
    'reservationEstimateCentsFor(%s) >= real cost at the QC break-case usage AND equals the true worst case',
    (tier) => {
      const reserved = reservationEstimateCentsFor(tier);

      // The exact usage QC's TieredScriptedModelClient fixtures use to reproduce the overshoot.
      const qcBreakCaseCost = costModel.costCents({ tier, tokenInput: 20_000, tokenOutput: 8_000, batched: false });
      expect(reserved).toBeGreaterThanOrEqual(qcBreakCaseCost);

      // The true worst case this runtime can ever produce: input at the documented safe bound,
      // output AT the wire-enforced hard cap.
      const trueWorstCaseCost = costModel.costCents({
        tier,
        tokenInput: RESERVATION_SAFE_MAX_INPUT_TOKENS,
        tokenOutput: HARD_MAX_OUTPUT_TOKENS_PER_RUN,
        batched: false,
      });
      expect(reserved).toBeGreaterThanOrEqual(trueWorstCaseCost);
      // The estimate IS this worst case (derived from the identical constants), not merely >= it by
      // coincidence — proves the estimate is DEFINED as the bound, not just numerically above it today.
      expect(reserved).toBe(trueWorstCaseCost);
    }
  );

  // TEETH: proves the output-token cap is actually ENFORCED on the real wire call, not merely
  // documented/assumed. If a future change ever let a caller's requested maxTokens exceed the hard
  // cap, this would fail — and the invariant above would stop being a real guarantee.
  test('AnthropicRuntimeClient clamps max_tokens to HARD_MAX_OUTPUT_TOKENS_PER_RUN even when a caller requests more', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    let capturedBody: { max_tokens?: number } = {};
    const fetchSpy = async (_url: string, init: { body: string }) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
      };
    };
    const client = new AnthropicRuntimeClient({ fetchImpl: fetchSpy as never });
    await client.generate({ tier: ClaudeModelTier.SONNET_5, systemPrompt: 's', userPrompt: 'u', maxTokens: 999_999 });
    expect(capturedBody.max_tokens).toBe(HARD_MAX_OUTPUT_TOKENS_PER_RUN);
  });

  test('AnthropicRuntimeClient defaults to the hard cap on the wire when no maxTokens is requested at all', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    let capturedBody: { max_tokens?: number } = {};
    const fetchSpy = async (_url: string, init: { body: string }) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
      };
    };
    const client = new AnthropicRuntimeClient({ fetchImpl: fetchSpy as never });
    await client.generate({ tier: ClaudeModelTier.SONNET_5, systemPrompt: 's', userPrompt: 'u' });
    expect(capturedBody.max_tokens).toBe(HARD_MAX_OUTPUT_TOKENS_PER_RUN);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// T-R27 FIX (cont'd) — the GENERALIZED burst test: total admitted spend stays <= ceiling across
// MULTIPLE tier x intensity x ceiling x burst combinations (parametrized so this can't pass by a
// lucky ratio), INCLUDING the two exact combinations QC used to break the original generic-average
// estimate:
//   PAID_INDIVIDUAL/LOW  ceiling 150, burst 10 @18c/run -> PRE-FIX spent 180 (overshoot 30)
//   PAID_INDIVIDUAL/HIGH ceiling 600, burst 60 @18c/run -> PRE-FIX spent 756 (overshoot 156)
// Both must now land at-or-under the ceiling, with zero leaked reservations.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('T-R27 FIX: total admitted spend never exceeds the ceiling, across tiers/ceilings/bursts (QC#1 reject cases)', () => {
  const CASES: Array<{
    label: string;
    accessTier: 'PAID_INDIVIDUAL' | 'FREE_ORG_LINKED';
    intensitySetting: 'LOW' | 'MEDIUM' | 'HIGH';
    burst: number;
  }> = [
    { label: 'PAID_INDIVIDUAL/LOW (QC break case #1: ceiling 150, burst 10)', accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', burst: 10 },
    { label: 'PAID_INDIVIDUAL/HIGH (QC break case #2: ceiling 600, burst 60)', accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'HIGH', burst: 60 },
    { label: 'PAID_INDIVIDUAL/MEDIUM (ceiling 300, burst 25)', accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'MEDIUM', burst: 25 },
    { label: 'FREE_ORG_LINKED/LOW (ceiling 40, burst 12 — not evenly divisible by the reservation)', accessTier: 'FREE_ORG_LINKED', intensitySetting: 'LOW', burst: 12 },
    { label: 'FREE_ORG_LINKED/HIGH (ceiling 160, burst 45)', accessTier: 'FREE_ORG_LINKED', intensitySetting: 'HIGH', burst: 45 },
  ];

  test.each(CASES)('$label: total admitted spend stays <= ceiling', async ({ accessTier, intensitySetting, burst }) => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', {
      accessTier: accessTier as never,
      intensitySetting: intensitySetting as never,
      organizationId: null,
    });
    const ceiling = DAILY_BUDGET_CENTS_BY_TIER_INTENSITY[accessTier][intensitySetting];

    const store = new SpendRecordingStore(budgetStore);
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    // The EXACT QC break-case usage: 20000 input / 8000 output -> 18 cents/run at Sonnet 5
    // (Prospecting's draft-step tier) — the numbers QC used to reproduce the overshoot.
    const model = new TieredScriptedModelClient({}, { tokenInput: 20_000, tokenOutput: 8_000 });
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, runGate, costModel: new TierPricingCostModel() });

    const results = await Promise.all(
      Array.from({ length: burst }, (_, i) =>
        runtime.runAgent(job({ idempotencyKey: `${accessTier}-${intensitySetting}-${i}` }))
      )
    );

    const totalSpend = await budgetStore.getDailySpendCents('user-1', new Date(0));
    expect(totalSpend).toBeLessThanOrEqual(ceiling); // THE INVARIANT: no overshoot, at any tier/ceiling/burst size
    expect(await budgetStore.getOutstandingReservationCents('user-1')).toBe(0); // no leaked reservations

    const surfaced = results.filter((r) => r.outcome === 'surfaced');
    const deferred = results.filter((r) => r.outcome === 'deferred');
    expect(surfaced.length).toBeGreaterThan(0); // sanity: some of the burst legitimately ran
    expect(model.calls).toHaveLength(surfaced.length); // exactly the admitted subset actually spent
    expect(surfaced.length + deferred.length).toBe(burst); // every run resolved one way or the other
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// T-R27 FIX (cont'd) — NO LEAK ON FAILURE (the drill gap QC flagged as uncovered): a reservation
// placed at admission must be released even when the run does NOT complete normally — a
// thrown/errored model call, and a missing-credential HOLD, must each leave 0 outstanding after.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('T-R27 FIX: no reservation leak on failure paths', () => {
  test('a thrown (transient) model error still releases its reservation — 0 outstanding after', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', organizationId: null });
    const store = new InMemoryAgentRuntimeStore();
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    const model = new TieredScriptedModelClient({ [ClaudeModelTier.SONNET_5]: genericError() });
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, runGate });

    await expect(runtime.runAgent(job({ idempotencyKey: 'fail-leak-check' }))).rejects.toThrow(/400/);

    expect(await budgetStore.getOutstandingReservationCents('user-1')).toBe(0); // NOT leaked
    expect(store.agentRuns.at(-1)?.status).toBe('FAILED');
  });

  test('a missing-credential HOLD still releases its reservation — 0 outstanding after', async () => {
    const budgetStore = new InMemoryBudgetKillSwitchStore();
    budgetStore.repContexts.set('user-1', { accessTier: 'PAID_INDIVIDUAL', intensitySetting: 'LOW', organizationId: null });
    const store = new InMemoryAgentRuntimeStore();
    const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
    // Real AnthropicRuntimeClient (default modelClient), no ANTHROPIC_API_KEY (deleted in beforeEach)
    // -> MissingClaudeCredentialError -> the run HOLDS.
    const runtime = new AgentRuntime({ cfe: clearCFE(), store, runGate });

    const res = await runtime.runAgent(job({ idempotencyKey: 'no-key-leak-check' }));

    expect(res.outcome).toBe('held');
    expect(await budgetStore.getOutstandingReservationCents('user-1')).toBe(0); // NOT leaked
  });
});
