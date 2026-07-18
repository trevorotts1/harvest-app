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

// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as every sibling route.
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, session, identity) => {
  const firstName = (session.user.name ?? '').trim().split(/\s+/)[0] || 'there';

  const today = await buildMissionControlToday(identity.userId, {
    greetingName: firstName,
    organizationId: identity.organizationId,
  });

  return NextResponse.json(today);
});
