import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ShiftService } from '@/services/learning-state/shift.service';

// T-34 (uiux §5.3) — Open -> Work (or straight to Close on an empty queue, AC-5.3-9). Session-gated;
// identity comes from the verified session only.
export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  try {
    const service = new ShiftService();
    const view = await service.begin(identity.userId);
    return NextResponse.json(view);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
