import {
  CalendarEvent,
  CalendarEventType,
  CalendarOverlap,
  EventStatus,
  TeamVisibility,
  Role,
} from '../../types/team-calendar';

class CalendarService {
  private events: Map<string, CalendarEvent> = new Map();

  /** Get events for a specific user (owner or participant). */
  getEvents(userId: string): CalendarEvent[] {
    return Array.from(this.events.values()).filter(
      (e) => e.ownerId === userId || e.participantIds.includes(userId)
    );
  }

  /** Get a single event by ID. */
  getEventById(eventId: string): CalendarEvent | undefined {
    return this.events.get(eventId);
  }

  /** Create a new calendar event. Checks for overlaps first — blocks if ANY participant has a conflict. */
  createEvent(
    data: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>
  ): { event?: CalendarEvent; overlap: CalendarOverlap } {
    const overlap = this.checkOverlap(
      data.participantIds,
      data.startTime,
      data.endTime,
      data.ownerId
    );

    if (overlap.hasOverlap) {
      return { overlap };
    }

    const now = new Date().toISOString();
    const event: CalendarEvent = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    this.events.set(event.id, event);
    return { event, overlap: { hasOverlap: false, conflictingEventIds: [], conflictingParticipantIds: [], message: 'No conflicts' } };
  }

  /**
   * Check whether any participant already has an event overlapping the proposed window.
   * Blocks if ANY participant has a conflict.
   */
  checkOverlap(
    participantIds: string[],
    startTime: string,
    endTime: string,
    excludeOwnerId?: string
  ): CalendarOverlap {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    const conflictingEventIds: string[] = [];
    const conflictingParticipantIds: string[] = [];

    for (const event of this.events.values()) {
      const evStart = new Date(event.startTime).getTime();
      const evEnd = new Date(event.endTime).getTime();

      // Time overlap: events overlap if one starts before the other ends
      const timeOverlaps = start < evEnd && end > evStart;
      if (!timeOverlaps) continue;

      // Check if any requested participant is already in this event
      for (const pid of participantIds) {
        if (event.participantIds.includes(pid) || event.ownerId === pid) {
          if (!conflictingParticipantIds.includes(pid)) {
            conflictingParticipantIds.push(pid);
          }
          if (!conflictingEventIds.includes(event.id)) {
            conflictingEventIds.push(event.id);
          }
        }
      }
    }

    const hasOverlap = conflictingParticipantIds.length > 0;
    return {
      hasOverlap,
      conflictingEventIds,
      conflictingParticipantIds,
      message: hasOverlap
        ? `Conflicts for participants: ${conflictingParticipantIds.join(', ')}`
        : 'No conflicts',
    };
  }

  /**
   * Get the team calendar for an upline.
   * Upline can see availability (busy slots) for their team, but NOT event details.
   * Details are masked: title becomes "Busy", type becomes "BUSY".
   */
  getTeamCalendar(uplineId: string, teamMemberIds: string[]): TeamVisibility[] {
    const result: TeamVisibility[] = [];

    for (const event of this.events.values()) {
      const isTeamEvent =
        teamMemberIds.includes(event.ownerId) ||
        event.participantIds.some((p) => teamMemberIds.includes(p));

      if (!isTeamEvent) continue;

      // Upline sees availability only — mask details
      const masked: TeamVisibility = {
        canSeeDetails: false,
        canSeeAvailability: true,
        maskedEvent: {
          id: event.id,
          ownerId: event.ownerId,
          startTime: event.startTime,
          endTime: event.endTime,
          title: 'Busy',
          type: 'BUSY',
        },
      };

      result.push(masked);
    }

    return result;
  }

  /** Reset store (for tests). */
  reset(): void {
    this.events.clear();
  }
}

export const calendarService = new CalendarService();