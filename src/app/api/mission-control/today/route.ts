// WP04 (T-32) — GET /api/mission-control/today: the REAL Mission Control / Today data surface
// (master-spec §9.5, uiux §5.2), replacing the retired `/api/mission-control/briefing` demo route.
//
// Session-gated via `withOnboardingGate` — identity comes from the VERIFIED Auth.js session +
// live DB onboarding-completeness check, never a client-forged `x-user-id` header (this file reads
// no such header at all, so the forged-identity build guard is moot by construction). Ownership is
// implicit: every zone query is scoped to `identity.userId` (never a client-supplied id).
//
// Lazy: `buildMissionControlToday` is called per-request, inside the handler; nothing Prisma/Claude/
// service-shaped is constructed at module scope.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildMissionControlToday } from '@/services/mission-control/today.service';
import { prisma } from '@/lib/prisma';
import { checkMilestones } from '@/services/gamification/celebration.service';
import { ensureFirstFortyEightStarted } from '@/services/gamification/first-48.service';

// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as every sibling route.
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, session, identity) => {
  const firstName = (session.user.name ?? '').trim().split(/\s+/)[0] || 'there';

  // T-43 (WP07 §12.2/§12.3 REACHABILITY): Today is "the default landing surface, always" (uiux §2.1)
  // — this is the real, frequently-hit production caller that (a) lazily stamps the First-48 anchor
  // the first time a GATED_COMPLETE rep's Today loads, and (b) detects any newly-true milestone.
  // Both are best-effort side effects: a failure here degrades to "not yet detected this load" (the
  // 5-minute Inngest cron sweep and the next Today load both retry) rather than ever failing the
  // whole Today response — matching the independent-zone-failure posture of everything else on this
  // page (master-spec §9.5).
  try {
    await ensureFirstFortyEightStarted(prisma as unknown as Parameters<typeof ensureFirstFortyEightStarted>[0], identity.userId);
  } catch {
    // best-effort — see comment above.
  }
  try {
    await checkMilestones(prisma as unknown as Parameters<typeof checkMilestones>[0], identity.userId);
  } catch {
    // best-effort — see comment above.
  }

  const today = await buildMissionControlToday(identity.userId, {
    greetingName: firstName,
    organizationId: identity.organizationId,
  });

  return NextResponse.json(today);
});
