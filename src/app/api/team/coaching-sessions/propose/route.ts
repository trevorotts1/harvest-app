// T-45 (WP09 §14.2/§14.4) — POST /api/team/coaching-sessions/propose: books (or proposes) a
// Coaching Session between a rep and their upline trainer, enforcing the schedule-flooding
// protection (§14.4 "protect the 2-Hour CEO promise"). Session-gated; the caller must be one of the
// two parties (`coaching_session` capability covers both rep- and upline-initiated proposals).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { hasCapability } from '@/lib/auth/rbac';
import { BookingService, type BookingPrismaClient } from '@/services/team-calendar/booking.service';

export const dynamic = 'force-dynamic';

interface ProposeBody {
  repId?: string;
  trainerId?: string;
  durationMinutes?: number;
  timezone?: string;
}

export const POST = withOnboardingGate(async (req, _ctx, session, identity) => {
  if (!hasCapability(session, 'coaching_session', 'write')) {
    return NextResponse.json({ error: 'Not permitted.', code: 'NOT_PERMITTED' }, { status: 403 });
  }

  let body: ProposeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' }, { status: 400 });
  }
  const repId = body.repId ?? identity.userId;
  const trainerId = body.trainerId ?? identity.userId;
  if (repId === trainerId) {
    return NextResponse.json(
      { error: '"repId" and "trainerId" must be different people.', code: 'SAME_PERSON' },
      { status: 400 }
    );
  }
  // The caller must be one of the two parties (never a third party booking on others' behalf).
  if (identity.userId !== repId && identity.userId !== trainerId && identity.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Not permitted.', code: 'NOT_PERMITTED' }, { status: 403 });
  }

  const [rep, trainer] = await Promise.all([
    prisma.user.findUnique({ where: { id: repId }, select: { organization_id: true } }),
    prisma.user.findUnique({ where: { id: trainerId }, select: { organization_id: true } }),
  ]);
  if (!rep || !trainer || rep.organization_id !== identity.organizationId || trainer.organization_id !== identity.organizationId) {
    return NextResponse.json({ error: 'Not found', code: 'CALENDAR_PARTY_NOT_FOUND' }, { status: 404 });
  }

  const service = new BookingService(prisma as unknown as BookingPrismaClient);
  const result = await service.proposeCoachingSession({
    repId,
    trainerId,
    organizationId: identity.organizationId ?? '',
    durationMinutes: body.durationMinutes,
    timezone: body.timezone,
  });

  return NextResponse.json(result, { status: 201 });
});
