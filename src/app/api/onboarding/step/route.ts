import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Role } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { withRole } from '@/lib/auth/with-role';
import { OnboardingStep, OnboardingSession, STEP_ORDER, MIN_COMMITMENT_SCORE, OrgType } from '@/types/onboarding';
import { onboardingService, type OnboardingStepPayload } from '@/services/onboarding/service';
import {
  checkSolutionNumberForOrg,
  decryptSolutionNumberFromStorage,
  encryptSolutionNumberForStorage,
} from '@/services/onboarding/wp01/solution-number';
// T-R36: the REAL onboarding-session persistence — replaces the in-memory `sessions: any[] = []`
// test seam this route used to read/write, which no real production call ever populated (every real
// user's first submission 404'd downstream at `/complete`, since nothing ever created a session for
// them). This route is the one lifecycle call-site allowed to CREATE a session on a miss — "when
// onboarding starts" (see session-store.ts's own header comment for why that's the honest "start"
// moment in an app whose real client doesn't call this route yet).
import {
  fromPersistedStep,
  getOrCreateOnboardingSession,
  toJsonUpdateValue,
  toPersistedStep,
  type OnboardingSessionUpdateData,
} from '@/services/onboarding/wp01/session-store';

const ALL_ROLES = Object.values(Role);

// Force per-request (dynamic) rendering — this route now reads the live session on every request
// (same rationale as /api/onboarding/consent, /api/onboarding/complete).
export const dynamic = 'force-dynamic';

interface StepRequestBody {
  step?: OnboardingStep;
  data?: Record<string, unknown>;
}

// Deliberately built on `withRole` (the REAL Auth.js session) — the same posture every other
// real-persistence onboarding route in this codebase now uses (`/consent`, `/contacts-import`,
// `/complete`). This route no longer trusts any `x-user-*` header: every session it reads or
// writes is looked up by `authSession.user.id`, so a caller can only ever advance THEIR OWN
// onboarding session.
export const POST = withRole(ALL_ROLES, async (req: NextRequest, _ctx, authSession) => {
  try {
    const userId = authSession.user.id;

    let body: StepRequestBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { step, data } = body;

    if (!step || !data) {
      return NextResponse.json(
        { error: 'step and data are required' },
        { status: 400 }
      );
    }

    const row = await getOrCreateOnboardingSession(prisma, userId);

    if (row.completed) {
      return NextResponse.json(
        { error: 'Onboarding already completed' },
        { status: 400 }
      );
    }

    const currentStep = fromPersistedStep(row.current_step);

    // Validate step progression
    const currentIdx = STEP_ORDER.indexOf(currentStep);
    const submittedIdx = STEP_ORDER.indexOf(step);

    if (submittedIdx !== currentIdx) {
      return NextResponse.json(
        { error: `Expected step ${currentStep}, received ${step}` },
        { status: 400 }
      );
    }

    // T-R38: `solution_number` is now also selected here — the dense-track (UPLINE/RVP) fallback
    // below needs the already-persisted, encrypted value to satisfy `ROLE_ORG_CONTEXT` without
    // requiring the caller to resubmit it.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, org_type: true, solution_number: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'Onboarding session not found' }, { status: 404 });
    }

    // A view shape matching the `OnboardingSession` TS interface `OnboardingService` expects —
    // `role`/`org_type` come from the real `User` row (see session-store.ts's field-ownership
    // comment), the rest from the real persisted session row.
    const sessionView = {
      role: user.role,
      org_type: user.org_type,
      current_step: step, // === currentStep, just proven equal by the STEP_ORDER index check above
      seven_whys: row.seven_whys,
      goal_card: row.goal_card,
      intensity_data: row.intensity_data,
      completed: row.completed,
    } as unknown as OnboardingSession;

    // T-R38 (§6.3, §17.1) — DENSE-TRACK SOLUTION-NUMBER FALLBACK: `UplineTrack.tsx` (the dense
    // UPLINE/RVP/dual-derived onboarding UI) has no re-entry field for the Primerica solution
    // number, so its real `ROLE_ORG_CONTEXT` submission omits `solution_number`/`solutionNumber`
    // entirely (see `buildDenseTrackStepPlan`/`buildRoleOrgContextPayload`,
    // onboarding-step-client.ts) — `validateStep`'s format gate then had no value to check and
    // failed closed with a 400 for every Primerica dense user, even though the SAME value was
    // already captured and persisted (encrypted) at §6.3 registration (`User.solution_number`).
    // Rather than adding a new UI capture field or weakening the format gate, reuse the value that
    // already exists: if this is a Primerica `ROLE_ORG_CONTEXT` submission and the payload itself
    // supplies NO value (neither key — an explicit submission always wins and is never silently
    // overridden), decrypt the persisted value server-side and hand `validateStep` an equivalent
    // payload. Decryption only ever happens for this exact branch (Primerica + payload omitted) —
    // never for a universal user, never when the caller already supplied their own value — and a
    // decrypt failure (see `decryptSolutionNumberFromStorage`'s own fail-closed doc comment) simply
    // leaves the payload unchanged, so the caller gets the same honest 400 as "never had one".
    let stepData: OnboardingStepPayload = data;
    if (step === OnboardingStep.ROLE_ORG_CONTEXT) {
      const submittedSolutionNumber = (data.solution_number ?? data.solutionNumber) as string | undefined;
      const effectiveOrgType =
        (data.orgType as OrgType | undefined) ?? (data.org_type as OrgType | undefined) ?? user.org_type;
      if (!submittedSolutionNumber && effectiveOrgType === OrgType.PRIMERICA && user.solution_number) {
        const persistedSolutionNumber = decryptSolutionNumberFromStorage(user.solution_number);
        if (persistedSolutionNumber) {
          stepData = { ...data, solution_number: persistedSolutionNumber };
        }
      }
    }

    // Business rule validation
    const validation = onboardingService.validateStep(sessionView, step, stepData as OnboardingStepPayload);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Update session data. `org_type`/`solution_number` are real `User` columns (already set at
    // registration, `POST /api/auth/register` — this branch lets an ACCOUNT_TYPE/REGISTER-step
    // submission correct/declare them later in the flow, same as before this fix, just written to
    // the real column instead of a fake in-memory one). Solution number is encrypted before it ever
    // touches persistence — the same `encryptSolutionNumberForStorage` the register route uses
    // (§3.2 "encrypted, Primerica only") — never the raw digits.
    if (step === OnboardingStep.REGISTER) {
      const orgType = data.orgType as OrgType | undefined;
      if (orgType) {
        await prisma.user.update({ where: { id: userId }, data: { org_type: orgType } });
      }
      const solutionNumber = data.solutionNumber as string | undefined;
      if (solutionNumber) {
        const effectiveOrgType = orgType ?? user.org_type;
        const check = checkSolutionNumberForOrg(effectiveOrgType, solutionNumber);
        // Same posture as before this fix: this legacy REGISTER-step branch performs no format
        // rejection of its own (that gate is `ROLE_ORG_CONTEXT`'s job, via `validateStep` above) —
        // it just never persists a value it cannot safely encrypt-and-store, rather than silently
        // writing plaintext or a garbage value.
        if (check.formatValid) {
          await prisma.user.update({
            where: { id: userId },
            data: { solution_number: encryptSolutionNumberForStorage(solutionNumber) },
          });
        }
      }
    }

    const updateData: OnboardingSessionUpdateData = {};

    if (step === OnboardingStep.SEVEN_WHYS) {
      updateData.seven_whys = toJsonUpdateValue(data.sevenWhys);
      // Also check intensity commitment gate if present
      if (data.intensityData) {
        const score = (data.intensityData as { commitmentScore: number }).commitmentScore;
        if (score < MIN_COMMITMENT_SCORE) {
          return NextResponse.json(
            { error: `Commitment score must be at least ${MIN_COMMITMENT_SCORE}/10 to proceed` },
            { status: 400 }
          );
        }
      }
    }
    if (step === OnboardingStep.GOAL_CARD) {
      updateData.goal_card = toJsonUpdateValue(data.goalCard);
    }
    if (step === OnboardingStep.INTENSITY) {
      updateData.intensity_data = toJsonUpdateValue(data.intensityData);
      const score = (data.intensityData as { commitmentScore?: number })?.commitmentScore ?? 0;
      if (score < MIN_COMMITMENT_SCORE) {
        return NextResponse.json(
          { error: `Commitment score must be at least ${MIN_COMMITMENT_SCORE}/10 to complete onboarding` },
          { status: 400 }
        );
      }
      // R-10 — the O-4 goal fields (income goal / weekly time / promotion target) ride the INTENSITY
      // payload; copy the three optional fields onto the session's `goal_fields` JSON. `validateStep`
      // above already format-gated every PRESENT field, and absent fields are simply not written
      // (the column stays SQL NULL) — never fabricated. This is a durable audit copy of the
      // `intensity_data` fields, exactly `sponsor_decision`'s (R-08) posture.
      const goals = (data.intensityData as {
        monthlyIncomeGoal?: unknown;
        weeklyTimeCommitment?: unknown;
        promotionTarget?: unknown;
      }) ?? {};
      const goalFields: Record<string, unknown> = {};
      if (goals.monthlyIncomeGoal !== undefined && goals.monthlyIncomeGoal !== null) {
        goalFields.monthlyIncomeGoal = goals.monthlyIncomeGoal;
      }
      if (goals.weeklyTimeCommitment !== undefined && goals.weeklyTimeCommitment !== null) {
        goalFields.weeklyTimeCommitment = goals.weeklyTimeCommitment;
      }
      if (goals.promotionTarget !== undefined && goals.promotionTarget !== null) {
        goalFields.promotionTarget = goals.promotionTarget;
      }
      if (Object.keys(goalFields).length > 0) {
        updateData.goal_fields = toJsonUpdateValue(goalFields);
      }
    }
    // T-21R (§6.10-10): `validateStep` above already rejected this request if `data.gdpr_consent`
    // wasn't explicitly `true` — reaching here means an explicit affirmative consent act occurred.
    // Unlike the pre-T-R36 in-memory demo (which set a fake `session.gdpr_consent` field on the
    // spot), this route does NOT itself write GDPR consent anywhere: the REAL, durable, versioned
    // `ComplianceConsent` row + `User.gdpr_consent` write is `POST /api/onboarding/consent`'s job
    // (WP11's `ConsentManager`, T-21R) — the completion route (`/complete`, T-R36) reads that same
    // real column. Duplicating the write here would create a second, divergent consent-write path
    // outside WP11's versioned audit trail, so this step only validates and advances.

    const nextStep = onboardingService.getNextStep({ ...sessionView, current_step: step } as OnboardingSession);
    if (nextStep) {
      updateData.current_step = toPersistedStep(nextStep);
    }

    const updated = await prisma.onboardingSession.update({ where: { id: row.id }, data: updateData });

    return NextResponse.json({
      currentStep: fromPersistedStep(updated.current_step),
      completed: updated.completed,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
