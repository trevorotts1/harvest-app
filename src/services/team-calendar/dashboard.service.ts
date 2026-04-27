import {
  AttendanceRecord,
  AttendanceTracking,
  RepDashboardData,
  Role,
  UplineDashboardData,
  CalendarEvent,
  TeamVisibility,
} from '../../types/team-calendar';
import { calendarService } from './calendar.service';

// In-memory attendance store
const attendanceRecords: Map<string, AttendanceRecord> = new Map();

// Simple team hierarchy (for RBAC — in production this comes from DB)
const uplineTeams: Map<string, string[]> = new Map();

class DashboardService {
  /** Register which reps belong to which upline (for testing / seeding). */
  registerTeam(uplineId: string, repIds: string[]): void {
    uplineTeams.set(uplineId, repIds);
  }

  /** Get the upline dashboard — team availability + masked events + attendance metrics. */
  getUplineDashboard(uplineId: string, uplineRole: Role): UplineDashboardData | null {
    // RBAC: only UPLINE, ADMIN, DUAL, RVP can see the upline dashboard
    if (!this.isUplineRole(uplineRole)) {
      return null;
    }

    const teamMemberIds = uplineTeams.get(uplineId) ?? [];
    const teamVisibility = calendarService.getTeamCalendar(uplineId, teamMemberIds);

    // Build team availability from masked events
    const teamAvailability = this.buildTeamAvailability(teamMemberIds, teamVisibility);

    // Get attendance metrics for team events
    const teamEventIds = teamVisibility.map((tv) => tv.maskedEvent.id);
    const attendanceMetrics = teamEventIds
      .map((eid) => this.getAttendanceMetrics(eid))
      .filter((m): m is AttendanceTracking => m !== null);

    return {
      teamAvailability,
      upcomingTeamEvents: teamVisibility,
      attendanceMetrics,
    };
  }

  /** Get the rep dashboard — own events, counts, personal attendance. */
  getRepDashboard(repId: string, requestorId: string, requestorRole: Role): RepDashboardData | null {
    // RBAC: rep can only see their own dashboard; upline/admin can see any rep's
    if (requestorRole === 'REP' && requestorId !== repId) {
      return null; // Rep cannot see other reps' dashboards
    }

    const events = calendarService.getEvents(repId);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const upcoming = events.filter((e) => e.startTime > now.toISOString());
    const today = events.filter(
      (e) => e.startTime >= todayStart && e.startTime < now.toISOString()
    );

    // Personal attendance summary
    const myRecords = Array.from(attendanceRecords.values()).filter(
      (r) => r.userId === repId
    );
    const attended = myRecords.filter((r) => r.status === 'ATTENDED').length;
    const missed = myRecords.filter((r) => r.status === 'MISSED').length;
    const late = myRecords.filter((r) => r.status === 'LATE').length;
    const total = attended + missed + late;
    const attendanceRate = total > 0 ? attended / total : 1;

    return {
      myEvents: events,
      upcomingCount: upcoming.length,
      todayCount: today.length,
      attendanceSummary: {
        attended,
        missed,
        late,
        attendanceRate,
      },
    };
  }

  /** Compute attendance metrics for a specific event. */
  getAttendanceMetrics(eventId: string): AttendanceTracking | null {
    const records = Array.from(attendanceRecords.values()).filter(
      (r) => r.eventId === eventId
    );
    if (records.length === 0) return null;

    const attended = records.filter((r) => r.status === 'ATTENDED').length;
    const missed = records.filter((r) => r.status === 'MISSED').length;
    const late = records.filter((r) => r.status === 'LATE').length;
    const excused = records.filter((r) => r.status === 'EXCUSED').length;
    const totalInvited = records.length;
    const attendanceRate = totalInvited > 0 ? attended / totalInvited : 0;

    return {
      eventId,
      totalInvited,
      attended,
      missed,
      late,
      excused,
      attendanceRate,
      records,
    };
  }

  /** Record attendance for a user on an event. */
  recordAttendance(eventId: string, userId: string, status: AttendanceRecord['status']): void {
    const record: AttendanceRecord = {
      eventId,
      userId,
      status,
      recordedAt: new Date().toISOString(),
    };
    attendanceRecords.set(`${eventId}:${userId}`, record);
  }

  /** Check if a role is an upline-level role. */
  private isUplineRole(role: Role): boolean {
    return ['UPLINE', 'ADMIN', 'DUAL', 'RVP'].includes(role);
  }

  /** Build team availability summary from masked calendar data. */
  private buildTeamAvailability(
    teamMemberIds: string[],
    teamVisibility: TeamVisibility[]
  ): UplineDashboardData['teamAvailability'] {
    const availabilityMap = new Map<string, Array<{ startTime: string; endTime: string }>>();

    for (const repId of teamMemberIds) {
      availabilityMap.set(repId, []);
    }

    for (const tv of teamVisibility) {
      const repId = tv.maskedEvent.ownerId;
      const slots = availabilityMap.get(repId);
      if (slots) {
        slots.push({
          startTime: tv.maskedEvent.startTime,
          endTime: tv.maskedEvent.endTime,
        });
      }
    }

    return Array.from(availabilityMap.entries()).map(([repId, busySlots]) => ({
      repId,
      repName: repId, // In production, resolve from user DB
      busySlots,
    }));
  }

  /** Reset all state (for tests). */
  reset(): void {
    attendanceRecords.clear();
    uplineTeams.clear();
  }
}

export const dashboardService = new DashboardService();