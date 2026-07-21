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
import { ClaudeModelTier } from '../runtime-model-map';
import { RunGate, RunGateDecision, RunGateRequest } from '../seams';
import { BudgetKillSwitchStore, PLATFORM_SCOPE_ID, PrismaBudgetKillSwitchStore } from './budget-store';
import { CLAUDE_PRICING_CENTS_PER_1K } from './pricing';

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

/**
 * The daily cents ceiling for a rep's tier x intensity (ENTERPRISE handled by the caller
 * separately). T-56 DRILL HARDENING: the accessTier dimension already fell back to a safe default
 * table via `??`, but the intensity dimension had no equivalent fallback — an unrecognized/corrupt
 * `intensitySetting` (a data-integrity gap, not a normal enum value) made `table[intensitySetting]`
 * resolve to `undefined`, and `spend >= undefined` is ALWAYS `false` in JS, so the budget check
 * could never trip: a mis-set threshold silently became UNLIMITED spend (fail-open) instead of
 * halting (fail-closed), the opposite of §4.5's mandate. A missing/unknown ceiling now returns 0
 * (halt immediately) rather than `undefined` (never trip) — "no known safe ceiling" must mean HALT,
 * not "assume the largest one."
 */
export function dailyBudgetCentsFor(accessTier: AccessTier, intensitySetting: IntensitySetting): number {
  const table = DAILY_BUDGET_CENTS_BY_TIER_INTENSITY[accessTier as Exclude<AccessTier, 'ENTERPRISE'>];
  const ceiling = (table ?? DAILY_BUDGET_CENTS_BY_TIER_INTENSITY.FREE_ORG_LINKED)[intensitySetting];
  return typeof ceiling === 'number' && Number.isFinite(ceiling) ? ceiling : 0;
}

/**
 * T-R27 (§4.5 concurrency hardening) — the conservative per-run token budget the reservation
 * primitive prices against at ADMISSION time (before real usage is known). Sized generously — well
 * above a typical draft's usage (most steps run ~2,000 input / ~800 output tokens, per the test
 * fixtures elsewhere in this lane) — so a legitimately large single-step run is never under-reserved
 * (the reservation would then admit a run that could itself breach the cap, exactly what §4.5 rules
 * out). Not derived from any one agent's real prompt size; it is a deliberate, documented, tunable
 * safety margin, analogous to `DAILY_BUDGET_CENTS_BY_TIER_INTENSITY`'s operator-tunable defaults.
 */
export const RESERVATION_TOKEN_BUDGET = { tokenInput: 15_000, tokenOutput: 6_000 } as const;

/**
 * The reservation estimate for one run at `tier` (cents) — `RESERVATION_TOKEN_BUDGET` priced at
 * `tier`'s real published rate (single-sourced from `pricing.ts`, so this never drifts out of sync
 * with the real cost model). Ordered Haiku < Sonnet < Opus, matching every other cost-disciplined
 * ordering in this lane.
 */
export function reservationEstimateCentsFor(tier: ClaudeModelTier): number {
  const rate = CLAUDE_PRICING_CENTS_PER_1K[tier];
  const raw = (RESERVATION_TOKEN_BUDGET.tokenInput / 1000) * rate.in + (RESERVATION_TOKEN_BUDGET.tokenOutput / 1000) * rate.out;
  return Math.max(0, Math.round(raw));
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

    // T-R27 (§4.5 concurrency hardening): the reservation this admission would place if it clears
    // every remaining check, priced conservatively for the tier the run will actually spend on.
    // Reserved ONLY once every other check below has already passed (see the end of this method) —
    // never left outstanding against a run this same call ultimately denies.
    const estimate = reservationEstimateCentsFor(req.primaryTier);
    let repReservationId: string | null = null;

    if (repInfo.accessTier === 'ENTERPRISE' && repInfo.organizationId) {
      // NOT reservation-aware (out of scope here, same as multi-instance atomicity, §4.5 T-56 gap was
      // documented for the PER-REP ceiling specifically): the org aggregate remains check-then-spend.
      // A concurrent multi-rep burst against the SAME enterprise org ceiling could in principle hit
      // the identical class of gap this unit closes for the per-rep case — flagged, not fixed, here.
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
      // THE T-R27 FIX: `tryReserve` folds in every OTHER admitted-but-not-yet-committed run's
      // outstanding reservation atomically, so a concurrent burst for this SAME rep can no longer
      // have every call observe the identical pre-burst `repSpend` and all pass (T-56's documented
      // gap) — each concurrent admission sees the reservations the others already placed.
      repReservationId = await this.store.tryReserve(req.userId, repSpend, ceiling, estimate);
      if (repReservationId === null) {
        return { allowed: false, reason: 'budget_exhausted' };
      }
    }

    const platformSpend = await this.store.getPlatformDailySpendCents(since);
    if (platformSpend >= PLATFORM_DAILY_BUDGET_CENTS) {
      // Roll back: the per-rep reservation above was provisional on EVERY check passing. The
      // platform-wide breach denies this run, so the hold must not outlive the denial (no leak).
      if (repReservationId) {
        await this.store.releaseReservation(req.userId, repReservationId);
      }
      await this.alertOperator({
        kind: 'kill_switch_auto_trip',
        scope: 'PLATFORM',
        scopeId: PLATFORM_SCOPE_ID,
        spendCents: platformSpend,
        ceilingCents: PLATFORM_DAILY_BUDGET_CENTS,
      });
      return { allowed: false, reason: 'budget_exhausted_platform' };
    }

    if (!repReservationId) {
      return { allowed: true };
    }

    // Admitted, WITH an outstanding reservation the caller now owns. `released` guards against a
    // double-release (defensive — a caller might release in both a success path and a `finally`).
    let released = false;
    const reservationId = repReservationId;
    return {
      allowed: true,
      release: async () => {
        if (released) return;
        released = true;
        await this.store.releaseReservation(req.userId, reservationId);
      },
    };
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
