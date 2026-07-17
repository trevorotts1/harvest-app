import { NextResponse } from 'next/server';
import { getMethodState } from '@/services/harvest-method/method.service';
// T-20 §6.10-1: downstream (WP03) route, now behind the real onboarding gate (see briefing/route.ts).
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';

// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as session/whoami/route.ts.
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  try {
    const result = getMethodState(identity.userId);

    if (!result.available) {
      return NextResponse.json({ available: false, reason: result.reason }, { status: 200 });
    }

    return NextResponse.json(result.state);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});