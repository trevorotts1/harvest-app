// T-45 (WP09 §14.3/§18.4) — POST /api/team/appointments/[id]/decline: trainer decline/cancel →
// automated, apologetic, CFE-cleared reschedule (never a silent drop). Ownership: only the rep or
// the trainer on the appointment (or admin) may decline it.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { BookingService, type BookingPrismaClient } from '@/services/team-calendar/booking.service';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate<{ params: { id: string } }>(async (_req, ctx, _session, identity) => {
  const appointmentId = ctx?.params?.id;
  if (!appointmentId) {
    return NextResponse.json({ error: '"id" is required.' }, { status: 400 });
  }

  const appt = await prisma.appointment.findFirst({ where: { id: appointmentId } });
  if (!appt) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (appt.rep_id !== identity.userId && appt.trainer_id !== identity.userId && identity.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const service = new BookingService(prisma as unknown as BookingPrismaClient);
  const result = await service.declineAndReschedule(appointmentId);
  if (!result.ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(result.rescheduled);
});
