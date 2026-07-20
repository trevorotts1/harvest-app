// T-45 (WP09 — master-spec §14.4 "The RVP controls and populates the master calendar ... all reps
// below see it read-only"; §14.1 calendar connect/disconnect) — the team master calendar + personal
// calendar-link management. Replaces the earlier in-memory, non-persisted scaffold this file used to
// contain (unreachable from any route, and unable to survive across serverless invocations in the
// first place) with real, org-scoped Prisma persistence over the pre-existing `TeamEvent`/
// `Attendance`/`CalendarLink` models.
//
// RBAC note: this service does not itself enforce "only RVP may create a broadcast event" — that is
// the route layer's job (`withCapability('team_calendar_broadcast', 'write', ...)`,
// src/app/api/team/calendar/route.ts), consistent with this codebase's established separation (the
// service is the org-scoped data operation; the route is the authorization gate).

import { encryptCalendarToken, type CalendarCredential } from './token-vault';

export interface TeamEventRow {
  id: string;
  organization_id: string;
  owner_id: string;
  type: string;
  starts_at: Date;
  rsvp_enabled: boolean;
}

export interface AttendanceRow {
  id: string;
  event_id: string;
  user_id: string;
  state: string;
}

export interface CalendarLinkStatusRow {
  provider: string;
  status: string;
}

export interface TeamCalendarPrismaClient {
  teamEvent: {
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<TeamEventRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<TeamEventRow>;
  };
  attendance: {
    findMany(args: { where: Record<string, unknown> }): Promise<AttendanceRow[]>;
  };
  calendarLink: {
    findMany(args: { where: Record<string, unknown> }): Promise<CalendarLinkStatusRow[]>;
    upsert(args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
  };
  appointment: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ id: string; status: string; confirmed_start: Date | null; confirmed_end: Date | null; contact_id: string }[]>;
  };
  coachingSession: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ id: string; status: string; starts_at: Date; ends_at: Date; trainer_id: string }[]>;
  };
}

export class TeamCalendarService {
  constructor(private readonly prisma: TeamCalendarPrismaClient) {}

  /** §14.4: "all reps below see it read-only" — org-scoped, upcoming-first. */
  async listBroadcastEvents(organizationId: string, viewerId: string, now: Date = new Date()) {
    const events = await this.prisma.teamEvent.findMany({
      where: { organization_id: organizationId, starts_at: { gte: now } },
      orderBy: { starts_at: 'asc' },
    });
    const attendance = await this.prisma.attendance.findMany({ where: { event_id: { in: events.map((e) => e.id) }, user_id: viewerId } });
    const byEvent = new Map(attendance.map((a) => [a.event_id, a.state]));
    return events.map((e) => ({ ...e, myAttendanceState: byEvent.get(e.id) ?? 'none' }));
  }

  /** §14.4: RVP-only in practice (route-enforced) — opportunity nights, training, team calls, big events. */
  async createBroadcastEvent(organizationId: string, ownerId: string, type: string, startsAt: Date, rsvpEnabled: boolean): Promise<TeamEventRow> {
    return this.prisma.teamEvent.create({
      data: { organization_id: organizationId, owner_id: ownerId, type, starts_at: startsAt, rsvp_enabled: rsvpEnabled },
    });
  }

  // ── Personal calendar connect/disconnect (§14.1) ────────────────────────────────────────────────

  async getConnectionStatus(userId: string): Promise<CalendarLinkStatusRow[]> {
    return this.prisma.calendarLink.findMany({ where: { user_id: userId } });
  }

  /** Stores the credential SEALED via token-vault.ts — never plaintext, never at module scope
   *  (the encryption key is read lazily inside `encryptCalendarToken`). If the vault is
   *  unconfigured in this environment, the connection is recorded as `CONNECTED` in the DB but with
   *  no usable `token_ref` — every sync attempt then correctly resolves to `unconfigured` rather
   *  than fabricating a working connection (see google-sync.service.ts / caldav-sync.service.ts). */
  async connect(userId: string, provider: 'google' | 'caldav_ios', credential: CalendarCredential): Promise<{ ok: boolean; vaultConfigured: boolean }> {
    const tokenRef = encryptCalendarToken(credential);
    await this.prisma.calendarLink.upsert({
      where: { user_id_provider: { user_id: userId, provider } },
      create: { user_id: userId, provider, status: 'CONNECTED', token_ref: tokenRef },
      update: { status: 'CONNECTED', token_ref: tokenRef },
    });
    return { ok: true, vaultConfigured: tokenRef !== null };
  }

  async disconnect(userId: string, provider: 'google' | 'caldav_ios'): Promise<void> {
    await this.prisma.calendarLink.upsert({
      where: { user_id_provider: { user_id: userId, provider } },
      create: { user_id: userId, provider, status: 'REVOKED', token_ref: null },
      update: { status: 'REVOKED', token_ref: null },
    });
  }

  /** The rep/trainer's own merged agenda — closing appointments + coaching sessions within the
   *  horizon. Personal-only (own data), distinct from the upline's team-availability AGGREGATE
   *  (dashboard.service.ts), which never exposes an individual's agenda. */
  async getPersonalAgenda(userId: string, now: Date = new Date(), horizonDays = 30) {
    const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
    const [appointments, coachingSessions] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { OR: [{ rep_id: userId }, { trainer_id: userId }], confirmed_start: { gte: now, lte: horizonEnd } },
      }),
      this.prisma.coachingSession.findMany({
        where: { OR: [{ rep_id: userId }, { trainer_id: userId }], starts_at: { gte: now, lte: horizonEnd } },
      }),
    ]);
    return {
      appointments: appointments.map((a) => ({ id: a.id, kind: 'closing_appointment' as const, status: a.status, startsAt: a.confirmed_start?.toISOString() ?? null, endsAt: a.confirmed_end?.toISOString() ?? null })),
      coachingSessions: coachingSessions.map((c) => ({ id: c.id, kind: 'coaching_session' as const, status: c.status, startsAt: c.starts_at.toISOString(), endsAt: c.ends_at.toISOString() })),
    };
  }
}
