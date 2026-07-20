// T-43 (WP07 §12.2) — GET /api/gamification/first-48: the 48-hour countdown state + the three
// closest-sphere goal slots. Session-gated, own-user-only.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { buildFirstFortyEightState } from '@/services/gamification/first-48.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const state = await buildFirstFortyEightState(prisma as never, identity.userId);
  return NextResponse.json(state);
});
