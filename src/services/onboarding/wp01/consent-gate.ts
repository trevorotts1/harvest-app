// WP01 §6.10-10 (T-21R) — the GDPR consent COMPLETION precondition.
//
// Distinct and separate from the §6.10-1 DOWNSTREAM onboarding gate (`evaluateOnboardingGate` in
// `identity-gate.ts`, consumed by `withOnboardingGate`/`src/middleware.ts`): that gate decides whether
// an ALREADY-onboarded-or-not user may reach a post-onboarding (WP02-WP10) surface, and this module
// does not touch it, wrap it, or change its behavior in any way. This module answers a narrower,
// earlier question — can a user's onboarding be marked COMPLETE at all — and is consumed only by the
// completion path (`POST /api/onboarding/complete`, `OnboardingService.validateStep` for the
// `CONSENT_CAPTURE` step). A user who never granted GDPR consent (§6.10-10: "GDPR consent captured,
// timestamped, versioned, revocable") must never be able to complete onboarding, regardless of every
// other completion signal (commitment score, sponsor, etc.) being satisfied.
//
// Kept pure (no Prisma, no ConsentManager import) — the same "pure decision function, wired in at the
// route layer" pattern `evaluateOnboardingGate`/`evaluateStepGate` (tracks.ts) already use — so the
// rule is unit-testable without any persistence layer and so the route/service call-sites stay the
// single place this precondition is enforced.

export type ConsentCompletionOutcome =
  | { allowed: true }
  | { allowed: false; reason: 'GDPR_CONSENT_REQUIRED' };

/**
 * Can onboarding be marked complete for this user? Fail-closed: only an explicit boolean `true`
 * passes — `false`, `undefined`, `null`, or any other value (a garbage/never-set session field)
 * blocks completion. Mirrors the fail-closed posture of `evaluateOnboardingGate` (identity-gate.ts) and
 * `evaluateStepGate` (tracks.ts): this never "warns and continues".
 */
export function evaluateConsentCompletionGate(gdprConsent: unknown): ConsentCompletionOutcome {
  if (gdprConsent === true) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'GDPR_CONSENT_REQUIRED' };
}
