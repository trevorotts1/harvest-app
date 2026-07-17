import { NextResponse } from 'next/server';
import { submitQualitiesFlip } from '@/services/harvest-method/method.service';
import { QualitiesFlipData } from '@/types/harvest-method';
// T-20 §6.10-1: downstream (WP03) route, now behind the real onboarding gate (see onboarding-gate.ts).
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';

// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as session/whoami/route.ts.
export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    const body: QualitiesFlipData = await req.json();

    if (!body.strengths || !body.values || !body.skills) {
      return NextResponse.json(
        { error: 'strengths, values, and skills are required' },
        { status: 400 },
      );
    }

    const result = submitQualitiesFlip(identity.userId, body);

    if (!result.available) {
      return NextResponse.json({ available: false, reason: result.reason }, { status: 200 });
    }

    return NextResponse.json(result.state);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
