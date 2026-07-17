// WP01 §6.10-1 — the Edge-safe half of the onboarding gate (T-20).
//
// `src/middleware.ts` runs on Next.js's Edge runtime, where the Prisma client (and the full Auth.js
// server chain) cannot be imported. So the PURE page-gate decision the middleware needs lives here,
// with ZERO server-only imports — NOT EVEN `@prisma/client` (importing an enum from it pulls the
// non-Edge-compatible client runtime into the middleware bundle, which breaks the build / boot). The
// one enum value this file needs — `GATED_COMPLETE` — is inlined as a plain string constant below and
// kept in lockstep with the Prisma `OnboardingStatus.GATED_COMPLETE` member. The DB-backed route
// wrapper (`withOnboardingGate`, onboarding-gate.ts) is where the real Prisma enum is used.

/**
 * The one `OnboardingStatus` value the Edge page-gate compares against, inlined as a literal so this
 * module imports nothing from `@prisma/client`. MUST equal `OnboardingStatus.GATED_COMPLETE` — a
 * compile-time assertion in onboarding-gate.ts (`GATED_COMPLETE_VALUE satisfies OnboardingStatus`)
 * fails typecheck if the Prisma enum member is ever renamed, so this can't silently drift.
 */
export const GATED_COMPLETE_VALUE = 'GATED_COMPLETE';

/**
 * The downstream (post-onboarding) PAGE route prefixes the §6.10-1 gate protects. `/onboarding/*`
 * and `/auth` are DELIBERATELY absent — identity capture and the resume flow ARE onboarding, so a
 * not-complete user must be able to reach them (gating them would dead-end the very flow that clears
 * the gate). `/dashboard` stays first so the T-04 middleware manifest guard (verify-middleware.mjs)
 * keeps passing.
 */
export const GATED_DOWNSTREAM_PAGE_PREFIXES: readonly string[] = [
  '/dashboard',
  '/today',
  '/shift',
  '/inbox',
  '/community',
  '/grow',
  '/learn',
  '/me',
  '/team',
  '/ritual',
];

export function isGatedDownstreamPage(pathname: string): boolean {
  return GATED_DOWNSTREAM_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * The middleware's pure decision: for an AUTHENTICATED request (the auth check is `withAuth`'s job),
 * should it be redirected into onboarding? True iff the path is a gated downstream page AND the
 * token's `onboardingStatus` claim is not GATED_COMPLETE. Fail-closed: an absent/unknown claim is
 * treated as not-complete (redirect). A non-gated page (including `/onboarding/*`) is never
 * redirected.
 */
export function shouldRedirectToOnboarding(
  pathname: string,
  onboardingStatus: string | null | undefined
): boolean {
  if (!isGatedDownstreamPage(pathname)) return false;
  return onboardingStatus !== GATED_COMPLETE_VALUE;
}

export const ONBOARDING_RESUME_REDIRECT = '/onboarding/resume';
