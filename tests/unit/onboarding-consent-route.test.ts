// WP01 §6.10-10 (T-21R) — `POST`/`DELETE /api/onboarding/consent`, the live GDPR consent
// grant/revoke route. Mirrors `tests/unit/session-whoami.test.ts`'s pattern exactly: `getCurrentSession`
// is mocked at the module boundary (`@/lib/auth/session`) so `withRole` sees a real session shape
// without a live Auth.js setup. `@/lib/onboarding/gdpr-consent` is ALSO mocked here so this suite
// stays a pure route/auth-gating test (no Prisma) — the grant/revoke business logic itself (WP11
// ConsentManager + durable ComplianceConsent/User writes) is proven directly, with real Prisma-shaped
// mocks, in `tests/unit/gdpr-consent.test.ts`. Together the two suites prove: the route calls the
// right function with the right (session-derived, never header-derived) user id, AND that function
// does the real work.

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({
  getCurrentSession: jest.fn(),
}));

jest.mock('@/lib/onboarding/gdpr-consent', () => ({
  grantGdprConsent: jest.fn(),
  revokeGdprConsent: jest.fn(),
}));

import { getCurrentSession } from '@/lib/auth/session';
import { grantGdprConsent, revokeGdprConsent } from '@/lib/onboarding/gdpr-consent';
import { POST, DELETE } from '@/app/api/onboarding/consent/route';

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedGrant = grantGdprConsent as jest.MockedFunction<typeof grantGdprConsent>;
const mockedRevoke = revokeGdprConsent as jest.MockedFunction<typeof revokeGdprConsent>;

function fakeSession(userId: string, role: Role = Role.REP): Session {
  return {
    user: {
      id: userId,
      role,
      orgType: 'EXTERNAL',
      organizationId: 'org-1',
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

const FAKE_RECORD = {
  id: 'rec-1',
  user_id: 'user-1',
  consent_type: 'profile' as const,
  given: true,
  version: 1,
  timestamp: '2026-01-01T00:00:00.000Z',
  revocable: true,
  source: 'onboarding',
};

const FAKE_ROW = { id: 'cc-1', user_id: 'user-1', consent_type: 'gdpr', given: true, timestamp: new Date() };

describe('POST /api/onboarding/consent (grant)', () => {
  afterEach(() => {
    mockedGetCurrentSession.mockReset();
    mockedGrant.mockReset();
    mockedRevoke.mockReset();
  });

  test('returns 401 with no session — never reaches grantGdprConsent', async () => {
    mockedGetCurrentSession.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/onboarding/consent', { method: 'POST' });
    const response = await POST(request, {});

    expect(response.status).toBe(401);
    expect(mockedGrant).not.toHaveBeenCalled();
  });

  test('an authenticated caller of ANY role grants consent for THEIR OWN session user id (never a header)', async () => {
    mockedGetCurrentSession.mockResolvedValue(fakeSession('user-1', Role.RVP));
    mockedGrant.mockResolvedValue({ record: FAKE_RECORD, complianceConsent: FAKE_ROW });

    // A forged x-user-id header must have ZERO effect — the route only trusts the session.
    const request = new NextRequest('http://localhost/api/onboarding/consent', {
      method: 'POST',
      headers: { 'x-user-id': 'some-other-victim-id' },
    });
    const response = await POST(request, {});

    expect(response.status).toBe(200);
    expect(mockedGrant).toHaveBeenCalledTimes(1);
    expect(mockedGrant.mock.calls[0]![0]).toBe('user-1'); // the SESSION id, not the header
    const body = await response.json();
    expect(body.granted).toBe(true);
    expect(body.version).toBe(1);
  });

  test('every role in the five-role enum can grant their own consent (no role-specific gate on this route)', async () => {
    for (const role of Object.values(Role)) {
      mockedGetCurrentSession.mockResolvedValue(fakeSession('user-1', role));
      mockedGrant.mockResolvedValue({ record: FAKE_RECORD, complianceConsent: FAKE_ROW });

      const request = new NextRequest('http://localhost/api/onboarding/consent', { method: 'POST' });
      const response = await POST(request, {});
      expect(response.status).toBe(200);
    }
  });
});

describe('DELETE /api/onboarding/consent (revoke, §6.10-10 "revocable")', () => {
  afterEach(() => {
    mockedGetCurrentSession.mockReset();
    mockedGrant.mockReset();
    mockedRevoke.mockReset();
  });

  test('returns 401 with no session — never reaches revokeGdprConsent', async () => {
    mockedGetCurrentSession.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/onboarding/consent', { method: 'DELETE' });
    const response = await DELETE(request, {});

    expect(response.status).toBe(401);
    expect(mockedRevoke).not.toHaveBeenCalled();
  });

  test('an authenticated caller revokes THEIR OWN consent — response reflects given: false', async () => {
    mockedGetCurrentSession.mockResolvedValue(fakeSession('user-1'));
    mockedRevoke.mockResolvedValue({
      record: { ...FAKE_RECORD, given: false, version: 2 },
      complianceConsent: { ...FAKE_ROW, given: false },
    });

    const request = new NextRequest('http://localhost/api/onboarding/consent', { method: 'DELETE' });
    const response = await DELETE(request, {});

    expect(response.status).toBe(200);
    expect(mockedRevoke).toHaveBeenCalledTimes(1);
    expect(mockedRevoke.mock.calls[0]![0]).toBe('user-1');
    const body = await response.json();
    expect(body.granted).toBe(false);
    expect(body.version).toBe(2);
  });
});
