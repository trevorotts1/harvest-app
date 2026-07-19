// T-34 (master-spec §9.8 "The Shift", uiux §5.3) — the bounded daily ritual's durable state:
// Open -> Work (one card at a time) -> Close -> explicit "You're done for today." Persists via a
// narrow, DI-mockable Prisma delegate (same convention as LearningStateService / MethodStateService)
// so tests supply an in-memory fake — no live database required.
//
// LANE NOTE: the Work-phase cards are read from real, pre-existing trunk models this build unit
// only reads/updates by id (DraftMessage, Appointment, User) — never T-30's agent-runtime internals
// or the CFE. Approving/declining a DraftMessage here writes the exact same
// `approval_state`/`approved_by`/`approved_at` columns the Approval Inbox (T-33) writes — the Work
// phase embeds the same item action, one at a time, per uiux §5.3 ("approve-with-inline-edit...
// embedded full-width") — it does not fork a second approval mechanism.
//
// SCOPE NOTE: uiux §5.3 names five Work-phase card types; this build unit populates the stack from
// the two that have a real, pre-existing backing model at this branch point (APPROVE_DRAFT from
// DraftMessage, CONFIRM_APPOINTMENT from Appointment). LOG_INTRODUCTION / MARK_ATTENDANCE are
// defined as first-class card/action types (so the ritual mechanics — one-at-a-time, skip, timer,
// close — are exercised identically once a future unit supplies real personal-introduction/
// attendance data) but are not synthesized here: no owning model exists yet in trunk, and inventing
// one would reach into WP08/WP09 territory outside this lane. AC-5.3-9 (empty queue still
// increments the streak) means an empty stack is an explicitly spec'd, correctly-handled state, not
// a gap.
//
// BUILD-SAFETY: the real `PrismaClient` is only ever instantiated as this class's constructor
// default parameter — created lazily per-request, never at module scope.

import { PrismaClient } from '@prisma/client';

import type {
  ShiftCardAction,
  ShiftCardType,
  ShiftMode,
  ShiftPhase,
  ShiftQueueCard,
  ShiftStateView,
} from '@/types/learning-state';

const SHORT_MODE_CAP = 3;
const GRACE_DAYS_PER_WEEK = 1;
const STANDARD_TARGET_SECONDS = 30 * 60;
const SHORT_TARGET_SECONDS = 10 * 60;

export interface ShiftSessionRow {
  id: string;
  user_id: string;
  session_date: string;
  mode: string;
  phase: string;
  stack_position: number;
  skip_counts: unknown;
  accumulated_seconds: number;
  last_resumed_at: Date | null;
  streak_count: number;
  grace_day_used: boolean;
  reflection_text: string | null;
  recap_approvals: number;
  recap_confirmations: number;
  recap_logs: number;
  completed_at: Date | null;
}

export interface DraftMessageQueueRow {
  id: string;
  user_id: string;
  body: string;
  channel: string;
  approval_state: string;
  cfe_outcome: string | null;
  created_at: Date;
}

export interface AppointmentQueueRow {
  id: string;
  rep_id: string;
  contact_id: string;
  status: string;
  proposed_windows: unknown;
  created_at: Date;
}

export interface ShiftPrismaClient {
  shiftSession: {
    findUnique(args: { where: { user_id_session_date: { user_id: string; session_date: string } } }): Promise<ShiftSessionRow | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<ShiftSessionRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<ShiftSessionRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ShiftSessionRow>;
  };
  draftMessage: {
    findMany(args: { where: Record<string, unknown> }): Promise<DraftMessageQueueRow[]>;
    findUnique(args: { where: { id: string } }): Promise<DraftMessageQueueRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<DraftMessageQueueRow>;
  };
  appointment: {
    findMany(args: { where: Record<string, unknown> }): Promise<AppointmentQueueRow[]>;
    findUnique(args: { where: { id: string } }): Promise<AppointmentQueueRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AppointmentQueueRow>;
  };
  user: {
    findUnique(args: { where: { id: string } }): Promise<{ intensity_setting: string } | null>;
  };
}

export class ShiftOwnershipError extends Error {
  constructor(message = 'That item does not belong to you.') {
    super(message);
    this.name = 'ShiftOwnershipError';
  }
}

/** T-34 QC fix — FAIL-CLOSED (master-spec §9.2/§18.6, uiux §5.2 "never sendable"): thrown by
 * `actionCard` when an 'APPROVE' is attempted on a DraftMessage whose `cfe_outcome` is not `PASS`
 * (i.e. `FLAG` or `BLOCK`). Mirrors the identical class of bug fixed in Mission Control's
 * `actOnQueueDraft` (T-32 QC fix, `src/services/mission-control/today.service.ts`) — the Shift's
 * Work-phase "Approve a draft" / "Respond to a flagged draft" cards shared ONE action handler with
 * no CFE check at all, so a FLAG or BLOCK-banded draft could be one-tap approved from the ritual
 * with no adjudication. This is DEFENSE IN DEPTH at the service layer: it holds even if the calling
 * UI (WorkPhase.tsx) is wrong, stale, or bypassed — the endpoint itself is the fail-closed
 * authority. Declining a flagged/blocked draft is NEVER gated — rejecting risky content is always
 * safe. Real adjudication (re-checked CFE, classifier drawer, edit-re-enters-CFE) is the Approval
 * Inbox's job (T-33, `/inbox` in main) — the Shift ritual only offers a deep-link there now; the
 * full inline-edit-in-Shift (embedding T-33's Approval Inbox Item component directly in the Work
 * phase) is DEFERRED to a post-merge integration tracked as T-R13, not built here. */
export class ShiftApprovalRequiresReviewError extends Error {
  constructor(
    message = 'This draft was flagged by compliance review and cannot be approved from the Shift ritual — review it in the Approval Inbox.'
  ) {
    super(message);
    this.name = 'ShiftApprovalRequiresReviewError';
  }
}

function todayDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function priorDateString(dateString: string): string {
  const d = new Date(`${dateString}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function isoWeekStart(dateString: string): string {
  const d = new Date(`${dateString}T00:00:00.000Z`);
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

function parseSkipCounts(raw: unknown): Record<string, number> {
  if (raw && typeof raw === 'object') return raw as Record<string, number>;
  return {};
}

export class ShiftService {
  constructor(
    private prisma: ShiftPrismaClient = new PrismaClient() as unknown as ShiftPrismaClient,
    private now: () => Date = () => new Date()
  ) {}

  /** Builds the real candidate stack for a rep from live DraftMessage + Appointment rows, ordered
   * by skip count (never-skipped first) then creation order, capped for short mode. Twice-skipped
   * items (skip count >= 2) are excluded — uiux §5.3: "twice-skipped items leave the Shift for
   * Today's queue." */
  private async buildCandidateStack(
    userId: string,
    skipCounts: Record<string, number>,
    mode: ShiftMode
  ): Promise<ShiftQueueCard[]> {
    const [drafts, appointments] = await Promise.all([
      this.prisma.draftMessage.findMany({ where: { user_id: userId, approval_state: 'PENDING' } }),
      this.prisma.appointment.findMany({ where: { rep_id: userId, status: 'PROPOSED' } }),
    ]);

    const draftCards: ShiftQueueCard[] = drafts.map((d) => {
      // T-34 QC fix: BLOCK is treated the same as FLAG here (both are non-PASS, both get the
      // RESPOND_FLAGGED card type) — defense in depth alongside actionCard's fail-closed check
      // below, even though in practice a BLOCK verdict is persisted as `approval_state: 'HELD'`
      // (agent-runtime.ts) and this query only ever fetches `approval_state: 'PENDING'` rows, so a
      // BLOCK draft does not currently reach this stack at all. Never assume that invariant here.
      const isNonPass = d.cfe_outcome === 'FLAG' || d.cfe_outcome === 'BLOCK';
      return {
        id: d.id,
        type: (isNonPass ? 'RESPOND_FLAGGED' : 'APPROVE_DRAFT') as ShiftCardType,
        title: isNonPass ? 'Respond to a flagged draft' : 'Approve a draft',
        detail: d.body,
        estimateMinutes: 1,
        cfeOutcome: d.cfe_outcome,
      };
    });
    const apptCards: ShiftQueueCard[] = appointments.map((a) => ({
      id: a.id,
      type: 'CONFIRM_APPOINTMENT' as ShiftCardType,
      title: 'Confirm an appointment window',
      detail: `Appointment ${a.id} awaiting your confirmation.`,
      estimateMinutes: 1,
      cfeOutcome: null,
    }));

    const all = [...draftCards, ...apptCards].filter((c) => (skipCounts[c.id] ?? 0) < 2);
    all.sort((a, b) => (skipCounts[a.id] ?? 0) - (skipCounts[b.id] ?? 0));

    return mode === 'SHORT' ? all.slice(0, SHORT_MODE_CAP) : all;
  }

  private computeElapsedSeconds(row: ShiftSessionRow): number {
    if (row.phase === 'WORK' && row.last_resumed_at) {
      const live = Math.floor((this.now().getTime() - row.last_resumed_at.getTime()) / 1000);
      return row.accumulated_seconds + Math.max(0, live);
    }
    return row.accumulated_seconds;
  }

  private async toView(row: ShiftSessionRow): Promise<ShiftStateView> {
    const skipCounts = parseSkipCounts(row.skip_counts);
    const mode = row.mode as ShiftMode;
    const stack = await this.buildCandidateStack(row.user_id, skipCounts, mode);
    const isEmpty = stack.length === 0;

    const graceDayAvailable = await this.isGraceDayAvailable(row.user_id, row.session_date);
    const graceDayOffer = await this.computeGraceDayOffer(row.user_id, row.session_date, row.phase, graceDayAvailable);

    return {
      phase: row.phase as ShiftPhase,
      mode,
      stackPosition: row.stack_position,
      stack,
      elapsedSeconds: this.computeElapsedSeconds(row),
      targetSeconds: mode === 'SHORT' ? SHORT_TARGET_SECONDS : STANDARD_TARGET_SECONDS,
      streakCount: row.streak_count,
      graceDayUsed: row.grace_day_used,
      graceDayAvailable,
      graceDayOffer,
      reflectionText: row.reflection_text,
      briefingLines: isEmpty
        ? ['Nothing needs you today — your field is working.']
        : [`${stack.length} item${stack.length === 1 ? '' : 's'} ready for your review.`],
      motivationalLine: 'Small, steady attention compounds. Show up — that is the whole job today.',
      recap:
        row.phase === 'CLOSE' || row.phase === 'DONE'
          ? { approvals: row.recap_approvals, confirmations: row.recap_confirmations, logs: row.recap_logs }
          : null,
      isEmpty,
    };
  }

  private async isGraceDayAvailable(userId: string, sessionDate: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.intensity_setting !== 'LOW') return false;
    const weekStart = isoWeekStart(sessionDate);
    const weekSessions = await this.prisma.shiftSession.findMany({
      where: { user_id: userId, session_date: { gte: weekStart } },
    });
    const usedThisWeek = weekSessions.filter((s) => s.grace_day_used).length;
    return usedThisWeek < GRACE_DAYS_PER_WEEK;
  }

  /** uiux §5.3 "Grace day: if yesterday broke a streak and a grace day is available ... the Open
   * screen surfaces it ... automatically, before the rep can feel the loss." Only ever true on the
   * still-OPEN phase — once the rep begins/closes, the actual repair decision happens in `close()`. */
  private async computeGraceDayOffer(
    userId: string,
    sessionDate: string,
    phase: string,
    graceDayAvailable: boolean
  ): Promise<boolean> {
    if (phase !== 'OPEN' || !graceDayAvailable) return false;
    const priorDate = priorDateString(sessionDate);
    const priorRow = await this.prisma.shiftSession.findUnique({
      where: { user_id_session_date: { user_id: userId, session_date: priorDate } },
    });
    const priorBroken = Boolean(priorRow) && priorRow!.phase !== 'DONE';
    return priorBroken;
  }

  /** Fetches (creating if needed) today's ShiftSession. An empty candidate stack auto-collapses
   * Open straight to Close (uiux AC-5.3-9), never lingering on an empty Work phase. */
  async getOrCreateToday(userId: string, requestedMode: ShiftMode = 'STANDARD'): Promise<ShiftStateView> {
    const sessionDate = todayDateString(this.now());
    let row = await this.prisma.shiftSession.findUnique({
      where: { user_id_session_date: { user_id: userId, session_date: sessionDate } },
    });
    if (!row) {
      row = await this.prisma.shiftSession.create({
        data: { user_id: userId, session_date: sessionDate, mode: requestedMode, phase: 'OPEN' },
      });
    }
    return this.toView(row);
  }

  /** Open -> Work (or straight to Close if the real queue is empty, AC-5.3-9). Idempotent. */
  async begin(userId: string): Promise<ShiftStateView> {
    const sessionDate = todayDateString(this.now());
    const row = await this.prisma.shiftSession.findUnique({
      where: { user_id_session_date: { user_id: userId, session_date: sessionDate } },
    });
    if (!row) throw new Error('No shift session for today — call getOrCreateToday first.');
    if (row.phase !== 'OPEN') return this.toView(row);

    const skipCounts = parseSkipCounts(row.skip_counts);
    const stack = await this.buildCandidateStack(userId, skipCounts, row.mode as ShiftMode);
    const nextPhase: ShiftPhase = stack.length === 0 ? 'CLOSE' : 'WORK';
    const updated = await this.prisma.shiftSession.update({
      where: { id: row.id },
      data: { phase: nextPhase, last_resumed_at: nextPhase === 'WORK' ? this.now() : null },
    });
    return this.toView(updated);
  }

  /** Acts on one card (uiux §5.3: "presents exactly one card at a time"). Ownership is enforced by
   * looking the backing row up and checking it belongs to `userId` before any mutation — never
   * trusting the caller. */
  async actionCard(userId: string, cardId: string, action: ShiftCardAction): Promise<ShiftStateView> {
    const sessionDate = todayDateString(this.now());
    const row = await this.prisma.shiftSession.findUnique({
      where: { user_id_session_date: { user_id: userId, session_date: sessionDate } },
    });
    if (!row) throw new Error('No shift session for today — call getOrCreateToday first.');

    const skipCounts = parseSkipCounts(row.skip_counts);
    let recapApprovals = row.recap_approvals;
    let recapConfirmations = row.recap_confirmations;
    let recapLogs = row.recap_logs;

    if (action === 'SKIP') {
      skipCounts[cardId] = (skipCounts[cardId] ?? 0) + 1;
    } else {
      // Ownership check + the actual mutation, scoped to whichever real model this card is.
      const draft = await this.prisma.draftMessage.findUnique({ where: { id: cardId } });
      if (draft) {
        if (draft.user_id !== userId) throw new ShiftOwnershipError();
        if (action === 'APPROVE') {
          // T-34 QC FIX — FAIL-CLOSED: a draft whose CFE outcome is not PASS (FLAG or BLOCK) can
          // NEVER be approved through the Shift ritual's action endpoint — only a clean PASS draft
          // may be one-tap approved here. Mirrors T-32's `actOnQueueDraft` fix exactly. Declining
          // is still allowed below (never gated) — this refusal throws BEFORE any mutation and
          // before stack_position/recap counters advance, so the card stays in place for the rep
          // to actually deal with (decline, or leave it for the real Approval Inbox).
          if (draft.cfe_outcome !== 'PASS') throw new ShiftApprovalRequiresReviewError();
          await this.prisma.draftMessage.update({
            where: { id: cardId },
            data: { approval_state: 'APPROVED', approved_by: userId, approved_at: this.now() },
          });
          recapApprovals += 1;
        } else if (action === 'DECLINE') {
          await this.prisma.draftMessage.update({ where: { id: cardId }, data: { approval_state: 'DECLINED' } });
        }
      } else {
        const appt = await this.prisma.appointment.findUnique({ where: { id: cardId } });
        if (appt) {
          if (appt.rep_id !== userId) throw new ShiftOwnershipError();
          if (action === 'CONFIRM') {
            await this.prisma.appointment.update({ where: { id: cardId }, data: { status: 'CONFIRMED' } });
            recapConfirmations += 1;
          }
        } else if (action === 'LOG') {
          recapLogs += 1;
        }
      }
    }

    // If every real item has now been actioned/skipped-out, the Work phase is over — advance to
    // Close automatically (uiux §5.3: the stack never lingers empty in Work; the rep lands on the
    // recap screen the moment there is nothing left to review).
    const remaining = await this.buildCandidateStack(userId, skipCounts, row.mode as ShiftMode);
    const nextPhase: ShiftPhase = remaining.length === 0 && row.phase === 'WORK' ? 'CLOSE' : (row.phase as ShiftPhase);

    const updated = await this.prisma.shiftSession.update({
      where: { id: row.id },
      data: {
        stack_position: row.stack_position + 1,
        skip_counts: skipCounts,
        recap_approvals: recapApprovals,
        recap_confirmations: recapConfirmations,
        recap_logs: recapLogs,
        phase: nextPhase,
      },
    });
    return this.toView(updated);
  }

  /** Work/Close -> Close/Done: freezes elapsed time, applies the streak (with the automatic
   * grace-day repair, uiux §5.3 "surfaces it automatically") and reaches the explicit
   * "You're done for today" state (AC-5.3-3). */
  async close(userId: string, reflectionText?: string): Promise<ShiftStateView> {
    const sessionDate = todayDateString(this.now());
    const row = await this.prisma.shiftSession.findUnique({
      where: { user_id_session_date: { user_id: userId, session_date: sessionDate } },
    });
    if (!row) throw new Error('No shift session for today — call getOrCreateToday first.');

    const frozenSeconds = this.computeElapsedSeconds(row);

    const priorDate = priorDateString(sessionDate);
    const priorRow = await this.prisma.shiftSession.findUnique({
      where: { user_id_session_date: { user_id: userId, session_date: priorDate } },
    });
    const priorStreak = priorRow?.streak_count ?? 0;
    const priorCompleted = priorRow?.phase === 'DONE';
    // No prior session at all = a fresh start (day one), not a broken streak.
    const priorMissing = !priorRow;

    let streakCount: number;
    let graceDayUsed = false;
    if (priorCompleted || priorMissing) {
      streakCount = priorStreak + 1;
    } else if (await this.isGraceDayAvailable(userId, sessionDate)) {
      graceDayUsed = true;
      streakCount = priorStreak + 1;
    } else {
      streakCount = 1;
    }

    const updated = await this.prisma.shiftSession.update({
      where: { id: row.id },
      data: {
        phase: 'DONE',
        accumulated_seconds: frozenSeconds,
        last_resumed_at: null,
        streak_count: streakCount,
        grace_day_used: graceDayUsed,
        reflection_text: reflectionText ?? row.reflection_text,
        completed_at: this.now(),
      },
    });
    return this.toView(updated);
  }
}
