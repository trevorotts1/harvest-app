// T-57 RG6 (i18n; master-spec §17.5) — `buildMilestoneShareText` grew an optional trailing `locale`
// param in T-57 RG5-FINAL (celebration.service.ts), but its one real caller —
// POST /api/gamification/milestones/share — still omitted it, so the share text this route returned
// resolved to English for every rep regardless of their own `User.locale` (flagged as a tracked,
// un-owned fast-follow by that unit's own header note). This suite proves the route-level wiring
// fix: the rep's `User.locale` is resolved (same duck-typed `prisma.user.findUnique({ select: {
// locale: true } })` pattern `today.service.ts`'s `resolveRepLocale` uses) and threaded through as
// `buildMilestoneShareText`'s real 5th argument — mirrors the exact module-boundary-mocking pattern
// established in tests/unit/pipeline-route.test.ts / tests/unit/approval-inbox-routes.test.ts.
//
// `buildMilestoneShareText` itself (real CFE-gating, real locale-aware anchor line) is proven
// independently in tests/unit/gamification-celebration.test.ts against real fakes — mocking it here
// (rather than exercising the real `ComplianceFilterEngine`, which needs a live classifier
// dependency this unit test has no business depending on) keeps this suite scoped to ONLY the
// route's own wiring: does the right locale reach the service call.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    whySession: { findFirst: jest.fn() },
  },
}));

const mockBuildMilestoneShareText = jest.fn();
jest.mock('@/services/gamification/celebration.service', () => {
  const actual = jest.requireActual('@/services/gamification/celebration.service');
  return {
    ...actual,
    buildMilestoneShareText: mockBuildMilestoneShareText,
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/gamification/milestones/share/route';
import { MilestoneKey } from '@/services/gamification/celebration.service';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'rep-milestone-1',
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

/** Seeds a SINGLE `prisma.user.findUnique` mock resolution that satisfies BOTH the onboarding
 *  gate's own read (`onboarding_status`/`onboarding_sessions`) AND this route's new locale read
 *  (`locale`) — the same shared-mock convention `me-security.test.ts` uses, since Jest's
 *  `mockResolvedValue` returns the identical object regardless of the caller's `select` shape. */
function seedUser(locale: string | null) {
  mockedUserFindUnique.mockResolvedValue({
    onboarding_status: OnboardingStatus.GATED_COMPLETE,
    onboarding_sessions: [],
    locale,
  });
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/gamification/milestones/share', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockBuildMilestoneShareText.mockReset();
  mockBuildMilestoneShareText.mockResolvedValue({ status: 'ok', text: 'stubbed share text' });
});

describe('POST /api/gamification/milestones/share — locale wiring (T-57 RG6)', () => {
  test('an es-locale rep: buildMilestoneShareText is called with locale "es" as the real 5th argument', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedUser('es');

    const res = await POST(postRequest({ key: MilestoneKey.FIRST_APPOINTMENT }), {});
    expect(res.status).toBe(200);

    expect(mockBuildMilestoneShareText).toHaveBeenCalledTimes(1);
    const args = mockBuildMilestoneShareText.mock.calls[0];
    expect(args[0]).toBe(MilestoneKey.FIRST_APPOINTMENT);
    expect(args[2]).toEqual({ user_id: 'rep-milestone-1', role: Role.REP });
    // The 4th positional arg (the CFE evaluator) is left at its default (undefined here, so the
    // route's real `ComplianceFilterEngine` default kicks in) — this route never overrides it.
    expect(args[3]).toBeUndefined();
    expect(args[4]).toBe('es'); // TEETH — the rep's real resolved locale, not the English default.
  });

  test('an en-locale rep: buildMilestoneShareText is called with locale "en"', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedUser('en');

    await POST(postRequest({ key: MilestoneKey.THIRTY_DAY_STREAK }), {});
    const args = mockBuildMilestoneShareText.mock.calls[0];
    expect(args[4]).toBe('en');
  });

  test('a rep with no locale on file (null): defaults to "en", never throws, never omits the argument', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedUser(null);

    const res = await POST(postRequest({ key: MilestoneKey.FIRST_RECRUIT }), {});
    expect(res.status).toBe(200);
    const args = mockBuildMilestoneShareText.mock.calls[0];
    expect(args[4]).toBe('en');
  });

  test('a garbage/invalid User.locale value: fails soft to "en", never propagates the invalid value', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedUser('fr'); // not a supported locale

    await POST(postRequest({ key: MilestoneKey.FIRST_RESPONSE }), {});
    const args = mockBuildMilestoneShareText.mock.calls[0];
    expect(args[4]).toBe('en');
  });

  test('a prisma.user.findUnique lookup failure: fails soft to "en", the share still succeeds', async () => {
    mockedSession.mockResolvedValue(fakeSession());

    // The onboarding gate reads via this same `prisma.user.findUnique` mock FIRST (and must keep
    // passing); only the SECOND call — this route's own new locale lookup — is forced to reject, to
    // prove that specific try/catch fails soft without disturbing the (already-proven-elsewhere)
    // gate behavior.
    mockedUserFindUnique
      .mockResolvedValueOnce({ onboarding_status: OnboardingStatus.GATED_COMPLETE, onboarding_sessions: [] })
      .mockRejectedValueOnce(new Error('db unavailable'));

    const res = await POST(postRequest({ key: MilestoneKey.FIRST_LICENSED_TEAM_MEMBER }), {});
    expect(res.status).toBe(200);
    const args = mockBuildMilestoneShareText.mock.calls[0];
    expect(args[4]).toBe('en');
  });

  test('no session → 401, buildMilestoneShareText never runs (locale resolution never reached)', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await POST(postRequest({ key: MilestoneKey.FIRST_APPOINTMENT }), {});
    expect(res.status).toBe(401);
    expect(mockBuildMilestoneShareText).not.toHaveBeenCalled();
  });

  test('an invalid milestone key → 400, buildMilestoneShareText never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedUser('es');
    const res = await POST(postRequest({ key: 'NOT_A_REAL_KEY' }), {});
    expect(res.status).toBe(400);
    expect(mockBuildMilestoneShareText).not.toHaveBeenCalled();
  });
});
