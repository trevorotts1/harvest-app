import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import type { Session } from 'next-auth';

// Same module-boundary mocking pattern as tests/unit/session-whoami.test.ts: mock the two seams the
// gate depends on — the live session accessor and the Prisma client — so the whole §6.10-1 wire can
// be exercised without a real DB or Auth.js runtime. moduleNameMapper resolves `@/...` to the same
// files the source imports, so the wrapper and this test see the identical mocks.
jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: jest.fn() } } }));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import {
  withOnboardingGate,
  getOnboardingState,
  shouldRedirectToOnboarding,
  isGatedDownstreamPage,
} from '@/lib/auth/onboarding-gate';
// The REAL downstream (WP04) route handler, built on withOnboardingGate — proving the gate is
// enforced end-to-end at the API surface, not just in the pure function (§6.10-1). T-32 retired the
// inert `/api/mission-control/briefing` demo scaffold this block used to exercise; it now proves the
// SAME §6.10-1 wire against the real Mission Control / Today route that replaced it.
import { GET as todayGET } from '@/app/api/mission-control/today/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedFindUnique = (prisma as unknown as {
  user: { findUnique: jest.Mock };
}).user.findUnique;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-gate-1',
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: 'org-1',
      accessTier: 'FREE_ORG_LINKED',
      onboardingStatus: OnboardingStatus.IN_PROGRESS,
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

/** Set what the next DB read of onboarding state returns. */
function seedOnboardingRow(status: OnboardingStatus | null, step = 'SEVEN_WHYS') {
  mockedFindUnique.mockResolvedValue(
    status === null ? null : { onboarding_status: status, onboarding_sessions: [{ current_step: step }] }
  );
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedFindUnique.mockReset();
});

describe('shouldRedirectToOnboarding — the pure middleware decision (Edge-safe)', () => {
  test('a gated downstream page + not-complete status → redirect', () => {
    expect(shouldRedirectToOnboarding('/dashboard', OnboardingStatus.IN_PROGRESS)).toBe(true);
    expect(shouldRedirectToOnboarding('/community/contact/abc', OnboardingStatus.IN_PROGRESS)).toBe(true);
    expect(shouldRedirectToOnboarding('/today', null)).toBe(true); // fail-closed on absent claim
    expect(shouldRedirectToOnboarding('/team', 'GARBAGE')).toBe(true); // fail-closed on garbage
  });

  test('a gated downstream page + GATED_COMPLETE → allowed through', () => {
    expect(shouldRedirectToOnboarding('/dashboard', OnboardingStatus.GATED_COMPLETE)).toBe(false);
    expect(shouldRedirectToOnboarding('/grow/tree', OnboardingStatus.GATED_COMPLETE)).toBe(false);
  });

  test('the onboarding flow itself is NEVER gated (would dead-end the flow that clears the gate)', () => {
    expect(isGatedDownstreamPage('/onboarding/resume')).toBe(false);
    expect(shouldRedirectToOnboarding('/onboarding/resume', OnboardingStatus.IN_PROGRESS)).toBe(false);
    expect(shouldRedirectToOnboarding('/auth', OnboardingStatus.IN_PROGRESS)).toBe(false);
  });
});

describe('getOnboardingState — fail-closed DB read', () => {
  test('a deleted/missing user row resolves to null status (treated as not-complete)', async () => {
    mockedFindUnique.mockResolvedValue(null);
    const state = await getOnboardingState('ghost-user');
    expect(state.onboardingStatus).toBeNull();
    expect(state.lastIncompleteStep).toBe('REGISTER');
  });

  test('reads the live status + latest resume step', async () => {
    seedOnboardingRow(OnboardingStatus.IN_PROGRESS, 'goals_intensity');
    const state = await getOnboardingState('user-gate-1');
    expect(state.onboardingStatus).toBe(OnboardingStatus.IN_PROGRESS);
    expect(state.lastIncompleteStep).toBe('goals_intensity');
  });
});

describe('withOnboardingGate — the §6.10-1 hard gate at the API layer', () => {
  const handler = jest.fn(async () => NextResponse.json({ ok: true, ran: true }));
  const wrapped = withOnboardingGate(handler);

  beforeEach(() => handler.mockClear());

  function req() {
    return new NextRequest('http://localhost/api/mission-control/briefing');
  }

  test('no session → 401 UNAUTHENTICATED, handler never runs', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await wrapped(req(), {});
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHENTICATED');
    expect(handler).not.toHaveBeenCalled();
  });

  test('a malformed/forged identity (missing role) → 403 INCOMPLETE_IDENTITY, handler never runs', async () => {
    mockedSession.mockResolvedValue({
      user: { id: 'u', orgType: 'EXTERNAL', accessTier: 'FREE_ORG_LINKED' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as unknown as Session);
    const res = await wrapped(req(), {});
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('INCOMPLETE_IDENTITY');
    expect(handler).not.toHaveBeenCalled();
  });

  test('authenticated but NOT GATED_COMPLETE → 403 ONBOARDING_INCOMPLETE + resume redirectTo, handler never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboardingRow(OnboardingStatus.IN_PROGRESS, 'seven_whys');
    const res = await wrapped(req(), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(body.redirectTo).toBe('/onboarding/resume?step=seven_whys');
    expect(handler).not.toHaveBeenCalled();
  });

  test('the LIVE DB status wins over a stale token claim: token says complete, DB says in-progress → still denied', async () => {
    mockedSession.mockResolvedValue(fakeSession({ onboardingStatus: OnboardingStatus.GATED_COMPLETE }));
    seedOnboardingRow(OnboardingStatus.IN_PROGRESS);
    const res = await wrapped(req(), {});
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  test('GATED_COMPLETE → handler runs, receives the validated identity', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboardingRow(OnboardingStatus.GATED_COMPLETE);
    const res = await wrapped(req(), {});
    expect(res.status).toBe(200);
    expect((await res.json()).ran).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const identityArg = (handler.mock.calls[0] as unknown[])[3] as { userId: string };
    expect(identityArg.userId).toBe('user-gate-1');
  });
});

describe('LIVE downstream route GET /api/mission-control/today is gated on GATED_COMPLETE (§6.10-1 is REAL)', () => {
  function req() {
    return new NextRequest('http://localhost/api/mission-control/today');
  }

  test('an authenticated-but-not-complete user is DENIED (403) — no Today data leaks', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboardingRow(OnboardingStatus.IN_PROGRESS);
    const res = await todayGET(req(), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(body.header).toBeUndefined(); // the payload never rendered
  });

  test('a GATED_COMPLETE user passes and gets their Today payload', async () => {
    mockedSession.mockResolvedValue(fakeSession({ onboardingStatus: OnboardingStatus.GATED_COMPLETE }));
    seedOnboardingRow(OnboardingStatus.GATED_COMPLETE);
    const res = await todayGET(req(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    // This suite's `jest.mock('@/lib/prisma', ...)` only stubs `user.findUnique` (the gate's own
    // dependency) — none of the six zone queries, so every zone independently reports its own
    // `status: 'error'` (proving the isolation guarantee holds even here) while the route itself
    // still succeeds end-to-end. The full real-data path is proven in
    // tests/unit/mission-control-today-service.test.ts and tests/unit/mission-control-route.test.ts.
    expect(body.generatedAt).toBeDefined();
    expect(body.header).toBeDefined();
    expect(body.briefing).toBeDefined();
    expect(body.actionQueue).toBeDefined();
    expect(body.pipeline).toBeDefined();
    expect(body.ratios).toBeDefined();
    expect(body.calendar).toBeDefined();
  });

  test('an unauthenticated request is DENIED (401)', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await todayGET(req(), {});
    expect(res.status).toBe(401);
  });
});
