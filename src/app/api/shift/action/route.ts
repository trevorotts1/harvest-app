import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ShiftApprovalRequiresReviewError, ShiftOwnershipError, ShiftService } from '@/services/learning-state/shift.service';
import type { ShiftCardAction } from '@/types/learning-state';

const VALID_ACTIONS: ShiftCardAction[] = ['APPROVE', 'DECLINE', 'SKIP', 'CONFIRM', 'LOG'];

// T-34 (uiux §5.3) — acts on exactly one card in the Work-phase stack (approve/decline/skip/
// confirm/log). Session-gated; the card's OWNERSHIP is re-verified against the real backing row
// inside ShiftService.actionCard — a forged cardId belonging to another user's DraftMessage/
// Appointment is refused (ShiftOwnershipError -> 403), never trusted from the request body.
export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { cardId, action } = body as { cardId?: unknown; action?: unknown };
    if (!cardId || typeof cardId !== 'string') {
      return NextResponse.json({ error: 'cardId is required' }, { status: 400 });
    }
    if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as ShiftCardAction)) {
      return NextResponse.json({ error: `action must be one of ${VALID_ACTIONS.join(', ')}` }, { status: 400 });
    }

    const service = new ShiftService();
    const view = await service.actionCard(identity.userId, cardId, action as ShiftCardAction);
    return NextResponse.json(view);
  } catch (error) {
    if (error instanceof ShiftOwnershipError) {
      return NextResponse.json({ error: error.message, code: 'NOT_OWNED' }, { status: 403 });
    }
    if (error instanceof ShiftApprovalRequiresReviewError) {
      // T-34 QC fix (D2, fail-closed): ShiftService.actionCard already refuses an APPROVE on a
      // non-PASS (FLAG/BLOCK) draft BEFORE any mutation — this is the ROUTE-layer half of that
      // defense in depth, surfaced as a distinct, non-500 refusal code (mirrors the existing
      // LAYER_ORDER_VIOLATION 409 convention, e.g. src/app/api/harvest-method/qualities-flip/route.ts)
      // so a caller can tell "this needs real compliance review" apart from "something broke."
      return NextResponse.json({ error: error.message, code: 'REQUIRES_REVIEW' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
