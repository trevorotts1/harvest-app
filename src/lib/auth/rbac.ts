import { Role } from '@prisma/client';
import type { Session } from 'next-auth';

/**
 * RBAC scaffold (T-04). Master spec §16.6 is the *authoritative* per-resource capability matrix
 * (rep/upline/rvp/admin/dual × contacts/billing/compliance-review/etc.) and is layered on by T-14
 * as middleware every WP consumes. This module is the primitive that matrix is built on: a
 * reusable, framework-agnostic "does this session's role satisfy this allow-list" check, plus a
 * throwing guard for route handlers / server actions / server components.
 *
 * It deliberately does NOT attempt to encode §16.6's full resource-by-resource matrix — that is
 * T-14's job. What it does encode correctly, because getting it wrong here would make every later
 * capability check wrong too, is the DUAL role's union semantics (§6.2): a DUAL user is a rep and
 * an upline *at once*, "union permissions" — see the parallel encoding in
 * src/services/compliance/rbac/rbac-service.ts, whose DUAL row is already the union of its REP and
 * UPLINE rows for the resource-action matrix that module owns.
 */

export type SessionUser = NonNullable<Session['user']>;

export type RBACErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN';

export class RBACError extends Error {
  constructor(
    public readonly code: RBACErrorCode,
    message: string,
    public readonly allowedRoles?: readonly Role[],
    public readonly actualRole?: Role
  ) {
    super(message);
    this.name = 'RBACError';
  }

  /** HTTP status an API route handler should respond with for this error. */
  get status(): 401 | 403 {
    return this.code === 'UNAUTHENTICATED' ? 401 : 403;
  }
}

export interface RoleCheckOptions {
  /**
   * §16.6 gives ADMIN "full" access in nearly every row of the RBAC matrix. Defaulting this to
   * true means an allow-list doesn't have to spell out ADMIN on every call-site. The one
   * documented exception is "Downline raw contact PII / conversation content", which §16.6 marks
   * "audited-only" even for ADMIN (i.e. allowed, but must write an audit trail entry) — a caller
   * guarding that specific capability should pass `{ adminBypass: false }` and layer an explicit
   * audit-log requirement itself (or wait for T-14's full matrix, which owns that nuance).
   */
  adminBypass?: boolean;
}

/**
 * Pure role-satisfaction check. No throwing, no assumptions about the caller's session shape
 * beyond a bare `Role`. This is what both `hasRole` and `requireRole` delegate to, and it is the
 * function the unit tests exercise directly for the full allow/deny/DUAL matrix.
 */
export function roleSatisfies(
  actualRole: Role,
  allowedRoles: readonly Role[],
  options: RoleCheckOptions = {}
): boolean {
  const { adminBypass = true } = options;

  if (allowedRoles.includes(actualRole)) return true;
  if (adminBypass && actualRole === Role.ADMIN) return true;

  // DUAL (§6.2 "concurrent rep + upline; union permissions"): a DUAL user satisfies any allow-list
  // that names REP or UPLINE, without needing DUAL spelled out explicitly at every call-site.
  if (actualRole === Role.DUAL && (allowedRoles.includes(Role.REP) || allowedRoles.includes(Role.UPLINE))) {
    return true;
  }

  return false;
}

/** Non-throwing check for conditional rendering / branching (e.g. `if (hasRole(session, [...]))`). */
export function hasRole(
  session: Session | null | undefined,
  allowedRoles: readonly Role[],
  options?: RoleCheckOptions
): boolean {
  const role = session?.user?.role;
  if (!role) return false;
  return roleSatisfies(role, allowedRoles, options);
}

/**
 * The reusable server-side guard: throws `RBACError` if there is no session (`UNAUTHENTICATED`) or
 * the session's role doesn't satisfy `allowedRoles` (`FORBIDDEN`). This is the "deny-by-default
 * authorization" §16.4/§16.6 calls for at the top of any gated route handler, server action, or
 * server component. See src/lib/auth/with-role.ts for an App-Router route-handler wrapper built on
 * top of this.
 */
export function requireRole(
  session: Session | null | undefined,
  allowedRoles: readonly Role[],
  options?: RoleCheckOptions
): asserts session is Session & { user: SessionUser } {
  if (!session?.user) {
    throw new RBACError('UNAUTHENTICATED', 'No session — sign-in required.');
  }

  if (!roleSatisfies(session.user.role, allowedRoles, options)) {
    throw new RBACError(
      'FORBIDDEN',
      `Role '${session.user.role}' is not permitted here (allowed: ${allowedRoles.join(', ')}).`,
      allowedRoles,
      session.user.role
    );
  }
}
