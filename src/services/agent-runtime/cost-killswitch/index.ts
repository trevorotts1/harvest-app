// T-31 (master-spec §4.5/§4.6) — public surface of the cost model / kill-switch / degradation-ladder
// lane. Consumes T-30's seams (`RunGate`, `CostModel`, `AgentModelClient`, `AgentRuntimeStore`) —
// see src/services/agent-runtime/seams.ts and index.ts for the contracts this file implements
// against. Nothing here modifies the runtime core (agent-runtime.ts, agent-handlers.ts, dispatch.ts,
// store.ts, runtime-model-map.ts, claude/*).

export { CLAUDE_PRICING_CENTS_PER_1K, BATCH_API_DISCOUNT, TierPricingCostModel, PRICING_INTRO_NOTE } from './pricing';

export {
  PLATFORM_SCOPE_ID,
  PrismaBudgetKillSwitchStore,
  InMemoryBudgetKillSwitchStore,
  ReservationLedger,
} from './budget-store';
export type { KillSwitchScope, KillSwitchState, RepBudgetContext, BudgetKillSwitchStore } from './budget-store';

export {
  BudgetKillSwitchRunGate,
  DAILY_BUDGET_CENTS_BY_TIER_INTENSITY,
  ENTERPRISE_ORG_DAILY_BUDGET_CENTS,
  PLATFORM_DAILY_BUDGET_CENTS,
  RESERVATION_TOKEN_BUDGET,
  dailyBudgetCentsFor,
  reservationEstimateCentsFor,
  startOfUtcDay,
  isUnderCostPressure,
  defaultAlertOperator,
} from './run-gate';
export type { OperatorAlert, AlertOperatorFn, BudgetKillSwitchRunGateOptions } from './run-gate';

export {
  DegradingModelClient,
  DegradationFloorExhaustedError,
  DEGRADATION_LADDER,
  isRateLimitOrOverloadSignal,
} from './degradation';
export type { DegradationEvent, DegradingModelClientOptions } from './degradation';

export { DegradationAnnotatingStore, HONEST_DEGRADATION_NOTE } from './degradation-store';

export { buildProductionAgentRuntimeDeps } from './wiring';
