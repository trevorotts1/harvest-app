// WP04 (T-32) — POST /api/mission-control/attendance: mark attendance from Today's Team calendar
// strip (uiux §5.2 item 6 "one-tap attendance marking").
//
// Session-gated (`withOnboardingGate`, never `x-user-id`). Ownership is enforced inside
// `markAttendance`: the event must belong to the SESSION user's own organization (from the verified
// identity, never a client-supplied org id).

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { markAttendance } from '@/services/mission-control/today.service';

export const dynamic = 'force-dynamic';

interface AttendanceBody {
  eventId?: string;
  state?: 'attended' | 'missed';
}

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: AttendanceBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.eventId || typeof body.eventId !== 'string') {
    return NextResponse.json({ error: '"eventId" is required.' }, { status: 400 });
  }
  if (body.state !== 'attended' && body.state !== 'missed') {
    return NextResponse.json({ error: '"state" must be "attended" or "missed".' }, { status: 400 });
  }

  const result = await markAttendance(identity.userId, body.eventId, identity.organizationId, body.state);
  if (!result.ok) {
    return NextResponse.json({ error: 'Event not found for your organization.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
