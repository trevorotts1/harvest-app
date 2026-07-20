// T-37 — route-level proofs for the two SMS send-path surfaces (master-spec §10.1). Mirrors the
// exact module-boundary-mocking pattern in tests/unit/approval-inbox-routes.test.ts: mock
// `@/lib/auth/session` + `@/lib/prisma`, then exercise the REAL `withOnboardingGate`-wrapped route
// handlers. Proves: session-gated (no session => 401; not gated_complete => 403), a forged
// `x-user-id` header has ZERO effect (the SESSION user id scopes every query), and ownership is
// enforced (another rep's draft => NOT_FOUND => 404). KEY-LESS: TWILIO_* is unset, so no real
// send is ever attempted.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    draftMessage: { findFirst: jest.fn(), update: jest.fn() },
    contact: { findFirst: jest.fn() },
    messageThread: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    message: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { POST as composePOST } from '@/app/api/messaging/compose-handoff/route';
import { POST as platformPOST } from '@/app/api/messaging/platform-send/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const p = prisma as unknown as {
  user: { findUnique: jest.Mock };
  draftMessage: { findFirst: jest.Mock; update: jest.Mock };
};

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

function seedGatedComplete() {
  p.user.findUnique.mockResolvedValue({
    onboarding_status: OnboardingStatus.GATED_COMPLETE,
    onboarding_sessions: [{ current_step: 'REGISTER' }],
  });
}

function postRequest(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/messaging/compose-handoff', () => {
  test('no session => 401, never touches the draft store', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await composePOST(postRequest('/api/messaging/compose-handoff', { draftId: 'd-1' }), {});
    expect(res.status).toBe(401);
    expect(p.draftMessage.findFirst).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete => 403', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    p.user.findUnique.mockResolvedValue({
      onboarding_status: OnboardingStatus.IN_PROGRESS,
      onboarding_sessions: [{ current_step: 'REGISTER' }],
    });
    const res = await composePOST(postRequest('/api/messaging/compose-handoff', { draftId: 'd-1' }), {});
    expect(res.status).toBe(403);
    expect(p.draftMessage.findFirst).not.toHaveBeenCalled();
  });

  test('TEETH: a forged x-user-id header has ZERO effect — the SESSION user id scopes the lookup', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGatedComplete();
    p.draftMessage.findFirst.mockResolvedValue(null); // => NOT_FOUND, short-circuits before any send

    const res = await composePOST(
      postRequest('/api/messaging/compose-handoff', { draftId: 'd-1' }, { 'x-user-id': 'victim-id' }),
      {}
    );
    expect(res.status).toBe(404);
    expect(p.draftMessage.findFirst).toHaveBeenCalledTimes(1);
    expect(p.draftMessage.findFirst.mock.calls[0][0].where.user_id).toBe('real-session-user');
    expect(p.draftMessage.findFirst.mock.calls[0][0].where.user_id).not.toBe('victim-id');
  });

  test('missing draftId => 400', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGatedComplete();
    const res = await composePOST(postRequest('/api/messaging/compose-handoff', {}), {});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/messaging/platform-send', () => {
  test('no session => 401', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await platformPOST(postRequest('/api/messaging/platform-send', { draftId: 'd-1' }), {});
    expect(res.status).toBe(401);
    expect(p.draftMessage.findFirst).not.toHaveBeenCalled();
  });

  test('gated but session has no organization => 400 (never reaches the send path)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ organizationId: null }));
    seedGatedComplete();
    const res = await platformPOST(postRequest('/api/messaging/platform-send', { draftId: 'd-1' }), {});
    expect(res.status).toBe(400);
    expect(p.draftMessage.findFirst).not.toHaveBeenCalled();
  });

  test('TEETH: a forged x-user-id header has ZERO effect — the SESSION user id scopes the lookup', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGatedComplete();
    p.draftMessage.findFirst.mockResolvedValue(null); // NOT_FOUND before any deliverability/Twilio work

    const res = await platformPOST(
      postRequest('/api/messaging/platform-send', { draftId: 'd-1' }, { 'x-user-id': 'victim-id' }),
      {}
    );
    expect(res.status).toBe(404);
    expect(p.draftMessage.findFirst.mock.calls[0][0].where.user_id).toBe('real-session-user');
    expect(p.draftMessage.findFirst.mock.calls[0][0].where.user_id).not.toBe('victim-id');
  });
});
