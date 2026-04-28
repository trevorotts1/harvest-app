import { calendarService } from '../../src/services/team-calendar/calendar.service';
import { dashboardService } from '../../src/services/team-calendar/dashboard.service';
import { CalendarEventType, EventStatus, Role } from '../../src/types/team-calendar';

// Helper to reset state between tests
function resetAll() {
  calendarService.reset();
  dashboardService.reset();
}

// Helper: ISO timestamps for today
const NOW = new Date();
const today = (hoursFromNow: number): string => {
  const d = new Date(NOW.getTime() + hoursFromNow * 3600 * 1000);
  return d.toISOString();
};

describe('WP09 Team Calendar', () => {
  afterEach(() => {
    resetAll();
  });

  test('create event successfully and retrieve it', () => {
    const result = calendarService.createEvent({
      title: 'Client Call with Sarah',
      type: CalendarEventType.CALL,
      status: EventStatus.SCHEDULED,
      userId: 'rep-1',
      ownerId: 'rep-1',
      participantIds: ['rep-1', 'upline-1'],
      startTime: today(1),
      endTime: today(2),
    });

    expect(result.event).toBeDefined();
    expect(result.event!.title).toBe('Client Call with Sarah');
    expect(result.event!.type).toBe(CalendarEventType.CALL);
    expect(result.event!.ownerId).toBe('rep-1');
    expect(result.event!.participantIds).toEqual(['rep-1', 'upline-1']);
    expect(result.overlap.hasOverlap).toBe(false);

    // Retrieve via getEvents
    const events = calendarService.getEvents('rep-1');
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(result.event!.id);
  });

  test('overlap detection blocks event creation when ANY participant has conflict', () => {
    // Create first event for rep-1 at 1pm-2pm
    const result1 = calendarService.createEvent({
      title: 'Team Meeting',
      type: CalendarEventType.MEETING,
      status: EventStatus.SCHEDULED,
      userId: 'rep-1',
      ownerId: 'rep-1',
      participantIds: ['rep-1'],
      startTime: today(1),
      endTime: today(2),
    });
    expect(result1.event).toBeDefined();

    // Try to create overlapping event with rep-1 as participant — should be BLOCKED
    const result2 = calendarService.createEvent({
      title: 'Another Meeting',
      type: CalendarEventType.APPOINTMENT,
      status: EventStatus.SCHEDULED,
      userId: 'rep-2',
      ownerId: 'rep-2',
      participantIds: ['rep-1', 'rep-2'],
      startTime: today(1.5), // overlaps with first event
      endTime: today(3),
    });

    expect(result2.event).toBeUndefined();
    expect(result2.overlap.hasOverlap).toBe(true);
    expect(result2.overlap.conflictingParticipantIds).toContain('rep-1');
  });

  test('upline sees team calendar with masked details (availability only)', () => {
    // Register team
    dashboardService.registerTeam('upline-1', ['rep-1', 'rep-2']);

    // Create events for reps
    calendarService.createEvent({
      title: 'Private Client Meeting',
      type: CalendarEventType.APPOINTMENT,
      status: EventStatus.CONFIRMED,
      userId: 'rep-1',
      ownerId: 'rep-1',
      participantIds: ['rep-1'],
      startTime: today(2),
      endTime: today(3),
    });

    calendarService.createEvent({
      title: 'Team Standup',
      type: CalendarEventType.MEETING,
      status: EventStatus.SCHEDULED,
      userId: 'rep-2',
      ownerId: 'rep-2',
      participantIds: ['rep-2'],
      startTime: today(4),
      endTime: today(5),
    });

    // Upline views team calendar
    const teamCalendar = calendarService.getTeamCalendar('upline-1', ['rep-1', 'rep-2']);

    expect(teamCalendar.length).toBeGreaterThanOrEqual(2);

    // All events should be masked — title is "Busy", type is "BUSY"
    for (const entry of teamCalendar) {
      expect(entry.canSeeDetails).toBe(false);
      expect(entry.canSeeAvailability).toBe(true);
      expect(entry.maskedEvent.title).toBe('Busy');
      expect(entry.maskedEvent.type).toBe('BUSY');
    }
  });

  test('rep cannot see other reps\' dashboard data', () => {
    // Register team
    dashboardService.registerTeam('upline-1', ['rep-1', 'rep-2']);

    // Create event for rep-1
    calendarService.createEvent({
      title: 'Rep 1 Event',
      type: CalendarEventType.CALL,
      status: EventStatus.SCHEDULED,
      userId: 'rep-1',
      ownerId: 'rep-1',
      participantIds: ['rep-1'],
      startTime: today(1),
      endTime: today(2),
    });

    // rep-1 viewing own dashboard — allowed
    const ownDashboard = dashboardService.getRepDashboard('rep-1', 'rep-1', Role.REP);
    expect(ownDashboard).not.toBeNull();
    expect(ownDashboard!.myEvents.length).toBeGreaterThanOrEqual(1);

    // rep-2 trying to view rep-1's dashboard — BLOCKED
    const otherDashboard = dashboardService.getRepDashboard('rep-1', 'rep-2', Role.REP);
    expect(otherDashboard).toBeNull();

    // Upline CAN view rep-1's dashboard
    const uplineDashboard = dashboardService.getRepDashboard('rep-1', 'upline-1', Role.UPLINE);
    expect(uplineDashboard).not.toBeNull();
    expect(uplineDashboard!.myEvents.length).toBeGreaterThanOrEqual(1);
  });
});