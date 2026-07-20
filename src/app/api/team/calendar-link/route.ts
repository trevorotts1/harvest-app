// T-45 (WP09 §14.1) — GET/POST/DELETE /api/team/calendar-link: connect/disconnect the caller's own
// Google Calendar or iOS CalDAV link. Session-gated; always operates on the SESSION user's own id —
// never a client-supplied user id (own-data only, no ownership param to leak).
//
// The credential body this route accepts is the OAuth/CalDAV secret the user just obtained from the
// provider's own consent flow — it is sealed via token-vault.ts before it ever touches the database
// (see calendar.service.ts `connect`). If `CALENDAR_TOKEN_ENCRYPTION_KEY` is not configured in this
// environment, the connection still records honestly but `vaultConfigured: false` is returned so the
// caller can surface "calendar connect isn't available in this environment yet" rather than a false
// "connected" claim.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { TeamCalendarService, type TeamCalendarPrismaClient } from '@/services/team-calendar/calendar.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const service = new TeamCalendarService(prisma as unknown as TeamCalendarPrismaClient);
  const status = await service.getConnectionStatus(identity.userId);
  return NextResponse.json({ links: status });
});

interface ConnectBody {
  provider?: 'google' | 'caldav_ios';
  accessToken?: string;
  refreshToken?: string; // for CalDAV, this field carries the server URL (see calendar.service.ts)
  appPassword?: string;
}

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: ConnectBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (body.provider !== 'google' && body.provider !== 'caldav_ios') {
    return NextResponse.json({ error: '"provider" must be "google" or "caldav_ios".' }, { status: 400 });
  }

  const service = new TeamCalendarService(prisma as unknown as TeamCalendarPrismaClient);
  const result = await service.connect(identity.userId, body.provider, {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    appPassword: body.appPassword,
  });
  return NextResponse.json(result);
});

export const DELETE = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const provider = req.nextUrl.searchParams.get('provider');
  if (provider !== 'google' && provider !== 'caldav_ios') {
    return NextResponse.json({ error: '"provider" query param must be "google" or "caldav_ios".' }, { status: 400 });
  }
  const service = new TeamCalendarService(prisma as unknown as TeamCalendarPrismaClient);
  await service.disconnect(identity.userId, provider);
  return NextResponse.json({ ok: true });
});
