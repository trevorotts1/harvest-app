// T-43 (WP07 §12.1) — GET /api/gamification/momentum: the ten-criteria breakdown + five-level
// Downline-Maxxer name + the single weakest-Law action (uiux §3.3 "tap-to-expand"). Session-gated
// via `withOnboardingGate`; scoped to the session's own userId only (never a client-supplied id —
// there is no cross-rep momentum surface anywhere in this build, doctrine §12).

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { computeMomentumCriteria } from '@/services/mission-control/momentum';
import { MOMENTUM_CRITERION_LABEL } from '@/services/gamification/momentum-criteria';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const events = await (prisma as unknown as { momentumEvent: { findMany(args: { where: { user_id: string } }): Promise<{ event_type: string; points: number; law: string; created_at: Date }[]> } }).momentumEvent.findMany({
    where: { user_id: identity.userId },
  });

  const result = computeMomentumCriteria(events, new Date());
  const weakestLabel = MOMENTUM_CRITERION_LABEL[result.weakestCriterion];

  return NextResponse.json({
    levelName: result.levelName,
    criteria: Object.fromEntries(
      Object.entries(result.criteria).map(([key, value]) => [key, { label: MOMENTUM_CRITERION_LABEL[key as keyof typeof MOMENTUM_CRITERION_LABEL], score: value }])
    ),
    weakestCriterion: result.weakestCriterion,
    weakestCriterionLabel: weakestLabel,
    suggestedAction: `Your ${weakestLabel} is your quietest area right now — one small action there helps most.`,
  });
});
