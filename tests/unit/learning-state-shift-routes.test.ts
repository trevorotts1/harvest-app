// T-34 (master-spec §9.7-§9.8, uiux §5.3) — proves the HTTP-route wiring: session gating (no
// session -> 401; onboarding incomplete -> 403), a forged `x-user-id` header has ZERO effect (the
// route always calls the service with the verified SESSION user id), and ownership is enforced at
// the route boundary (an ownership violation from the service surfaces as 403, never a silent
// success). Mirrors the exact module-boundary-mocking convention established in
// tests/unit/harvest-method-action-queue-routes.test.ts.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

const mockRecomputeAndGetView = jest.fn();
jest.mock('@/services/learning-state/learning-state.service', () => ({
  LearningStateService: jest.fn().mockImplementation(() => ({
    recomputeAndGetView: mockRecomputeAndGetView,
  })),
}));

const mockGetOrCreateToday = jest.fn();
const mockBegin = jest.fn();
const mockActionCard = jest.fn();
const mockClose = jest.fn();
jest.mock('@/services/learning-state/shift.service', () => {
  const actual = jest.requireActual('@/services/learning-state/shift.service');
  return {
    ...actual,
    ShiftService: jest.fn().mockImplementation(() => ({
      getOrCreateToday: mockGetOrCreateToday,
      begin: mockBegin,
      actionCard: mockActionCard,
      close: mockClose,
    })),
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { ShiftOwnershipError } from '@/services/learning-state/shift.service';
import { GET as learningStateGET } from '@/app/api/learning-state/route';
import { GET as shiftGET } from '@/app/api/shift/route';
import { POST as shiftBeginPOST } from '@/app/api/shift/begin/route';
import { POST as shiftActionPOST } from '@/app/api/shift/action/route';
import { POST as shiftClosePOST } from '@/app/api/shift/close/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'rep-real-session',
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

function seedGate(status: OnboardingStatus) {
  mockedUserFindUnique.mockResolvedValueOnce({ onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }] });
}

function getRequest(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers });
}

function postRequest(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockRecomputeAndGetView.mockReset();
  mockGetOrCreateToday.mockReset();
  mockBegin.mockReset();
  mockActionCard.mockReset();
  mockClose.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/learning-state
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('GET /api/learning-state', () => {
  test('no session -> 401, the ratio service never runs', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await learningStateGET(getRequest('/api/learning-state'), {});
    expect(res.status).toBe(401);
    expect(mockRecomputeAndGetView).not.toHaveBeenCalled();
  });

  test('onboarding incomplete -> 403, the ratio service never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.IN_PROGRESS);
    const res = await learningStateGET(getRequest('/api/learning-state'), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(mockRecomputeAndGetView).not.toHaveBeenCalled();
  });

  test('TEETH: a forged x-user-id header has ZERO effect — the route calls the service with the SESSION user id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockRecomputeAndGetView.mockResolvedValue({ agentRatio: {}, fieldTrainerRatio: {}, computedAt: 'x' });

    const res = await learningStateGET(getRequest('/api/learning-state', { 'x-user-id': 'some-other-victim-id' }), {});

    expect(res.status).toBe(200);
    expect(mockRecomputeAndGetView).toHaveBeenCalledTimes(1);
    expect(mockRecomputeAndGetView).toHaveBeenCalledWith('real-session-user');
    expect(mockRecomputeAndGetView).not.toHaveBeenCalledWith('some-other-victim-id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/shift
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('GET /api/shift', () => {
  test('no session -> 401', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await shiftGET(getRequest('/api/shift'), {});
    expect(res.status).toBe(401);
    expect(mockGetOrCreateToday).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header has ZERO effect on which rep\'s shift is fetched', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockGetOrCreateToday.mockResolvedValue({ phase: 'OPEN' });

    const res = await shiftGET(getRequest('/api/shift', { 'x-user-id': 'victim-id' }), {});
    expect(res.status).toBe(200);
    expect(mockGetOrCreateToday.mock.calls[0][0]).toBe('real-session-user');
  });

  test('?mode=short selects SHORT mode', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockGetOrCreateToday.mockResolvedValue({ phase: 'OPEN' });

    await shiftGET(getRequest('/api/shift?mode=short'), {});
    expect(mockGetOrCreateToday).toHaveBeenCalledWith(expect.any(String), 'SHORT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/shift/begin
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('POST /api/shift/begin', () => {
  test('no session -> 401', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await shiftBeginPOST(postRequest('/api/shift/begin', {}), {});
    expect(res.status).toBe(401);
    expect(mockBegin).not.toHaveBeenCalled();
  });

  test('forged x-user-id is ignored; the session user id is used', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockBegin.mockResolvedValue({ phase: 'WORK' });

    await shiftBeginPOST(postRequest('/api/shift/begin', {}, { 'x-user-id': 'victim-id' }), {});
    expect(mockBegin).toHaveBeenCalledWith('real-session-user');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/shift/action
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('POST /api/shift/action', () => {
  test('no session -> 401', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await shiftActionPOST(postRequest('/api/shift/action', { cardId: 'c1', action: 'APPROVE' }), {});
    expect(res.status).toBe(401);
    expect(mockActionCard).not.toHaveBeenCalled();
  });

  test('missing cardId -> 400, service never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.GATED_COMPLETE);
    const res = await shiftActionPOST(postRequest('/api/shift/action', { action: 'APPROVE' }), {});
    expect(res.status).toBe(400);
    expect(mockActionCard).not.toHaveBeenCalled();
  });

  test('invalid action -> 400, service never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.GATED_COMPLETE);
    const res = await shiftActionPOST(postRequest('/api/shift/action', { cardId: 'c1', action: 'DESTROY_ALL' }), {});
    expect(res.status).toBe(400);
    expect(mockActionCard).not.toHaveBeenCalled();
  });

  test('TEETH: forged x-user-id is ignored — the route calls actionCard with the SESSION user id, not the header', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockActionCard.mockResolvedValue({ phase: 'WORK' });

    await shiftActionPOST(
      postRequest('/api/shift/action', { cardId: 'c1', action: 'APPROVE' }, { 'x-user-id': 'victim-id' }),
      {}
    );
    expect(mockActionCard).toHaveBeenCalledWith('real-session-user', 'c1', 'APPROVE');
  });

  test('TEETH: an ownership violation from the service surfaces as 403 NOT_OWNED — never a silent 200', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockActionCard.mockRejectedValue(new ShiftOwnershipError());

    const res = await shiftActionPOST(postRequest('/api/shift/action', { cardId: 'not-mine', action: 'APPROVE' }), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NOT_OWNED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// POST /api/shift/close
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('POST /api/shift/close', () => {
  test('no session -> 401', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await shiftClosePOST(postRequest('/api/shift/close', {}), {});
    expect(res.status).toBe(401);
    expect(mockClose).not.toHaveBeenCalled();
  });

  test('reflection is optional — an empty body still succeeds (AC-5.3-5 equal-weight skip)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockClose.mockResolvedValue({ phase: 'DONE' });

    const res = await shiftClosePOST(new NextRequest('http://localhost/api/shift/close', { method: 'POST' }), {});
    expect(res.status).toBe(200);
    expect(mockClose).toHaveBeenCalledWith('real-session-user', undefined);
  });

  test('forged x-user-id is ignored on close too', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedGate(OnboardingStatus.GATED_COMPLETE);
    mockClose.mockResolvedValue({ phase: 'DONE' });

    await shiftClosePOST(postRequest('/api/shift/close', { reflectionText: 'good day' }, { 'x-user-id': 'victim-id' }), {});
    expect(mockClose).toHaveBeenCalledWith('real-session-user', 'good day');
  });
});
