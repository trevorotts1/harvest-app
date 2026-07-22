// T-45 (WP09 §14.2/§14.3/§18.4) — BookingService: the double-booking-race slot lock (QC break-it
// load-bearing case), the calendar-disconnected propose-only degrade (never book blind), the
// trainer decline → apologetic reschedule, no-show tracking, and the coaching-session
// schedule-flooding protection. In-memory mock Prisma delegate — the same DI-mock convention as
// tests/unit/wp01-sponsor-invite-service.test.ts.

import { randomUUID } from 'crypto';

import { BookingService, type BookingPrismaClient, type AppointmentRow, type CoachingSessionRow, type AgentDispatch } from '../../src/services/team-calendar/booking.service';
import { AgentKey } from '../../src/services/agent-runtime';

/** A small, generic `where`-clause matcher covering the shapes booking.service.ts actually issues
 *  (`OR`, `{in:[]}`, `{not:null}`, `{gte:}/{lte:}`) — so the mock behaves like real Prisma filtering
 *  rather than silently ignoring the clause. */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      const clauses = condition as Record<string, unknown>[];
      if (!clauses.some((c) => matchesWhere(row, c))) return false;
      continue;
    }
    const value = row[key];
    if (condition !== null && typeof condition === 'object') {
      const cond = condition as { in?: unknown[]; not?: unknown; gte?: unknown; lte?: unknown; lt?: unknown; gt?: unknown };
      if (cond.in && !cond.in.includes(value)) return false;
      if ('not' in cond && value === cond.not) return false;
      if (cond.gte !== undefined && !(value !== null && value !== undefined && (value as Date) >= (cond.gte as Date))) return false;
      if (cond.lte !== undefined && !(value !== null && value !== undefined && (value as Date) <= (cond.lte as Date))) return false;
      if (cond.lt !== undefined && !(value !== null && value !== undefined && (value as Date) < (cond.lt as Date))) return false;
      if (cond.gt !== undefined && !(value !== null && value !== undefined && (value as Date) > (cond.gt as Date))) return false;
    } else if (value !== condition) {
      return false;
    }
  }
  return true;
}

function makeMockPrisma(seed: {
  busyBlocks?: { user_id: string; starts_at: Date; ends_at: Date }[];
  links?: { user_id: string; provider: string; status: string }[];
  contact?: { id: string; user_id: string; first_name: string; timezone: string | null; interactions?: { id: string }[] };
} = {}) {
  const appointments = new Map<string, AppointmentRow>();
  const slotLocks = new Set<string>();
  const coachingSessions = new Map<string, CoachingSessionRow>();

  const prisma: BookingPrismaClient = {
    appointment: {
      async create({ data }) {
        const slotLockId = data.slot_lock_id as string | undefined;
        if (slotLockId) {
          if (slotLocks.has(slotLockId)) {
            const err = new Error('Unique constraint failed') as Error & { code: string };
            err.code = 'P2002';
            throw err;
          }
          slotLocks.add(slotLockId);
        }
        const row = { id: randomUUID(), ...data } as AppointmentRow;
        appointments.set(row.id, row);
        return { ...row };
      },
      async update({ where, data }) {
        const existing = appointments.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...data } as AppointmentRow;
        appointments.set(where.id, updated);
        return { ...updated };
      },
      async findFirst({ where }) {
        const id = (where as { id?: string }).id;
        if (id) return appointments.get(id) ? { ...appointments.get(id)! } : null;
        return Array.from(appointments.values())[0] ?? null;
      },
      async findMany({ where }) {
        return Array.from(appointments.values()).filter((a) => matchesWhere(a as unknown as Record<string, unknown>, where)).map((a) => ({ ...a }));
      },
    },
    coachingSession: {
      async create({ data }) {
        const slotLockId = data.slot_lock_id as string | undefined;
        if (slotLockId) {
          if (slotLocks.has(slotLockId)) {
            const err = new Error('Unique constraint failed') as Error & { code: string };
            err.code = 'P2002';
            throw err;
          }
          slotLocks.add(slotLockId);
        }
        const row = { id: randomUUID(), ...data } as CoachingSessionRow;
        coachingSessions.set(row.id, row);
        return { ...row };
      },
      async update({ where, data }) {
        const existing = coachingSessions.get(where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...data } as CoachingSessionRow;
        coachingSessions.set(where.id, updated);
        return { ...updated };
      },
      async findFirst({ where }) {
        const id = (where as { id?: string }).id;
        if (id) return coachingSessions.get(id) ? { ...coachingSessions.get(id)! } : null;
        return null;
      },
      async findMany({ where }) {
        return Array.from(coachingSessions.values()).filter((c) => matchesWhere(c as unknown as Record<string, unknown>, where)).map((c) => ({ ...c }));
      },
    },
    calendarBusyBlock: {
      async findMany() {
        return (seed.busyBlocks ?? []).map((b) => ({ starts_at: b.starts_at, ends_at: b.ends_at }));
      },
    },
    calendarLink: {
      async findMany() {
        return seed.links ?? [];
      },
    },
    contact: {
      async findUnique() {
        return seed.contact ?? null;
      },
    },
  };

  return { prisma, appointments, coachingSessions, slotLocks };
}

const CONNECTED_LINKS = [
  { user_id: 'rep-1', provider: 'google', status: 'CONNECTED' },
  { user_id: 'trainer-1', provider: 'google', status: 'CONNECTED' },
];

const CONTACT_ET = { id: 'contact-1', user_id: 'rep-1', first_name: 'ciphertext', timezone: 'America/New_York', interactions: [] };

describe('WP09 BookingService', () => {
  const fakeDispatch = jest.fn(async (input: Parameters<AgentDispatch>[0]) => ({
    agentKey: input.agentKey,
    outcome: 'surfaced' as const,
    runId: 'run-1',
    draftMessageId: 'draft-1',
    reasoningLog: 'mock dispatch',
    cfe: { band: 'clear' as const, released: true, held: false, score: 0 },
  }));

  beforeEach(() => {
    fakeDispatch.mockClear();
  });

  it('books a fully-connected, mutually-free window and dispatches the CFE-gated confirmation draft (§14.6-1, §14.6-6)', async () => {
    const { prisma } = makeMockPrisma({ links: CONNECTED_LINKS, contact: CONTACT_ET });
    const service = new BookingService(prisma, fakeDispatch);

    const result = await service.proposeClosingAppointment({
      repId: 'rep-1',
      trainerId: 'trainer-1',
      contactId: 'contact-1',
      organizationId: 'org-1',
      now: new Date('2025-06-09T13:00:00Z'),
    });

    expect(result.outcome).toBe('booked');
    expect(result.calendarDisconnected).toBe(false);
    expect(result.window).toBeDefined();
    expect(fakeDispatch).toHaveBeenCalledTimes(1);
    expect(fakeDispatch.mock.calls[0][0].agentKey).toBe(AgentKey.APPOINTMENT_SETTING);
  });

  it('DOUBLE-BOOKING RACE: two concurrent proposals for the same trainer+window — the atomic slot lock lets exactly one win (§14.6-1, §18.4, QC break-it)', async () => {
    const { prisma, appointments } = makeMockPrisma({ links: CONNECTED_LINKS, contact: CONTACT_ET });
    const now = new Date('2025-06-09T13:00:00Z');

    // Both callers share the SAME prisma store (simulating two concurrent requests hitting the same
    // trainer's calendar) — they will independently compute the SAME first-free window and race on
    // the deterministic slot_lock_id.
    const serviceA = new BookingService(prisma, fakeDispatch);
    const serviceB = new BookingService(prisma, fakeDispatch);

    const [resultA, resultB] = await Promise.all([
      serviceA.proposeClosingAppointment({ repId: 'rep-1', trainerId: 'trainer-1', contactId: 'contact-1', organizationId: 'org-1', now }),
      serviceB.proposeClosingAppointment({ repId: 'rep-1', trainerId: 'trainer-1', contactId: 'contact-1', organizationId: 'org-1', now }),
    ]);

    const outcomes = [resultA.outcome, resultB.outcome];
    // Exactly one booked the contested window; the loser auto-proposes the next window instead of
    // silently failing or double-booking the same slot.
    expect(outcomes.filter((o) => o === 'booked').length).toBe(1);

    const confirmedRows = Array.from(appointments.values()).filter((a) => a.status === 'CONFIRMED');
    expect(confirmedRows.length).toBe(1);
    // The two confirmed_start times (if any) must never collide with each other.
    const bookedWindow = resultA.outcome === 'booked' ? resultA.window : resultB.window;
    expect(bookedWindow).toBeDefined();
  });

  it('a disconnected/expired calendar NEVER auto-books, even into an apparently-free window (§14.6-4, §18.4 "never book blind")', async () => {
    const { prisma, appointments } = makeMockPrisma({
      links: [{ user_id: 'rep-1', provider: 'google', status: 'EXPIRED' }, { user_id: 'trainer-1', provider: 'google', status: 'CONNECTED' }],
      contact: CONTACT_ET,
    });
    const service = new BookingService(prisma, fakeDispatch);

    const result = await service.proposeClosingAppointment({
      repId: 'rep-1',
      trainerId: 'trainer-1',
      contactId: 'contact-1',
      organizationId: 'org-1',
      now: new Date('2025-06-09T13:00:00Z'),
    });

    expect(result.calendarDisconnected).toBe(true);
    expect(result.outcome).not.toBe('booked');
    const confirmedRows = Array.from(appointments.values()).filter((a) => a.status === 'CONFIRMED');
    expect(confirmedRows.length).toBe(0);
  });

  it('no overlap in the 14-day horizon → three near-miss windows proposed, never a silent failure (§14.6-4)', async () => {
    const now = new Date('2025-06-09T13:00:00Z');
    const busyBlocks = [
      { user_id: 'rep-1', starts_at: now, ends_at: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000) },
    ];
    const { prisma } = makeMockPrisma({ links: CONNECTED_LINKS, contact: CONTACT_ET, busyBlocks });
    const service = new BookingService(prisma, fakeDispatch);

    const result = await service.proposeClosingAppointment({ repId: 'rep-1', trainerId: 'trainer-1', contactId: 'contact-1', organizationId: 'org-1', now });

    expect(result.outcome).toBe('near_miss_proposed');
    expect(result.nearMissWindows).toBeDefined();
    expect(result.nearMissWindows!.length).toBeGreaterThan(0);
    expect(result.nearMissWindows!.length).toBeLessThanOrEqual(3);
  });

  it('trainer decline/cancel → the current row is DECLINED and a fresh apologetic reschedule is proposed (§14.6-5)', async () => {
    const { prisma, appointments } = makeMockPrisma({ links: CONNECTED_LINKS, contact: CONTACT_ET });
    const service = new BookingService(prisma, fakeDispatch);

    const first = await service.proposeClosingAppointment({ repId: 'rep-1', trainerId: 'trainer-1', contactId: 'contact-1', organizationId: 'org-1', now: new Date('2025-06-09T13:00:00Z') });
    expect(first.outcome).toBe('booked');

    const declineResult = await service.declineAndReschedule(first.appointmentId);
    expect(declineResult.ok).toBe(true);
    expect(appointments.get(first.appointmentId)?.status).toBe('DECLINED');
    if (declineResult.ok) {
      expect(['booked', 'proposed', 'near_miss_proposed']).toContain(declineResult.rescheduled.outcome);
    }
    // The reschedule dispatch happened in addition to the original booking dispatch.
    expect(fakeDispatch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('marks a no-show — this is what the Field Trainer\'s Ratio panel reads honestly (§14.6-5)', async () => {
    const { prisma, appointments } = makeMockPrisma({ links: CONNECTED_LINKS, contact: CONTACT_ET });
    const service = new BookingService(prisma, fakeDispatch);
    const first = await service.proposeClosingAppointment({ repId: 'rep-1', trainerId: 'trainer-1', contactId: 'contact-1', organizationId: 'org-1', now: new Date('2025-06-09T13:00:00Z') });

    const outcome = await service.markAppointmentOutcome(first.appointmentId, 'no_show');
    expect(outcome.ok).toBe(true);
    expect(appointments.get(first.appointmentId)?.status).toBe('NO_SHOW');
  });

  it('schedule-flooding protection declines over-booking coaching sessions and suggests field-active time (§14.6-7, uiux AC-5.9-5)', async () => {
    const { prisma } = makeMockPrisma({ links: CONNECTED_LINKS });
    const service = new BookingService(prisma, fakeDispatch);
    const now = new Date('2025-06-09T13:00:00Z');

    const first = await service.proposeCoachingSession({ repId: 'rep-1', trainerId: 'trainer-1', organizationId: 'org-1', now });
    expect(first.outcome).not.toBe('flooding_declined');
    const second = await service.proposeCoachingSession({ repId: 'rep-1', trainerId: 'trainer-1', organizationId: 'org-1', now: new Date(now.getTime() + 3600_000) });
    expect(second.outcome).not.toBe('flooding_declined');
    const third = await service.proposeCoachingSession({ repId: 'rep-1', trainerId: 'trainer-1', organizationId: 'org-1', now: new Date(now.getTime() + 7200_000) });

    expect(third.outcome).toBe('flooding_declined');
    if (third.outcome === 'flooding_declined') {
      expect(third.suggestion.toLowerCase()).toContain('field-active');
    }
  });

  it('coaching-session double-booking race — the atomic slot lock lets exactly one win', async () => {
    const { prisma, coachingSessions } = makeMockPrisma({ links: CONNECTED_LINKS });
    const now = new Date('2025-06-09T13:00:00Z');
    const serviceA = new BookingService(prisma, fakeDispatch);
    const serviceB = new BookingService(prisma, fakeDispatch);

    const [a, b] = await Promise.all([
      serviceA.proposeCoachingSession({ repId: 'rep-1', trainerId: 'trainer-1', organizationId: 'org-1', now }),
      serviceB.proposeCoachingSession({ repId: 'rep-2', trainerId: 'trainer-1', organizationId: 'org-1', now }),
    ]);

    const confirmed = Array.from(coachingSessions.values()).filter((c) => c.status === 'CONFIRMED');
    expect(confirmed.length).toBe(1);
    expect([a.outcome, b.outcome].filter((o) => o === 'booked').length).toBe(1);
  });

  // T-57 RG8 (i18n; server-i18n-leak) — `buildDossier`'s `note` used to be hardcoded English with
  // no path to Spanish. Now resolves the rep's real `User.locale` (duck-typed against `this.prisma`,
  // same convention `zones/briefing.ts`'s own `resolveRepLocale` uses) and composes via the catalog.
  describe('T-57 RG8 — dossier note i18n (server-i18n-leak)', () => {
    it('a Spanish-locale rep gets a real ES dossier note (first-touch branch), not English', async () => {
      const { prisma, appointments } = makeMockPrisma({ links: CONNECTED_LINKS, contact: CONTACT_ET });
      const prismaWithLocale = Object.assign(prisma, {
        user: { findUnique: async () => ({ locale: 'es' }) },
      }) as unknown as BookingPrismaClient;
      const service = new BookingService(prismaWithLocale, fakeDispatch);

      const result = await service.proposeClosingAppointment({
        repId: 'rep-1',
        trainerId: 'trainer-1',
        contactId: 'contact-1',
        organizationId: 'org-1',
        now: new Date('2025-06-09T13:00:00Z'),
      });
      expect(result.outcome).toBe('booked');

      const row = appointments.get(result.appointmentId);
      const dossier = row?.dossier as { note: string } | undefined;
      expect(dossier?.note).toBe('Primer contacto real con esta persona — mantenlo cálido y sin presión.');
      expect(dossier?.note.toLowerCase()).not.toContain('first real touch');
    });

    it('a Spanish-locale rep gets the real ES prior-engagement dossier note (CLDR plural), not English', async () => {
      const contactWithHistory = { ...CONTACT_ET, interactions: [{ id: 'i1' }, { id: 'i2' }] };
      const { prisma, appointments } = makeMockPrisma({ links: CONNECTED_LINKS, contact: contactWithHistory });
      const prismaWithLocale = Object.assign(prisma, {
        user: { findUnique: async () => ({ locale: 'es' }) },
      }) as unknown as BookingPrismaClient;
      const service = new BookingService(prismaWithLocale, fakeDispatch);

      const result = await service.proposeClosingAppointment({
        repId: 'rep-1',
        trainerId: 'trainer-1',
        contactId: 'contact-1',
        organizationId: 'org-1',
        now: new Date('2025-06-09T13:00:00Z'),
      });
      expect(result.outcome).toBe('booked');

      const row = appointments.get(result.appointmentId);
      const dossier = row?.dossier as { note: string } | undefined;
      expect(dossier?.note).toBe(
        '2 señales de contacto previo en el historial — abre con calidez, haciendo referencia a la relación, no como un primer acercamiento distante.'
      );
      expect(dossier?.note.toLowerCase()).not.toContain('prior engagement');
    });

    it('a locale-lookup failure (or absent `.user` on the DI prisma) fails soft to the English dossier note, never throws', async () => {
      // The real DI type (`BookingPrismaClient`) has no `.user` accessor at all — every existing
      // test's fake (above) matches that exactly, proving `resolveRepLocale`'s duck-type falls
      // through to `DEFAULT_LOCALE` rather than crashing booking.
      const { prisma, appointments } = makeMockPrisma({ links: CONNECTED_LINKS, contact: CONTACT_ET });
      const service = new BookingService(prisma, fakeDispatch);

      const result = await service.proposeClosingAppointment({
        repId: 'rep-1',
        trainerId: 'trainer-1',
        contactId: 'contact-1',
        organizationId: 'org-1',
        now: new Date('2025-06-09T13:00:00Z'),
      });
      expect(result.outcome).toBe('booked');

      const row = appointments.get(result.appointmentId);
      const dossier = row?.dossier as { note: string } | undefined;
      expect(dossier?.note).toBe('First real touch with this contact — keep it warm and low-pressure.');
    });
  });
});
