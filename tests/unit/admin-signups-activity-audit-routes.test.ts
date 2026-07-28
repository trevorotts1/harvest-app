// T-R56 (admin console — items 3 & 5, read-only, ADMIN-only) — PROOF: GET /api/admin/signups,
// GET /api/admin/activity, and GET /api/admin/audit are all session-gated (never trusts
// `x-user-id`) via `withCapability('cross_org', 'read')` — the §16.6 row-9 grant that is ADMIN-only
// with no adminBypass loophole for any other elevated role (RVP/UPLINE included). Mirrors
// tests/unit/deliverability-admin-route.test.ts's module-boundary-mocking pattern.

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

const auditRows: Array<Record<string, unknown>> = [
  {
    id: 'entry-1',
    sequence: 1,
    user_id: 'target-1',
    content_id: 'target-1',
    content_text: 'evidence line',
    content_hash: 'hash1',
    channel: null,
    risk_score: 0,
    outcome: 'RECORDED',
    classifier_data: { action: 'user_suspended', target_user_id: 'target-1' },
    rule_version: 'admin-console-user_profile.manage-v1',
    regulation: 'SECURITY',
    reviewer_id: 'admin-caller',
    reviewer_action: 'user_suspended',
    role: Role.ADMIN,
    prev_hash: null,
    entry_hash: 'deadbeef',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  },
];

const securityRows = [
  { id: 'sec-1', user_id: 'target-1', type: 'account_suspended', severity: 'WARNING', created_at: new Date('2026-01-01T00:00:00.000Z') },
];

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: jest.fn(async () => [
        {
          id: 'u1',
          email: 'u1@example.com',
          name: 'U1',
          role: Role.REP,
          access_tier: 'FREE_ORG_LINKED',
          onboarding_status: 'GATED_COMPLETE',
          is_suspended: false,
          created_at: new Date('2026-01-05'),
          updated_at: new Date('2026-01-05'),
        },
      ]),
    },
    auditEntry: {
      findMany: jest.fn(async () => auditRows),
      findFirst: jest.fn(async () => auditRows[auditRows.length - 1] ?? null),
      findUnique: jest.fn(async () => null),
    },
    securityEvent: {
      findMany: jest.fn(async () => securityRows),
      count: jest.fn(async () => securityRows.length),
    },
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { GET as signupsGET } from '@/app/api/admin/signups/route';
import { GET as activityGET } from '@/app/api/admin/activity/route';
import { GET as auditGET } from '@/app/api/admin/audit/route';

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

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, { headers });
}

beforeEach(() => {
  mockedSession.mockReset();
});

describe('GET /api/admin/signups', () => {
  it('401 with no session', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await signupsGET(req('/api/admin/signups'), {});
    expect(res.status).toBe(401);
  });

  it('403 for a non-ADMIN role (RVP) — cross_org.read is ADMIN-only, no bypass', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.RVP }));
    const res = await signupsGET(req('/api/admin/signups'), {});
    expect(res.status).toBe(403);
  });

  it('403 even with a forged x-user-id header and no real session', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await signupsGET(req('/api/admin/signups', { 'x-user-id': 'admin-caller' }), {});
    expect(res.status).toBe(401);
  });

  it('200 for ADMIN, returns recent signups', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await signupsGET(req('/api/admin/signups?limit=5'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.signups)).toBe(true);
    expect(body.signups[0].id).toBe('u1');
  });
});

describe('GET /api/admin/activity — org-wide, cross-user (never self-scoped like /api/activity-ledger)', () => {
  it('401 with no session', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await activityGET(req('/api/admin/activity'), {});
    expect(res.status).toBe(401);
  });

  it('403 for a non-ADMIN role (UPLINE)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.UPLINE }));
    const res = await activityGET(req('/api/admin/activity'), {});
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN, returns entries across users (not scoped to the caller)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await activityGET(req('/api/admin/activity'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThan(0);
    // The entry belongs to a DIFFERENT user than the ADMIN caller — proving this is cross-account.
    expect(body.entries[0].user_id).toBe('target-1');
    expect(body.entries[0].user_id).not.toBe('admin-caller');
  });
});

describe('GET /api/admin/audit — AuditEntry (+ hash-chain integrity) and SecurityEvent, paginated', () => {
  it('401 with no session', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await auditGET(req('/api/admin/audit'), {});
    expect(res.status).toBe(401);
  });

  it('403 for a non-ADMIN role', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.RVP }));
    const res = await auditGET(req('/api/admin/audit'), {});
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN (default kind=audit): returns paginated AuditEntry rows + the chain-integrity verdict', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await auditGET(req('/api/admin/audit?page=1&pageSize=20'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe('audit');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBe(1);
    expect(body.chainIntegrity).toBeDefined();
    expect(typeof body.chainIntegrity.valid).toBe('boolean');
  });

  it('200 for ADMIN (kind=security): returns paginated SecurityEvent rows, no chainIntegrity field', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await auditGET(req('/api/admin/audit?kind=security'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe('security');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].type).toBe('account_suspended');
    expect(body.chainIntegrity).toBeUndefined();
  });
});
