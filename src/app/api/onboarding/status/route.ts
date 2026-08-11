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
// R-05 (§6.3, §6.10-4) — the at-rest SOLUTION-NUMBER presence probe, used ONLY to render the
// saved-value MASK state on the O-3 org-context screen (the solution number is captured exactly
// once, at registration; later steps read the already-persisted value back — never re-prompt).
// `decryptSolutionNumberFromStorage` fails closed to `null` on ANY error (missing value, malformed
// envelope, wrong/rotated key, tampered ciphertext), so this probe is exactly as honest as the
// step route's own reuse fallback: "has a reusable persisted value" is true only when the value
// can genuinely be decrypted with the current at-rest key. The boolean NEVER carries the value —
// the raw digits never cross this API, and the UI renders only the mask either way (§6.10-4).
import { decryptSolutionNumberFromStorage } from '@/services/onboarding/wp01/solution-number';

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

    // R-05 — `hasSolutionNumber` is a Primerica-gated PRESENCE signal (true/false only, never the
    // value) that lets the O-3 screen render the persisted solution number's masked saved-state
    // (§6.10-4 "never displayed after entry" — the mask is the only display form, and the caption
    // stays the module's not-verified honesty line). Reading it here reuses the SAME
    // server-side decrypt (`decryptSolutionNumberFromStorage`) the `/step` route's reuse fallback
    // uses, so the mask the UI shows and the value the format gate reuses are decided by exactly
    // the same fail-closed rule. A universal user never sees the field at all — this probe is
    // rendered only behind the O-3 org branch (see OrgStep.tsx), and it carries no Primerica
    // string that could leak.
    const user = await prisma.user.findUnique({
      where: { id: authSession.user.id },
      select: { solution_number: true },
    });
    const hasSolutionNumber =
      user !== null && decryptSolutionNumberFromStorage(user.solution_number) !== null;

    return NextResponse.json({
      currentStep: fromPersistedStep(row.current_step),
      completed: row.completed,
      sevenWhys: row.seven_whys,
      goalCard: row.goal_card,
      intensityData: row.intensity_data,
      // R-10 — the O-4 step's persisted goal fields (JSON copy of the INTENSITY payload's
      // monthlyIncomeGoal / weeklyTimeCommitment / promotionTarget); `null` when the step was
      // never reached or no fields were captured.
      goalFields: row.goal_fields,
      // R-05 — the presence-only signal; the value itself never leaves this route.
      hasSolutionNumber,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
