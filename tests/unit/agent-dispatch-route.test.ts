// WP04 (T-30) — PROOF (f): the new POST /api/agents/dispatch route is session-gated (§6.10-1) and a
// forged `x-user-id` header is INERT — the enqueued job's userId is the VERIFIED session identity,
// never the header. Mirrors the module-boundary-mocking pattern of agent-queue-route.test.ts.
//
// The Inngest producer is mocked so this test never loads the ESM `inngest` package and can capture
// exactly what the route enqueues.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: jest.fn() } } }));

const sentEvents: unknown[] = [];
jest.mock('@/services/agent-runtime/inngest-functions', () => ({
  InngestDurableQueue: class {
    async send(data: unknown) {
      sentEvents.push(data);
    }
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/agents/dispatch/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;

function fakeSession(): Session {
  return {
    user: {
      id: 'real-session-user',
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: 'org-1',
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function seedOnboarding(status: OnboardingStatus | null) {
  mockedUserFindUnique.mockResolvedValue(
    status === null ? null : { onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }] }
  );
}

function postRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/agents/dispatch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  sentEvents.length = 0;
});

describe('POST /api/agents/dispatch — session-gated + forged-header inert (§6.10-1)', () => {
  test('no session → 401; a forged x-user-id header has no effect; nothing is enqueued', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await POST(postRequest({ agentKey: 'prospecting' }, { 'x-user-id': 'attacker-victim-id' }), {});
    expect(res.status).toBe(401);
    expect(sentEvents).toHaveLength(0);
  });

  test('authenticated but not GATED_COMPLETE → 403 ONBOARDING_INCOMPLETE; nothing is enqueued', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await POST(postRequest({ agentKey: 'prospecting' }), {});
    expect(res.status).toBe(403);
    expect(sentEvents).toHaveLength(0);
  });

  test('gated_complete → 202, and the enqueued userId is the SESSION identity, not the forged header', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await POST(
      postRequest({ agentKey: 'prospecting', contactId: 'c1' }, { 'x-user-id': 'attacker-victim-id' }),
      {}
    );
    expect(res.status).toBe(202);
    expect(sentEvents).toHaveLength(1);
    expect((sentEvents[0] as { userId: string }).userId).toBe('real-session-user');
    expect((sentEvents[0] as { userId: string }).userId).not.toBe('attacker-victim-id');
  });

  test('an unknown agentKey is rejected (400) before enqueue', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await POST(postRequest({ agentKey: 'not_a_real_agent' }), {});
    expect(res.status).toBe(400);
    expect(sentEvents).toHaveLength(0);
  });
});
