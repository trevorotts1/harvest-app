// T-31 (master-spec §4.5/§4.6) — the budget/kill-switch persistence boundary. Same DI-mockable
// delegate convention as T-30's `AgentRuntimeStore` (store.ts): one narrow interface, a real
// `PrismaBudgetKillSwitchStore` (lazy, never constructed at module scope), and an
// `InMemoryBudgetKillSwitchStore` for tests/dev with no DB.
//
// Deliberately reads live spend off the EXISTING `AgentRun.cost_cents` roll-up (§4.5: "every
// AgentRun records ... giving a live per-rep and per-org cost roll-up") rather than a second ledger
// table — there is exactly one source of truth for "how much has this rep/org/platform spent
// today." This file only adds the kill-switch TRIPPED/CLEARED state (a new, additive table,
// `AgentKillSwitch`) and the read paths RunGate needs to enforce budgets.
//
// T-R27 (§4.5 concurrency hardening) — ALSO adds the RESERVATION primitive that closes T-56's
// documented per-rep "check-then-spend" gap: a concurrent burst for one rep used to have every
// `RunGate.check()` compare its estimate only against the last-COMMITTED spend
// (`getDailySpendCents`), so every call in the burst could observe the identical pre-burst total and
// all pass. `tryReserve`/`releaseReservation` add an outstanding-reservation tally, ADMISSION-time
// (not persisted, no schema change — see `ReservationLedger` below), so concurrent admissions for
// the SAME rep see each other's in-flight holds even though the committed-spend read itself is still
// a separate, necessarily-slightly-stale snapshot.

import type { AccessTier, IntensitySetting } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * T-R27 — an in-process, per-rep outstanding-reservation tally. Every mutating operation
 * (`reserve`/`release`) and the read it's paired with (`outstandingCentsFor`) is a single
 * SYNCHRONOUS Map mutation with no `await` inside it, so two concurrent callers can never interleave
 * mid-operation (JS run-to-completion semantics) — `tryReserve` below composes a read + compare +
 * write into one such atomic call. This is the "mirror the store's atomic-update pattern" primitive
 * the reservation fix needs.
 *
 * ATOMICITY ASSUMPTION (stated per the build brief): atomic within a single Node process/instance
 * only — there is no network round-trip, no lock, nothing shared across replicas. If this deployment
 * ever runs multiple concurrent Node instances/workers, reservations made in one instance are NOT
 * visible to another, so the SAME per-rep burst spread across replicas could still overshoot.
 * Closing that is a separate, larger concern (a distributed lock or a real DB-backed reservation row,
 * which the "no schema change" constraint here rules out) — out of scope for this unit, exactly as
 * multi-instance atomicity was called out as T-R5's concern, not this one's.
 */
export class ReservationLedger {
  private readonly byUser = new Map<string, Map<string, number>>();
  private counter = 0;

  /** Sum of this user's currently-outstanding (unreleased) reservations. */
  outstandingCentsFor(userId: string): number {
    const userMap = this.byUser.get(userId);
    if (!userMap) return 0;
    let total = 0;
    for (const cents of userMap.values()) total += cents;
    return total;
  }

  /**
   * Atomic admission primitive: given the caller's already-read `committedSpendCents` snapshot, if
   * `committedSpendCents + outstanding + estimateCents` would exceed `ceilingCents`, denies (returns
   * null, no mutation). Otherwise records the reservation and returns its token — all in one
   * synchronous critical section, so concurrent callers for the SAME userId can never both pass on
   * the same outstanding total.
   */
  tryReserve(userId: string, committedSpendCents: number, ceilingCents: number, estimateCents: number): string | null {
    const outstanding = this.outstandingCentsFor(userId);
    if (committedSpendCents + outstanding + estimateCents > ceilingCents) {
      return null;
    }
    const id = `res_${++this.counter}_${Math.random().toString(36).slice(2, 8)}`;
    const userMap = this.byUser.get(userId) ?? new Map<string, number>();
    userMap.set(id, estimateCents);
    this.byUser.set(userId, userMap);
    return id;
  }

  /** Idempotent: releasing an unknown/already-released token is a safe no-op. */
  release(userId: string, reservationId: string): void {
    this.byUser.get(userId)?.delete(reservationId);
  }
}

/**
 * T-R27 — ONE ledger shared by every `PrismaBudgetKillSwitchStore` instance in this Node process.
 * `wiring.ts` intentionally builds a FRESH store per dispatch invocation (lazy, no shared client at
 * module scope) — if the reservation tally lived on the instance instead of the module, concurrent
 * invocations (each with their own store instance) would never see each other's reservations and the
 * T-56 gap would reopen. Module-scoped state here holds no client/key/connection (build-safety rule
 * is about NOT eagerly opening DB/API connections at import time; an empty in-memory Map has no such
 * cost), so this stays consistent with the lazy-construction convention elsewhere in this file.
 */
const PROCESS_RESERVATION_LEDGER = new ReservationLedger();

export type KillSwitchScope = 'PLATFORM' | 'ORG' | 'REP';

/** The singleton scope_id for the PLATFORM-wide kill-switch row (there is exactly one). */
export const PLATFORM_SCOPE_ID = 'GLOBAL';

export interface KillSwitchState {
  tripped: boolean;
  reason: string | null;
}

export interface RepBudgetContext {
  accessTier: AccessTier;
  intensitySetting: IntensitySetting;
  organizationId: string | null;
}

export interface BudgetKillSwitchStore {
  /** The rep's tier + intensity + org (drives which budget ceiling applies, §4.5). */
  getRepBudgetContext(userId: string): Promise<RepBudgetContext | null>;
  /** Sum of `AgentRun.cost_cents` for this rep since `since` (inclusive). */
  getDailySpendCents(userId: string, since: Date): Promise<number>;
  /** Sum of `AgentRun.cost_cents` across every rep in this org since `since`. */
  getOrgDailySpendCents(organizationId: string, since: Date): Promise<number>;
  /** Sum of `AgentRun.cost_cents` platform-wide since `since` (the unit-economics circuit breaker). */
  getPlatformDailySpendCents(since: Date): Promise<number>;
  getKillSwitchState(scope: KillSwitchScope, scopeId: string): Promise<KillSwitchState | null>;
  setKillSwitchState(
    scope: KillSwitchScope,
    scopeId: string,
    tripped: boolean,
    reason: string | null,
    actorUserId: string
  ): Promise<void>;
  /** T-R27 (§4.5 concurrency hardening) — atomic admission-time reservation. See `ReservationLedger`
   *  for the atomicity contract/assumption. Returns null (denied, nothing reserved) when
   *  `committedSpendCents + outstanding-reservations + estimateCents` would exceed `ceilingCents`;
   *  otherwise returns a token that MUST be released exactly once via `releaseReservation`. */
  tryReserve(userId: string, committedSpendCents: number, ceilingCents: number, estimateCents: number): Promise<string | null>;
  /** Release a reservation created by `tryReserve`. Idempotent — releasing an unknown/already-
   *  released token is a no-op, so a defensive double-release (e.g. both a success path AND a
   *  guarding `finally`) is always safe. */
  releaseReservation(userId: string, reservationId: string): Promise<void>;
  /** Observability/test helper: this rep's currently-outstanding (unreleased) reservation total. */
  getOutstandingReservationCents(userId: string): Promise<number>;
}

// --- Narrow Prisma delegate shapes (only what this store touches) -----------------------------

interface PrismaLike {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { access_tier: true; intensity_setting: true; organization_id: true };
    }): Promise<{ access_tier: AccessTier; intensity_setting: IntensitySetting; organization_id: string | null } | null>;
    findMany(args: {
      where: { organization_id: string };
      select: { id: true };
    }): Promise<{ id: string }[]>;
  };
  agentRun: {
    aggregate(args: {
      where: { user_id?: string | { in: string[] }; created_at: { gte: Date } };
      _sum: { cost_cents: true };
    }): Promise<{ _sum: { cost_cents: number | null } }>;
  };
  agentKillSwitch: {
    findUnique(args: {
      where: { scope_scope_id: { scope: string; scope_id: string } };
    }): Promise<{ tripped: boolean; reason: string | null } | null>;
    upsert(args: {
      where: { scope_scope_id: { scope: string; scope_id: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

export class PrismaBudgetKillSwitchStore implements BudgetKillSwitchStore {
  // Lazy default: the shared singleton, never constructed at module scope here.
  constructor(private db: PrismaLike = prisma as unknown as PrismaLike) {}

  async getRepBudgetContext(userId: string): Promise<RepBudgetContext | null> {
    const row = await this.db.user.findUnique({
      where: { id: userId },
      select: { access_tier: true, intensity_setting: true, organization_id: true },
    });
    if (!row) return null;
    return {
      accessTier: row.access_tier,
      intensitySetting: row.intensity_setting,
      organizationId: row.organization_id,
    };
  }

  async getDailySpendCents(userId: string, since: Date): Promise<number> {
    const res = await this.db.agentRun.aggregate({
      where: { user_id: userId, created_at: { gte: since } },
      _sum: { cost_cents: true },
    });
    return res._sum.cost_cents ?? 0;
  }

  async getOrgDailySpendCents(organizationId: string, since: Date): Promise<number> {
    const members = await this.db.user.findMany({
      where: { organization_id: organizationId },
      select: { id: true },
    });
    if (members.length === 0) return 0;
    const res = await this.db.agentRun.aggregate({
      where: { user_id: { in: members.map((m) => m.id) }, created_at: { gte: since } },
      _sum: { cost_cents: true },
    });
    return res._sum.cost_cents ?? 0;
  }

  async getPlatformDailySpendCents(since: Date): Promise<number> {
    const res = await this.db.agentRun.aggregate({
      where: { created_at: { gte: since } },
      _sum: { cost_cents: true },
    });
    return res._sum.cost_cents ?? 0;
  }

  async getKillSwitchState(scope: KillSwitchScope, scopeId: string): Promise<KillSwitchState | null> {
    const row = await this.db.agentKillSwitch.findUnique({
      where: { scope_scope_id: { scope, scope_id: scopeId } },
    });
    return row ? { tripped: row.tripped, reason: row.reason } : null;
  }

  async setKillSwitchState(
    scope: KillSwitchScope,
    scopeId: string,
    tripped: boolean,
    reason: string | null,
    actorUserId: string
  ): Promise<void> {
    const now = new Date();
    const tripFields = tripped
      ? { tripped: true, reason, tripped_by: actorUserId, tripped_at: now }
      : { tripped: false, cleared_by: actorUserId, cleared_at: now };
    await this.db.agentKillSwitch.upsert({
      where: { scope_scope_id: { scope, scope_id: scopeId } },
      create: { scope, scope_id: scopeId, ...tripFields },
      update: tripFields,
    });
  }

  // ── T-R27 reservation primitive — see PROCESS_RESERVATION_LEDGER's doc comment for the
  // single-Node-process atomicity assumption. No schema change: nothing here touches the DB. ────────

  async tryReserve(userId: string, committedSpendCents: number, ceilingCents: number, estimateCents: number): Promise<string | null> {
    return PROCESS_RESERVATION_LEDGER.tryReserve(userId, committedSpendCents, ceilingCents, estimateCents);
  }

  async releaseReservation(userId: string, reservationId: string): Promise<void> {
    PROCESS_RESERVATION_LEDGER.release(userId, reservationId);
  }

  async getOutstandingReservationCents(userId: string): Promise<number> {
    return PROCESS_RESERVATION_LEDGER.outstandingCentsFor(userId);
  }
}

/** Test/dev store: no DB, no infra. Records everything for assertions. */
export class InMemoryBudgetKillSwitchStore implements BudgetKillSwitchStore {
  repContexts = new Map<string, RepBudgetContext>();
  /** userId -> array of cost_cents entries, each with its own timestamp (for `since` filtering). */
  spendByUser = new Map<string, { costCents: number; at: Date }[]>();
  killSwitches = new Map<string, KillSwitchState>();
  /** T-R27 — INSTANCE-scoped (not module-scoped, unlike the Prisma store): each test constructs its
   *  own `InMemoryBudgetKillSwitchStore`, and reservation state must not leak across tests. */
  private readonly reservations = new ReservationLedger();

  private key(scope: KillSwitchScope, scopeId: string): string {
    return `${scope}:${scopeId}`;
  }

  /** Test helper: record a run's cost against a rep (mirrors what a real AgentRun insert would sum). */
  recordSpend(userId: string, costCents: number, at: Date = new Date()): void {
    const list = this.spendByUser.get(userId) ?? [];
    list.push({ costCents, at });
    this.spendByUser.set(userId, list);
  }

  async getRepBudgetContext(userId: string): Promise<RepBudgetContext | null> {
    return this.repContexts.get(userId) ?? null;
  }

  async getDailySpendCents(userId: string, since: Date): Promise<number> {
    const list = this.spendByUser.get(userId) ?? [];
    return list.filter((r) => r.at >= since).reduce((sum, r) => sum + r.costCents, 0);
  }

  async getOrgDailySpendCents(organizationId: string, since: Date): Promise<number> {
    let total = 0;
    for (const [userId, ctx] of this.repContexts) {
      if (ctx.organizationId === organizationId) {
        total += await this.getDailySpendCents(userId, since);
      }
    }
    return total;
  }

  async getPlatformDailySpendCents(since: Date): Promise<number> {
    let total = 0;
    for (const userId of this.spendByUser.keys()) {
      total += await this.getDailySpendCents(userId, since);
    }
    return total;
  }

  async getKillSwitchState(scope: KillSwitchScope, scopeId: string): Promise<KillSwitchState | null> {
    return this.killSwitches.get(this.key(scope, scopeId)) ?? null;
  }

  async setKillSwitchState(
    scope: KillSwitchScope,
    scopeId: string,
    tripped: boolean,
    reason: string | null
  ): Promise<void> {
    this.killSwitches.set(this.key(scope, scopeId), { tripped, reason });
  }

  async tryReserve(userId: string, committedSpendCents: number, ceilingCents: number, estimateCents: number): Promise<string | null> {
    return this.reservations.tryReserve(userId, committedSpendCents, ceilingCents, estimateCents);
  }

  async releaseReservation(userId: string, reservationId: string): Promise<void> {
    this.reservations.release(userId, reservationId);
  }

  async getOutstandingReservationCents(userId: string): Promise<number> {
    return this.reservations.outstandingCentsFor(userId);
  }
}
