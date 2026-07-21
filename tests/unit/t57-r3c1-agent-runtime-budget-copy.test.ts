// T-57 R3c-1 (MINOR-D5, master-spec §4.6) — before this fix, a budget-denied run's `reasoning_log`
// rendered the RunGate's raw machine token verbatim: "{Agent} deferred: budget_exhausted." That
// string is exactly what `services/mission-control/zones/briefing.ts`'s `receiptOf` surfaces
// UNCHANGED as a briefing receipt line (AC-4-10) — so the rep's own receipts literally showed the
// internal enum token. §4.6 specifies the honest sentence this proves now renders instead, plus
// the "intensity-change affordance" (a plain-language pointer to Me → Intensity, since a persisted
// log line can't carry a real hyperlink).

import { AgentKey, AgentRuntime, InMemoryAgentRuntimeStore } from '@/services/agent-runtime';
import type { AgentModelClient, AgentGenerationRequest, AgentGenerationResult, RunGate } from '@/services/agent-runtime';
import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ClaudeClassifierClient } from '@/services/compliance/claude';
import type { ClassifierVerdict } from '@/types/compliance';

class NeverCalledModelClient implements AgentModelClient {
  async generate(_req: AgentGenerationRequest): Promise<AgentGenerationResult> {
    throw new Error('The model must never be called — the RunGate denies before any Claude spend.');
  }
}

class ZeroConfidenceClassifierClient implements ClaudeClassifierClient {
  async classify(): Promise<ClassifierVerdict> {
    return { flagged: false, confidence: 0, rationale: 'test' };
  }
}

function clearCFE() {
  return new ComplianceFilterEngine({ classifierClient: new ZeroConfidenceClassifierClient() });
}

function job() {
  return {
    agentKey: AgentKey.PROSPECTING,
    userId: 'user-1',
    trigger: 'test',
    idempotencyKey: `idem-${Math.random()}`,
    contactId: 'contact-1',
    channel: 'SMS_HANDOFF' as const,
    rep: { firstName: 'Tasha', organization: 'primerica' },
    contact: { firstName: 'Jordan', relationshipType: 'FRIEND' },
    task: undefined,
  };
}

const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterAll(() => {
  if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
});

describe('T-57 R3c-1 — agent-runtime.ts humanizes the budget_exhausted hold reason (MINOR-D5)', () => {
  test('RED (pre-fix) would read: "... deferred: budget_exhausted." — the raw machine token never appears in the humanized reasoning', async () => {
    const denyGate: RunGate = { check: () => ({ allowed: false, reason: 'budget_exhausted' }) };
    const runtime = new AgentRuntime({
      modelClient: new NeverCalledModelClient(),
      cfe: clearCFE(),
      store: new InMemoryAgentRuntimeStore(),
      runGate: denyGate,
    });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('deferred');
    expect(res.reasoningLog).not.toContain('budget_exhausted');
  });

  test('GREEN: the reasoning names the daily-limit-at-intensity plain-language sentence (§4.6 exact wording)', async () => {
    const denyGate: RunGate = { check: () => ({ allowed: false, reason: 'budget_exhausted' }) };
    const runtime = new AgentRuntime({
      modelClient: new NeverCalledModelClient(),
      cfe: clearCFE(),
      store: new InMemoryAgentRuntimeStore(),
      runGate: denyGate,
    });
    const res = await runtime.runAgent(job());
    expect(res.reasoningLog).toMatch(/reach their daily limit at your current intensity/);
  });

  test('GREEN: the reasoning names the real, reachable intensity-change affordance (Me → Intensity)', async () => {
    const denyGate: RunGate = { check: () => ({ allowed: false, reason: 'budget_exhausted' }) };
    const runtime = new AgentRuntime({
      modelClient: new NeverCalledModelClient(),
      cfe: clearCFE(),
      store: new InMemoryAgentRuntimeStore(),
      runGate: denyGate,
    });
    const res = await runtime.runAgent(job());
    expect(res.reasoningLog).toMatch(/Me.*Intensity/);
  });

  // T-57 RE-GATE fix (D states re-gate, sibling to D2): the RunGate can ALSO deny with
  // `budget_exhausted_org` (enterprise-org daily ceiling, run-gate.ts:198) or
  // `budget_exhausted_platform` (platform-wide daily ceiling, run-gate.ts:227) — the ORIGINAL
  // fix above only string-equals the bare `'budget_exhausted'`, so both siblings fell through to
  // the raw-token fallback and leaked the internal enum into the rep's own receipts, exactly the
  // defect MINOR-D5 existed to close. These two tests prove the humanization now covers them too.
  test('RE-GATE GREEN: budget_exhausted_org renders the SAME humanized §4.6 sentence, never the raw token', async () => {
    const denyGate: RunGate = { check: () => ({ allowed: false, reason: 'budget_exhausted_org' }) };
    const runtime = new AgentRuntime({
      modelClient: new NeverCalledModelClient(),
      cfe: clearCFE(),
      store: new InMemoryAgentRuntimeStore(),
      runGate: denyGate,
    });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('deferred');
    expect(res.reasoningLog).not.toContain('budget_exhausted_org');
    expect(res.reasoningLog).toMatch(/reach their daily limit at your current intensity/);
    expect(res.reasoningLog).toMatch(/Me.*Intensity/);
  });

  test('RE-GATE GREEN: budget_exhausted_platform renders the SAME humanized §4.6 sentence, never the raw token', async () => {
    const denyGate: RunGate = { check: () => ({ allowed: false, reason: 'budget_exhausted_platform' }) };
    const runtime = new AgentRuntime({
      modelClient: new NeverCalledModelClient(),
      cfe: clearCFE(),
      store: new InMemoryAgentRuntimeStore(),
      runGate: denyGate,
    });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('deferred');
    expect(res.reasoningLog).not.toContain('budget_exhausted_platform');
    expect(res.reasoningLog).toMatch(/reach their daily limit at your current intensity/);
    expect(res.reasoningLog).toMatch(/Me.*Intensity/);
  });

  test('a DIFFERENT deny reason (kill_switch) is left unchanged — this fix is scoped to budget_exhausted only', async () => {
    const denyGate: RunGate = { check: () => ({ allowed: false, reason: 'kill_switch' }) };
    const runtime = new AgentRuntime({
      modelClient: new NeverCalledModelClient(),
      cfe: clearCFE(),
      store: new InMemoryAgentRuntimeStore(),
      runGate: denyGate,
    });
    const res = await runtime.runAgent(job());
    expect(res.reasoningLog).toContain('kill_switch');
  });

  // RE-GATE guard: the PREFIX match (`startsWith('budget_exhausted')`) must not over-match a
  // real, non-budget RunGate reason that merely shares the `_org` suffix shape
  // (`kill_switch_org` — a real org-scope kill-switch trip, run-gate.ts:171) — this must keep
  // rendering the raw-token fallback exactly like plain `kill_switch` does above.
  test('RE-GATE: kill_switch_org (a real, different deny reason) is also left unchanged — no false-positive prefix match', async () => {
    const denyGate: RunGate = { check: () => ({ allowed: false, reason: 'kill_switch_org' }) };
    const runtime = new AgentRuntime({
      modelClient: new NeverCalledModelClient(),
      cfe: clearCFE(),
      store: new InMemoryAgentRuntimeStore(),
      runGate: denyGate,
    });
    const res = await runtime.runAgent(job());
    expect(res.reasoningLog).toContain('kill_switch_org');
    expect(res.reasoningLog).not.toMatch(/reach their daily limit/);
  });

  test('no Claude spend happens on a denied run either way (unchanged fail-closed guarantee)', async () => {
    const model = new NeverCalledModelClient();
    const denyGate: RunGate = { check: () => ({ allowed: false, reason: 'budget_exhausted' }) };
    const store = new InMemoryAgentRuntimeStore();
    const runtime = new AgentRuntime({ modelClient: model, cfe: clearCFE(), store, runGate: denyGate });
    const res = await runtime.runAgent(job());
    expect(res.outcome).toBe('deferred');
    expect(store.draftMessages).toHaveLength(0);
  });
});
