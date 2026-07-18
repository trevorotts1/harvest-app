import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { LayerOrderViolationError, MethodStateService } from '@/services/harvest-method/method-state.service';
import type { QualitiesFlipSubmission } from '@/types/harvest-method';

// T-26 (§8.1 Layer 2 — Qualities Flip, the SIX clusters govern per §8.1/uiux §5.4). UNIVERSAL for
// every organization (§8 preamble, §17.1).
export const dynamic = 'force-dynamic';

const service = new MethodStateService();

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    const body: QualitiesFlipSubmission = await req.json();

    if (!Array.isArray(body.selectedClusters) || !Array.isArray(body.assignments)) {
      return NextResponse.json({ error: 'selectedClusters and assignments arrays are required' }, { status: 400 });
    }

    const result = await service.submitQualitiesFlip(identity.userId, body);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LayerOrderViolationError) {
      return NextResponse.json({ error: error.message, code: 'LAYER_ORDER_VIOLATION' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
