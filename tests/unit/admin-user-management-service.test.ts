// T-R56 (admin console — user_profile.manage) — proves `UserManagementService` end-to-end against
// a real `AuditService`/`InMemoryAuditRepository` (no mocking of the audit store — same convention
// as tests/unit/audit-store.test.ts): list/search/paginate, detail, suspend/reactivate/role-change,
// the self-target safety guard, and — the load-bearing proof for this build unit — that every
// mutation appends exactly one hash-chained AuditEntry.

import { Role } from '@prisma/client';

import { AuditService, InMemoryAuditRepository } from '@/services/compliance/audit/audit-service';
import {
  InvalidRoleError,
  SelfTargetNotAllowedError,
  UserManagementNotFoundError,
  UserManagementService,
  type UserManagementPrismaDelegate,
  type UserRow,
} from '@/services/admin/user-management.service';

/** A minimal, in-memory fake satisfying `UserManagementPrismaDelegate` — mirrors the narrow-
 *  delegate + plain-mock convention this repo's other admin/compliance services already use
 *  (e.g. `AuditEntryPrismaDelegate`). */
class FakeUserStore implements UserManagementPrismaDelegate {
  private rows = new Map<string, UserRow>();

  seed(row: UserRow): void {
    this.rows.set(row.id, row);
  }

  async findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  }): Promise<UserRow[]> {
    let rows = Array.from(this.rows.values());
    const where = args.where ?? {};
    if (where.role) rows = rows.filter((r) => r.role === where.role);
    if (where.OR) {
      const term = ((where.OR as Array<{ email?: { contains: string } }>)[0]?.email?.contains ?? '').toLowerCase();
      rows = rows.filter((r) => r.email.toLowerCase().includes(term) || r.name.toLowerCase().includes(term));
    }
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const skip = args.skip ?? 0;
    const take = args.take ?? rows.length;
    return rows.slice(skip, skip + take);
  }

  async count(args: { where?: Record<string, unknown> }): Promise<number> {
    return (await this.findMany({ where: args.where, take: Number.MAX_SAFE_INTEGER })).length;
  }

  async findUnique(args: { where: { id: string } }): Promise<UserRow | null> {
    return this.rows.get(args.where.id) ?? null;
  }

  async update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UserRow> {
    const existing = this.rows.get(args.where.id);
    if (!existing) throw new Error('not found');
    const updated = { ...existing, ...args.data } as UserRow;
    this.rows.set(args.where.id, updated);
    return updated;
  }
}

function makeRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-1',
    email: 'rep1@example.com',
    name: 'Rep One',
    role: Role.REP,
    org_type: 'EXTERNAL',
    organization_id: null,
    access_tier: 'FREE_ORG_LINKED',
    onboarding_status: 'GATED_COMPLETE',
    is_suspended: false,
    suspended_at: null,
    suspended_reason: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildService(): { service: UserManagementService; store: FakeUserStore; audit: AuditService; repo: InMemoryAuditRepository } {
  const store = new FakeUserStore();
  const repo = new InMemoryAuditRepository();
  const audit = new AuditService(repo);
  const service = new UserManagementService(store, audit);
  return { service, store, audit, repo };
}

const ADMIN_ID = 'admin-1';
const ADMIN_ROLE = Role.ADMIN;

describe('UserManagementService.listUsers — list + search + paginate', () => {
  it('paginates and returns totals', async () => {
    const { service, store } = buildService();
    for (let i = 0; i < 5; i++) {
      store.seed(makeRow({ id: `u${i}`, email: `u${i}@example.com`, name: `User ${i}`, created_at: new Date(2026, 0, i + 1) }));
    }
    const page1 = await service.listUsers({ page: 1, pageSize: 2 });
    expect(page1.users).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);

    const page2 = await service.listUsers({ page: 2, pageSize: 2 });
    expect(page2.users).toHaveLength(2);
    expect(page2.users.map((u) => u.id)).not.toEqual(page1.users.map((u) => u.id));
  });

  it('filters by role', async () => {
    const { service, store } = buildService();
    store.seed(makeRow({ id: 'rep-a', role: Role.REP }));
    store.seed(makeRow({ id: 'upline-a', email: 'up@example.com', role: Role.UPLINE }));
    const result = await service.listUsers({ role: Role.UPLINE });
    expect(result.users).toHaveLength(1);
    expect(result.users[0].id).toBe('upline-a');
  });

  it('searches by email/name substring, case-insensitively', async () => {
    const { service, store } = buildService();
    store.seed(makeRow({ id: 'match', name: 'Alicia Gomez', email: 'alicia@example.com' }));
    store.seed(makeRow({ id: 'nomatch', name: 'Bob Smith', email: 'bob@example.com' }));
    const result = await service.listUsers({ search: 'ALICIA' });
    expect(result.users).toHaveLength(1);
    expect(result.users[0].id).toBe('match');
  });

  it('caps pageSize at the maximum', async () => {
    const { service } = buildService();
    const result = await service.listUsers({ pageSize: 99999 });
    expect(result.pageSize).toBe(100);
  });
});

describe('UserManagementService.getUserDetail', () => {
  it('returns the full detail shape for an existing user', async () => {
    const { service, store } = buildService();
    store.seed(makeRow({ id: 'user-1' }));
    const detail = await service.getUserDetail('user-1');
    expect(detail.id).toBe('user-1');
    expect(detail.orgType).toBe('EXTERNAL');
  });

  it('throws UserManagementNotFoundError for an unknown id', async () => {
    const { service } = buildService();
    await expect(service.getUserDetail('nope')).rejects.toBeInstanceOf(UserManagementNotFoundError);
  });
});

describe('UserManagementService.listRecentSignups', () => {
  it('returns rows newest-first, capped at the requested limit', async () => {
    const { service, store } = buildService();
    store.seed(makeRow({ id: 'old', created_at: new Date('2026-01-01') }));
    store.seed(makeRow({ id: 'new', email: 'new@example.com', created_at: new Date('2026-02-01') }));
    const signups = await service.listRecentSignups(1);
    expect(signups).toHaveLength(1);
    expect(signups[0].id).toBe('new');
  });
});

describe('UserManagementService.suspendUser — SAFE, reversible, audited', () => {
  it('sets is_suspended + suspended_at + reason, and writes exactly one hash-chained AuditEntry', async () => {
    const { service, store, repo } = buildService();
    store.seed(makeRow({ id: 'target-1' }));

    const detail = await service.suspendUser(ADMIN_ID, ADMIN_ROLE, 'target-1', 'policy violation');

    expect(detail.isSuspended).toBe(true);
    expect(detail.suspendedReason).toBe('policy violation');
    expect(detail.suspendedAt).not.toBeNull();

    // The row was updated (not deleted) — a suspend is never destructive.
    const raw = await store.findUnique({ where: { id: 'target-1' } });
    expect(raw).not.toBeNull();

    const entries = await repo.query({});
    expect(entries).toHaveLength(1);
    expect(entries[0].user_id).toBe('target-1');
    expect(entries[0].reviewer_id).toBe(ADMIN_ID);
    expect(entries[0].reviewer_action).toBe('user_suspended');
    expect(entries[0].outcome).toBe('RECORDED');
    expect(entries[0].entry_hash).toBeTruthy();
    expect(entries[0].prev_hash).toBeNull(); // genesis entry
  });

  it('throws UserManagementNotFoundError for an unknown target, writing no AuditEntry', async () => {
    const { service, repo } = buildService();
    await expect(service.suspendUser(ADMIN_ID, ADMIN_ROLE, 'ghost', null)).rejects.toBeInstanceOf(UserManagementNotFoundError);
    expect((await repo.query({})).length).toBe(0);
  });

  it('rejects an admin suspending their OWN account — no mutation, no AuditEntry', async () => {
    const { service, store, repo } = buildService();
    store.seed(makeRow({ id: ADMIN_ID, role: Role.ADMIN }));
    await expect(service.suspendUser(ADMIN_ID, ADMIN_ROLE, ADMIN_ID, null)).rejects.toBeInstanceOf(SelfTargetNotAllowedError);
    const raw = await store.findUnique({ where: { id: ADMIN_ID } });
    expect(raw?.is_suspended).toBe(false);
    expect((await repo.query({})).length).toBe(0);
  });
});

describe('UserManagementService.reactivateUser — lifts a hold, audited', () => {
  it('clears is_suspended/suspended_at/suspended_reason and writes one AuditEntry', async () => {
    const { service, store, repo } = buildService();
    store.seed(makeRow({ id: 'target-1', is_suspended: true, suspended_at: new Date(), suspended_reason: 'was suspended' }));

    const detail = await service.reactivateUser(ADMIN_ID, ADMIN_ROLE, 'target-1');

    expect(detail.isSuspended).toBe(false);
    expect(detail.suspendedAt).toBeNull();
    expect(detail.suspendedReason).toBeNull();

    const entries = await repo.query({});
    expect(entries).toHaveLength(1);
    expect(entries[0].reviewer_action).toBe('user_reactivated');
  });
});

describe('UserManagementService.changeRole — matrix-respecting, self-target-safe, audited', () => {
  it('changes the role and writes one AuditEntry recording from/to', async () => {
    const { service, store, repo } = buildService();
    store.seed(makeRow({ id: 'target-1', role: Role.REP }));

    const detail = await service.changeRole(ADMIN_ID, ADMIN_ROLE, 'target-1', Role.UPLINE);

    expect(detail.role).toBe(Role.UPLINE);
    const entries = await repo.query({});
    expect(entries).toHaveLength(1);
    expect(entries[0].reviewer_action).toBe('user_role_changed');
    expect((entries[0].classifier_data as Record<string, unknown>).from).toBe(Role.REP);
    expect((entries[0].classifier_data as Record<string, unknown>).to).toBe(Role.UPLINE);
  });

  it('rejects an invalid role value — no mutation, no AuditEntry', async () => {
    const { service, store, repo } = buildService();
    store.seed(makeRow({ id: 'target-1', role: Role.REP }));
    await expect(service.changeRole(ADMIN_ID, ADMIN_ROLE, 'target-1', 'SUPERUSER')).rejects.toBeInstanceOf(InvalidRoleError);
    const raw = await store.findUnique({ where: { id: 'target-1' } });
    expect(raw?.role).toBe(Role.REP);
    expect((await repo.query({})).length).toBe(0);
  });

  it('rejects an admin changing their OWN role — no mutation, no AuditEntry', async () => {
    const { service, store, repo } = buildService();
    store.seed(makeRow({ id: ADMIN_ID, role: Role.ADMIN }));
    await expect(service.changeRole(ADMIN_ID, ADMIN_ROLE, ADMIN_ID, Role.REP)).rejects.toBeInstanceOf(SelfTargetNotAllowedError);
    const raw = await store.findUnique({ where: { id: ADMIN_ID } });
    expect(raw?.role).toBe(Role.ADMIN);
    expect((await repo.query({})).length).toBe(0);
  });
});

describe('UserManagementService mutations — hash-chain proof across multiple actions', () => {
  it('chains sequential mutations correctly and the chain verifies as valid', async () => {
    const { service, store, audit } = buildService();
    store.seed(makeRow({ id: 'a' }));
    store.seed(makeRow({ id: 'b' }));

    await service.suspendUser(ADMIN_ID, ADMIN_ROLE, 'a', 'reason a');
    await service.reactivateUser(ADMIN_ID, ADMIN_ROLE, 'a');
    await service.changeRole(ADMIN_ID, ADMIN_ROLE, 'b', Role.RVP);

    const verification = await audit.verifyStoredChain();
    expect(verification.valid).toBe(true);

    const entries = await audit.query({});
    expect(entries.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });
});
