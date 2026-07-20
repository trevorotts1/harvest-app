// T-R14 (LAUNCH-GATE remediation, master-spec §4 "the agent layer ... scheduled/evented jobs" and
// the "24/7 / while you slept" autonomous-run premise) — the SCHEDULED (cron-triggered) dispatch
// pass. Before this unit, the ONLY way an agent job reached the durable queue was the session-gated,
// user-invoked POST /api/agents/dispatch (dispatch/route.ts) or the single EVENT-triggered
// `agentDispatchFunction` (inngest-functions.ts) — there was no autonomous trigger at all, which
// directly contradicts the product's "while you slept" premise. This file is that missing trigger's
// pure, package-free HANDLER LOGIC — unit-testable with no live Inngest server and no live DB (same
// separation-of-concerns convention as durable-queue.ts/dispatch.ts: the Inngest `{ cron: ... }`
// wrapper lives in inngest-functions.ts, which imports the `inngest` package and just calls
// `runScheduledDispatch` inside one `step.run(...)`).
//
// What this does NOT do (by design — "CONSUME, don't fork"):
//   • It does not re-implement agent execution. Every unit of due work is enqueued through the
//     EXISTING `DurableQueue.send()` boundary (durable-queue.ts) — the real production wiring
//     (inngest-functions.ts) passes `new InngestDurableQueue()`, which is the exact same producer
//     the user-invoked dispatch route already uses. From there it flows through the unmodified
//     `agentDispatchFunction` → `dispatchAgentJob` → `AgentRuntime.runAgent`, so every existing
//     guard (idempotency, per-contact do-not-contact/agents_paused, the CFE fail-closed gate) still
//     applies exactly as it does today.
//   • It does not re-implement the WP03 readiness/priority-tier engine. "Due" here is a deliberately
//     simple, generic outreach-cadence + pipeline-stage predicate over fields that already exist on
//     `Contact` (do_not_contact/agents_paused/pipeline_stage/last_contact_date) — enough to prove a
//     real, tenant-correct, non-fabricated autonomous trigger exists, without touching WP03's own
//     (separately-owned) prioritized-queue lane.
//
// Cadence chosen (documented, per the build brief):
//   • The Inngest function this wraps runs HOURLY (`0 * * * *`, see inngest-functions.ts). Because
//     every unit of due work carries a PER-UTC-DAY idempotency key (`scheduledIdempotencyKey`
//     below), an hourly tick is a liveness/catch-up mechanism, not the cadence itself — a given
//     rep/contact/agent combination fires AT MOST once per UTC day no matter how often the cron
//     ticks, and a rep whose pass is skipped one hour (RunGate denial, transient infra hiccup) is
//     naturally retried the next hour. This is what makes the "24/7, while you slept" premise real:
//     the wave lands sometime overnight (UTC) rather than needing a precise midnight-exact trigger.
//   • §10.4 note (carried from the build brief): this scheduler triggers agent RUNS, which produce
//     CFE-gated DraftMessage rows sitting in the Approval Inbox — it does not send anything itself.
//     Recipient-timezone quiet hours (§10.4) are a SEND-time gate (SendComplianceGate, downstream of
//     human approval); they are correctly out of scope here, exactly as the CFE is out of scope here
//     (both are downstream, unmodified, and still fully in effect).
//
// Guards (§4.5/§4.6) — respected TWICE, deliberately:
//   1. HERE, before enqueueing anything: the scheduler consults the SAME T-31 `RunGate` the
//      user-invoked path relies on (`BudgetKillSwitchRunGate` by default) once per rep, so a
//      killed/over-budget rep is skipped outright — not even an event reaches the queue for them.
//   2. AGAIN downstream, inside the unmodified `AgentRuntime.runAgent` (agent-runtime.ts step 3) —
//      belt-and-suspenders, and the reason a scheduled dispatch can never bypass a guard the
//      user-invoked path also has to clear.
//
// Idempotency: reuses the EXISTING `IdempotencyLog` table/pattern (T-30 store.ts) — this module never
// writes to it (only the real `AgentRuntime.runAgent` run ever calls `markProcessed`, at a genuine
// terminal outcome); it only READS it (`wasAlreadyDispatched`) to avoid re-enqueueing a due unit that
// has already reached the queue for today, so two scheduler passes (or a caught-up hourly tick after
// a skip) never double-dispatch the same due work.

import type { IntensitySetting, PipelineStage } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { criticalityFor } from './agent-runtime';
import {
  BudgetKillSwitchRunGate,
  BudgetKillSwitchStore,
  PrismaBudgetKillSwitchStore,
  startOfUtcDay,
} from './cost-killswitch';
import type { AgentDispatchEventData, DurableQueue } from './durable-queue';
import { AgentKey, getAgentSpec } from './runtime-model-map';
import { RunGate } from './seams';

// ── Inngest function config (defined here, package-free, so tests can assert it without importing
// `inngest` — same convention as AGENT_DISPATCH_FUNCTION_ID/AGENT_DISPATCH_EVENT in durable-queue.ts).
// The actual `inngest.createFunction({ cron: SCHEDULED_AGENT_DISPATCH_CRON }, ...)` registration
// lives in inngest-functions.ts (imports the `inngest` package, so it is NOT reachable from Jest —
// "the cron registration itself is config," unit-tested here only as a stable, asserted value).
export const SCHEDULED_AGENT_DISPATCH_FUNCTION_ID = 'agent-scheduled-dispatch' as const;
/** Hourly. See the file doc comment above ("Cadence chosen") for the full rationale. */
export const SCHEDULED_AGENT_DISPATCH_CRON = '0 * * * *' as const;

// ── Triggers (persisted on AgentRun.trigger / the dispatch event) ────────────────────────────────
export const SCHEDULED_TRIGGER_CONTACT = 'scheduled_cron_contact' as const;
export const SCHEDULED_TRIGGER_BRIEFING = 'scheduled_cron_briefing' as const;

/**
 * §4.2: "Intensity governs run frequency and daily action caps ... Low/Medium/High ≈ 2/5/10 new
 * community introductions per day." Reused here as the scheduled pass's per-rep daily cap on NEW
 * contact-bound autonomous dispatches — additive to (never a substitute for) the dollar-denominated
 * budget ceiling T-31's RunGate already enforces downstream. Keeps a High-intensity rep's overnight
 * wave bounded even before a single token is spent.
 */
export const SCHEDULED_ACTION_CAP_BY_INTENSITY: Record<IntensitySetting, number> = {
  LOW: 2,
  MEDIUM: 5,
  HIGH: 10,
};

/** A contact untouched for this many days (or never touched) is due for another autonomous pass. */
export const DEFAULT_OUTREACH_CADENCE_DAYS = 3;

/** Safety cap on rows fetched per rep per pass, ahead of the intensity cap trimming further. */
const MAX_DUE_CONTACTS_FETCHED_PER_REP = 50;

/**
 * Pipeline stage → the 24/7 parallel agent that owns it (§4.2 table). Stages the strictly-SEQUENTIAL
 * Appointment Setting Agent owns (APPOINTMENT_PROPOSED/APPOINTMENT_CONFIRMED/MET, §4.1 principle 3)
 * and DO_NOT_CONTACT are deliberately absent — `agentKeyForPipelineStage` returns null for them, and
 * this scheduler never touches those contacts.
 */
const PIPELINE_STAGE_TO_AGENT: Partial<Record<PipelineStage, AgentKey>> = {
  IDENTIFIED: AgentKey.PROSPECTING,
  INTRODUCED: AgentKey.PRE_SALE_NURTURE,
  RESPONDED: AgentKey.PRE_SALE_NURTURE,
  CLOSED_CLIENT: AgentKey.POST_SALE_NURTURE,
  CLOSED_RECRUIT: AgentKey.POST_SALE_NURTURE,
  DORMANT: AgentKey.INACTIVITY_REENGAGEMENT,
};

export function agentKeyForPipelineStage(stage: PipelineStage): AgentKey | null {
  return PIPELINE_STAGE_TO_AGENT[stage] ?? null;
}

/** Per-rep-per-agent-per-target-per-UTC-day — the cadence AND the dedup key are the same string. */
export function scheduledIdempotencyKey(agentKey: AgentKey, userId: string, target: string, dateKey: string): string {
  return `scheduled:${agentKey}:${userId}:${target}:${dateKey}`;
}

/** YYYY-MM-DD in UTC — the daily cadence/idempotency window. */
export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── The enumeration boundary (DI-mockable; same narrow-store convention as store.ts/budget-store.ts) ─

export interface DueRep {
  userId: string;
}

export interface DueContactCandidate {
  contactId: string;
  pipelineStage: PipelineStage;
}

export interface ScheduledDispatchStore {
  /** Every rep eligible for an autonomous pass at all (real, onboarded accounts only). */
  listDueReps(): Promise<DueRep[]>;
  /** Contacts belonging to (ONLY) `userId` — tenant boundary — not yet touched within the outreach
   *  cadence window and eligible for an autonomous run. */
  listDueContacts(userId: string, now: Date): Promise<DueContactCandidate[]>;
  /** Count of this rep's scheduled CONTACT-bound dispatches since `since` — what the §4.2 intensity
   *  action cap is enforced against cumulatively across repeated cron ticks in the same day. */
  countScheduledDispatchesToday(userId: string, since: Date): Promise<number>;
  /** Read-only reuse of the EXISTING IdempotencyLog pattern (T-30 store.ts) — true once the real
   *  `AgentRuntime.runAgent` (or a prior pass's enqueue that already reached a terminal outcome) has
   *  processed this exact key. This module never WRITES here — see the file doc comment. */
  wasAlreadyDispatched(idempotencyKey: string): Promise<boolean>;
}

// --- Narrow Prisma delegate shape (only what this store touches) --------------------------------

interface PrismaLike {
  user: {
    findMany(args: {
      where: { role: { in: ('REP' | 'DUAL')[] }; onboarding_status: 'GATED_COMPLETE' };
      select: { id: true };
    }): Promise<{ id: string }[]>;
  };
  contact: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true; pipeline_stage: true };
      take: number;
    }): Promise<{ id: string; pipeline_stage: PipelineStage }[]>;
  };
  agentRun: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  idempotencyLog: {
    findUnique(args: { where: { key: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
}

/** The real path: Postgres via the shared `@/lib/prisma` singleton, read LAZILY (constructed only
 *  when this class is instantiated inside a handler invocation, never at module scope). */
export class PrismaScheduledDispatchStore implements ScheduledDispatchStore {
  constructor(
    private db: PrismaLike = prisma as unknown as PrismaLike,
    private cadenceDays: number = DEFAULT_OUTREACH_CADENCE_DAYS
  ) {}

  async listDueReps(): Promise<DueRep[]> {
    // Tenant-correct by construction: REP/DUAL accounts own a personal warm-market Vault (Contact
    // rows keyed by user_id); UPLINE/RVP/ADMIN-only accounts are Mission Control roll-up viewers
    // (§9.6) with no personal 24/7 agent surface of their own. GATED_COMPLETE-only (§1.4): nothing
    // downstream of onboarding is reachable — and therefore nothing is autonomously actionable —
    // before that gate.
    const rows = await this.db.user.findMany({
      where: { role: { in: ['REP', 'DUAL'] }, onboarding_status: 'GATED_COMPLETE' },
      select: { id: true },
    });
    return rows.map((r) => ({ userId: r.id }));
  }

  async listDueContacts(userId: string, now: Date): Promise<DueContactCandidate[]> {
    const cutoff = new Date(now.getTime() - this.cadenceDays * 24 * 60 * 60 * 1000);
    const rows = await this.db.contact.findMany({
      where: {
        user_id: userId, // ← the tenant boundary; never omitted, never widened to `{ in: [...] }`
        do_not_contact: false,
        agents_paused: false,
        pipeline_stage: {
          notIn: ['DO_NOT_CONTACT', 'APPOINTMENT_PROPOSED', 'APPOINTMENT_CONFIRMED', 'MET'],
        },
        OR: [{ last_contact_date: null }, { last_contact_date: { lte: cutoff } }],
      },
      select: { id: true, pipeline_stage: true },
      take: MAX_DUE_CONTACTS_FETCHED_PER_REP,
    });
    return rows.map((r) => ({ contactId: r.id, pipelineStage: r.pipeline_stage }));
  }

  async countScheduledDispatchesToday(userId: string, since: Date): Promise<number> {
    return this.db.agentRun.count({
      where: { user_id: userId, trigger: SCHEDULED_TRIGGER_CONTACT, created_at: { gte: since } },
    });
  }

  async wasAlreadyDispatched(idempotencyKey: string): Promise<boolean> {
    const row = await this.db.idempotencyLog.findUnique({ where: { key: idempotencyKey }, select: { id: true } });
    return row !== null;
  }
}

/** Test/dev store: no DB, no infra. `idempotencyKeys` is a plain `Set<string>` a test can SHARE with
 *  an `InMemoryAgentRuntimeStore`'s own set of the same name, so an end-to-end test can prove real
 *  reuse of the one idempotency mechanism (enqueue → drain through the real runtime → re-run the
 *  scheduler and see it skip). */
export class InMemoryScheduledDispatchStore implements ScheduledDispatchStore {
  reps: DueRep[] = [];
  contactsByUser = new Map<string, DueContactCandidate[]>();
  idempotencyKeys: Set<string>;
  dispatchedTodayByUser = new Map<string, number>();

  constructor(opts: { idempotencyKeys?: Set<string> } = {}) {
    this.idempotencyKeys = opts.idempotencyKeys ?? new Set<string>();
  }

  async listDueReps(): Promise<DueRep[]> {
    return this.reps;
  }

  async listDueContacts(userId: string): Promise<DueContactCandidate[]> {
    return this.contactsByUser.get(userId) ?? [];
  }

  async countScheduledDispatchesToday(userId: string): Promise<number> {
    return this.dispatchedTodayByUser.get(userId) ?? 0;
  }

  async wasAlreadyDispatched(idempotencyKey: string): Promise<boolean> {
    return this.idempotencyKeys.has(idempotencyKey);
  }
}

// ── The scheduled pass itself ─────────────────────────────────────────────────────────────────────

export interface ScheduledDispatchDeps {
  store?: ScheduledDispatchStore;
  budgetStore?: BudgetKillSwitchStore;
  /** T-31 seam. Default = the REAL `BudgetKillSwitchRunGate` — a scheduled pass consults the exact
   *  same kill-switch/budget gate the user-invoked path does; it is never bypassed here. */
  runGate?: RunGate;
  /**
   * REQUIRED — the EXISTING durable-queue producer (never re-implemented here). Production callers
   * (inngest-functions.ts) pass `new InngestDurableQueue()`; tests pass `InMemoryDurableQueue`.
   * Deliberately no default: a silently-defaulted in-memory queue in production would look like it
   * worked while dispatching nothing real, which is worse than a loud requirement.
   */
  queue: DurableQueue;
  clock?: () => Date;
}

export interface ScheduledDispatchRepSummary {
  userId: string;
  gateAllowed: boolean;
  gateReason?: string;
  enqueued: number;
}

export interface ScheduledDispatchResult {
  ok: boolean;
  repsConsidered: number;
  repsSkippedByGate: number;
  unitsEnqueued: number;
  perRep: ScheduledDispatchRepSummary[];
  /** Set only on the fail-safe (missing queue / infra-unavailable) no-op path. */
  skippedReason?: string;
}

function emptyResult(reason: string): ScheduledDispatchResult {
  return { ok: false, repsConsidered: 0, repsSkippedByGate: 0, unitsEnqueued: 0, perRep: [], skippedReason: reason };
}

/**
 * The scheduled pass: enumerate due work, consult the RunGate, enqueue through the EXISTING durable
 * queue. Fail-safe (§4.6 doctrine extended to the scheduler): missing infra (no queue wired, an
 * unreachable DB, any enumeration error) never throws across this boundary — it logs and returns a
 * clean no-op result, exactly like every other "agents pause gracefully / nothing was lost" failure
 * mode already documented for this runtime. The next cron tick tries again.
 */
export async function runScheduledDispatch(deps: ScheduledDispatchDeps): Promise<ScheduledDispatchResult> {
  if (!deps.queue) {
    // A caller-wiring bug (a queue was not supplied), not a live-infra failure — still fail-safe.
    // eslint-disable-next-line no-console
    console.error('[agent-runtime][scheduled-dispatch] no durable queue supplied; no-op.');
    return emptyResult('no_queue');
  }

  const clock = deps.clock ?? (() => new Date());

  try {
    const now = clock();
    const store = deps.store ?? new PrismaScheduledDispatchStore();
    const budgetStore = deps.budgetStore ?? new PrismaBudgetKillSwitchStore();
    const runGate = deps.runGate ?? new BudgetKillSwitchRunGate({ store: budgetStore });

    const reps = await store.listDueReps();
    const perRep: ScheduledDispatchRepSummary[] = [];
    let unitsEnqueued = 0;
    let repsSkippedByGate = 0;

    for (const rep of reps) {
      const summary = await processRep(rep.userId, now, { store, budgetStore, runGate, queue: deps.queue });
      perRep.push(summary);
      unitsEnqueued += summary.enqueued;
      if (!summary.gateAllowed) repsSkippedByGate += 1;
    }

    return { ok: true, repsConsidered: reps.length, repsSkippedByGate, unitsEnqueued, perRep };
  } catch (err) {
    // §4.6: "Claude API outage: agents pause gracefully ... no fabricated briefings" / "Empty
    // prospect pool: log ... never fabricate contacts" — the same doctrine, applied to the
    // scheduler's own enumeration step. An unreachable DB or any other infra hiccup here must never
    // crash the scheduled function; it logs and exits as a clean no-op instead.
    // eslint-disable-next-line no-console
    console.error('[agent-runtime][scheduled-dispatch] infra unavailable this pass; graceful no-op.', err);
    return emptyResult('infra_unavailable');
  }
}

async function processRep(
  userId: string,
  now: Date,
  ctx: { store: ScheduledDispatchStore; budgetStore: BudgetKillSwitchStore; runGate: RunGate; queue: DurableQueue }
): Promise<ScheduledDispatchRepSummary> {
  // §4.5 — consult the SAME RunGate/kill-switch (T-31) the user-invoked path relies on, BEFORE this
  // rep gets so much as one enqueued event. A killed or over-budget rep is skipped OUTRIGHT here —
  // not merely deferred downstream — so a scheduled pass never even puts a job on the queue for them
  // (belt: here; suspenders: the unmodified `AgentRuntime.runAgent` consults it again, §4.5 step 3).
  //
  // Every agent this scheduler ever dispatches (REPORTING, PROSPECTING, PRE_SALE_NURTURE,
  // POST_SALE_NURTURE, INACTIVITY_REENGAGEMENT) is non-critical per `criticalityFor` (only
  // APPOINTMENT_SETTING is critical, and this scheduler never touches that agent/those pipeline
  // stages — see `agentKeyForPipelineStage`) — so ONE gate check per rep, probed with the Reporting
  // Agent's own real spec (never a synthetic/fake agent key), correctly represents the whole pass.
  const reportingSpec = getAgentSpec(AgentKey.REPORTING);
  const gateDecision = await ctx.runGate.check({
    userId,
    agentKey: AgentKey.REPORTING,
    criticality: criticalityFor(AgentKey.REPORTING),
    primaryTier: reportingSpec.primaryTier,
  });
  if (!gateDecision.allowed) {
    return { userId, gateAllowed: false, gateReason: gateDecision.reason, enqueued: 0 };
  }

  const dateKey = utcDateKey(now);
  let enqueued = 0;

  // 1) The Reporting Agent's overnight briefing/evening-recap (§4.2: "Parallel, scheduled") — the
  // single most literal "while you slept" surface. Rep-facing, not contact-bound; fires at most once
  // per rep per UTC day no matter how often the cron ticks (the per-day idempotency key IS the
  // cadence).
  const briefingKey = scheduledIdempotencyKey(AgentKey.REPORTING, userId, 'rep', dateKey);
  if (!(await ctx.store.wasAlreadyDispatched(briefingKey))) {
    await ctx.queue.send(dispatchEvent(AgentKey.REPORTING, userId, SCHEDULED_TRIGGER_BRIEFING, briefingKey));
    enqueued += 1;
  }

  // 2) The contact-bound 24/7 agents (Prospecting / Pre-Sale Nurture / Post-Sale Nurture / Inactivity
  // & Re-engagement), capped by the §4.2 intensity action cap.
  const repBudgetContext = await ctx.budgetStore.getRepBudgetContext(userId);
  const intensity: IntensitySetting = repBudgetContext?.intensitySetting ?? 'MEDIUM';
  const cap = SCHEDULED_ACTION_CAP_BY_INTENSITY[intensity];
  const alreadyToday = await ctx.store.countScheduledDispatchesToday(userId, startOfUtcDay(now));
  let remaining = Math.max(0, cap - alreadyToday);

  if (remaining > 0) {
    const dueContacts = await ctx.store.listDueContacts(userId, now);
    for (const candidate of dueContacts) {
      if (remaining <= 0) break;
      const agentKey = agentKeyForPipelineStage(candidate.pipelineStage);
      if (!agentKey) continue; // owned by another surface (e.g. the sequential Appointment Setting Agent) — not this cron's job
      const key = scheduledIdempotencyKey(agentKey, userId, candidate.contactId, dateKey);
      if (await ctx.store.wasAlreadyDispatched(key)) continue; // reuses the EXISTING IdempotencyLog pattern — no double-dispatch
      await ctx.queue.send(dispatchEvent(agentKey, userId, SCHEDULED_TRIGGER_CONTACT, key, candidate.contactId));
      enqueued += 1;
      remaining -= 1;
    }
  }

  return { userId, gateAllowed: true, enqueued };
}

function dispatchEvent(
  agentKey: AgentKey,
  userId: string,
  trigger: string,
  idempotencyKey: string,
  contactId?: string
): AgentDispatchEventData {
  return { agentKey, userId, trigger, idempotencyKey, contactId };
}
