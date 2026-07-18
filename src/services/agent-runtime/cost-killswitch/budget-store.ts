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

import type { AccessTier, IntensitySetting } from '@prisma/client';
import { prisma } from '@/lib/prisma';

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
}

/** Test/dev store: no DB, no infra. Records everything for assertions. */
export class InMemoryBudgetKillSwitchStore implements BudgetKillSwitchStore {
  repContexts = new Map<string, RepBudgetContext>();
  /** userId -> array of cost_cents entries, each with its own timestamp (for `since` filtering). */
  spendByUser = new Map<string, { costCents: number; at: Date }[]>();
  killSwitches = new Map<string, KillSwitchState>();

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
}
