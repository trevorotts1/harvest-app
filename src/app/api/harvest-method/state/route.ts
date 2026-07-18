import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { MethodStateService } from '@/services/harvest-method/method-state.service';

// T-26 (§8 preamble, §17.1): UNIVERSAL for every organization — this route carries no org-gate
// check of its own. The old (pre-rebuild) version of this route refused every non-Primerica user,
// exactly inverted from the master spec's "WP03 is unblocked for all organizations."
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  try {
    // Lazy: constructed per-request, not at module scope, so `next build`'s page-data collection
    // (which imports this module) never triggers the constructor's fail-closed
    // `getContactEncryptionKey()` default read (T-26 build-integration fix).
    const service = new MethodStateService();
    const state = await service.getState(identity.userId);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
