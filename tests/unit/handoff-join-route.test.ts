// T-R22 / T-R22R (remediation of the T-40R re-QC LOW/UX finding) — the pre-existing POST
// /api/messaging/handoff/join route (built in T-40R) was, until T-R22, API-reachable ONLY:
// `tests/unit/messaging-surfaces-mount.test.ts` proves it exists, is session-gated, and wires
// `ThreeWayHandoffService.join`, but nothing ever actually INVOKED the handler to prove its
// contract end to end. This suite closes that gap for the exact affordance the `/team/bridges` tab
// (T-R22R's re-integration of T-R22 onto WP09's `/team` surface) calls: proves the OWNERSHIP 404 (a
// caller who is not this handoff's invited upline gets the SAME "Handoff not found" 404 as a truly
// nonexistent id — no leak of which case it was), the 409 NOT_JOINABLE case, and the happy JOIN
// path — using the SESSION user id as the joiner, never a forged header. This file does not modify
// the route or the service — it only adds test coverage. Carried over unmodified from
// build/T-R22-handoff-join-ui@765c793 — the join route itself was never touched by WP09 or this
// re-integration.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
  },
}));

const mockJoin = jest.fn();
jest.mock('@/services/messaging/handoff/three-way-handoff.service', () => {
  const actual = jest.requireActual('@/services/messaging/handoff/three-way-handoff.service');
  return {
    ...actual,
    ThreeWayHandoffService: jest.fn().mockImplementation(() => ({
      join: mockJoin,
    })),
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/messaging/handoff/join/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'upline-1',
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

function seedOnboarding(status: OnboardingStatus | null) {
  mockedUserFindUnique.mockResolvedValue(
    status === null ? null : { onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }] }
  );
}

function postRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/messaging/handoff/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockJoin.mockReset();
});

describe('POST /api/messaging/handoff/join — T-R22 route-level teeth (ownership 404 + happy path)', () => {
  test('no session → 401, the service is never called', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await POST(postRequest({ handoffId: 'h-1' }), {});
    expect(res.status).toBe(401);
    expect(mockJoin).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete → 403 ONBOARDING_INCOMPLETE, service never called', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);
    const res = await POST(postRequest({ handoffId: 'h-1' }), {});
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ONBOARDING_INCOMPLETE');
    expect(mockJoin).not.toHaveBeenCalled();
  });

  test('missing handoffId → 400, the service is never called', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    const res = await POST(postRequest({}), {});
    expect(res.status).toBe(400);
    expect(mockJoin).not.toHaveBeenCalled();
  });

  test('OWNERSHIP 404: NOT_YOUR_HANDOFF resolves to the SAME plain 404 as a nonexistent handoff (no leak)', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'not-the-upline' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockJoin.mockResolvedValue({ ok: false, code: 'NOT_YOUR_HANDOFF' });

    const res = await POST(postRequest({ handoffId: 'h-belongs-to-someone-else' }), {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Handoff not found' });
    // No `code` field distinguishing NOT_YOUR_HANDOFF from NOT_FOUND — the whole point of the
    // no-leak contract.
    expect(body.code).toBeUndefined();
  });

  test('a truly nonexistent handoff id produces the IDENTICAL 404 body as the ownership case', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockJoin.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });

    const res = await POST(postRequest({ handoffId: 'no-such-id' }), {});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Handoff not found' });
  });

  test('NOT_JOINABLE (already joined / lapsed) → 409 with a distinguishing code', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockJoin.mockResolvedValue({ ok: false, code: 'NOT_JOINABLE' });

    const res = await POST(postRequest({ handoffId: 'h-1' }), {});
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NOT_JOINABLE');
  });

  test('a forged x-user-id header has ZERO effect — the SESSION user id is the joiner passed to the service', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-upline' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockJoin.mockResolvedValue({
      ok: true,
      handoff: { id: 'h-1', state: 'JOINED', joined_at: new Date('2026-07-15T12:00:00Z') },
    });

    await POST(postRequest({ handoffId: 'h-1' }, { 'x-user-id': 'some-other-victim-id' }), {});

    expect(mockJoin).toHaveBeenCalledTimes(1);
    expect(mockJoin).toHaveBeenCalledWith('real-upline', 'h-1');
  });

  test('happy path: the invited upline joins → 200 with the joined handoff shape', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'upline-1' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockJoin.mockResolvedValue({
      ok: true,
      handoff: { id: 'h-1', state: 'JOINED', joined_at: new Date('2026-07-15T12:00:00Z') },
    });

    const res = await POST(postRequest({ handoffId: 'h-1' }), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      handoff: { id: 'h-1', state: 'JOINED', joinedAt: '2026-07-15T12:00:00.000Z' },
    });
  });
});
