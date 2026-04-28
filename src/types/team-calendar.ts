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
  ownerId: string;
  type: CalendarEventType;
  title: string;
  startTime: string;
  endTime: string;
  participantIds: string[];
  status: EventStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarOverlap {
  hasConflict: boolean;
  hasOverlap: boolean;
  conflictingUserIds: string[];
  conflictingEventIds: string[];
  conflictingParticipantIds: string[];
  message?: string;
}

export enum Role {
  REP = 'REP',
  UPLINE = 'UPLINE',
  ADMIN = 'ADMIN',
  DUAL = 'DUAL',
  RVP = 'RVP',
}

export interface MaskedEvent {
  id: string;
  ownerId: string;
  startTime: string;
  endTime: string;
  title: string;
  type: string;
}

export interface TeamVisibility {
  uplineId?: string;
  repId?: string;
  canViewAvailability: boolean;
  canViewDetails: boolean;
  canSeeDetails?: boolean;
  canSeeAvailability?: boolean;
  maskedEvent: MaskedEvent;
}

export interface AttendanceRecord {
  userId: string;
  eventId: string;
  status: 'ATTENDED' | 'NO_SHOW' | 'MISSED' | 'EXCUSED' | 'LATE' | 'PENDING';
  recordedAt: string;
}

export interface AttendanceTracking {
  eventId: string;
  totalInvited: number;
  attended: number;
  missed: number;
  late: number;
  excused: number;
  attendanceRate: number;
  records: AttendanceRecord[];
}

export interface RepDashboardData {
  myEvents: CalendarEvent[];
  upcomingCount: number;
  todayCount: number;
  attendanceSummary: {
    attended: number;
    missed: number;
    late: number;
    attendanceRate: number;
  };
}

export interface UplineDashboardData {
  teamAvailability: Array<{
    repId: string;
    repName: string;
    busySlots: Array<{ startTime: string; endTime: string }>;
  }>;
  upcomingTeamEvents: TeamVisibility[];
  attendanceMetrics: AttendanceTracking[];
}
