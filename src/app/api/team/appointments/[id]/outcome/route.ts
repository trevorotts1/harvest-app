// T-45 (WP09 §14.3 "no-shows count against the Field Trainer's Ratio") — POST
// /api/team/appointments/[id]/outcome: mark a past-due CONFIRMED appointment's real-world outcome.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { BookingService, type BookingPrismaClient } from '@/services/team-calendar/booking.service';

export const dynamic = 'force-dynamic';

interface OutcomeBody {
  outcome?: 'completed' | 'no_show';
}

export const POST = withOnboardingGate<{ params: { id: string } }>(async (req, ctx, _session, identity) => {
  const appointmentId = ctx?.params?.id;
  if (!appointmentId) {
    return NextResponse.json({ error: '"id" is required.' }, { status: 400 });
  }

  let body: OutcomeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (body.outcome !== 'completed' && body.outcome !== 'no_show') {
    return NextResponse.json({ error: '"outcome" must be "completed" or "no_show".' }, { status: 400 });
  }

  const appt = await prisma.appointment.findFirst({ where: { id: appointmentId } });
  if (!appt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (appt.rep_id !== identity.userId && appt.trainer_id !== identity.userId && identity.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const service = new BookingService(prisma as unknown as BookingPrismaClient);
  const result = await service.markAppointmentOutcome(appointmentId, body.outcome);
  if (!result.ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
