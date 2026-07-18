// T-31 (master-spec §4.5/§4.6) — the REAL kill-switch: per-rep daily budget ceilings (tier x
// intensity), an org-level aggregate ceiling for ENTERPRISE seats, and a platform-wide spend
// circuit breaker — plus manual PLATFORM/ORG/REP kill switches. This is what T-30's
// `AgentRuntime.runAgent` consults BEFORE any Claude spend (agent-runtime.ts step 3, already
// wired to the `RunGate` seam) — a denial here means the run is recorded HELD/deferred and NEVER
// calls the model client (no tokens spent).
//
// Critical-path bypass (§4.5: "critical paths — CFE, inbound handling, appointment confirmations —
// continue"): `AgentRuntime` already computes `req.criticality` via `criticalityFor()` (Appointment
// Setting only) before calling this gate — this file just has to honor it, which it does first.

import type { AccessTier, IntensitySetting } from '@prisma/client';
import { RunGate, RunGateDecision, RunGateRequest } from '../seams';
import { BudgetKillSwitchStore, PLATFORM_SCOPE_ID, PrismaBudgetKillSwitchStore } from './budget-store';

/**
 * Daily token-budget ceilings, in cents, by tier x intensity (§4.2/§4.5: "Low < Medium < High" is
 * the spec-mandated ORDERING; the master spec fixes the ordering and the tier scaling, not the
 * exact cents figure — these are documented, operator-tunable defaults, deliberately non-zero and
 * ordered Low < Medium < High within each tier, and PAID_INDIVIDUAL > FREE at every intensity).
 * ENTERPRISE does not use this table — it aggregates to `ENTERPRISE_ORG_DAILY_BUDGET_CENTS` (§4.5:
 * "enterprise seats aggregate to an org ceiling").
 */
export const DAILY_BUDGET_CENTS_BY_TIER_INTENSITY: Record<
  Exclude<AccessTier, 'ENTERPRISE'>,
  Record<IntensitySetting, number>
> = {
  FREE_ORG_LINKED: { LOW: 40, MEDIUM: 80, HIGH: 160 },
  FREE_PAID_EXTERNAL: { LOW: 40, MEDIUM: 80, HIGH: 160 },
  PAID_INDIVIDUAL: { LOW: 150, MEDIUM: 300, HIGH: 600 },
};

/** Org-level aggregate daily ceiling for ENTERPRISE seats (§4.5). Operator-tunable default. */
export const ENTERPRISE_ORG_DAILY_BUDGET_CENTS = 5_000; // $50.00/day

/** Platform-wide daily spend circuit breaker (§4.5: "the unit-economics circuit breaker named in
 *  the blueprint risk"). Operator-tunable default. */
export const PLATFORM_DAILY_BUDGET_CENTS = 100_000; // $1,000.00/day

export interface OperatorAlert {
  kind: 'kill_switch_auto_trip';
  scope: 'PLATFORM' | 'ORG';
  scopeId: string;
  spendCents: number;
  ceilingCents: number;
}

export type AlertOperatorFn = (alert: OperatorAlert) => void | Promise<void>;

/**
 * Default alert sink: a structured log line. §4.5 requires "the operator is alerted" on a
 * kill-switch-threshold breach — this is the seam a real deployment wires to PagerDuty/Slack/email;
 * intentionally simple here so the behavior is provable without a live alerting integration.
 */
export const defaultAlertOperator: AlertOperatorFn = (alert) => {
  // eslint-disable-next-line no-console
  console.error('[agent-runtime][kill-switch] operator alert:', JSON.stringify(alert));
};

/** Midnight UTC on the day of `d` — the daily budget window boundary. */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The daily cents ceiling for a rep's tier x intensity (ENTERPRISE handled by the caller separately). */
export function dailyBudgetCentsFor(accessTier: AccessTier, intensitySetting: IntensitySetting): number {
  const table = DAILY_BUDGET_CENTS_BY_TIER_INTENSITY[accessTier as Exclude<AccessTier, 'ENTERPRISE'>];
  return (table ?? DAILY_BUDGET_CENTS_BY_TIER_INTENSITY.FREE_ORG_LINKED)[intensitySetting];
}

export interface BudgetKillSwitchRunGateOptions {
  store?: BudgetKillSwitchStore;
  clock?: () => Date;
  alertOperator?: AlertOperatorFn;
}

export class BudgetKillSwitchRunGate implements RunGate {
  private readonly store: BudgetKillSwitchStore;
  private readonly clock: () => Date;
  private readonly alertOperator: AlertOperatorFn;

  constructor(opts: BudgetKillSwitchRunGateOptions = {}) {
    // Lazy default: no client/key construction at module scope (build-safety rule).
    this.store = opts.store ?? new PrismaBudgetKillSwitchStore();
    this.clock = opts.clock ?? (() => new Date());
    this.alertOperator = opts.alertOperator ?? defaultAlertOperator;
  }

  async check(req: RunGateRequest): Promise<RunGateDecision> {
    // §4.5: critical paths survive the kill-switch/budget gate entirely.
    if (req.criticality === 'critical') {
      return { allowed: true };
    }

    const platformKill = await this.store.getKillSwitchState('PLATFORM', PLATFORM_SCOPE_ID);
    if (platformKill?.tripped) {
      return { allowed: false, reason: 'kill_switch_platform' };
    }

    const repKill = await this.store.getKillSwitchState('REP', req.userId);
    if (repKill?.tripped) {
      return { allowed: false, reason: 'kill_switch_rep' };
    }

    const repInfo = await this.store.getRepBudgetContext(req.userId);
    if (!repInfo) {
      // Unknown rep row is a data/lookup gap, not a spend signal — this gate is a cost control, not
      // an identity check (identity is already verified upstream of dispatch). Fail OPEN here,
      // mirroring `AllowAllRunGate`'s default posture (T-30 seams.ts) rather than silently blocking
      // a legitimate run because of a lookup miss.
      return { allowed: true };
    }

    if (repInfo.organizationId) {
      const orgKill = await this.store.getKillSwitchState('ORG', repInfo.organizationId);
      if (orgKill?.tripped) {
        return { allowed: false, reason: 'kill_switch_org' };
      }
    }

    const since = startOfUtcDay(this.clock());

    if (repInfo.accessTier === 'ENTERPRISE' && repInfo.organizationId) {
      const orgSpend = await this.store.getOrgDailySpendCents(repInfo.organizationId, since);
      if (orgSpend >= ENTERPRISE_ORG_DAILY_BUDGET_CENTS) {
        await this.alertOperator({
          kind: 'kill_switch_auto_trip',
          scope: 'ORG',
          scopeId: repInfo.organizationId,
          spendCents: orgSpend,
          ceilingCents: ENTERPRISE_ORG_DAILY_BUDGET_CENTS,
        });
        return { allowed: false, reason: 'budget_exhausted_org' };
      }
    } else {
      const ceiling = dailyBudgetCentsFor(repInfo.accessTier, repInfo.intensitySetting);
      const repSpend = await this.store.getDailySpendCents(req.userId, since);
      if (repSpend >= ceiling) {
        return { allowed: false, reason: 'budget_exhausted' };
      }
    }

    const platformSpend = await this.store.getPlatformDailySpendCents(since);
    if (platformSpend >= PLATFORM_DAILY_BUDGET_CENTS) {
      await this.alertOperator({
        kind: 'kill_switch_auto_trip',
        scope: 'PLATFORM',
        scopeId: PLATFORM_SCOPE_ID,
        spendCents: platformSpend,
        ceilingCents: PLATFORM_DAILY_BUDGET_CENTS,
      });
      return { allowed: false, reason: 'budget_exhausted_platform' };
    }

    return { allowed: true };
  }
}

/**
 * Cost-pressure probe for the degradation ladder (degradation.ts): true once a rep (or their org,
 * for ENTERPRISE) has crossed `thresholdRatio` of their daily ceiling — BEFORE the hard budget denial
 * above fires. Lets non-quality-critical Sonnet drafting step down to Haiku proactively (§4.4: "if
 * Sonnet 5 is saturated ... degrade to Haiku 4.5") rather than only reacting to a live 429.
 */
export async function isUnderCostPressure(
  store: BudgetKillSwitchStore,
  userId: string,
  clock: () => Date = () => new Date(),
  thresholdRatio = 0.8
): Promise<boolean> {
  const repInfo = await store.getRepBudgetContext(userId);
  if (!repInfo) return false;
  const since = startOfUtcDay(clock());

  const isEnterpriseOrg = repInfo.accessTier === 'ENTERPRISE' && repInfo.organizationId;
  const ceiling = isEnterpriseOrg ? ENTERPRISE_ORG_DAILY_BUDGET_CENTS : dailyBudgetCentsFor(repInfo.accessTier, repInfo.intensitySetting);
  if (ceiling <= 0) return false;

  const spend = isEnterpriseOrg
    ? await store.getOrgDailySpendCents(repInfo.organizationId as string, since)
    : await store.getDailySpendCents(userId, since);

  return spend / ceiling >= thresholdRatio;
}
