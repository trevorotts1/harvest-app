// WP01 §6.1 — the master identity gate: the entry gate EVERY user passes before any onboarding
// track or downstream (WP02–WP10) surface is reachable.
//
// This is the spine's front door. It is wired to the Auth.js session (T-04, src/lib/auth/*) and the
// canonical five-role model (Prisma `Role`, §3.1) — `resolveIdentity` reads the exact session shape
// the T-04 `session` callback stamps (src/lib/auth/options.ts + src/types/next-auth.d.ts) and turns
// it into an authoritative `IdentityContext` the rest of WP01 (roles, org gate, tracks) consumes.
//
// FAIL-CLOSED BY CONSTRUCTION (§6.10-1, QC "gate bypass" critical failure): no session → denied
// UNAUTHENTICATED; a session missing a role/org/user-id, or carrying a role/org value outside the
// canonical enums (a forged or drifted token) → denied INCOMPLETE_IDENTITY. The gate never
// "warns and continues" and never infers a default role — an unauthenticated or malformed caller is
// refused, which is what makes a deep-link / direct-API bypass of onboarding impossible at this
// layer rather than only in the UI.

import { AccessTier, OnboardingStatus, OrgType, Role } from '@prisma/client';

/**
 * The subset of the Auth.js `Session['user']` (src/types/next-auth.d.ts) the identity gate needs.
 * Kept structural (all-optional, `unknown`-tolerant) so the gate can be exercised against a raw,
 * untrusted token shape — a real signed session, a forged one, or a test fixture — and still fail
 * closed, rather than assuming the session was already validated upstream.
 */
export interface IdentitySessionUser {
  id?: unknown;
  role?: unknown;
  orgType?: unknown;
  organizationId?: unknown;
  accessTier?: unknown;
}

export type IdentitySession = { user?: IdentitySessionUser | null } | null | undefined;

export type IdentityDenialReason = 'UNAUTHENTICATED' | 'INCOMPLETE_IDENTITY';

/** The authoritative, validated identity every downstream WP01 module is handed. */
export interface IdentityContext {
  userId: string;
  role: Role;
  orgType: OrgType;
  organizationId: string | null;
  accessTier: AccessTier;
}

export type IdentityResult =
  | { ok: true; identity: IdentityContext }
  | { ok: false; reason: IdentityDenialReason };

function isKnownRole(value: unknown): value is Role {
  return typeof value === 'string' && (Object.values(Role) as string[]).includes(value);
}

function isKnownOrgType(value: unknown): value is OrgType {
  return typeof value === 'string' && (Object.values(OrgType) as string[]).includes(value);
}

function isKnownAccessTier(value: unknown): value is AccessTier {
  return typeof value === 'string' && (Object.values(AccessTier) as string[]).includes(value);
}

/**
 * The master gate. Pure and fail-closed: turns a (possibly absent, possibly malformed) session into
 * a validated `IdentityContext` or a typed denial. Never throws — callers that want a throwing guard
 * use `requireIdentity`.
 */
export function resolveIdentity(session: IdentitySession): IdentityResult {
  const user = session?.user;
  // No session at all, or a session with no user → not signed in.
  if (!user || typeof user.id !== 'string' || user.id.length === 0) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }

  // A signed-in user whose token is missing or carries an out-of-enum role/org/tier is treated as an
  // incomplete/forged identity and refused — the gate never coerces a garbage value into a default.
  if (!isKnownRole(user.role) || !isKnownOrgType(user.orgType) || !isKnownAccessTier(user.accessTier)) {
    return { ok: false, reason: 'INCOMPLETE_IDENTITY' };
  }

  return {
    ok: true,
    identity: {
      userId: user.id,
      role: user.role,
      orgType: user.orgType,
      organizationId: typeof user.organizationId === 'string' ? user.organizationId : null,
      accessTier: user.accessTier,
    },
  };
}

export class IdentityGateError extends Error {
  constructor(public readonly reason: IdentityDenialReason) {
    super(
      reason === 'UNAUTHENTICATED'
        ? 'No session — sign-in required.'
        : 'Session identity is incomplete or invalid.'
    );
    this.name = 'IdentityGateError';
  }

  /** HTTP status a route handler should respond with. */
  get status(): 401 | 403 {
    return this.reason === 'UNAUTHENTICATED' ? 401 : 403;
  }
}

/**
 * Throwing guard for route handlers / server actions / server components: returns the validated
 * `IdentityContext` or throws `IdentityGateError`. Deny-by-default — the caller cannot proceed
 * without a valid identity.
 */
export function requireIdentity(session: IdentitySession): IdentityContext {
  const result = resolveIdentity(session);
  if (!result.ok) {
    throw new IdentityGateError(result.reason);
  }
  return result.identity;
}

// ─── The hard onboarding gate (§6.10-1 / QC WP01 AC-1) ──────────────────────────────────────────
//
// Distinct from the identity check above: a fully authenticated user is still NOT allowed into any
// WP02–WP10 feature until their onboarding reaches GATED_COMPLETE. Enforced here at the domain layer
// so it holds at the API/route layer, not only in the UI — any gated route consumes this and, on a
// not-complete result, issues the resume redirect (§6.10-1: "redirects to
// /onboarding/resume?step={lastIncompleteStep}").

export const ONBOARDING_RESUME_PATH = '/onboarding/resume';

export type OnboardingGateOutcome =
  | { allowed: true }
  | { allowed: false; redirectTo: string };

/**
 * Is a downstream (post-onboarding) feature reachable for this user? Only when
 * `onboarding_status === GATED_COMPLETE`. Otherwise the caller is sent to the resume path keyed to
 * their last incomplete step. Fail-closed: any status other than GATED_COMPLETE (including an
 * unknown/garbage value) is treated as not-complete.
 */
export function evaluateOnboardingGate(
  onboardingStatus: OnboardingStatus | string | null | undefined,
  lastIncompleteStep: string
): OnboardingGateOutcome {
  if (onboardingStatus === OnboardingStatus.GATED_COMPLETE) {
    return { allowed: true };
  }
  const step = encodeURIComponent(lastIncompleteStep || 'REGISTER');
  return { allowed: false, redirectTo: `${ONBOARDING_RESUME_PATH}?step=${step}` };
}
