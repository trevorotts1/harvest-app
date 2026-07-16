import { Role } from '@prisma/client';
import type { Session } from 'next-auth';

import { can, type Action, type Resource } from './rbac-matrix';

/**
 * RBAC scaffold (T-04) + the §16.6 capability layer (T-14).
 *
 * `roleSatisfies`/`hasRole`/`requireRole` are the original T-04 primitive: a reusable,
 * framework-agnostic "does this session's role satisfy this caller-supplied allow-list" check,
 * plus a throwing guard for route handlers / server actions / server components. They deliberately
 * do NOT encode §16.6's full resource-by-resource matrix — the allow-list is whatever the call-site
 * passes in, and (by default) ADMIN bypasses it.
 *
 * `hasCapability`/`requireCapability` (T-14) are the matrix-backed counterparts: instead of a
 * caller-supplied allow-list, they check `can(role, resource, action)` against the authoritative
 * §16.6 matrix in `./rbac-matrix.ts` — so the allow-list can't drift from the spec, and there is no
 * default ADMIN bypass (the matrix itself decides, row by row, exactly like §16.6's table). Prefer
 * these over `requireRole` wherever a call-site's authorization question is "can this role do X to
 * resource Y" rather than "is this role generically privileged enough to be here."
 *
 * What every one of these functions encodes correctly, because getting it wrong here would make
 * every later capability check wrong too, is the DUAL role's union semantics (§6.2): a DUAL user is
 * a rep and an upline *at once*, "union permissions" — see the parallel encoding in
 * `./rbac-matrix.ts`'s `can()` and in `src/services/compliance/rbac/rbac-service.ts`, which derives
 * its permissions from the same matrix.
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

/**
 * Non-throwing §16.6 capability check for conditional rendering / branching. Unlike `hasRole`,
 * there is no allow-list to pass in — `resource`/`action` are looked up against the authoritative
 * matrix (`./rbac-matrix.ts`), which is the single source of truth for who is allowed to do what.
 */
export function hasCapability(
  session: Session | null | undefined,
  resource: Resource,
  action: Action
): boolean {
  const role = session?.user?.role;
  if (!role) return false;
  return can(role, resource, action);
}

/**
 * The §16.6 matrix-backed guard: throws `RBACError` if there is no session (`UNAUTHENTICATED`) or
 * the session's role is not granted `action` on `resource` per the authoritative matrix
 * (`FORBIDDEN`). This is "deny-by-default authorization" (§16.4/§16.8-6) expressed directly against
 * §16.6 rather than a hand-written allow-list — prefer this over `requireRole` for any check that
 * maps onto a §16.6 resource/action pair. See `src/lib/auth/with-role.ts`'s `withCapability` for the
 * App-Router route-handler wrapper built on top of this.
 */
export function requireCapability(
  session: Session | null | undefined,
  resource: Resource,
  action: Action
): asserts session is Session & { user: SessionUser } {
  if (!session?.user) {
    throw new RBACError('UNAUTHENTICATED', 'No session — sign-in required.');
  }

  if (!can(session.user.role, resource, action)) {
    throw new RBACError(
      'FORBIDDEN',
      `Role '${session.user.role}' is not permitted to '${action}' on '${resource}' (§16.6).`,
      undefined,
      session.user.role
    );
  }
}
