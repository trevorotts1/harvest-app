// T-45 (WP09 §14.4; uiux §5.9 item 5, AC-5.9-7 "editable only by RVP roles; reps see it read-only")
// — GET/POST /api/team/calendar: the org-wide broadcast master calendar plus the caller's own
// merged personal agenda. Session-gated; write is capability-gated to RVP/ADMIN
// (`team_calendar_broadcast`), never a client-supplied role.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { hasCapability } from '@/lib/auth/rbac';
import { TeamCalendarService, type TeamCalendarPrismaClient } from '@/services/team-calendar/calendar.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const service = new TeamCalendarService(prisma as unknown as TeamCalendarPrismaClient);

  const [broadcastEvents, personalAgenda, caller] = await Promise.all([
    identity.organizationId ? service.listBroadcastEvents(identity.organizationId, identity.userId) : Promise.resolve([]),
    service.getPersonalAgenda(identity.userId),
    prisma.user.findUnique({ where: { id: identity.userId }, select: { upline_id: true } }),
  ]);

  // Surfaced so the calendar page can offer a real "propose a coaching session with your upline"
  // action (POST /api/team/coaching-sessions/propose) without the client having to guess an id.
  return NextResponse.json({ broadcastEvents, personalAgenda, myUplineId: caller?.upline_id ?? null });
});

interface CreateBroadcastEventBody {
  type?: string;
  startsAt?: string;
  rsvpEnabled?: boolean;
}

export const POST = withOnboardingGate(async (req, _ctx, session, identity) => {
  // §14.4 "The RVP controls and populates the master calendar" — write is RVP/ADMIN only.
  if (!hasCapability(session, 'team_calendar_broadcast', 'write')) {
    return NextResponse.json({ error: 'Only the RVP/admin can add to the team calendar.' }, { status: 403 });
  }
  if (!identity.organizationId) {
    return NextResponse.json({ error: 'No organization on file for this account.' }, { status: 400 });
  }

  let body: CreateBroadcastEventBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.type || typeof body.type !== 'string') {
    return NextResponse.json({ error: '"type" is required.' }, { status: 400 });
  }
  const startsAt = body.startsAt ? new Date(body.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: '"startsAt" must be a valid ISO date.' }, { status: 400 });
  }

  const service = new TeamCalendarService(prisma as unknown as TeamCalendarPrismaClient);
  const event = await service.createBroadcastEvent(identity.organizationId, identity.userId, body.type, startsAt, body.rsvpEnabled ?? true);
  return NextResponse.json({ event }, { status: 201 });
});
