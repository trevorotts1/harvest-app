// T-45 (WP09 §14.4; uiux §5.9) — GET /api/team/dashboard: the anti-surveillance upline/RVP dashboard
// (roster, needs-you-now, downline leak, the caller's own Field Trainer's Ratio, team-availability
// aggregate). Session-gated (`withOnboardingGate`, never `x-user-id`); RBAC via the §16.6
// `team_metrics` capability (upline/rvp/admin — a plain rep has no downline, so no dashboard).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { hasCapability } from '@/lib/auth/rbac';
import { DashboardService, resolveTeamMemberIds, type RosterPrismaClient } from '@/services/team-calendar/dashboard.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (req, _ctx, session, identity) => {
  if (!hasCapability(session, 'team_metrics', 'read')) {
    return NextResponse.json({ error: 'This dashboard is for team leads — reps see their own Today view.' }, { status: 403 });
  }

  const db = prisma as unknown as RosterPrismaClient;
  const service = new DashboardService(db);

  const teamMemberIds = await resolveTeamMemberIds(db, { id: identity.userId, role: identity.role, organizationId: identity.organizationId });

  if (teamMemberIds.length === 0) {
    // uiux §5.9 states/AC-5.9-8: zero-team renders the recruit-your-first coaching state, never a
    // blank/error screen.
    return NextResponse.json({
      hasTeam: false,
      roster: [],
      needsYouNow: [],
      downlineLeak: [],
      fieldTrainerRatio: { appointmentsRun: 0, completed: 0, noShows: 0, closeRate: 0 },
      teamAvailability: [],
    });
  }

  const sortParam = req.nextUrl.searchParams.get('sort');
  const sortBy = sortParam === 'pace' || sortParam === 'momentum' ? sortParam : 'name';

  const [rosterRaw, needsYouNow, downlineLeak, fieldTrainerRatio, teamAvailability] = await Promise.all([
    service.getRoster(teamMemberIds),
    identity.organizationId ? service.getNeedsYouNow(identity.userId, identity.organizationId) : Promise.resolve([]),
    service.getDownlineLeak(teamMemberIds),
    service.getFieldTrainerRatioPanel(identity.userId),
    service.getTeamAvailabilityAggregate(teamMemberIds),
  ]);

  return NextResponse.json({
    hasTeam: true,
    roster: service.sortRoster(rosterRaw, sortBy),
    needsYouNow,
    downlineLeak,
    fieldTrainerRatio,
    teamAvailability,
  });
});
