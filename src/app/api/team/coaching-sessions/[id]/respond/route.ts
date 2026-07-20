// T-45 (WP09 §14.2) — POST /api/team/coaching-sessions/[id]/respond: confirm/decline a proposed
// Coaching Session. Ownership is enforced inside `respondToCoachingSession` (only the rep or
// trainer on the session may respond).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { BookingService, type BookingPrismaClient } from '@/services/team-calendar/booking.service';

export const dynamic = 'force-dynamic';

interface RespondBody {
  action?: 'confirm' | 'decline';
}

export const POST = withOnboardingGate<{ params: { id: string } }>(async (req, ctx, _session, identity) => {
  const sessionId = ctx?.params?.id;
  if (!sessionId) {
    return NextResponse.json({ error: '"id" is required.' }, { status: 400 });
  }

  let body: RespondBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (body.action !== 'confirm' && body.action !== 'decline') {
    return NextResponse.json({ error: '"action" must be "confirm" or "decline".' }, { status: 400 });
  }

  const service = new BookingService(prisma as unknown as BookingPrismaClient);
  const result = await service.respondToCoachingSession(sessionId, identity.userId, body.action);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason === 'not_found' ? 'Not found' : 'Not permitted.' }, { status: result.reason === 'not_found' ? 404 : 403 });
  }
  return NextResponse.json({ ok: true });
});
