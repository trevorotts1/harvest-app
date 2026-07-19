import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ShiftService } from '@/services/learning-state/shift.service';

// T-34 (uiux §5.3) — Close: freezes elapsed time, applies the streak (with automatic grace-day
// repair), and reaches the explicit "You're done for today" state (AC-5.3-3). The optional
// reflection is equal-weight-skippable (AC-5.3-5) — an absent/empty `reflectionText` is not an
// error.
export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // A body-less close (reflection skipped) is valid — see header note.
      body = {};
    }

    const { reflectionText } = body as { reflectionText?: unknown };
    if (reflectionText !== undefined && typeof reflectionText !== 'string') {
      return NextResponse.json({ error: '"reflectionText" must be a string' }, { status: 400 });
    }

    const service = new ShiftService();
    const view = await service.close(identity.userId, reflectionText as string | undefined);
    return NextResponse.json(view);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
