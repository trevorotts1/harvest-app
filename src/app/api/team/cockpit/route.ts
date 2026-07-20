// T-45 (WP09 §14.5 P0; uiux §5.9 item 7, AC-5.9-6) — GET /api/team/cockpit: the Sponsor Cockpit.
// Session-gated; ALWAYS scoped to the SESSION user's own id as sponsor — never a client-supplied
// sponsor id (own-data only, per §15.3 "any existing account can sponsor").

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { hasCapability } from '@/lib/auth/rbac';
import { SponsorCockpitService, type SponsorCockpitPrismaClient } from '@/services/team-calendar/sponsor-cockpit.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (req, _ctx, session, identity) => {
  if (!hasCapability(session, 'sponsor_cockpit', 'read')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
  }

  const periodParam = req.nextUrl.searchParams.get('periodStart');
  const now = new Date();
  const periodStart = periodParam ? new Date(periodParam) : new Date(now.getFullYear(), now.getMonth(), 1);

  const service = new SponsorCockpitService(prisma as unknown as SponsorCockpitPrismaClient);
  const seats = await service.getCockpit(identity.userId, periodStart);

  return NextResponse.json({
    seats,
    // uiux §5.9 states/AC-5.9-8: zero-sponsees renders the recruit-your-first-sponsee coaching
    // state on the client, never a blank screen — this flag is what drives that branch.
    hasSponsees: seats.length > 0,
  });
});
