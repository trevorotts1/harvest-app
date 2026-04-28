// POST /api/agents/appointment — Run appointment setting agent

import { NextRequest, NextResponse } from 'next/server';
import { AppointmentSettingAgent } from '@/services/agent-layer';
import { AppointmentRequest, DualCalendarAvailability } from '@/types/agent-layer';

const appointmentAgent = new AppointmentSettingAgent();

export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    const appointmentRequest: AppointmentRequest = {
      contactId: body.contactId ?? '',
      contactName: body.contactName ?? '',
      repId: userId,
      uplineId: body.uplineId,
      preferredTimes: body.preferredTimes ?? [],
      durationMinutes: body.durationMinutes ?? 30,
      type: body.type ?? 'INTRO',
      blockedHours: body.blockedHours ?? [],
    };

    const availability: DualCalendarAvailability = {
      repWindows: body.repWindows ?? [],
      uplineWindows: body.uplineWindows ?? [],
      overlappingWindows: [],
      timezone: body.timezone ?? 'America/New_York',
    };

    // Check prerequisites
    const canProceed = appointmentAgent.canProceed(
      body.prospectHasResponded ?? false,
      body.calendarsSynced ?? false
    );

    if (!canProceed) {
      return NextResponse.json(
        { error: 'Appointment prerequisites not met: prospect must have responded and calendars must be synced' },
        { status: 400 }
      );
    }

    const result = appointmentAgent.proposeAppointment(appointmentRequest, availability);

    if (result.success && result.scheduledTime) {
      const contract = appointmentAgent.createWP09Contract(
        appointmentRequest,
        result.scheduledTime,
        appointmentRequest.durationMinutes,
        appointmentRequest.type
      );

      return NextResponse.json({
        result,
        wp09Contract: contract,
        requiresRepConfirmation: true,
      });
    }

    if (result.conflictDetected) {
      const conflictResult = appointmentAgent.handleConflict(appointmentRequest, availability);
      return NextResponse.json({
        result: conflictResult,
        message: 'Calendar conflict detected. Alternative times suggested.',
      });
    }

    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: 'Appointment agent execution failed' },
      { status: 500 }
    );
  }
}