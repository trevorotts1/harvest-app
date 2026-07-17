// T-24 — proves `/api/contacts/hidden-earnings` (the Hidden Earnings render endpoint, §7.3/§8.4) is
// actually gated the same way `/api/contacts/import` is (no session → 401; onboarding-incomplete →
// 403), reads the caller's org/solution-number/contact-count SERVER-SIDE (never from the request
// body — nothing here is client-suppliable), and that the response always carries the mandatory
// safe-harbor line while a Primerica calibration only ever appears for a Primerica org with a
// solution number on file. Mirrors the exact module-boundary-mocking pattern established in
// tests/unit/contacts-import-route.test.ts.

import { OnboardingStatus, OrgType, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    contact: { count: jest.fn() },
  },
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/contacts/hidden-earnings/route';
import { SAFE_HARBOR_LINE } from '@/services/warm-market/hidden-earnings';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedContactCount = (prisma as unknown as { contact: { count: jest.Mock } }).contact.count;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-he-1',
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

// Onboarding-gate reads `onboarding_status` fresh from the DB via `prisma.user.findUnique` — the
// SAME mocked function the route's own org/solution-number read uses. Chain `mockResolvedValueOnce`
// calls so the FIRST call (the gate's read) resolves the gate, and the SECOND (the route's own
// read) resolves the org context — exactly mirroring how withOnboardingGate composes in front of
// the handler in the real request lifecycle.
function seedGateThenRoute(
  status: OnboardingStatus,
  routeUser: { org_type: OrgType; solution_number: string | null } | null
) {
  mockedUserFindUnique
    .mockResolvedValueOnce({ onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }] })
    .mockResolvedValueOnce(routeUser);
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost/api/contacts/hidden-earnings', { method: 'GET' });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedContactCount.mockReset();
});

describe('GET /api/contacts/hidden-earnings — the §6.10-1 hard gate', () => {
  test('no session -> 401, no DB reads for the figure occur', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(getRequest(), {});
    expect(res.status).toBe(401);
    expect(mockedContactCount).not.toHaveBeenCalled();
  });

  test('authenticated but onboarding incomplete -> 403 ONBOARDING_INCOMPLETE, figure never computed', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockedUserFindUnique.mockResolvedValueOnce({
      onboarding_status: OnboardingStatus.IN_PROGRESS,
      onboarding_sessions: [{ current_step: 'ORG' }],
    });

    const res = await GET(getRequest(), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(mockedContactCount).not.toHaveBeenCalled();
  });
});

describe('GET /api/contacts/hidden-earnings — the render, once gated', () => {
  test('universal org, 0 contacts -> growth path, carries the safe-harbor line, no dollar figure', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGateThenRoute(OnboardingStatus.GATED_COMPLETE, { org_type: OrgType.EXTERNAL, solution_number: null });
    mockedContactCount.mockResolvedValue(0);

    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe('growth_path');
    expect(body.safeHarborLine).toBe(SAFE_HARBOR_LINE);
    expect(JSON.stringify(body)).not.toMatch(/\$0\b/);
  });

  test('universal org, 100 contacts -> a real figure, universal calibration, safe-harbor line present, zero Primerica strings', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGateThenRoute(OnboardingStatus.GATED_COMPLETE, { org_type: OrgType.EXTERNAL, solution_number: null });
    mockedContactCount.mockResolvedValue(100);

    const res = await GET(getRequest(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe('figure');
    expect(body.calibration).toBe('universal');
    expect(body.safeHarborLine).toBe(SAFE_HARBOR_LINE);
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/primerica/);
  });

  test('TEETH: Primerica org WITH a solution number on file -> Primerica calibration', async () => {
    mockedSession.mockResolvedValue(fakeSession({ orgType: 'PRIMERICA' as unknown as Session['user']['orgType'] }));
    seedGateThenRoute(OnboardingStatus.GATED_COMPLETE, {
      org_type: OrgType.PRIMERICA,
      solution_number: '{"ciphertext":"...","iv":"...","authTag":"..."}',
    });
    mockedContactCount.mockResolvedValue(100);

    const res = await GET(getRequest(), {});
    const body = await res.json();
    expect(body.calibration).toBe('primerica');
    expect(body.safeHarborLine).toBe(SAFE_HARBOR_LINE);
  });

  test('TEETH: Primerica org WITHOUT a solution number on file -> universal calibration, never Primerica numbers', async () => {
    mockedSession.mockResolvedValue(fakeSession({ orgType: 'PRIMERICA' as unknown as Session['user']['orgType'] }));
    seedGateThenRoute(OnboardingStatus.GATED_COMPLETE, { org_type: OrgType.PRIMERICA, solution_number: null });
    mockedContactCount.mockResolvedValue(100);

    const res = await GET(getRequest(), {});
    const body = await res.json();
    expect(body.calibration).toBe('universal');
  });

  test('fail-closed default: a missing/deleted user row never falls back to Primerica', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGateThenRoute(OnboardingStatus.GATED_COMPLETE, null);
    mockedContactCount.mockResolvedValue(100);

    const res = await GET(getRequest(), {});
    const body = await res.json();
    expect(body.calibration).toBe('universal');
  });

  test('the response never renders NaN anywhere in the serialized payload', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedGateThenRoute(OnboardingStatus.GATED_COMPLETE, { org_type: OrgType.EXTERNAL, solution_number: null });
    mockedContactCount.mockResolvedValue(7); // a "gap" count that floors to a zero-client figure

    const res = await GET(getRequest(), {});
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/NaN/);
    expect(body.kind).toBe('growth_path'); // 7 contacts floors to $0 under the universal formula
  });
});
