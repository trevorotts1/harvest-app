// T-33 — the Agent Activity Ledger (master-spec §9.3 "receipts"; uiux §4.7 agent badge / §4.2
// receipts expander). Consumes `AgentRun.reasoning_log` verbatim — this is the OTHER T-30 seam named
// in agent-runtime/index.ts's own header comment ("T-32 Mission Control UI — reads the AgentRun
// stream (the Activity Ledger: reasoning_log per run)"); T-32 owns the Today-surface narrative
// rendering, this module owns the plain, read-only, ownership-scoped ledger read itself, which any
// consuming surface (Today's receipts, a dedicated ledger view, or a contact-timeline agent badge)
// can be built against.
//
// READ-ONLY BY CONSTRUCTION: this service exposes exactly one method, a query. There is no
// update/delete on the interface or the class — the ledger is a transparent RECORD of what already
// happened, never something a rep or an agent can edit after the fact (§9.3 "trust is built by
// showing work, not claiming it").
//
// OWNERSHIP-SCOPED BY CONSTRUCTION: every query is filtered to the CALLER's own `user_id` — there is
// no parameter anywhere on this service (or the route built on it) that lets a caller name a
// different user's id and read their runs. (Team/org-wide aggregation for an upline/RVP view is a
// distinct RBAC-scoped capability — see `src/services/compliance/audit/activity-ledger.ts`'s own
// `ActivityLedgerService` for that pattern — and is explicitly out of this build unit's lane.)

import { PrismaClient } from '@prisma/client';

export interface AgentRunLedgerRow {
  id: string;
  agent_key: string;
  user_id: string;
  trigger: string;
  status: string;
  reasoning_log: string | null;
  output_ref: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

/** Narrow, DI-mockable Prisma surface — same convention as every other service in this codebase. */
export interface ActivityLedgerPrismaClient {
  agentRun: {
    findMany(args: {
      where: { user_id: string };
      orderBy: { created_at: 'desc' };
      take: number;
    }): Promise<AgentRunLedgerRow[]>;
  };
}

export interface ListLedgerOptions {
  /** Default 50, capped at 200 — same defensive clamp convention as agent-queue's AGENT_QUEUE_MAX_LIMIT. */
  limit?: number;
}

export const ACTIVITY_LEDGER_DEFAULT_LIMIT = 50;
export const ACTIVITY_LEDGER_MAX_LIMIT = 200;

export class AgentActivityLedgerService {
  constructor(
    private prisma: ActivityLedgerPrismaClient = new PrismaClient() as unknown as ActivityLedgerPrismaClient
  ) {}

  /** §9.3 — the plain-language record of every agent run for THIS rep, newest first. Never accepts
   *  a targetUserId parameter: own-scope only, by construction. */
  async listForUser(userId: string, options: ListLedgerOptions = {}): Promise<AgentRunLedgerRow[]> {
    const limit = clampLimit(options.limit);
    return this.prisma.agentRun.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return ACTIVITY_LEDGER_DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), ACTIVITY_LEDGER_MAX_LIMIT);
}
