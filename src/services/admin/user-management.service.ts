import { Role } from '@prisma/client';

import { AuditService } from '@/services/compliance/audit/audit-service';
import { mapAdminMutationToAuditInput } from './admin-audit';

/**
 * T-R56 (admin console — `user_profile.manage`, ADMIN-only per the §16.6 matrix). Backs
 * `src/app/api/admin/users/**` — list/search/paginate, detail, suspend/reactivate, and role-change.
 *
 * Suspend is a SAFE, reversible account hold — it flips `User.is_suspended` (blocks a future
 * sign-in, `src/lib/auth/options.ts`) and never deletes anything. Every mutation (suspend/
 * reactivate/role-change) writes exactly one hash-chained `AuditEntry` via `AuditService`
 * (`mapAdminMutationToAuditInput`) — the caller (the route handler) supplies a real, Prisma-backed
 * `AuditService`; this service never constructs its own.
 *
 * Narrow Prisma delegate (mirrors `AuditEntryPrismaDelegate`'s "minimal surface, easy to mock"
 * convention) so unit tests satisfy this with a plain mock object, no real `DATABASE_URL` needed.
 */
export interface UserManagementPrismaDelegate {
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  }): Promise<UserRow[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  findUnique(args: { where: { id: string } }): Promise<UserRow | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UserRow>;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  org_type: string;
  organization_id: string | null;
  access_tier: string;
  onboarding_status: string;
  is_suspended: boolean;
  suspended_at: Date | string | null;
  suspended_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: Role;
  accessTier: string;
  onboardingStatus: string;
  isSuspended: boolean;
  createdAt: string;
}

export interface UserDetail extends UserSummary {
  orgType: string;
  organizationId: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  updatedAt: string;
}

export interface ListUsersQuery {
  /** Case-insensitive substring match against email or name. */
  search?: string;
  role?: Role;
  page?: number;
  pageSize?: number;
}

export interface ListUsersResult {
  users: UserSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export class UserManagementNotFoundError extends Error {
  constructor(userId: string) {
    super(`No user found with id '${userId}'.`);
    this.name = 'UserManagementNotFoundError';
  }
}

export class InvalidRoleError extends Error {
  constructor(role: string) {
    super(`'${role}' is not a valid role.`);
    this.name = 'InvalidRoleError';
  }
}

/**
 * Safety rail (not a §16.6 RBAC rule — the matrix already fully authorizes an ADMIN for
 * `user_profile.manage` against ANY target including themselves): an admin acting on their OWN
 * account via suspend/role-change is a self-lockout risk with no recovery path inside this same
 * console (a suspended/demoted admin can no longer reach `/admin` to undo it). Mirrors the
 * kill-switch route's "REP scope always targets the caller" ownership-safety posture, inverted —
 * here the safety move is to REQUIRE a different admin, not to force self-targeting.
 * Reactivation is deliberately NOT guarded this way — lifting your OWN hold is never a lockout.
 */
export class SelfTargetNotAllowedError extends Error {
  constructor(action: 'suspend' | 'change the role of') {
    super(`An admin may not ${action} their own account — ask another admin.`);
    this.name = 'SelfTargetNotAllowedError';
  }
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    accessTier: row.access_tier,
    onboardingStatus: row.onboarding_status,
    isSuspended: row.is_suspended,
    createdAt: toIso(row.created_at),
  };
}

function toDetail(row: UserRow): UserDetail {
  return {
    ...toSummary(row),
    orgType: row.org_type,
    organizationId: row.organization_id,
    suspendedAt: row.suspended_at ? toIso(row.suspended_at) : null,
    suspendedReason: row.suspended_reason,
    updatedAt: toIso(row.updated_at),
  };
}

export class UserManagementService {
  constructor(
    private readonly prisma: UserManagementPrismaDelegate,
    private readonly auditService: AuditService
  ) {}

  async listUsers(query: ListUsersQuery = {}): Promise<ListUsersResult> {
    const page = query.page && query.page > 0 ? Math.floor(query.page) : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(Math.floor(query.pageSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

    const where: Record<string, unknown> = {};
    if (query.role) where.role = query.role;
    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.count({ where }),
    ]);

    return {
      users: rows.map(toSummary),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getUserDetail(userId: string): Promise<UserDetail> {
    const row = await this.prisma.findUnique({ where: { id: userId } });
    if (!row) throw new UserManagementNotFoundError(userId);
    return toDetail(row);
  }

  /** Recent signups, newest first — the "SIGNUPS" half of the admin dashboard (item 3). */
  async listRecentSignups(limit = 10): Promise<UserSummary[]> {
    const rows = await this.prisma.findMany({ orderBy: { created_at: 'desc' }, take: Math.min(Math.max(1, limit), MAX_PAGE_SIZE) });
    return rows.map(toSummary);
  }

  async suspendUser(actorId: string, actorRole: Role, targetUserId: string, reason: string | null): Promise<UserDetail> {
    if (actorId === targetUserId) throw new SelfTargetNotAllowedError('suspend');
    const existing = await this.prisma.findUnique({ where: { id: targetUserId } });
    if (!existing) throw new UserManagementNotFoundError(targetUserId);

    const updated = await this.prisma.update({
      where: { id: targetUserId },
      data: { is_suspended: true, suspended_at: new Date(), suspended_reason: reason },
    });

    await this.auditService.recordAuditEvent(
      mapAdminMutationToAuditInput({
        actorId,
        actorRole,
        targetUserId,
        action: 'user_suspended',
        detail: { previously_suspended: existing.is_suspended },
        reason,
      })
    );

    return toDetail(updated);
  }

  async reactivateUser(actorId: string, actorRole: Role, targetUserId: string): Promise<UserDetail> {
    const existing = await this.prisma.findUnique({ where: { id: targetUserId } });
    if (!existing) throw new UserManagementNotFoundError(targetUserId);

    const updated = await this.prisma.update({
      where: { id: targetUserId },
      data: { is_suspended: false, suspended_at: null, suspended_reason: null },
    });

    await this.auditService.recordAuditEvent(
      mapAdminMutationToAuditInput({
        actorId,
        actorRole,
        targetUserId,
        action: 'user_reactivated',
        detail: { previously_suspended: existing.is_suspended },
      })
    );

    return toDetail(updated);
  }

  /**
   * Role-change: §16.6's matrix is the RBAC gate at the route layer (`withCapability('user_profile',
   * 'manage')`, ADMIN-only) — this method's own contribution is validating `newRole` is a real
   * `Role` enum member (fail closed on anything else, e.g. a typo'd/forged string) before writing.
   */
  async changeRole(actorId: string, actorRole: Role, targetUserId: string, newRole: string): Promise<UserDetail> {
    if (actorId === targetUserId) throw new SelfTargetNotAllowedError('change the role of');
    if (!Object.values(Role).includes(newRole as Role)) {
      throw new InvalidRoleError(newRole);
    }
    const existing = await this.prisma.findUnique({ where: { id: targetUserId } });
    if (!existing) throw new UserManagementNotFoundError(targetUserId);

    const updated = await this.prisma.update({
      where: { id: targetUserId },
      data: { role: newRole as Role },
    });

    await this.auditService.recordAuditEvent(
      mapAdminMutationToAuditInput({
        actorId,
        actorRole,
        targetUserId,
        action: 'user_role_changed',
        detail: { from: existing.role, to: newRole },
      })
    );

    return toDetail(updated);
  }
}
