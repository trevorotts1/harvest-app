import { Role } from '@/types/compliance';

/**
 * RBAC Enforcement Service for WP11.
 *
 * Implements role-based access control with a permissions matrix.
 * Used by compliance and data-rights paths to enforce
 * who can access what resources with which actions.
 */

export type Resource =
  | 'contacts'
  | 'calendar'
  | 'agent_logs'
  | 'compliance_audit'
  | 'data_rights'
  | 'messaging'
  | 'social'
  | 'payment'
  | 'user_profile'
  | 'onboarding'
  | 'team_metrics'
  | 'billing';

export type Action = 'read' | 'write' | 'delete' | 'export' | 'approve' | 'manage';

export interface Permission {
  resource: Resource;
  actions: Action[];
}

/**
 * Permission matrix per role.
 * Based on WP11 RBAC requirements and WP01 role model.
 */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  REP: [
    { resource: 'contacts', actions: ['read', 'write', 'delete', 'export'] },
    { resource: 'calendar', actions: ['read', 'write'] },
    { resource: 'agent_logs', actions: ['read'] },
    { resource: 'compliance_audit', actions: ['read'] },
    { resource: 'data_rights', actions: ['read', 'write', 'export'] },
    { resource: 'messaging', actions: ['read', 'write'] },
    { resource: 'social', actions: ['read', 'write'] },
    { resource: 'user_profile', actions: ['read', 'write'] },
    { resource: 'onboarding', actions: ['read', 'write'] },
  ],
  UPLINE: [
    { resource: 'contacts', actions: ['read'] },
    { resource: 'calendar', actions: ['read'] },
    { resource: 'agent_logs', actions: ['read'] },
    { resource: 'compliance_audit', actions: ['read', 'approve'] },
    { resource: 'data_rights', actions: ['read'] },
    { resource: 'messaging', actions: ['read', 'approve'] },
    { resource: 'social', actions: ['read', 'approve'] },
    { resource: 'team_metrics', actions: ['read'] },
    { resource: 'user_profile', actions: ['read'] },
    { resource: 'onboarding', actions: ['read'] },
  ],
  DUAL: [
    // Dual role gets both REP and UPLINE permissions
    { resource: 'contacts', actions: ['read', 'write', 'delete', 'export'] },
    { resource: 'calendar', actions: ['read', 'write'] },
    { resource: 'agent_logs', actions: ['read'] },
    { resource: 'compliance_audit', actions: ['read', 'approve'] },
    { resource: 'data_rights', actions: ['read', 'write', 'export'] },
    { resource: 'messaging', actions: ['read', 'write', 'approve'] },
    { resource: 'social', actions: ['read', 'write', 'approve'] },
    { resource: 'team_metrics', actions: ['read'] },
    { resource: 'user_profile', actions: ['read', 'write'] },
    { resource: 'onboarding', actions: ['read', 'write'] },
  ],
  RVP: [
    // RVP = org leader: broader visibility
    { resource: 'contacts', actions: ['read'] },
    { resource: 'calendar', actions: ['read'] },
    { resource: 'agent_logs', actions: ['read'] },
    { resource: 'compliance_audit', actions: ['read', 'approve', 'manage'] },
    { resource: 'data_rights', actions: ['read', 'manage'] },
    { resource: 'messaging', actions: ['read', 'approve', 'manage'] },
    { resource: 'social', actions: ['read', 'approve', 'manage'] },
    { resource: 'team_metrics', actions: ['read', 'manage'] },
    { resource: 'payment', actions: ['read'] },
    { resource: 'billing', actions: ['read', 'manage'] },
    { resource: 'user_profile', actions: ['read'] },
    { resource: 'onboarding', actions: ['read', 'manage'] },
  ],
  ADMIN: [
    // Admin: full access
    { resource: 'contacts', actions: ['read', 'write', 'delete', 'export', 'manage'] },
    { resource: 'calendar', actions: ['read', 'write', 'manage'] },
    { resource: 'agent_logs', actions: ['read', 'manage'] },
    { resource: 'compliance_audit', actions: ['read', 'approve', 'manage'] },
    { resource: 'data_rights', actions: ['read', 'write', 'delete', 'export', 'manage'] },
    { resource: 'messaging', actions: ['read', 'write', 'approve', 'manage'] },
    { resource: 'social', actions: ['read', 'write', 'approve', 'manage'] },
    { resource: 'team_metrics', actions: ['read', 'manage'] },
    { resource: 'payment', actions: ['read', 'manage'] },
    { resource: 'billing', actions: ['read', 'manage'] },
    { resource: 'user_profile', actions: ['read', 'write', 'manage'] },
    { resource: 'onboarding', actions: ['read', 'write', 'manage'] },
  ],
  EXTERNAL: [
    // External: minimal read-only
    { resource: 'user_profile', actions: ['read', 'write'] },
    { resource: 'data_rights', actions: ['read', 'write', 'export'] },
    { resource: 'onboarding', actions: ['read'] },
  ],
};

export class RBACService {
  private permissions: Record<Role, Permission[]>;

  constructor(permissions?: Record<Role, Permission[]>) {
    this.permissions = permissions ?? ROLE_PERMISSIONS;
  }

  /**
   * Check if a role has a specific permission on a resource.
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