// T-43 (WP07 §12.8) — GET/PATCH /api/gamification/goal-card: the Goal Commitment Card. Own-user-only.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { getGoalCard, upsertGoalCard, type GoalCardPatch } from '@/services/gamification/goal-card.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const card = await getGoalCard(prisma as never, identity.userId);
  return NextResponse.json({ card });
});

export const PATCH = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: GoalCardPatch;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const updated = await upsertGoalCard(prisma as never, identity.userId, body);
  return NextResponse.json(updated);
});
