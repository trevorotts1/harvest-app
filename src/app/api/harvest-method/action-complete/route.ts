import { NextResponse } from 'next/server';
import { markActionComplete } from '@/services/harvest-method/action-queue.service';
// T-20 §6.10-1: downstream (WP03) route, now behind the real onboarding gate (see onboarding-gate.ts).
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';

// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as session/whoami/route.ts.
export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    const { actionId } = await req.json();
    if (!actionId) return NextResponse.json({ error: 'actionId is required' }, { status: 400 });

    const result = markActionComplete(identity.userId, actionId);
    if (!result.available) return NextResponse.json({ available: false, reason: result.reason }, { status: 200 });
    return NextResponse.json({ success: result.success });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
