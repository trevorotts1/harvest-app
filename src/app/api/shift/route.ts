import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ShiftService } from '@/services/learning-state/shift.service';
import type { ShiftMode } from '@/types/learning-state';

// T-34 (master-spec §9.8 "The Shift", uiux §5.3) — fetches (creating if needed) today's bounded
// daily ritual state: Open recap + the real Work-phase card stack. `?mode=short` selects the
// 10-minute variant (uiux §5.3 "Short mode ... reachable from the re-engagement deep link",
// AC-5.3-4).
//
// Session-gated (withOnboardingGate) — identity comes from the verified session, never a
// client-forged `x-user-id` header. Ownership is enforced by scoping every query to
// `identity.userId` (see ShiftService), and the session row itself is keyed on (user_id,
// session_date) so no cross-account read is possible.
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  try {
    const modeParam = req.nextUrl.searchParams.get('mode');
    const mode: ShiftMode = modeParam === 'short' ? 'SHORT' : 'STANDARD';

    // Lazy: constructed per-request, not at module scope.
    const service = new ShiftService();
    const view = await service.getOrCreateToday(identity.userId, mode);
    return NextResponse.json(view);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
