// T-45 (WP09 — master-spec §14.2/§14.3/§18.4; uiux §5.9 items 5-6) — the appointment/coaching-session
// booking orchestration: merges dual-calendar availability, atomically slot-locks a window (or
// proposes near-miss windows), and dispatches the EXISTING, UNMODIFIED Appointment Setting Agent
// (`src/services/agent-runtime`, Claude-only, CFE-gated) to draft the contact-facing confirmation/
// reschedule text. This module CONSUMES the agent runtime and the CFE — it never re-implements
// either (per the platform invariant "do not edit existing gate/compliance/runtime services").
//
// Every contact-bound message this module produces goes through `AgentRuntime.runAgent` with
// `agentKey: AgentKey.APPOINTMENT_SETTING`, which — unmodified — already: checks per-contact
// controls, checks the run gate, calls Sonnet 5 for the negotiation draft, runs the CFE synchronous
// gate (fail-closed), and creates a `DraftMessage` carrying its CFE band, landing in the EXISTING
// Approval Inbox for the rep's review (§14.3 "flagged for rep review, a human-in-the-loop
// compression point"; §14.6-6). This module never sends anything itself — it only ever proposes a
// draft into that already-gated pipeline.

import { AgentKey, AgentRuntime, type AgentJobResult } from '../agent-runtime';
import {
  DEFAULT_WORKING_HOURS,
  findFreeWindow,
  findNearMissWindows,
  type BusyWindow,
  type NearMissWindow,
  type TimeWindow,
  type WorkingHours,
} from './availability';
import { deterministicSlotLockId, isSlotTakenError } from './slot-lock';
import { decryptRequiredField, getContactEncryptionKey } from '../warm-market/vault/vault-encryption';

// ── Persistence seam ──────────────────────────────────────────────────────────────────────────────

export interface AppointmentRow {
  id: string;
  rep_id: string;
  trainer_id: string | null;
  contact_id: string;
  status: string;
  proposed_windows: unknown;
  confirmed_start: Date | null;
  confirmed_end: Date | null;
  governing_timezone: string | null;
  slot_lock_id: string | null;
  event_kind: string | null;
  dossier: unknown;
  organization_id?: string;
}

export interface CoachingSessionRow {
  id: string;
  organization_id: string;
  rep_id: string;
  trainer_id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  slot_lock_id: string | null;
}

export interface BookingPrismaClient {
  appointment: {
    create(args: { data: Record<string, unknown> }): Promise<AppointmentRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AppointmentRow>;
    findFirst(args: { where: Record<string, unknown> }): Promise<AppointmentRow | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<AppointmentRow[]>;
  };
  coachingSession: {
    create(args: { data: Record<string, unknown> }): Promise<CoachingSessionRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CoachingSessionRow>;
    findFirst(args: { where: Record<string, unknown> }): Promise<CoachingSessionRow | null>;
    findMany(args: { where: Record<string, unknown> }): Promise<CoachingSessionRow[]>;
  };
  calendarBusyBlock: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ starts_at: Date; ends_at: Date }[]>;
  };
  calendarLink: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ user_id: string; provider: string; status: string }[]>;
  };
  contact: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; user_id: string; first_name: string; timezone: string | null; interactions?: { id: string }[] } | null>;
  };
}

// ── Dispatch seam (the existing, unmodified agent runtime) ──────────────────────────────────────────

export type AgentDispatch = (input: {
  agentKey: AgentKey;
  userId: string;
  trigger: string;
  idempotencyKey: string;
  contactId?: string;
  task: string;
  channel?: 'SMS_HANDOFF' | 'SMS_PLATFORM' | 'EMAIL' | 'SOCIAL_DM' | 'IN_APP';
  contact?: { firstName?: string };
}) => Promise<AgentJobResult>;

/** The real dispatch, constructed LAZILY (only when actually invoked — never at module scope). */
function defaultDispatch(): AgentDispatch {
  return (input) => new AgentRuntime().runAgent(input);
}

// §14.4 "Schedule-flooding protection auto-limits coaching sessions to protect the 2-Hour CEO
// promise" — a documented, conservative weekly cap; see `proposeCoachingSession`'s flooding check.
export const MAX_COACHING_SESSIONS_PER_REP_PER_WEEK = 2;

const APPOINTMENT_DURATION_DEFAULT_MINUTES = 45;

function safeFirstName(contact: { first_name: string } | null): string | undefined {
  if (!contact) return undefined;
  try {
    return decryptRequiredField(contact.first_name, getContactEncryptionKey());
  } catch {
    return undefined; // missing encryption key / undecryptable — degrade to no personalization, never crash booking
  }
}

async function mergedBusyFor(
  prisma: BookingPrismaClient,
  userIds: string[],
  searchStart: Date,
  horizonDays: number
): Promise<BusyWindow[]> {
  const searchEnd = new Date(searchStart.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const [busyBlocks, appointments, coachingSessions] = await Promise.all([
    prisma.calendarBusyBlock.findMany({ where: { user_id: { in: userIds }, starts_at: { lt: searchEnd }, ends_at: { gt: searchStart } } }),
    prisma.appointment.findMany({
      where: {
        OR: [{ rep_id: { in: userIds } }, { trainer_id: { in: userIds } }],
        status: { in: ['PROPOSED', 'CONFIRMED'] },
        confirmed_start: { not: null },
      },
    }),
    prisma.coachingSession.findMany({
      where: { OR: [{ rep_id: { in: userIds } }, { trainer_id: { in: userIds } }], status: { in: ['PROPOSED', 'CONFIRMED'] } },
    }),
  ]);

  const busy: BusyWindow[] = busyBlocks.map((b) => ({ startsAt: b.starts_at, endsAt: b.ends_at }));
  for (const appt of appointments) {
    if (appt.confirmed_start && appt.confirmed_end) busy.push({ startsAt: appt.confirmed_start, endsAt: appt.confirmed_end });
  }
  for (const cs of coachingSessions) {
    busy.push({ startsAt: cs.starts_at, endsAt: cs.ends_at });
  }
  return busy;
}

/** True iff either party's Google Calendar connection is not CONNECTED — §14.3/§18.4's "disconnected
 *  calendar degrades to propose-only, never books blind." */
async function calendarDisconnectedFor(prisma: BookingPrismaClient, userIds: string[]): Promise<boolean> {
  const links = await prisma.calendarLink.findMany({ where: { user_id: { in: userIds }, provider: 'google' } });
  return userIds.some((id) => {
    const link = links.find((l) => l.user_id === id);
    return !link || link.status !== 'CONNECTED';
  });
}

// ── Closing Appointment (rep + trainer + contact) ──────────────────────────────────────────────────

export interface ProposeClosingAppointmentInput {
  repId: string;
  trainerId: string;
  contactId: string;
  organizationId: string;
  durationMinutes?: number;
  now?: Date;
  workingHours?: WorkingHours;
}

export type ProposeClosingAppointmentOutcome = 'booked' | 'proposed' | 'near_miss_proposed';

export interface ProposeClosingAppointmentResult {
  appointmentId: string;
  outcome: ProposeClosingAppointmentOutcome;
  window?: TimeWindow;
  nearMissWindows?: NearMissWindow[];
  calendarDisconnected: boolean;
  agentDispatch: AgentJobResult;
}

export class BookingService {
  constructor(
    private readonly prisma: BookingPrismaClient,
    private readonly dispatch: AgentDispatch = defaultDispatch()
  ) {}

  async proposeClosingAppointment(input: ProposeClosingAppointmentInput): Promise<ProposeClosingAppointmentResult> {
    const now = input.now ?? new Date();
    const durationMinutes = input.durationMinutes ?? APPOINTMENT_DURATION_DEFAULT_MINUTES;
    const contact = await this.prisma.contact.findUnique({ where: { id: input.contactId } });
    const governingTimezone = contact?.timezone ?? null;
    const firstName = safeFirstName(contact);

    const [merged, disconnected] = await Promise.all([
      mergedBusyFor(this.prisma, [input.repId, input.trainerId], now, 14),
      calendarDisconnectedFor(this.prisma, [input.repId, input.trainerId]),
    ]);

    const freeWindow = findFreeWindow({
      mergedBusy: merged,
      durationMinutes,
      searchStart: now,
      governingTimezone,
      workingHours: input.workingHours ?? DEFAULT_WORKING_HOURS,
    });

    const dossier = this.buildDossier(contact);

    // §14.3/§18.4: a disconnected calendar NEVER auto-books, even if a window looks free — the
    // engine cannot trust availability data it cannot currently verify.
    if (freeWindow && !disconnected) {
      const booked = await this.attemptSlotLockBooking(input, freeWindow, governingTimezone, dossier);
      if (booked) {
        const agentDispatch = await this.dispatch({
          agentKey: AgentKey.APPOINTMENT_SETTING,
          userId: input.repId,
          trigger: 'wp09_appointment_booked',
          idempotencyKey: `appt:${booked.id}:confirm`,
          contactId: input.contactId,
          contact: { firstName },
          task: `Confirm the closing appointment window (${freeWindow.startsAt.toISOString()} to ${freeWindow.endsAt.toISOString()}, ${governingTimezone ?? 'the contact\'s timezone'}) warmly and clearly, with the safe, doctrine-clean introduction voice.`,
        });
        return { appointmentId: booked.id, outcome: 'booked', window: freeWindow, calendarDisconnected: false, agentDispatch };
      }
      // Lost the atomic slot-lock race — fall through to a near-miss proposal rather than retry
      // forever (§14.3 "loser auto-proposes the next window").
    }

    const nearMiss = findNearMissWindows({ mergedBusy: merged, durationMinutes, searchStart: now, governingTimezone });
    const appointment = await this.prisma.appointment.create({
      data: {
        rep_id: input.repId,
        trainer_id: input.trainerId,
        contact_id: input.contactId,
        proposed_windows: nearMiss.length > 0 ? nearMiss : freeWindow ? [freeWindow] : [],
        governing_timezone: governingTimezone,
        status: 'PROPOSED',
        event_kind: 'closing_appointment',
        dossier: { ...dossier, calendar_disconnected: disconnected },
      },
    });

    const outcome: ProposeClosingAppointmentOutcome = disconnected && freeWindow ? 'proposed' : 'near_miss_proposed';
    const windowsForTask = nearMiss.length > 0 ? nearMiss : freeWindow ? [freeWindow] : [];
    const agentDispatch = await this.dispatch({
      agentKey: AgentKey.APPOINTMENT_SETTING,
      userId: input.repId,
      trigger: disconnected ? 'wp09_calendar_disconnected_propose_only' : 'wp09_no_overlap_near_miss',
      idempotencyKey: `appt:${appointment.id}:propose`,
      contactId: input.contactId,
      contact: { firstName },
      task: disconnected
        ? 'Propose these candidate times for a closing appointment, and note we will confirm once availability is verified (calendar disconnected).'
        : `No fully-open window in the next 14 days — propose the top ${windowsForTask.length} closest-fit times for a closing appointment and ask which works best.`,
    });

    return {
      appointmentId: appointment.id,
      outcome,
      nearMissWindows: nearMiss.length > 0 ? nearMiss : undefined,
      window: nearMiss.length === 0 ? freeWindow ?? undefined : undefined,
      calendarDisconnected: disconnected,
      agentDispatch,
    };
  }

  /** §14.3/§18.4 atomic slot-lock: a deterministic id keyed on trainer+window means a concurrent
   *  attempt for the SAME trainer+window collides on the DB unique constraint — exactly one caller's
   *  `create()` succeeds. Returns `null` if this attempt lost the race. */
  private async attemptSlotLockBooking(
    input: ProposeClosingAppointmentInput,
    window: TimeWindow,
    governingTimezone: string | null,
    dossier: Record<string, unknown>
  ): Promise<AppointmentRow | null> {
    const slotLockId = deterministicSlotLockId(input.trainerId, window);
    try {
      return await this.prisma.appointment.create({
        data: {
          rep_id: input.repId,
          trainer_id: input.trainerId,
          contact_id: input.contactId,
          proposed_windows: [window],
          confirmed_start: window.startsAt,
          confirmed_end: window.endsAt,
          governing_timezone: governingTimezone,
          status: 'CONFIRMED',
          slot_lock_id: slotLockId,
          event_kind: 'closing_appointment',
          dossier,
        },
      });
    } catch (err) {
      if (isSlotTakenError(err)) return null;
      throw err;
    }
  }

  private buildDossier(contact: { interactions?: { id: string }[] } | null): Record<string, unknown> {
    const priorInteractionCount = contact?.interactions?.length ?? 0;
    return {
      generated_at: new Date().toISOString(),
      prior_interaction_count: priorInteractionCount,
      note: priorInteractionCount > 0
        ? `${priorInteractionCount} prior engagement signal(s) on file — open warm, reference the relationship, not a cold intro.`
        : 'First real touch with this contact — keep it warm and low-pressure.',
    };
  }

  /** §14.3 "trainer declines/cancels → automated, apologetic, CFE-cleared reschedule to the
   *  prospect." Marks the current row DECLINED, re-runs the booking search excluding the declined
   *  window, and dispatches a fresh, apologetic proposal — never leaves the contact hanging. */
  async declineAndReschedule(appointmentId: string, now: Date = new Date()): Promise<{ ok: true; rescheduled: ProposeClosingAppointmentResult } | { ok: false; reason: 'not_found' }> {
    const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId } });
    if (!appt || !appt.trainer_id) return { ok: false, reason: 'not_found' };

    await this.prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'DECLINED' } });

    const rescheduled = await this.proposeClosingAppointment({
      repId: appt.rep_id,
      trainerId: appt.trainer_id,
      contactId: appt.contact_id,
      organizationId: appt.organization_id ?? '',
      now,
    });
    return { ok: true, rescheduled };
  }

  /** Marks a past-due CONFIRMED appointment's real-world outcome. `no_show` is what the Field
   *  Trainer's Ratio panel (dashboard.service.ts) reads to count no-shows against the trainer
   *  honestly (§14.3/uiux §5.9 item 4). */
  async markAppointmentOutcome(appointmentId: string, outcome: 'completed' | 'no_show'): Promise<{ ok: true } | { ok: false; reason: 'not_found' }> {
    const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId } });
    if (!appt) return { ok: false, reason: 'not_found' };
    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: outcome === 'no_show' ? 'NO_SHOW' : 'HELD' },
    });
    return { ok: true };
  }

  // ── Coaching Session (rep + upline, no contact) — §14.2/§14.4 ────────────────────────────────────

  async proposeCoachingSession(input: {
    repId: string;
    trainerId: string;
    organizationId: string;
    durationMinutes?: number;
    timezone?: string;
    now?: Date;
  }): Promise<
    | { outcome: 'flooding_declined'; suggestion: string }
    | { outcome: 'booked'; sessionId: string; window: TimeWindow }
    | { outcome: 'near_miss_proposed'; sessionId: string; nearMissWindows: NearMissWindow[] }
  > {
    const now = input.now ?? new Date();
    const durationMinutes = input.durationMinutes ?? 30;
    const timezone = input.timezone ?? 'UTC';

    // §14.4 schedule-flooding protection: cap coaching sessions per rep per rolling week, protecting
    // the 2-Hour CEO promise — "suggesting field-active time over call-time."
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recent = await this.prisma.coachingSession.findMany({
      where: { rep_id: input.repId, status: { in: ['PROPOSED', 'CONFIRMED'] }, starts_at: { gte: weekAgo } },
    });
    if (recent.length >= MAX_COACHING_SESSIONS_PER_REP_PER_WEEK) {
      return {
        outcome: 'flooding_declined',
        suggestion: 'This rep already has enough coaching time booked this week — suggest field-active time (introductions, appointments) instead of another call.',
      };
    }

    const merged = await mergedBusyFor(this.prisma, [input.repId, input.trainerId], now, 14);
    const freeWindow = findFreeWindow({ mergedBusy: merged, durationMinutes, searchStart: now, governingTimezone: timezone });

    if (freeWindow) {
      const slotLockId = deterministicSlotLockId(input.trainerId, freeWindow);
      try {
        const session = await this.prisma.coachingSession.create({
          data: {
            organization_id: input.organizationId,
            rep_id: input.repId,
            trainer_id: input.trainerId,
            starts_at: freeWindow.startsAt,
            ends_at: freeWindow.endsAt,
            status: 'CONFIRMED',
            slot_lock_id: slotLockId,
          },
        });
        return { outcome: 'booked', sessionId: session.id, window: freeWindow };
      } catch (err) {
        if (!isSlotTakenError(err)) throw err;
        // Lost the race — fall through to a near-miss proposal instead of an unbounded retry loop.
      }
    }

    const nearMiss = findNearMissWindows({ mergedBusy: merged, durationMinutes, searchStart: now, governingTimezone: timezone });
    const session = await this.prisma.coachingSession.create({
      data: {
        organization_id: input.organizationId,
        rep_id: input.repId,
        trainer_id: input.trainerId,
        starts_at: nearMiss[0]?.startsAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000),
        ends_at: nearMiss[0]?.endsAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000 + durationMinutes * 60000),
        status: 'PROPOSED',
      },
    });
    return { outcome: 'near_miss_proposed', sessionId: session.id, nearMissWindows: nearMiss };
  }

  async respondToCoachingSession(
    sessionId: string,
    actingUserId: string,
    action: 'confirm' | 'decline'
  ): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_yours' }> {
    const session = await this.prisma.coachingSession.findFirst({ where: { id: sessionId } });
    if (!session) return { ok: false, reason: 'not_found' };
    if (session.rep_id !== actingUserId && session.trainer_id !== actingUserId) return { ok: false, reason: 'not_yours' };
    await this.prisma.coachingSession.update({
      where: { id: sessionId },
      data: { status: action === 'confirm' ? 'CONFIRMED' : 'DECLINED' },
    });
    return { ok: true };
  }
}
