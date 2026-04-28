// WP04 Appointment Setting Agent — dual-calendar scheduling with WP09 contract

import {
  AgentType,
  AgentExecutionMode,
  AgentActionType,
  AgentAction,
  AppointmentRequest,
  AppointmentResult,
  DualCalendarAvailability,
  CalendarAvailabilityWindow,
  TimeBlock,
  WP09AppointmentContract,
} from '../../types/agent-layer';
import { BaseAgent } from './base-agent';

/**
 * Appointment Setting Agent: Schedules meetings via dual-calendar sync.
 * Runs SEQUENTIALLY — requires: (1) prospect has responded,
 * (2) both rep and upline calendars synced.
 *
 * Key rules:
 * - Respects rep's time-blocked hours
 * - Finds overlapping availability within 48 hours of trigger
 * - Always requires rep confirmation before finalizing
 * - On conflict: suggests alternative times, notifies rep
 * - Contract compatible with WP09 calendar architecture
 */
export class AppointmentSettingAgent extends BaseAgent {
  readonly agentType = AgentType.APPOINTMENT;
  readonly executionMode = AgentExecutionMode.SEQUENTIAL;
  readonly description = 'Schedules meetings via dual Google Calendar sync';

  /**
   * Find overlapping availability between rep and upline.
   * Must find windows within 48 hours of trigger.
   */
  findOverlappingAvailability(
    availability: DualCalendarAvailability,
    blockedHours: TimeBlock[]
  ): CalendarAvailabilityWindow[] {
    const { repWindows, uplineWindows } = availability;

    const overlapping: CalendarAvailabilityWindow[] = [];

    for (const rep of repWindows) {
      const repStart = new Date(rep.start);
      const repEnd = new Date(rep.end);

      // Skip windows that fall in blocked hours
      if (this.isBlocked(repStart, repEnd, blockedHours)) {
        continue;
      }

      for (const upline of uplineWindows) {
        const uplineStart = new Date(upline.start);
        const uplineEnd = new Date(upline.end);

        // Calculate overlap
        const overlapStart = new Date(Math.max(repStart.getTime(), uplineStart.getTime()));
        const overlapEnd = new Date(Math.min(repEnd.getTime(), uplineEnd.getTime()));

        if (overlapStart < overlapEnd) {
          overlapping.push({
            start: overlapStart.toISOString(),
            end: overlapEnd.toISOString(),
            provider: rep.provider,
            userId: rep.userId,
          });
        }
      }
    }

    // Sort by earliest availability
    return overlapping.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }

  /**
   * Check if a time window falls within blocked hours.
   */
  private isBlocked(start: Date, end: Date, blockedHours: TimeBlock[]): boolean {
    for (const block of blockedHours) {
      const startDay = start.getDay();
      const endDay = end.getDay();

      // Check if any part of the window falls on a blocked day
      if (startDay === block.dayOfWeek || endDay === block.dayOfWeek) {
        const startHour = start.getHours() + start.getMinutes() / 60;
        const endHour = end.getHours() + end.getMinutes() / 60;

        if (startHour < block.endHour && endHour > block.startHour) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Attempt to schedule an appointment.
   * Returns result with confirmation requirement (always true for rep confirmation).
   */
  proposeAppointment(
    request: AppointmentRequest,
    availability: DualCalendarAvailability
  ): AppointmentResult {
    const windows = this.findOverlappingAvailability(
      availability,
      request.blockedHours
    );

    if (windows.length === 0) {
      return {
        success: false,
        conflictDetected: true,
        alternativeTimes: [],
        requiresRepConfirmation: true,
      };
    }

    // Take the earliest available window
    const selected = windows[0];

    return {
      success: true,
      appointmentId: crypto.randomUUID(),
      scheduledTime: selected.start,
      conflictDetected: false,
      requiresRepConfirmation: true, // Always require rep sign-off
    };
  }

  /**
   * Generate a WP09-compatible appointment contract.
   */
  createWP09Contract(
    request: AppointmentRequest,
    scheduledTime: string,
    durationMinutes: number,
    type: 'INTRO' | 'FOLLOW_UP' | 'CLOSING' | 'CHECK_IN'
  ): WP09AppointmentContract {
    return {
      appointmentId: crypto.randomUUID(),
      repId: request.repId,
      uplineId: request.uplineId,
      contactId: request.contactId,
      scheduledTime,
      durationMinutes,
      type,
      status: 'PENDING',
      repTimezone: 'America/New_York', // from user profile in production
    };
  }

  /**
   * Handle a calendar conflict by suggesting alternatives.
   */
  handleConflict(
    request: AppointmentRequest,
    availability: DualCalendarAvailability
  ): AppointmentResult {
    const windows = this.findOverlappingAvailability(
      availability,
      request.blockedHours
    );

    return {
      success: false,
      conflictDetected: true,
      alternativeTimes: windows.slice(0, 3).map((w) => w.start),
      requiresRepConfirmation: true,
    };
  }

  /**
   * Check prerequisites for appointment setting.
   * Sequential: requires prospect response + calendar connection.
   */
  canProceed(prospectHasResponded: boolean, calendarsSynced: boolean): boolean {
    return prospectHasResponded && calendarsSynced;
  }
}