// T-40R (WP05 GATE remediation, master-spec §10.2 outreach sequence + §4 "24/7 / while you slept") —
// THE MISSING CADENCE TRIGGER. T-39 built `SequenceService.runDueSteps` (fire every due step of ONE
// sequence, through the fully-gated T-37 seam), but NOTHING ever called it: no route, no cron. So an
// enrolled sequence's later touches never fired — a core §10.2 promise was unreachable. This file is
// that trigger's PURE, package-free HANDLER LOGIC (unit-testable with no live Inngest server and no
// live DB), mirroring the T-R14 scheduled-dispatch.ts convention exactly: the `inngest.createFunction
// ({ cron })` wrapper (which imports the `inngest` package, so it is NOT reachable from Jest) lives in
// ../inngest/messaging-inngest-functions.ts and just calls `runDueSequences` inside one `step.run`.
//
// "CONSUME, don't fork" — this never re-implements a send. It only enumerates ACTIVE sequences and
// hands each to `SequenceService.runDueSteps`, which routes every touch THROUGH the seam (pre-schedule
// SendComplianceGate + the per-send CFE/compliance/deliverability gate). A step the seam HELDs is
// recorded HELD and NOT sent, exactly as built; the gate is authoritative and untouched here.
//
// Idempotent by construction: `runDueSteps` advances `current_step_index` and marks steps SENT — a
// re-tick over the same sequence only ever fires steps still SCHEDULED/DEFERRED and due, so a second
// hourly pass can never re-send an already-sent step. Fail-safe (§4.6 doctrine): any enumeration/infra
// error is caught and returned as a clean no-op; the next tick tries again.

import { prisma } from '@/lib/prisma';

import type { RunContext, RunSummary } from './sequence.service';

// ── Inngest function config (package-free — asserted by tests without importing `inngest`, same
// convention as SCHEDULED_AGENT_DISPATCH_* in scheduled-dispatch.ts). The real registration lives in
// ../inngest/messaging-inngest-functions.ts.
export const SCHEDULED_SEQUENCE_RUN_FUNCTION_ID = 'messaging-scheduled-sequence-run' as const;
/** Hourly. runDueSteps is due-aware and idempotent, so an hourly tick is a liveness/catch-up cadence
 *  (mirrors the T-R14 scheduled agent dispatch), not the sequence's own timing (that is per-step
 *  scheduled_at). */
export const SCHEDULED_SEQUENCE_RUN_CRON = '0 * * * *' as const;

/** Safety cap on sequences processed per tick — a huge tenant can never make one tick unbounded; the
 *  remainder is naturally picked up next hour (still due). */
const MAX_SEQUENCES_PER_TICK = 500;

/** One ACTIVE sequence due for a cadence tick, plus the per-rep run context the seam needs. */
export interface DueSequence {
  sequenceId: string;
  userId: string;
  organizationId: string;
  /** The rep-org's authenticated EMAIL sending domain (null → an EMAIL step HELDs NO_SENDING_DOMAIN). */
  sendingDomain: string | null;
}

/** DI-mockable enumeration boundary (same narrow-store convention as ScheduledDispatchStore). */
export interface DueSequenceStore {
  listDueSequences(now: Date): Promise<DueSequence[]>;
}

/** The one thing this pass does to a sequence — `SequenceService` implements it. Kept as a seam so a
 *  test can inject a fake runner and prove the pass delegates, and so production injects the REAL,
 *  fully-gated `SequenceService` (built by production-wiring.ts) with no send re-implemented here. */
export interface SequenceRunner {
  runDueSteps(userId: string, sequenceId: string, ctx: RunContext, now?: Date): Promise<RunSummary>;
}

interface PrismaLike {
  outreachSequence: {
    findMany(args: {
      where: { state: 'ACTIVE' };
      select: { id: true; user_id: true; steps: { where: Record<string, unknown>; select: { id: true }; take: 1 } };
      take: number;
    }): Promise<{ id: string; user_id: string; steps: { id: string }[] }[]>;
  };
  user: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; organization_id: true };
    }): Promise<{ id: string; organization_id: string | null }[]>;
  };
}

/**
 * The REAL enumeration: every ACTIVE sequence that has at least one step still due (SCHEDULED/DEFERRED
 * and scheduled_at <= now), joined to its rep's org + the org's sending domain. Read LAZILY via the
 * shared prisma singleton (constructed only inside a handler tick, never at module scope). Sequences
 * whose rep has no organization are still enumerated (organizationId ''); their EMAIL/SMS_PLATFORM
 * steps then fail closed downstream in the gate, never send.
 */
export class PrismaDueSequenceStore implements DueSequenceStore {
  constructor(
    private db: PrismaLike = prisma as unknown as PrismaLike,
    private resolveDomain: (organizationId: string) => Promise<string | null> = async () => null
  ) {}

  async listDueSequences(now: Date): Promise<DueSequence[]> {
    const sequences = await this.db.outreachSequence.findMany({
      where: { state: 'ACTIVE' },
      select: {
        id: true,
        user_id: true,
        // Only sequences with a genuinely-due step are worth a tick — cheap filter (take: 1).
        steps: {
          where: { status: { in: ['SCHEDULED', 'DEFERRED'] }, scheduled_at: { lte: now } },
          select: { id: true },
          take: 1,
        },
      },
      take: MAX_SEQUENCES_PER_TICK,
    });
    const due = sequences.filter((s) => s.steps.length > 0);
    if (due.length === 0) return [];

    const userIds = [...new Set(due.map((s) => s.user_id))];
    const users = await this.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, organization_id: true },
    });
    const orgByUser = new Map(users.map((u) => [u.id, u.organization_id]));

    // Resolve each distinct org's sending domain once.
    const domainByOrg = new Map<string, string | null>();
    for (const orgId of new Set([...orgByUser.values()].filter((o): o is string => !!o))) {
      domainByOrg.set(orgId, await this.resolveDomain(orgId));
    }

    return due.map((s) => {
      const organizationId = orgByUser.get(s.user_id) ?? '';
      return {
        sequenceId: s.id,
        userId: s.user_id,
        organizationId,
        sendingDomain: organizationId ? domainByOrg.get(organizationId) ?? null : null,
      };
    });
  }
}

/** Test/dev store: no DB, no infra. */
export class InMemoryDueSequenceStore implements DueSequenceStore {
  due: DueSequence[] = [];
  async listDueSequences(): Promise<DueSequence[]> {
    return this.due;
  }
}

export interface ScheduledSequenceRunDeps {
  store: DueSequenceStore;
  /** REQUIRED — the fully-gated `SequenceService`. Production (messaging-inngest-functions.ts) passes
   *  `buildSequenceService()`; tests pass a real `SequenceService` over an in-memory prisma (or a fake
   *  runner). Deliberately no default: a silently-defaulted runner in production would look like it
   *  worked while firing nothing, which is worse than a loud requirement (mirrors the durable queue). */
  runner: SequenceRunner;
  clock?: () => Date;
}

export interface ScheduledSequenceRunResult {
  ok: boolean;
  sequencesConsidered: number;
  /** Steps that actually SENT across all sequences this tick (SENT status from each RunSummary). */
  stepsSent: number;
  perSequence: { sequenceId: string; state: string; sent: number; processed: number }[];
  skippedReason?: string;
}

function emptyResult(reason: string): ScheduledSequenceRunResult {
  return { ok: false, sequencesConsidered: 0, stepsSent: 0, perSequence: [], skippedReason: reason };
}

/**
 * The scheduled cadence pass: enumerate due ACTIVE sequences, fire each due step through the fully-
 * gated `SequenceService.runDueSteps`. Fail-safe: a broken enumeration store, or a single sequence
 * throwing, never crashes the pass — it logs and continues / no-ops. Every send is the seam's, gated.
 */
export async function runDueSequences(deps: ScheduledSequenceRunDeps): Promise<ScheduledSequenceRunResult> {
  if (!deps || !deps.runner || !deps.store) {
    // eslint-disable-next-line no-console
    console.error('[messaging][sequence-run] missing store/runner; no-op.');
    return emptyResult('no_runner');
  }

  const clock = deps.clock ?? (() => new Date());
  const now = clock();

  let due: DueSequence[];
  try {
    due = await deps.store.listDueSequences(now);
  } catch (err) {
    // §4.6 doctrine: an unreachable DB / enumeration hiccup is a graceful no-op, never a crash.
    // eslint-disable-next-line no-console
    console.error('[messaging][sequence-run] enumeration unavailable this tick; graceful no-op.', err);
    return emptyResult('infra_unavailable');
  }

  const perSequence: ScheduledSequenceRunResult['perSequence'] = [];
  let stepsSent = 0;

  for (const seq of due) {
    try {
      const ctx: RunContext = { organizationId: seq.organizationId, sendingDomain: seq.sendingDomain };
      const summary = await deps.runner.runDueSteps(seq.userId, seq.sequenceId, ctx, now);
      stepsSent += summary.sent;
      perSequence.push({
        sequenceId: seq.sequenceId,
        state: summary.state,
        sent: summary.sent,
        processed: summary.processed,
      });
    } catch (err) {
      // One sequence's failure must never abort the whole tick — record it and move on.
      // eslint-disable-next-line no-console
      console.error(`[messaging][sequence-run] sequence ${seq.sequenceId} errored this tick; skipping.`, err);
      perSequence.push({ sequenceId: seq.sequenceId, state: 'ERROR', sent: 0, processed: 0 });
    }
  }

  return { ok: true, sequencesConsidered: due.length, stepsSent, perSequence };
}
