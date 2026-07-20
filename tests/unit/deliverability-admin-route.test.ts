// T-36 (§10.3, SC5 launch gate) — PROOF (e): GET /api/admin/deliverability (the SC5 "list domains
// for org" / provisioning-status admin surface) is session-gated (never trusts `x-user-id`) and
// ADMIN-only. Mirrors tests/unit/kill-switch-route.test.ts's module-boundary-mocking pattern
// exactly: `@/lib/auth/session`'s `getCurrentSession` is mocked, `@/lib/prisma` is mocked with
// per-model stubs, and the route's exported `GET` is imported and driven directly with a real
// `NextRequest`.

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

const findUniqueCalls: unknown[] = [];
jest.mock('@/lib/prisma', () => ({
  prisma: {
    a2PBrandRegistration: { findUnique: jest.fn(async (args: unknown) => { findUniqueCalls.push(args); return null; }) },
    a2PCampaignRegistration: { findUnique: jest.fn(async () => null) },
    platformPhoneNumber: { findMany: jest.fn(async () => []) },
    emailDomainAuthentication: { findMany: jest.fn(async () => []) },
    emailWarmupPlan: { findMany: jest.fn(async () => []) },
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { GET } from '@/app/api/admin/deliverability/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'real-session-user',
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: 'org-1',
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function getRequest(query: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/admin/deliverability${query}`, { headers });
}

beforeEach(() => {
  mockedSession.mockReset();
  findUniqueCalls.length = 0;
  const savedSid = process.env.TWILIO_ACCOUNT_SID;
  const savedToken = process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  // restore-able via afterEach if a later test needs them; none in this file do.
  void savedSid;
  void savedToken;
});

describe('GET /api/admin/deliverability — session-gated, ADMIN-only, forged-header inert', () => {
  test('no session -> 401', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(getRequest('?organizationId=org-1', { 'x-user-id': 'attacker' }), {});
    expect(res.status).toBe(401);
  });

  test('a REP (non-admin) is rejected 403 — even with a forged x-user-id header naming an admin', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.REP }));
    const res = await GET(getRequest('?organizationId=org-1', { 'x-user-id': 'some-admin-id' }), {});
    expect(res.status).toBe(403);
  });

  test('an UPLINE/RVP (non-admin upline-class role) is also rejected 403 — this is ADMIN-only, not upline-class', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.UPLINE }));
    const res = await GET(getRequest('?organizationId=org-1'), {});
    expect(res.status).toBe(403);
  });

  test('ADMIN without an organizationId query param -> 400, no lookup performed', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.ADMIN }));
    const res = await GET(getRequest(''), {});
    expect(res.status).toBe(400);
    expect(findUniqueCalls).toHaveLength(0);
  });

  test('ADMIN with organizationId -> 200; identity comes from the session, never from a client header', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.ADMIN }));
    const res = await GET(getRequest('?organizationId=org-target', { 'x-user-id': 'attacker' }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizationId).toBe('org-target');
    expect(body.a2p).toHaveProperty('readiness');
    // A brand-new org with no rows on file is fail-closed NOT deliverable, and Twilio is
    // unconfigured in this key-less test environment — never falsely "ready".
    expect(body.a2p.readiness.deliverable).toBe(false);
    expect(body.a2p.twilioConfigured).toBe(false);
    expect(body.email.domains).toEqual([]);
    // The organizationId actually queried against Prisma is the one from the query string (an
    // ops/admin surface legitimately looks up ANY org), not the caller's own session org — but the
    // CALLER's authorization to be here at all came only from session.user.role, never a header.
    expect(findUniqueCalls[0]).toMatchObject({ where: { organization_id: 'org-target' } });
  });
});
