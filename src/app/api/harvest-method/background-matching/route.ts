import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { LayerOrderViolationError, MethodStateService } from '@/services/harvest-method/method-state.service';
import { NoteTooLongError } from '@/services/harvest-method/doctrine-notes';
import type { BackgroundMatchingSubmission } from '@/types/harvest-method';

// T-26 (§8.1 Layer 3 — Background Matching). UNIVERSAL for every organization (§8 preamble, §17.1).
// The readiness SCORE itself is computed by the queue orchestrator (prioritized-queue.service.ts),
// never returned by this route — this route only returns tile-completion + doctrine corrections.
export const dynamic = 'force-dynamic';

const service = new MethodStateService();

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    const body: BackgroundMatchingSubmission = await req.json();
    if (!Array.isArray(body.entries)) {
      return NextResponse.json({ error: 'entries array is required' }, { status: 400 });
    }

    const result = await service.submitBackgroundMatching(identity.userId, body);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LayerOrderViolationError) {
      return NextResponse.json({ error: error.message, code: 'LAYER_ORDER_VIOLATION' }, { status: 409 });
    }
    if (error instanceof NoteTooLongError) {
      return NextResponse.json({ error: error.message, code: 'NOTE_TOO_LONG' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
