// T-R56 (admin console — user_profile.manage, ADMIN-only per §16.6) — PROOF: every
// /api/admin/users/** route is session-gated (never trusts `x-user-id`), ADMIN passes, non-ADMIN
// gets 401 (no session) / 403 (wrong role), and every mutation route (suspend/reactivate/role)
// writes exactly one hash-chained AuditEntry via the REAL `AuditService`/`InMemoryAuditRepository`
// (only `@/lib/prisma`'s `user` delegate is mocked — the audit store is real, same principle
// tests/unit/audit-store.test.ts uses: never mock the thing you're trying to prove). Mirrors
// tests/unit/kill-switch-route.test.ts / tests/unit/deliverability-admin-route.test.ts's exact
// module-boundary-mocking pattern.

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

interface FakeUserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  org_type: string;
  organization_id: string | null;
  access_tier: string;
  onboarding_status: string;
  is_suspended: boolean;
  suspended_at: Date | null;
  suspended_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

const usersById = new Map<string, FakeUserRow>();
const auditEntries: Array<Record<string, unknown>> = [];

function seedUser(row: Partial<FakeUserRow> & { id: string }): void {
  usersById.set(row.id, {
    email: 'user@example.com',
    name: 'Some User',
    role: Role.REP,
    org_type: 'EXTERNAL',
    organization_id: null,
    access_tier: 'FREE_ORG_LINKED',
    onboarding_status: 'GATED_COMPLETE',
    is_suspended: false,
    suspended_at: null,
    suspended_reason: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...row,
  });
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: jest.fn(async (args: { where?: { role?: Role }; skip?: number; take?: number }) => {
        let rows = Array.from(usersById.values());
        if (args.where?.role) rows = rows.filter((r) => r.role === args.where!.role);
        rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
        const skip = args.skip ?? 0;
        const take = args.take ?? rows.length;
        return rows.slice(skip, skip + take);
      }),
      count: jest.fn(async (args: { where?: { role?: Role } }) => {
        let rows = Array.from(usersById.values());
        if (args.where?.role) rows = rows.filter((r) => r.role === args.where!.role);
        return rows.length;
      }),
      findUnique: jest.fn(async (args: { where: { id: string } }) => usersById.get(args.where.id) ?? null),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = usersById.get(args.where.id);
        if (!existing) throw new Error('not found');
        const updated = { ...existing, ...args.data } as FakeUserRow;
        usersById.set(args.where.id, updated);
        return updated;
      }),
    },
    auditEntry: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        auditEntries.push(args.data);
        return args.data;
      }),
      findMany: jest.fn(async () => [...auditEntries].sort((a, b) => (a.sequence as number) - (b.sequence as number))),
      findUnique: jest.fn(async (args: { where: { id: string } }) => auditEntries.find((e) => e.id === args.where.id) ?? null),
      findFirst: jest.fn(async () => {
        if (auditEntries.length === 0) return null;
        return [...auditEntries].sort((a, b) => (b.sequence as number) - (a.sequence as number))[0];
      }),
    },
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { GET as listUsersGET } from '@/app/api/admin/users/route';
import { GET as userDetailGET } from '@/app/api/admin/users/[userId]/route';
import { POST as suspendPOST } from '@/app/api/admin/users/[userId]/suspend/route';
import { POST as reactivatePOST } from '@/app/api/admin/users/[userId]/reactivate/route';
import { POST as rolePOST } from '@/app/api/admin/users/[userId]/role/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'admin-caller',
      role: Role.ADMIN,
      orgType: 'EXTERNAL',
      organizationId: null,
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`http://localhost${url}`, init);
}

beforeEach(() => {
  mockedSession.mockReset();
  usersById.clear();
  auditEntries.length = 0;
  seedUser({ id: 'admin-caller', role: Role.ADMIN });
  seedUser({ id: 'target-1', email: 'target1@example.com', name: 'Target One', role: Role.REP });
});

// ── GET /api/admin/users — list ─────────────────────────────────────────────────────────────────
describe('GET /api/admin/users', () => {
  it('401 with no session', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await listUsersGET(req('/api/admin/users'), {});
    expect(res.status).toBe(401);
  });

  it('403 for a non-ADMIN role (REP)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.REP }));
    const res = await listUsersGET(req('/api/admin/users'), {});
    expect(res.status).toBe(403);
  });

  it('403 for a non-ADMIN role (RVP) — user_profile.manage is ADMIN-only, no adminBypass loophole for other elevated roles', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.RVP }));
    const res = await listUsersGET(req('/api/admin/users'), {});
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN, returns the seeded users with pagination metadata', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await listUsersGET(req('/api/admin/users'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(Array.isArray(body.users)).toBe(true);
  });

  it('a forged x-user-id header never substitutes for the real session', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await listUsersGET(req('/api/admin/users', { headers: { 'x-user-id': 'admin-caller' } }), {});
    expect(res.status).toBe(401);
  });
});

// ── GET /api/admin/users/[userId] — detail ──────────────────────────────────────────────────────
describe('GET /api/admin/users/[userId]', () => {
  const ctx = { params: { userId: 'target-1' } };

  it('401 with no session', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await userDetailGET(req('/api/admin/users/target-1'), ctx);
    expect(res.status).toBe(401);
  });

  it('403 for a non-ADMIN role', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.UPLINE }));
    const res = await userDetailGET(req('/api/admin/users/target-1'), ctx);
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN with a real detail payload', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await userDetailGET(req('/api/admin/users/target-1'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('target-1');
    expect(body.email).toBe('target1@example.com');
  });

  it('404 for an unknown user id', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await userDetailGET(req('/api/admin/users/ghost'), { params: { userId: 'ghost' } });
    expect(res.status).toBe(404);
  });
});

// ── POST /api/admin/users/[userId]/suspend ──────────────────────────────────────────────────────
describe('POST /api/admin/users/[userId]/suspend — SAFE, reversible, audited', () => {
  const ctx = { params: { userId: 'target-1' } };
  function postReq(body: unknown = {}) {
    return req('/api/admin/users/target-1/suspend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('401 with no session; nothing suspended, no AuditEntry', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await suspendPOST(postReq({ reason: 'test' }), ctx);
    expect(res.status).toBe(401);
    expect(usersById.get('target-1')?.is_suspended).toBe(false);
    expect(auditEntries).toHaveLength(0);
  });

  it('403 for a non-ADMIN role; nothing suspended, no AuditEntry', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.UPLINE }));
    const res = await suspendPOST(postReq({ reason: 'test' }), ctx);
    expect(res.status).toBe(403);
    expect(usersById.get('target-1')?.is_suspended).toBe(false);
    expect(auditEntries).toHaveLength(0);
  });

  it('200 for ADMIN: flips is_suspended, never deletes the row, writes exactly one AuditEntry', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await suspendPOST(postReq({ reason: 'policy violation' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuspended).toBe(true);
    expect(usersById.has('target-1')).toBe(true); // never deleted
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].reviewer_id).toBe('admin-caller');
    expect(auditEntries[0].reviewer_action).toBe('user_suspended');
    expect(auditEntries[0].entry_hash).toBeTruthy();
  });

  it('400 when an ADMIN targets their OWN account — self-lockout guard, no AuditEntry', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await suspendPOST(postReq({}), { params: { userId: 'admin-caller' } });
    expect(res.status).toBe(400);
    expect(usersById.get('admin-caller')?.is_suspended).toBe(false);
    expect(auditEntries).toHaveLength(0);
  });

  it('404 for an unknown target', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await suspendPOST(postReq({}), { params: { userId: 'ghost' } });
    expect(res.status).toBe(404);
  });
});

// ── POST /api/admin/users/[userId]/reactivate ───────────────────────────────────────────────────
describe('POST /api/admin/users/[userId]/reactivate', () => {
  const ctx = { params: { userId: 'target-1' } };
  function postReq() {
    return req('/api/admin/users/target-1/reactivate', { method: 'POST' });
  }

  beforeEach(() => {
    usersById.set('target-1', {
      ...usersById.get('target-1')!,
      is_suspended: true,
      suspended_at: new Date(),
      suspended_reason: 'was suspended',
    });
  });

  it('401 with no session', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await reactivatePOST(postReq(), ctx);
    expect(res.status).toBe(401);
  });

  it('403 for a non-ADMIN role', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.RVP }));
    const res = await reactivatePOST(postReq(), ctx);
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN: clears the suspend hold, writes exactly one AuditEntry', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await reactivatePOST(postReq(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuspended).toBe(false);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].reviewer_action).toBe('user_reactivated');
  });
});

// ── POST /api/admin/users/[userId]/role ─────────────────────────────────────────────────────────
describe('POST /api/admin/users/[userId]/role — respects the RBAC matrix, audited', () => {
  const ctx = { params: { userId: 'target-1' } };
  function postReq(body: unknown) {
    return req('/api/admin/users/target-1/role', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('401 with no session', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await rolePOST(postReq({ role: Role.UPLINE }), ctx);
    expect(res.status).toBe(401);
  });

  it('403 for a non-ADMIN role (a REP may never change roles, even their own)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.REP, id: 'target-1' }));
    const res = await rolePOST(postReq({ role: Role.UPLINE }), ctx);
    expect(res.status).toBe(403);
    expect(usersById.get('target-1')?.role).toBe(Role.REP);
  });

  it('200 for ADMIN: changes the role, writes exactly one AuditEntry with from/to', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await rolePOST(postReq({ role: Role.UPLINE }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe(Role.UPLINE);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].reviewer_action).toBe('user_role_changed');
  });

  it('400 for an invalid role value; nothing changes, no AuditEntry', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await rolePOST(postReq({ role: 'SUPERUSER' }), ctx);
    expect(res.status).toBe(400);
    expect(usersById.get('target-1')?.role).toBe(Role.REP);
    expect(auditEntries).toHaveLength(0);
  });

  it('400 when an ADMIN targets their OWN role — self-demotion guard, no AuditEntry', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await rolePOST(postReq({ role: Role.REP }), { params: { userId: 'admin-caller' } });
    expect(res.status).toBe(400);
    expect(usersById.get('admin-caller')?.role).toBe(Role.ADMIN);
    expect(auditEntries).toHaveLength(0);
  });
});
