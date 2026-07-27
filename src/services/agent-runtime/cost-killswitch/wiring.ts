// T-31 — the ONE place that assembles the real cost/kill-switch/degradation deps for a production
// agent-dispatch invocation. Lazy: takes no key, opens no connection, and constructs nothing at
// module scope (build-safety rule) — every call builds a fresh set of deps for exactly one
// `dispatchAgentJob` invocation, matching the existing lazy-per-invocation convention in
// dispatch.ts / inngest-functions.ts. The production call site (inngest-functions.ts) calls this
// and passes the result straight through to `dispatchAgentJob(data, deps)`.

import { AgnesRuntimeClient } from '../agnes';
import { PrismaAgentRuntimeStore } from '../store';
import type { AgentRuntimeDeps } from '../agent-runtime';

import { TierPricingCostModel } from './pricing';
import { PrismaBudgetKillSwitchStore } from './budget-store';
import { BudgetKillSwitchRunGate, isUnderCostPressure } from './run-gate';
import { DegradingModelClient } from './degradation';
import { DegradationAnnotatingStore } from './degradation-store';

/**
 * Builds the real `AgentRuntimeDeps` for one dispatch of `userId`'s job: the real per-tier
 * `CostModel`, the real budget/kill-switch `RunGate`, and a Claude-only model client wrapped in the
 * in-roster degradation ladder (reactive on rate-limit/overload, proactive on cost pressure for
 * this rep), paired with a store that honestly annotates a degraded run's `reasoning_log`.
 */
export function buildProductionAgentRuntimeDeps(userId: string): AgentRuntimeDeps {
  const budgetStore = new PrismaBudgetKillSwitchStore();
  const runGate = new BudgetKillSwitchRunGate({ store: budgetStore });
  const costModel = new TierPricingCostModel();

  const modelClient = new DegradingModelClient(new AgnesRuntimeClient(), {
    costPressureCheck: () => isUnderCostPressure(budgetStore, userId),
  });
  const store = new DegradationAnnotatingStore(new PrismaAgentRuntimeStore(), modelClient);

  return { runGate, costModel, modelClient, store };
}
