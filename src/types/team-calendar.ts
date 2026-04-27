// WP09: Team Calendar & Upline Dashboard - Types

export enum CalendarEventType {
  APPOINTMENT = 'APPOINTMENT',
  CALL = 'CALL',
  FOLLOWUP = 'FOLLOWUP',
  MEETING = 'MEETING',
  BLOCKED = 'BLOCKED',
  THREE_WAY = 'THREE_WAY',
}

export enum EventStatus {
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  RESCHEDULED = 'RESCHEDULED',
}

export interface CalendarEvent {
  id: string;
  userId: string;
  type: CalendarEventType;
  title: string;
  startTime: string;
  endTime: string;
  participantIds: string[];
  status: EventStatus;
  notes?: string;
  createdAt: string;
}

export interface CalendarOverlap {
  hasConflict: boolean;
  conflictingUserIds: string[];
  conflictingEventIds: string[];
}

export interface TeamVisibility {
  uplineId: string;
  repId: string;
  canViewAvailability: boolean;
  canViewDetails: boolean;
}

export interface AttendanceTracking {
  userId: string;
  eventId: string;
  status: 'ATTENDED' | 'NO_SHOW' | 'EXCUSED' | 'PENDING';
  notes?: string;
}
