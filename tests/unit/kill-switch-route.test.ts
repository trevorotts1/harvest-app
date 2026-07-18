// T-31 — PROOF (d): /api/agents/kill-switch is session-gated (never trusts `x-user-id` /
// `x-organization-id`) and ownership-checked per scope: REP always affects the CALLER's own
// identity (a forged `scopeId` for another rep is ignored, not honored); ORG requires an
// upline-class role AND the caller's OWN organizationId (a forged org id from a non-admin is
// rejected 403); PLATFORM requires ADMIN. Mirrors the module-boundary-mocking pattern of
// tests/unit/agent-dispatch-route.test.ts / agent-queue-route.test.ts.

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

const upsertCalls: unknown[] = [];
const findUniqueCalls: unknown[] = [];
jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentKillSwitch: {
      upsert: jest.fn(async (args: unknown) => {
        upsertCalls.push(args);
        return {};
      }),
      findUnique: jest.fn(async (args: unknown) => {
        findUniqueCalls.push(args);
        return null;
      }),
    },
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { POST, GET } from '@/app/api/agents/kill-switch/route';

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

function postRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/agents/kill-switch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  upsertCalls.length = 0;
  findUniqueCalls.length = 0;
});

describe('POST /api/agents/kill-switch — session-gated, forged-header inert', () => {
  test('no session -> 401; nothing is toggled', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await POST(postRequest({ scope: 'REP', tripped: true }, { 'x-user-id': 'attacker' }), {});
    expect(res.status).toBe(401);
    expect(upsertCalls).toHaveLength(0);
  });

  test('REP scope: a rep can pause THEIR OWN agents; the scopeId is the SESSION identity, never a forged header/body value', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user', role: Role.REP }));
    const res = await POST(
      postRequest({ scope: 'REP', tripped: true, reason: 'taking a break', scopeId: 'attacker-victim-id' }, { 'x-user-id': 'attacker-victim-id' }),
      {}
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scopeId).toBe('real-session-user'); // the client-supplied scopeId was ignored
    expect(body.scopeId).not.toBe('attacker-victim-id');
    expect(upsertCalls).toHaveLength(1);
  });

  test('ORG scope: a REP (non-upline) is rejected 403 — no toggle happens', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.REP, organizationId: 'org-1' }));
    const res = await POST(postRequest({ scope: 'ORG', tripped: true }), {});
    expect(res.status).toBe(403);
    expect(upsertCalls).toHaveLength(0);
  });

  test('ORG scope: an UPLINE can toggle their OWN org', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.UPLINE, organizationId: 'org-1' }));
    const res = await POST(postRequest({ scope: 'ORG', tripped: true, reason: 'org-wide pause' }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scopeId).toBe('org-1');
    expect(upsertCalls).toHaveLength(1);
  });

  // TEETH: an upline trying to toggle a DIFFERENT org via a forged scopeId must be rejected — if
  // the ownership check were removed, this would silently trip someone else's org kill switch.
  test('ORG scope: an UPLINE cannot toggle a DIFFERENT (forged) org id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.UPLINE, organizationId: 'org-1' }));
    const res = await POST(postRequest({ scope: 'ORG', tripped: true, scopeId: 'someone-elses-org' }), {});
    expect(res.status).toBe(403);
    expect(upsertCalls).toHaveLength(0);
  });

  test('ORG scope: ADMIN may target an explicit org id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.ADMIN, organizationId: 'org-admin-home' }));
    const res = await POST(postRequest({ scope: 'ORG', tripped: true, scopeId: 'org-target' }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scopeId).toBe('org-target');
  });

  test('PLATFORM scope: a non-admin (including UPLINE/RVP) is rejected 403', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.RVP, organizationId: 'org-1' }));
    const res = await POST(postRequest({ scope: 'PLATFORM', tripped: true }), {});
    expect(res.status).toBe(403);
    expect(upsertCalls).toHaveLength(0);
  });

  test('PLATFORM scope: ADMIN may toggle it', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.ADMIN }));
    const res = await POST(postRequest({ scope: 'PLATFORM', tripped: true, reason: 'operator emergency stop' }), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scopeId).toBe('GLOBAL');
    expect(upsertCalls).toHaveLength(1);
  });

  test('an invalid scope is rejected 400 before any toggle', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await POST(postRequest({ scope: 'NOT_A_SCOPE', tripped: true }), {});
    expect(res.status).toBe(400);
    expect(upsertCalls).toHaveLength(0);
  });
});

describe('GET /api/agents/kill-switch — session-gated read', () => {
  test('no session -> 401', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/api/agents/kill-switch'), {});
    expect(res.status).toBe(401);
  });

  test('a rep sees their own + org state, never the platform state', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.REP, organizationId: 'org-1' }));
    const res = await GET(new NextRequest('http://localhost/api/agents/kill-switch'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('rep');
    expect(body).toHaveProperty('org');
    expect(body.platform).toBeNull(); // non-admin never sees/queries the platform switch
  });
});
