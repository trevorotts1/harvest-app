// T-43 (WP07 §12.5) — GET /api/gamification/streak: recomputes (idempotent per day) and returns the
// rolling 7-day streak summary, the grace-day availability, and the visual bar data.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { recomputeStreak } from '@/services/gamification/streak.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const summary = await recomputeStreak(prisma as never, identity.userId);
  return NextResponse.json(summary);
});
