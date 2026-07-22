import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { OnboardingStatus, Role, SponsorshipState } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { withRole } from '@/lib/auth/with-role';
// `OrgType`/`IntensitySetting` are re-exported via `@/types/onboarding` (which itself re-exports
// straight from `@prisma/client` — see that file's own T-17/T-19 QC-fix comments) rather than
// imported from the Prisma package's own module specifier directly, purely to minimize this diff
// against the file's pre-T-R36 import style. Unlike before this fix, this route now ALSO imports
// `@/lib/prisma` directly and goes through `withRole` (a real, verified Auth.js session) — so
// `scripts/verify-api-auth.mjs`'s forged-header guard is moot here by construction: this route no
// longer reads any `x-user-*` header at all (the T-R36 fix this file's own history warned about
// making live the moment real persistence landed — see the retired ./store.ts).
import { IntensitySetting, OrgType } from '@/types/onboarding';
// T-R35 (P1 fix, §6.9/§15.2): builds the exact declared `OnboardingCompletedEvent` shape and
// publishes it through an `OnboardingEventSink`. This module has ZERO dependency on the `inngest`
// package itself (see its own header comment) — only the production sink implementation
// (`InngestOnboardingEventSink`, payment-inngest-functions.ts) does, which is why THAT is imported
// lazily below rather than here at module scope.
import { emitOnboardingCompleted } from '@/services/onboarding/wp01/downstream-contracts';
// T-19 QC CRITICAL fix (§6.7): the ONLY tier source this route may consult now. It used to call
// `onboardingService.determineAccessTier(commitmentScore, session.org_type)` — a legacy function
// that assigned tier BY COMMITMENT SCORE (>=9 -> ENTERPRISE $25,000/yr, >=7 -> PAID_INDIVIDUAL
// $297/mo), which §6.7 never describes: tier is assigned "from auth source + org context", never a
// self-reported commitment slider. A SPONSORED user (should be free, org-subsidized) who rated
// their own commitment >=9 was silently promoted to a $25,000/yr tier. `assignAccessTierFromSignals`
// is the single §6.7-correct decision function (src/services/onboarding/wp01/access-tier.ts) —
// wiring it in here is what makes it reachable from the live app at all.
import { assignAccessTierFromSignals } from '@/services/onboarding/wp01/access-tier';
// T-21R (§6.10-10): the pure GDPR-consent completion precondition — see its module comment for why
// this is a SEPARATE function from the §6.10-1 downstream gate (`evaluateOnboardingGate`,
// identity-gate.ts), which this route/fix does not touch.
import { evaluateConsentCompletionGate } from '@/services/onboarding/wp01/consent-gate';
// T-R36: the REAL onboarding-session persistence — replaces the in-memory demo `sessions`/`users`
// arrays (`./store.ts`, now retired) that made every real user 404 here before this fix. See
// session-store.ts's own header comment for the full field-ownership rationale (why the session row
// only needs `current_step`/the three JSON blobs/`completed`, and every other signal this route
// reads — role, org_type, gdpr_consent — comes straight off the real `User` row instead).
import { fromPersistedStep, getOnboardingSession, toPersistedStep } from '@/services/onboarding/wp01/session-store';
import { OnboardingStep } from '@/types/onboarding';

const ALL_ROLES = Object.values(Role);

// Force per-request (dynamic) rendering — same rationale as `/api/onboarding/consent`: this route
// now reads the live session on every request and must never be statically optimized/cached across
// users.
export const dynamic = 'force-dynamic';

// Deliberately built on `withRole` (the REAL Auth.js session, `getCurrentSession` under the hood) —
// the SAME posture `/api/onboarding/consent` and `/api/onboarding/contacts-import` already
// established for this onboarding surface (T-21R/T-R30): "is there a valid, authenticated session
// at all" is the only authorization question — every role completes their OWN onboarding, so the
// allow-list is intentionally every role in the enum. This is also what makes "a user can only
// complete THEIR OWN session" a structural property rather than a check: every persisted-session
// lookup below is keyed by `authSession.user.id`, never a client-supplied id, so there is no request
// shape through which caller A can ever target caller B's session.
export const POST = withRole(ALL_ROLES, async (_req: NextRequest, _ctx, authSession) => {
  try {
    const userId = authSession.user.id;

    // T-R36: READ THE REAL PERSISTED SESSION — the fix's central point. `getOnboardingSession`
    // (never `getOrCreateOnboardingSession`) so a user with no session yet gets an honest 404, not a
    // silently-created empty one they could then "complete" with nothing in it.
    const onboardingRow = await getOnboardingSession(prisma, userId);

    if (!onboardingRow) {
      return NextResponse.json(
        { error: 'Onboarding session not found' },
        { status: 404 }
      );
    }

    if (onboardingRow.completed) {
      return NextResponse.json(
        { error: 'Onboarding already completed' },
        { status: 400 }
      );
    }

    const currentStep = fromPersistedStep(onboardingRow.current_step);

    // Check that we're at the INTENSITY or CONSENT_CAPTURE step (last before complete) — T-21R adds
    // CONSENT_CAPTURE (§6.10-10) as the true final step for every role's ROLE_STEP_MAP
    // (types/onboarding.ts), and T-R36's enum-widening migration is what makes persisting a session
    // that has actually reached it possible at all (see prisma/schema.prisma's OnboardingStep
    // comment).
    if (
      currentStep !== OnboardingStep.INTENSITY &&
      currentStep !== OnboardingStep.CONSENT_CAPTURE &&
      currentStep !== OnboardingStep.COMPLETE
    ) {
      return NextResponse.json(
        { error: 'Cannot complete onboarding before reaching INTENSITY step' },
        { status: 400 }
      );
    }

    // Validate intensity data exists — real persisted JSON, not an in-memory fixture.
    const intensityData = onboardingRow.intensity_data as
      | { commitmentScore?: number; riskTolerance?: string }
      | null;
    if (!intensityData) {
      return NextResponse.json(
        { error: 'Intensity data is required before completing onboarding' },
        { status: 400 }
      );
    }

    const commitmentScore = intensityData.commitmentScore ?? 0;

    // Check commitment threshold
    if (commitmentScore < 5) {
      return NextResponse.json(
        { error: 'Commitment score must be at least 5/10 to complete onboarding' },
        { status: 400 }
      );
    }

    // T-R36: role/org_type/gdpr_consent are real `User` columns (prisma/schema.prisma) — never
    // duplicated onto the session row (see session-store.ts's header comment on field ownership).
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, org_type: true, gdpr_consent: true },
    });
    if (!user) {
      // Structurally near-unreachable (withRole already proved a live session for this id), but
      // fail closed rather than assume — same honest-404 posture as the missing-session case above.
      return NextResponse.json(
        { error: 'Onboarding session not found' },
        { status: 404 }
      );
    }

    // T-21R (§6.10-10) — GDPR CONSENT COMPLETION PRECONDITION: a user must never reach
    // GATED_COMPLETE without a recorded, affirmative GDPR consent event. Fail-closed — anything
    // other than an explicit `true` on the REAL `User.gdpr_consent` column (durably written by
    // `POST /api/onboarding/consent`'s `grantGdprConsent`, T-21R — never this route) blocks
    // completion outright, same as the commitment-score check just above.
    const consentOutcome = evaluateConsentCompletionGate(user.gdpr_consent);
    if (!consentOutcome.allowed) {
      return NextResponse.json(
        {
          error: 'GDPR consent is required to complete onboarding (§6.10-10)',
          code: consentOutcome.reason,
        },
        { status: 400 }
      );
    }

    // T-R36: `sponsorLinked` used to read a fake `session.sponsor_id` field that no live route ever
    // populated. The REAL signal is the same one `provisionFromContract` (payment/provisioning.ts)
    // itself reads downstream — an ACTIVE `Sponsorship` row for this member — so tier assignment
    // here and provisioning's own sponsor lookup can never disagree about "does this user have a
    // sponsor".
    const sponsorship = await prisma.sponsorship.findFirst({
      where: { member_user_id: userId, state: SponsorshipState.ACTIVE },
      select: { sponsor_user_id: true },
    });

    // Finalize: determine access tier — §6.7 SIGNALS ONLY, never `commitmentScore` (that variable
    // stays above purely to gate onboarding completion and to record `user.commitment_score` for
    // reporting; it must never again feed the tier decision).
    //
    // This app has exactly one wired registration auth method (T-04's email/password
    // `CredentialsProvider` — no `primerica_portal_oauth` provider exists anywhere in the codebase
    // yet), so `authMethod` is always `'email_password'` at this call site. `sponsorLinked` is true
    // when a real ACTIVE Sponsorship row links this user to a sponsor, OR when the user's org
    // context is Primerica: a Primerica rep onboards under their existing upline/org by
    // construction, the same "org context implies sponsorship" convention
    // `OnboardingService.determineAccessTier`/`seedAccessTier` already use for that org type.
    const accessTier = assignAccessTierFromSignals({
      authMethod: 'email_password',
      sponsorLinked: Boolean(sponsorship) || user.org_type === OrgType.PRIMERICA,
    });

    const goalCard = onboardingRow.goal_card as { anchorStatement?: string } | null;
    const intensitySetting = intensityData.riskTolerance as IntensitySetting;

    // T-R35 (P1 fix, §6.9/§15.2) — PUBLISH `user.onboarding_completed` through the PRODUCTION
    // Inngest client, mirroring `InngestDurableQueue`'s `inngest.send` pattern
    // (agent-runtime/inngest-functions.ts) — the only other real producer in this codebase. This is
    // what makes the registered `provisionOnOnboardingCompletedFunction` subscriber
    // (payment-inngest-functions.ts, served at /api/inngest) actually fire; before T-R35 nothing in
    // the live app ever called it, and before T-R36 no REAL user's session could ever reach this
    // line at all (see this file's own git history / the retired ./store.ts).
    //
    // Deliberately published BEFORE the session/user are mutated below (not after): a publish
    // failure (`inngest.send` throwing — e.g. a transient Inngest/network fault) propagates to this
    // route's own top-level try/catch and surfaces as a real 500, fail-closed rather than silently
    // swallowed, and — because the session is NOT yet marked `completed` — the caller can safely
    // retry the same POST, which will attempt the publish again (`session.completed` still blocks a
    // SECOND attempt only once this call has actually succeeded). A duplicate publish from a client
    // retry lands on the exact same idempotent guard `provisionFromContract` already enforces for
    // an Inngest-level redelivery (at most one ACTIVE subscription per user_id) — see
    // provisioning.ts's own doc comment — so it can never double-provision either way.
    //
    // Payload — every field is one of the exact 7 declared on `OnboardingCompletedEvent`
    // (types/onboarding.ts:463-471: `event`, `user_id`, `role`, `access_tier`, `organization`,
    // `anchor_statement`, `intensity_setting`), sourced from real, persisted onboarding data
    // established above in this handler, never fabricated:
    //   - user_id / role: the authenticated session's own id + the real `User.role`.
    //   - access_tier: `accessTier`, the §6.7-correct value just computed above from signals, never
    //     `commitmentScore` (see the T-19 fix comment above).
    //   - organization: §6.8 models org membership as a SET, but this app only ever tracks a single
    //     `org_type` category on `User` (there is no real multi-org id list yet) — carried here as
    //     the one-element array the user actually has, never a fabricated org id.
    //   - anchor_statement: §6.4's Seven Whys anchor, sourced from the persisted
    //     `OnboardingSession.goal_card.anchorStatement` — only the rep track (Flow A/C) ever
    //     produces one; per downstream-contracts.ts's own documented convention for this exact
    //     non-nullable field, a track with none passes `''`.
    //   - intensity_setting: the persisted `OnboardingSession.intensity_data.riskTolerance`, whose
    //     `'LOW' | 'MEDIUM' | 'HIGH'` literal values are IDENTICAL to the `IntensitySetting` enum's
    //     own members (prisma/schema.prisma) — the same value under two names, not an invented
    //     mapping — and `intensity_data` is guaranteed present by the required-field check earlier
    //     in this handler.
    const { InngestOnboardingEventSink } = await import(
      '@/services/payment/inngest/payment-inngest-functions'
    );
    await emitOnboardingCompleted(new InngestOnboardingEventSink(), {
      user_id: userId,
      role: user.role,
      access_tier: accessTier,
      organization: [user.org_type],
      anchor_statement: goalCard?.anchorStatement ?? '',
      intensity_setting: intensitySetting,
    });

    // T-R36: mark completion for REAL, ATOMICALLY (a single `$transaction` — either both writes
    // land or neither does). This closes the actual production gap the whole ticket exists for:
    // the pre-fix route only ever mutated an in-memory `user.access_tier`/`commitment_score` that
    // vanished at request end, and NEVER wrote `User.onboarding_status`. `provisionFromContract`'s
    // own fail-closed §15.2 precondition reads exactly that column and REFUSES to provision unless
    // it is `GATED_COMPLETE` — so even with T-R35's publish wired correctly, a real subscriber
    // consuming a real published event would have hit `ProvisioningNotAllowedError` forever, because
    // nothing ever flipped the real row. Doing both writes in one transaction (rather than one write
    // succeeding and the other failing) also avoids stranding the session in `completed: true` with
    // `onboarding_status` never flipped — a state a retry could never repair, since a completed
    // session short-circuits with 400 above before reaching this point again.
    await prisma.$transaction([
      prisma.onboardingSession.update({
        where: { id: onboardingRow.id },
        data: { completed: true, current_step: toPersistedStep(OnboardingStep.COMPLETE) },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          access_tier: accessTier,
          commitment_score: commitmentScore,
          intensity_setting: intensitySetting,
          onboarding_status: OnboardingStatus.GATED_COMPLETE,
        },
      }),
    ]);

    return NextResponse.json({
      completed: true,
      accessTier,
      commitmentScore,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
