// T-45 (WP09 §14.2/§14.3) — POST /api/team/appointments/propose: the Appointment Setting Agent
// edge — merges dual-calendar availability for the rep + trainer, atomically books (or proposes
// near-miss windows for) a Closing Appointment, and dispatches the existing, CFE-gated
// APPOINTMENT_SETTING agent for the contact-facing draft. Session-gated; the caller must own the
// contact (ownership check below) — never a client-supplied rep id.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { BookingService, type BookingPrismaClient } from '@/services/team-calendar/booking.service';

export const dynamic = 'force-dynamic';

interface ProposeBody {
  trainerId?: string;
  contactId?: string;
  durationMinutes?: number;
}

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: ProposeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.trainerId || typeof body.trainerId !== 'string') {
    return NextResponse.json({ error: '"trainerId" is required.' }, { status: 400 });
  }
  if (!body.contactId || typeof body.contactId !== 'string') {
    return NextResponse.json({ error: '"contactId" is required.' }, { status: 400 });
  }

  // Ownership: the caller must own the contact (never propose an appointment for someone else's
  // community member). "Not found" for both cases (row-level 404, §16.6).
  const contact = await prisma.contact.findFirst({ where: { id: body.contactId, user_id: identity.userId } });
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  // The trainer must be a real upline-capable account in the SAME organization — never book a
  // "trainer" outside the org, never trust an arbitrary id blind.
  const trainer = await prisma.user.findUnique({ where: { id: body.trainerId }, select: { organization_id: true, role: true } });
  if (!trainer || trainer.organization_id !== identity.organizationId || !['UPLINE', 'RVP', 'ADMIN', 'DUAL'].includes(trainer.role)) {
    return NextResponse.json({ error: 'Trainer not found' }, { status: 404 });
  }

  const service = new BookingService(prisma as unknown as BookingPrismaClient);
  const result = await service.proposeClosingAppointment({
    repId: identity.userId,
    trainerId: body.trainerId,
    contactId: body.contactId,
    organizationId: identity.organizationId ?? '',
    durationMinutes: body.durationMinutes,
  });

  return NextResponse.json(result, { status: 201 });
});
