// T-40R (WP05 GATE remediation, master-spec §10.6/§10.9-8 "24h no-join → return to the rep") — THE
// MISSING RETURN SWEEP. T-39 built `ThreeWayHandoffService.returnIfLapsed` (a still-INVITED handoff
// past its 24h deadline returns to the rep with a coached next step), but NOTHING ever called it: no
// route, no cron — so a lapsed handoff sat INVITED forever and the "returns to you" promise was
// unreachable. This file is that sweep's PURE, package-free HANDLER LOGIC, mirroring the T-R14
// scheduled-dispatch convention (the `inngest.createFunction({ cron })` wrapper lives in
// ../inngest/messaging-inngest-functions.ts and just calls `runHandoffReturnSweep` inside a step.run).
//
// "CONSUME, don't fork": it never re-implements the return; it enumerates lapsed handoffs and hands
// each to `ThreeWayHandoffService.returnIfLapsed`, which is ownership-scoped (per rep) and idempotent
// (an already-JOINED/RETURNED handoff is left untouched). Fail-safe: an enumeration/infra error is a
// graceful no-op; the next tick catches up.

import { prisma } from '@/lib/prisma';

import type { HandoffRow } from './three-way-handoff.service';

export const HANDOFF_RETURN_SWEEP_FUNCTION_ID = 'messaging-handoff-return-sweep' as const;
/** Hourly. The 24h return deadline has hour-level granularity that an hourly sweep satisfies well;
 *  `returnIfLapsed` is idempotent so a re-tick over an already-returned handoff is a no-op. */
export const HANDOFF_RETURN_SWEEP_CRON = '0 * * * *' as const;

const MAX_HANDOFFS_PER_TICK = 500;

/** One still-INVITED, past-deadline handoff owned by `userId`. */
export interface LapsedHandoff {
  handoffId: string;
  userId: string;
}

/** DI-mockable enumeration boundary. */
export interface LapsedHandoffStore {
  listLapsedHandoffs(now: Date): Promise<LapsedHandoff[]>;
}

/** The one thing this sweep does — `ThreeWayHandoffService` implements it (ownership-scoped, idempotent). */
export interface HandoffReturner {
  returnIfLapsed(userId: string, handoffId: string, now?: Date): Promise<HandoffRow | null>;
}

interface PrismaLike {
  threeWayHandoff: {
    findMany(args: {
      where: { state: 'INVITED'; return_deadline_at: { lte: Date } };
      select: { id: true; user_id: true };
      take: number;
    }): Promise<{ id: string; user_id: string }[]>;
  };
}

/** The REAL enumeration: still-INVITED handoffs whose 24h return deadline has passed. Read LAZILY via
 *  the shared prisma singleton (constructed only inside a handler tick, never module scope). */
export class PrismaLapsedHandoffStore implements LapsedHandoffStore {
  constructor(private db: PrismaLike = prisma as unknown as PrismaLike) {}

  async listLapsedHandoffs(now: Date): Promise<LapsedHandoff[]> {
    const rows = await this.db.threeWayHandoff.findMany({
      where: { state: 'INVITED', return_deadline_at: { lte: now } },
      select: { id: true, user_id: true },
      take: MAX_HANDOFFS_PER_TICK,
    });
    return rows.map((r) => ({ handoffId: r.id, userId: r.user_id }));
  }
}

/** Test/dev store: no DB, no infra. */
export class InMemoryLapsedHandoffStore implements LapsedHandoffStore {
  lapsed: LapsedHandoff[] = [];
  async listLapsedHandoffs(): Promise<LapsedHandoff[]> {
    return this.lapsed;
  }
}

export interface HandoffReturnSweepDeps {
  store: LapsedHandoffStore;
  /** REQUIRED — the real `ThreeWayHandoffService`. Deliberately no default (loud, not silent). */
  sweeper: HandoffReturner;
  clock?: () => Date;
}

export interface HandoffReturnSweepResult {
  ok: boolean;
  considered: number;
  returned: number;
  perHandoff: { handoffId: string; state: string }[];
  skippedReason?: string;
}

function emptyResult(reason: string): HandoffReturnSweepResult {
  return { ok: false, considered: 0, returned: 0, perHandoff: [], skippedReason: reason };
}

/**
 * The sweep: enumerate lapsed handoffs, return each to its owning rep via the ownership-scoped,
 * idempotent `returnIfLapsed`. Fail-safe throughout: a broken store or a single handoff throwing
 * never crashes the tick.
 */
export async function runHandoffReturnSweep(deps: HandoffReturnSweepDeps): Promise<HandoffReturnSweepResult> {
  if (!deps || !deps.sweeper || !deps.store) {
    // eslint-disable-next-line no-console
    console.error('[messaging][handoff-sweep] missing store/sweeper; no-op.');
    return emptyResult('no_sweeper');
  }

  const clock = deps.clock ?? (() => new Date());
  const now = clock();

  let lapsed: LapsedHandoff[];
  try {
    lapsed = await deps.store.listLapsedHandoffs(now);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[messaging][handoff-sweep] enumeration unavailable this tick; graceful no-op.', err);
    return emptyResult('infra_unavailable');
  }

  const perHandoff: HandoffReturnSweepResult['perHandoff'] = [];
  let returned = 0;

  for (const h of lapsed) {
    try {
      const row = await deps.sweeper.returnIfLapsed(h.userId, h.handoffId, now);
      const state = row?.state ?? 'NOT_FOUND';
      if (state === 'RETURNED') returned += 1;
      perHandoff.push({ handoffId: h.handoffId, state });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[messaging][handoff-sweep] handoff ${h.handoffId} errored this tick; skipping.`, err);
      perHandoff.push({ handoffId: h.handoffId, state: 'ERROR' });
    }
  }

  return { ok: true, considered: lapsed.length, returned, perHandoff };
}
