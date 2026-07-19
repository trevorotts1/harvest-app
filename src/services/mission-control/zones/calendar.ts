// WP04 (T-32) — Zone 6: Team calendar strip (uiux §5.2 item 6, master-spec §9.5 item 6).
//
// Reads the real `TeamEvent`/`Attendance` Prisma models directly (both already exist in the schema
// and are, as of this unit, otherwise UNUSED anywhere in the app — the separate in-memory
// `src/services/team-calendar/*` module is a distinct, pre-existing, non-Prisma-backed WP09 scaffold
// this unit does not touch). Scoped to the rep's own organization via the verified session's
// `organizationId` (never a client-supplied value).

import type { AttendanceState, CalendarZoneData } from '../types';
import type { MissionControlPrismaClient } from '../prisma-types';

const UPCOMING_EVENT_COUNT = 3;

export async function buildCalendarZone(
  db: MissionControlPrismaClient,
  userId: string,
  organizationId: string | null,
  now: Date = new Date()
): Promise<CalendarZoneData> {
  if (!organizationId) {
    return { hasOrg: false, events: [] };
  }

  const events = await db.teamEvent.findMany({
    where: { organization_id: organizationId, starts_at: { gte: now } },
    orderBy: { starts_at: 'asc' },
    take: UPCOMING_EVENT_COUNT,
  });

  if (events.length === 0) {
    return { hasOrg: true, events: [] };
  }

  const attendanceRows = await db.attendance.findMany({
    where: { event_id: { in: events.map((e) => e.id) }, user_id: userId },
  });
  const attendanceByEvent = new Map(attendanceRows.map((a) => [a.event_id, a.state as AttendanceState]));

  return {
    hasOrg: true,
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      startsAt: e.starts_at.toISOString(),
      attendanceState: attendanceByEvent.get(e.id) ?? 'none',
    })),
  };
}
