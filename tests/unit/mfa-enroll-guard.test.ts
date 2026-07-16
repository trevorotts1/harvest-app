/**
 * T-12 HIGH fix — the MFA-management routes are now wrapped in `withSessionSecurity` (composed
 * under `withRole`), and re-enrolling over an ALREADY-enrolled factor requires a fresh step-up.
 *
 * This drives the real composed `POST /api/auth/mfa/enroll` handler end-to-end:
 *   - first-time enrollment (no existing factor) → allowed with no step-up;
 *   - re-enrollment with a STALE/absent step-up → 403 STEP_UP_REQUIRED, no overwrite;
 *   - re-enrollment with a FRESH step-up → allowed (overwrite proceeds).
 * Teeth: drop the withSessionSecurity wrap and the "matching fingerprint" assertion path changes;
 * drop the re-enroll guard and the 403 case starts returning 200 + overwriting the victim's factor.
 */

import { Role } from '@prisma/client';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';

jest.mock('../../src/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn(), update: jest.fn() } },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getCurrentSession } = jest.requireMock('../../src/lib/auth/session') as {
  getCurrentSession: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = jest.requireMock('@/lib/prisma') as {
  prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
};

import { POST as enrollPost } from '../../src/app/api/auth/mfa/enroll/route';
import {
  computeDeviceFingerprint,
  InMemorySessionActivityStore,
  setSessionActivityStore,
} from '../../src/lib/auth/session-security';
import { InMemorySecurityEventSink, setSecurityEventSink } from '../../src/services/security/security-event';

const KNOWN_FINGERPRINT = computeDeviceFingerprint({ userAgent: 'UA-known', ip: '1.2.3.4', acceptLanguage: null });

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-1',
      email: 'rep@example.com',
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: null,
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      deviceFingerprintHash: KNOWN_FINGERPRINT,
      securityVersionAtIssue: 0,
      boundAt: Date.now(),
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function fakeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/auth/mfa/enroll', {
    method: 'POST',
    headers: { 'user-agent': 'UA-known', 'x-forwarded-for': '1.2.3.4' },
  });
}

let sink: InMemorySecurityEventSink;

beforeEach(() => {
  sink = new InMemorySecurityEventSink();
  setSecurityEventSink(sink);
  setSessionActivityStore(new InMemorySessionActivityStore());
  getCurrentSession.mockReset();
  prisma.user.findUnique.mockReset();
  prisma.user.update.mockReset();
  prisma.user.update.mockResolvedValue({});
});

describe('POST /api/auth/mfa/enroll — session-security wrap + re-enrollment step-up guard (T-12)', () => {
  test('first-time enrollment (no existing factor) is allowed with no step-up', async () => {
    getCurrentSession.mockResolvedValue(fakeSession({ mfaEnrolled: false, mfaVerifiedAt: null }));
    prisma.user.findUnique.mockResolvedValue({ security_version: 0, mfa_enrolled: false });

    const res = await enrollPost(fakeRequest(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.secret).toBe('string');
    expect(prisma.user.update).toHaveBeenCalledTimes(1); // factor material persisted
  });

  test('re-enrollment over an existing factor WITHOUT a fresh step-up → 403 STEP_UP_REQUIRED, no overwrite', async () => {
    getCurrentSession.mockResolvedValue(fakeSession({ mfaEnrolled: true, mfaVerifiedAt: null }));
    prisma.user.findUnique.mockResolvedValue({ security_version: 0, mfa_enrolled: true });

    const res = await enrollPost(fakeRequest(), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('STEP_UP_REQUIRED');
    expect(prisma.user.update).not.toHaveBeenCalled(); // the victim's factor is NOT overwritten
    expect(sink.ofType('mfa_challenge')).toHaveLength(1);
  });

  test('re-enrollment WITH a fresh step-up → allowed (overwrite proceeds)', async () => {
    const fresh = new Date(Date.now() - 60_000).toISOString();
    getCurrentSession.mockResolvedValue(fakeSession({ mfaEnrolled: true, mfaVerifiedAt: fresh }));
    prisma.user.findUnique.mockResolvedValue({ security_version: 0, mfa_enrolled: true });

    const res = await enrollPost(fakeRequest(), {});
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  test('a revoked session (bumped security_version) is denied by the withSessionSecurity wrap (401)', async () => {
    getCurrentSession.mockResolvedValue(fakeSession({ mfaEnrolled: false, securityVersionAtIssue: 0 }));
    prisma.user.findUnique.mockResolvedValue({ security_version: 5, mfa_enrolled: false }); // bumped since sign-in

    const res = await enrollPost(fakeRequest(), {});
    expect(res.status).toBe(401);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sink.ofType('session_revoked')).toHaveLength(1);
  });
});
