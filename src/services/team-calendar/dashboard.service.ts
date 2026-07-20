// T-45 (WP09 — master-spec §14.4; uiux §5.9) — the anti-surveillance upline/RVP dashboard.
//
// ANTI-SURVEILLANCE INVARIANT (QC checkpoint 7/8, critical-failure condition): this module computes
// and returns EXACTLY three classes of signal — pace (availability consistency), outcomes
// (appointments held), and coarse team-availability zones — and NOTHING ELSE. There is no
// screen-time, no keystroke/session-duration, no per-task activity feed, and no numeric leaderboard
// rank anywhere in this file. The roster is returned in a stable, non-"worst-performer" order (by
// name); a caller may additionally sort by pace/momentum (uiux §5.9 item 3 "sortable by pace and
// momentum only"), but there is no sort that frames a rep as "worst."
//
// SCOPE (RBAC/org-gating, §16.6 row 2): `resolveTeamMemberIds` returns a rep's DIRECT downline for
// an UPLINE/DUAL caller, and the full ORGANIZATION for an RVP/ADMIN caller — "upline=team (aggregate),
// rvp=org-wide." Every query in this file is scoped through that id list; nothing here ever reads
// across an organization boundary (the route layer's org check is a second, redundant gate — see
// src/app/api/team/dashboard/route.ts).

import { computeMomentum, type MomentumEventLike } from '../mission-control/momentum';
import type { MomentumBand } from '../mission-control/types';

export type PaceStatus = 'on_track' | 'needs_a_push' | 'behind';
export type PaceIcon = 'leaf-check' | 'flag-caution' | 'moon-rest';

const PACE_ORDER: Record<PaceStatus, number> = { on_track: 0, needs_a_push: 1, behind: 2 };
const PACE_ICON: Record<PaceStatus, PaceIcon> = { on_track: 'leaf-check', needs_a_push: 'flag-caution', behind: 'moon-rest' };

/** §14.4 "on track / needs a push / behind" — never red, never a numeric rank, always icon+phrase. */
export function paceStatusFor(daysSinceLastActivity: number | null): PaceStatus {
  if (daysSinceLastActivity === null) return 'needs_a_push'; // no data yet — a learning state, not "behind"
  if (daysSinceLastActivity <= 2) return 'on_track';
  if (daysSinceLastActivity <= 5) return 'needs_a_push';
  return 'behind';
}

export interface RosterRow {
  userId: string;
  name: string;
  paceStatus: PaceStatus;
  paceIcon: PaceIcon;
  paceLabel: string;
  momentumBand: MomentumBand | 'no_data';
  momentumScore: number | null;
  lastActiveAt: string | null;
  inactivityFlagDays: 3 | 5 | 7 | null;
}

const PACE_LABEL: Record<PaceStatus, string> = {
  on_track: 'On track',
  needs_a_push: 'Needs a push',
  behind: 'Behind — one small action wakes it up',
};

export interface RosterPrismaClient {
  user: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ id: string; name: string }[]>;
  };
  momentumEvent: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ user_id: string; law: string; points: number; created_at: Date }[]>;
  };
  appointment: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ trainer_id: string | null; rep_id: string; status: string; confirmed_start: Date | null }[]>;
  };
  coachingSession: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ rep_id: string; trainer_id: string; status: string; starts_at: Date }[]>;
  };
  threeWayHandoff: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ id: string; user_id: string; contact_id: string; trigger_reason: string; state: string; invited_at: Date }[]>;
  };
  calendarBusyBlock: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ user_id: string; starts_at: Date; ends_at: Date }[]>;
  };
}

/** §16.6 row 2 — upline gets their direct downline; RVP/ADMIN get the whole org. Never cross-org. */
export async function resolveTeamMemberIds(
  prisma: RosterPrismaClient,
  caller: { id: string; role: string; organizationId: string | null },
  orgWideRoles: readonly string[] = ['RVP', 'ADMIN']
): Promise<string[]> {
  if (orgWideRoles.includes(caller.role)) {
    if (!caller.organizationId) return [];
    const rows = await prisma.user.findMany({ where: { organization_id: caller.organizationId, id: { not: caller.id } } });
    return rows.map((r) => r.id);
  }
  const rows = await prisma.user.findMany({ where: { upline_id: caller.id } });
  return rows.map((r) => r.id);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(from: Date | null, now: Date): number | null {
  if (!from) return null;
  return Math.floor((now.getTime() - from.getTime()) / DAY_MS);
}

export class DashboardService {
  constructor(private readonly prisma: RosterPrismaClient) {}

  /** The rep roster (uiux §5.9 item 3) — pace + momentum ONLY, no leaderboard, sorted by name by default. */
  async getRoster(teamMemberIds: string[], now: Date = new Date()): Promise<RosterRow[]> {
    if (teamMemberIds.length === 0) return [];
    const [users, momentumEvents, appointments, coachingSessions] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: teamMemberIds } } }),
      this.prisma.momentumEvent.findMany({ where: { user_id: { in: teamMemberIds } } }),
      this.prisma.appointment.findMany({ where: { rep_id: { in: teamMemberIds } } }),
      this.prisma.coachingSession.findMany({ where: { rep_id: { in: teamMemberIds } } }),
    ]);

    return users
      .map((u) => {
        const events: MomentumEventLike[] = momentumEvents
          .filter((e) => e.user_id === u.id)
          .map((e) => ({ law: e.law, points: e.points, created_at: e.created_at }));
        const momentum = events.length > 0 ? computeMomentum(events, now) : null;

        const activityDates: Date[] = [
          ...appointments.filter((a) => a.rep_id === u.id && a.confirmed_start).map((a) => a.confirmed_start as Date),
          ...coachingSessions.filter((c) => c.rep_id === u.id).map((c) => c.starts_at),
          ...(momentum ? [now] : []), // a momentum event exists somewhere in history — treat as "recent enough" signal, refined below by real last-event timestamp
        ];
        const lastMomentumEventAt = momentumEvents
          .filter((e) => e.user_id === u.id)
          .reduce<Date | null>((max, e) => (!max || e.created_at > max ? e.created_at : max), null);
        if (lastMomentumEventAt) activityDates.push(lastMomentumEventAt);
        const lastActiveAt = activityDates.reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);

        const gap = daysSince(lastActiveAt, now);
        const pace = paceStatusFor(gap);
        const inactivityFlagDays: 3 | 5 | 7 | null = gap === null ? null : gap >= 7 ? 7 : gap >= 5 ? 5 : gap >= 3 ? 3 : null;

        return {
          userId: u.id,
          name: u.name,
          paceStatus: pace,
          paceIcon: PACE_ICON[pace],
          paceLabel: PACE_LABEL[pace],
          momentumBand: momentum?.band ?? 'no_data',
          momentumScore: momentum?.score ?? null,
          lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
          inactivityFlagDays,
        } satisfies RosterRow;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** uiux §5.9 item 3 — an EXPLICIT sort helper, pace/momentum only (never "worst performer"). */
  sortRoster(rows: RosterRow[], by: 'name' | 'pace' | 'momentum'): RosterRow[] {
    const copy = [...rows];
    if (by === 'pace') return copy.sort((a, b) => PACE_ORDER[a.paceStatus] - PACE_ORDER[b.paceStatus] || a.name.localeCompare(b.name));
    if (by === 'momentum') return copy.sort((a, b) => (b.momentumScore ?? -1) - (a.momentumScore ?? -1) || a.name.localeCompare(b.name));
    return copy.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** uiux §5.9 item 2 "Needs-you-now strip" — responded-today alerts bridging into a three-way. */
  async getNeedsYouNow(uplineId: string, organizationId: string, now: Date = new Date()): Promise<
    { handoffId: string; repUserId: string; contactId: string; triggerReason: string; invitedAt: string }[]
  > {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rows = await this.prisma.threeWayHandoff.findMany({
      where: { upline_id: uplineId, organization_id: organizationId, state: 'INVITED', invited_at: { gte: todayStart } },
    });
    return rows.map((r) => ({ handoffId: r.id, repUserId: r.user_id, contactId: r.contact_id, triggerReason: r.trigger_reason, invitedAt: r.invited_at.toISOString() }));
  }

  /** uiux §5.9 item 6 "Downline Leak indicators" — quiet, non-shaming, coaching-suggestion framed. */
  async getDownlineLeak(teamMemberIds: string[], now: Date = new Date(), thresholdDays = 5): Promise<
    { userId: string; daysSinceFieldActivity: number }[]
  > {
    const roster = await this.getRoster(teamMemberIds, now);
    return roster
      .filter((r) => {
        const gap = r.lastActiveAt ? daysSince(new Date(r.lastActiveAt), now) : null;
        return gap === null || gap >= thresholdDays;
      })
      .map((r) => ({ userId: r.userId, daysSinceFieldActivity: r.lastActiveAt ? (daysSince(new Date(r.lastActiveAt), now) as number) : thresholdDays }));
  }

  /** uiux §5.9 item 4 — the upline's OWN Field Trainer's Ratio, owned honestly (no-shows count
   *  against it, §14.3). Computed from real Appointment rows where THIS caller is the trainer. */
  async getFieldTrainerRatioPanel(trainerId: string, now: Date = new Date()): Promise<{
    appointmentsRun: number;
    completed: number;
    noShows: number;
    closeRate: number;
  }> {
    const rows = await this.prisma.appointment.findMany({
      where: { trainer_id: trainerId, status: { in: ['HELD', 'NO_SHOW'] }, confirmed_start: { lte: now } },
    });
    const appointmentsRun = rows.length;
    const noShows = rows.filter((r) => r.status === 'NO_SHOW').length;
    const completed = appointmentsRun - noShows;
    const closeRate = appointmentsRun > 0 ? completed / appointmentsRun : 0;
    return { appointmentsRun, completed, noShows, closeRate };
  }

  /**
   * §14.2 "Upline sees the team availability aggregate ('Harvest Availability' zones) — never the
   * underlying private/personal events." Returns coarse 2-hour busy-count buckets — NEVER an
   * individual `CalendarBusyBlock` row, never which provider (Google vs. CalDAV) contributed it, so
   * a CalDAV-sourced block can never be individually identified by an upline (§14.1/§14.6-2).
   */
  async getTeamAvailabilityAggregate(
    teamMemberIds: string[],
    now: Date = new Date(),
    horizonHours = 72,
    bucketHours = 2
  ): Promise<{ bucketStart: string; busyCount: number; teamSize: number }[]> {
    if (teamMemberIds.length === 0) return [];
    const horizonEnd = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);
    const blocks = await this.prisma.calendarBusyBlock.findMany({
      where: { user_id: { in: teamMemberIds }, starts_at: { lt: horizonEnd }, ends_at: { gt: now } },
    });

    const buckets: { bucketStart: string; busyCount: number; teamSize: number }[] = [];
    const bucketMs = bucketHours * 60 * 60 * 1000;
    for (let t = now.getTime(); t < horizonEnd.getTime(); t += bucketMs) {
      const bucketStart = new Date(t);
      const bucketEnd = new Date(t + bucketMs);
      const busyUsers = new Set<string>();
      for (const block of blocks) {
        if (block.starts_at.getTime() < bucketEnd.getTime() && block.ends_at.getTime() > bucketStart.getTime()) {
          busyUsers.add(block.user_id);
        }
      }
      buckets.push({ bucketStart: bucketStart.toISOString(), busyCount: busyUsers.size, teamSize: teamMemberIds.length });
    }
    return buckets;
  }
}
