import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { MethodStateService } from '@/services/harvest-method/method-state.service';
import type { BlankCanvasSubmission } from '@/types/harvest-method';

// T-26 (§8.1 Layer 1 — Blank Canvas). UNIVERSAL for every organization (§8 preamble, §17.1).
export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    // Lazy: constructed per-request, not at module scope, so `next build`'s page-data collection
    // (which imports this module) never triggers the constructor's fail-closed
    // `getContactEncryptionKey()` default read (T-26 build-integration fix).
    const service = new MethodStateService();
    const body: BlankCanvasSubmission = await req.json();

    if (typeof body.vaultCountAtStart !== 'number' || !Array.isArray(body.entries)) {
      return NextResponse.json({ error: 'vaultCountAtStart (number) and entries (array) are required' }, { status: 400 });
    }

    const result = await service.submitBlankCanvas(identity.userId, body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
