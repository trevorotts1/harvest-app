import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Role } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { withRole } from '@/lib/auth/with-role';
// T-R36: the REAL onboarding-session persistence — replaces the in-memory `_sessions: any[] = []`
// test seam this route used to read, which no real production call ever populated. Read-only lookup
// (`getOnboardingSession`, never the get-or-create variant): a caller with no session yet gets an
// honest 404, exactly like before this fix, never a silently-created empty one.
import { fromPersistedStep, getOnboardingSession } from '@/services/onboarding/wp01/session-store';

const ALL_ROLES = Object.values(Role);

// Force per-request (dynamic) rendering — this route now reads the live session on every request
// (same rationale as /api/onboarding/consent, /api/onboarding/complete, /api/onboarding/step).
export const dynamic = 'force-dynamic';

// Deliberately built on `withRole` (the REAL Auth.js session) — the same posture every other
// real-persistence onboarding route in this codebase now uses. No `x-user-*` header is read or
// trusted: the session looked up is always the caller's own (`authSession.user.id`).
export const GET = withRole(ALL_ROLES, async (_req: NextRequest, _ctx, authSession) => {
  try {
    const row = await getOnboardingSession(prisma, authSession.user.id);

    if (!row) {
      return NextResponse.json(
        { error: 'Onboarding session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      currentStep: fromPersistedStep(row.current_step),
      completed: row.completed,
      sevenWhys: row.seven_whys,
      goalCard: row.goal_card,
      intensityData: row.intensity_data,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
