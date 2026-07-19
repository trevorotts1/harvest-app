import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { LearningStateService } from '@/services/learning-state/learning-state.service';

// T-34 (master-spec §9.7 "the two ratios", §9.5 item 5) — the Agent's Ratio + Field Trainer's
// Ratio, computed live from this rep's own real Contact/Appointment data and gated by the durable
// learning-state threshold (baseline 20:5:1 "learning your community" until 20-50 data points).
//
// Session-gated (withOnboardingGate) — identity comes from the verified session, never a
// client-forged `x-user-id` header. Ownership is enforced entirely by scoping every underlying
// query to `identity.userId` (see LearningStateService).
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  try {
    // Lazy: constructed per-request, not at module scope — same convention as
    // src/app/api/harvest-method/state/route.ts.
    const service = new LearningStateService();
    const view = await service.recomputeAndGetView(identity.userId);
    return NextResponse.json(view);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
