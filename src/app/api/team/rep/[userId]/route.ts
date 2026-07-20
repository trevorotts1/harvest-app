// T-45 (WP09 §9.6/§16.6; uiux §5.9 AC-5.9-4) — GET /api/team/rep/[userId]: the rep drill-in.
// Session-gated; org/ownership scoping (cross-org or non-downline → 404, never 403 — see
// rep-drill-in.service.ts's header) is enforced inside `getRepDrillIn`, never trusting a
// client-supplied org id.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { hasCapability } from '@/lib/auth/rbac';
import { getRepDrillIn, type RepDrillInPrismaClient } from '@/services/team-calendar/rep-drill-in.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate<{ params: { userId: string } }>(async (_req, ctx, session, identity) => {
  if (!hasCapability(session, 'team_metrics', 'read')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const targetRepId = ctx?.params?.userId;
  if (!targetRepId) {
    return NextResponse.json({ error: '"userId" is required.' }, { status: 400 });
  }

  const drillIn = await getRepDrillIn(
    prisma as unknown as RepDrillInPrismaClient,
    { id: identity.userId, role: identity.role, organizationId: identity.organizationId },
    targetRepId
  );

  if (!drillIn) {
    // Cross-org / not-your-downline / genuinely-not-found all resolve identically here — never a
    // signal that distinguishes "exists but you can't see it" from "doesn't exist" (§16.6/§17.2).
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(drillIn);
});
