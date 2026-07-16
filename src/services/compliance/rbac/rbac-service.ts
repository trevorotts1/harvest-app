import { Role } from '@prisma/client';

import { MATRIX, can, type Action, type Resource } from '@/lib/auth/rbac-matrix';

/**
 * RBAC Enforcement Service for WP11.
 *
 * Implements role-based access control with a permissions matrix. Used by compliance and
 * data-rights paths to enforce who can access what resources with which actions — most notably
 * `LegalHoldService` (T-11), which calls `assertPermission(role, 'data_rights', 'manage')` to gate
 * placing/lifting a legal hold to ADMIN + RVP only.
 *
 * T-14 reconciliation: this module previously hand-maintained its own `ROLE_PERMISSIONS` table,
 * keyed by a *different, stale* `Role` type (`src/types/compliance.ts`'s six-value union including
 * the retired `EXTERNAL`) that had drifted from master-spec §16.6 in several places — e.g. `UPLINE`
 * and `RVP` were missing `write`/`export`/`delete` on `data_rights` even though §16.6 row 8 grants
 * "Data-rights (own export/delete)" to all five roles, and there was no `billing_own` /
 * `downline_visibility` / `downline_pii` / `org_seat_config` / `cross_org` resource at all despite
 * §16.6 naming them explicitly.
 *
 * `src/lib/auth/rbac-matrix.ts`'s `MATRIX` is now the single authoritative §16.6 permission table
 * (keyed by Prisma's five-role `Role` enum, matching T-04). `ROLE_PERMISSIONS` below is *derived*
 * from it — there is exactly one place the resource × role × action grants are spelled out. The
 * public contract of this file (the `Resource`/`Action`/`Permission` shapes, `RBACService` and its
 * four methods) is unchanged so existing/forthcoming callers — T-11's `LegalHoldService` included —
 * do not need to change how they call it.
 */

export type { Resource, Action };

export interface Permission {
  resource: Resource;
  actions: Action[];
}

/** Every resource key `MATRIX` defines — iterated once to derive each role's Permission[] below. */
const ALL_RESOURCES = Object.keys(MATRIX) as Resource[];

/**
 * Derives a role's `Permission[]` from the authoritative `MATRIX` (including the DUAL = REP ∪
 * UPLINE union, via the same `can()` §16.6 enforcement used everywhere else) rather than
 * hand-listing each role's grants a second time.
 */
function permissionsForRole(role: Role): Permission[] {
  const permissions: Permission[] = [];

  for (const resource of ALL_RESOURCES) {
    const actions = (Object.keys(MATRIX[resource]) as Action[]).filter((action) =>
      can(role, resource, action)
    );
    if (actions.length > 0) {
      permissions.push({ resource, actions });
    }
  }

  return permissions;
}

/**
 * Permission matrix per role, derived from `src/lib/auth/rbac-matrix.ts`'s authoritative §16.6
 * `MATRIX` — see the reconciliation note above. Do not hand-edit; edit `MATRIX` instead.
 */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.REP]: permissionsForRole(Role.REP),
  [Role.UPLINE]: permissionsForRole(Role.UPLINE),
  [Role.RVP]: permissionsForRole(Role.RVP),
  [Role.ADMIN]: permissionsForRole(Role.ADMIN),
  [Role.DUAL]: permissionsForRole(Role.DUAL),
};

export class RBACService {
  private permissions: Record<Role, Permission[]>;

  constructor(permissions?: Record<Role, Permission[]>) {
    this.permissions = permissions ?? ROLE_PERMISSIONS;
  }

  /**
   * Check if a role has a specific permission on a resource. Fail-closed: an unrecognized
   * resource, an unrecognized action, or a resource/action this role's permission list doesn't
   * name all return `false` — there is no default-allow path.
   */
  checkPermission(role: Role, resource: Resource, action: Action): boolean {
    const rolePerms = this.permissions[role] ?? [];
    const perm = rolePerms.find((p) => p.resource === resource);
    return perm ? perm.actions.includes(action) : false;
  }

  /**
   * Get all permissions for a role.
   */
  getPermissions(role: Role): Permission[] {
    return this.permissions[role] ?? [];
  }

  /**
   * Get all actions a role can perform on a resource.
   */
  getActions(role: Role, resource: Resource): Action[] {
    const perm = this.getPermissions(role).find((p) => p.resource === resource);
    return perm ? perm.actions : [];
  }

  /**
   * Assert that a role has permission (throws if not).
   */
  assertPermission(role: Role, resource: Resource, action: Action): void {
    if (!this.checkPermission(role, resource, action)) {
      throw new Error(
        `RBAC: Role '${role}' does not have '${action}' permission on '${resource}'`
      );
    }
  }
}
