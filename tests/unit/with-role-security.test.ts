import { Role } from '@prisma/client';
import type { Session } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('../../src/lib/auth/session', () => ({
  getCurrentSession: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getCurrentSession } = jest.requireMock('../../src/lib/auth/session') as {
  getCurrentSession: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = jest.requireMock('@/lib/prisma') as {
  prisma: { user: { findUnique: jest.Mock } };
};

import { withCapability, withRole, withSessionSecurity, withStepUp } from '../../src/lib/auth/with-role';
import { InMemorySecurityEventSink, setSecurityEventSink } from '../../src/services/security/security-event';
import {
  computeDeviceFingerprint,
  InMemorySessionActivityStore,
  setSessionActivityStore,
} from '../../src/lib/auth/session-security';

/** The fingerprint `withSessionSecurity` will compute from `fakeRequest()`'s default headers —
 *  used as the session's *bound* fingerprint in "should match" tests, so the match is real (not
 *  a placeholder string that could never equal anything). */
const KNOWN_FINGERPRINT = computeDeviceFingerprint({
  userAgent: 'UA-known',
  ip: '1.2.3.4',
  acceptLanguage: null,
});

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-1',
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: null,
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      deviceFingerprintHash: 'fp-known',
      securityVersionAtIssue: 0,
      boundAt: 1_000_000,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function fakeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    headers: { 'user-agent': 'UA-known', 'x-forwarded-for': '1.2.3.4', ...headers },
  });
}

let sink: InMemorySecurityEventSink;

beforeEach(() => {
  sink = new InMemorySecurityEventSink();
  setSecurityEventSink(sink);
  setSessionActivityStore(new InMemorySessionActivityStore());
  getCurrentSession.mockReset();
  prisma.user.findUnique.mockReset();
});

const okHandler = jest.fn(async () => NextResponse.json({ ok: true }));

describe('withRole / withCapability — privilege-escalation SecurityEvent (§18.10)', () => {
  beforeEach(() => okHandler.mockClear());

  test('FORBIDDEN (role not on allow-list) returns 403 and emits privilege_escalation_denied', async () => {
    getCurrentSession.mockResolvedValue(fakeSession({ role: Role.REP }));
    const handler = withRole([Role.ADMIN], okHandler);

    const res = await handler(fakeRequest(), {});
    expect(res.status).toBe(403);
    expect(okHandler).not.toHaveBeenCalled();
    expect(sink.ofType('privilege_escalation_denied')).toHaveLength(1);
    expect(sink.ofType('privilege_escalation_denied')[0]?.user_id).toBe('user-1');
  });

  test('UNAUTHENTICATED (no session) returns 401 and does NOT emit privilege_escalation_denied', async () => {
    getCurrentSession.mockResolvedValue(null);
    const handler = withRole([Role.ADMIN], okHandler);

    const res = await handler(fakeRequest(), {});
    expect(res.status).toBe(401);
    expect(sink.ofType('privilege_escalation_denied')).toHaveLength(0);
  });

  test('an allowed role passes through to the handler with no SecurityEvent', async () => {
    getCurrentSession.mockResolvedValue(fakeSession({ role: Role.ADMIN }));
    const handler = withRole([Role.ADMIN], okHandler);

    const res = await handler(fakeRequest(), {});
    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(sink.ofType('privilege_escalation_denied')).toHaveLength(0);
  });

  test('withCapability also emits privilege_escalation_denied on a matrix-denied action', async () => {
    getCurrentSession.mockResolvedValue(fakeSession({ role: Role.REP }));
    const handler = withCapability('downline_visibility', 'read', okHandler);

    const res = await handler(fakeRequest(), {});
    expect(res.status).toBe(403);
    expect(sink.ofType('privilege_escalation_denied')).toHaveLength(1);
  });
});

describe('withStepUp — mfa_challenge SecurityEvent (§16.4 sensitive actions)', () => {
  beforeEach(() => okHandler.mockClear());

  test('no session → 401, no SecurityEvent', async () => {
    getCurrentSession.mockResolvedValue(null);
    const handler = withStepUp('data_export', okHandler);

    const res = await handler(fakeRequest(), {});
    expect(res.status).toBe(401);
    expect(sink.ofType('mfa_challenge')).toHaveLength(0);
  });

  test('not enrolled → 403 MFA_ENROLLMENT_REQUIRED + mfa_challenge SecurityEvent', async () => {
    getCurrentSession.mockResolvedValue(fakeSession({ mfaEnrolled: false, mfaVerifiedAt: null }));
    const handler = withStepUp('data_export', okHandler);

    const res = await handler(fakeRequest(), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(okHandler).not.toHaveBeenCalled();
    expect(sink.ofType('mfa_challenge')).toHaveLength(1);
  });

  test('enrolled but stale step-up → 403 STEP_UP_REQUIRED + mfa_challenge SecurityEvent', async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    getCurrentSession.mockResolvedValue(fakeSession({ mfaEnrolled: true, mfaVerifiedAt: stale }));
    const handler = withStepUp('billing_change', okHandler);

    const res = await handler(fakeRequest(), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('STEP_UP_REQUIRED');
    expect(sink.ofType('mfa_challenge')).toHaveLength(1);
  });

  test('enrolled + fresh step-up → handler runs, no blocking SecurityEvent', async () => {
    const fresh = new Date(Date.now() - 60_000).toISOString();
    getCurrentSession.mockResolvedValue(fakeSession({ mfaEnrolled: true, mfaVerifiedAt: fresh }));
    const handler = withStepUp('org_switch', okHandler);

    const res = await handler(fakeRequest(), {});
    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(sink.ofType('mfa_challenge')).toHaveLength(0);
  });
});

describe('withSessionSecurity — session-hijack SecurityEvent (§16.4/§18.10)', () => {
  beforeEach(() => okHandler.mockClear());

  test('matching fingerprint + current security_version → handler runs, activity touched', async () => {
    getCurrentSession.mockResolvedValue(
      fakeSession({ deviceFingerprintHash: KNOWN_FINGERPRINT, securityVersionAtIssue: 0, boundAt: Date.now() })
    );
    prisma.user.findUnique.mockResolvedValue({ security_version: 0 });
    const handler = withSessionSecurity(okHandler);

    const res = await handler(fakeRequest({ 'user-agent': 'UA-known', 'x-forwarded-for': '1.2.3.4' }), {});
    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
    expect(sink.ofType('suspected_takeover')).toHaveLength(0);
    expect(sink.ofType('session_revoked')).toHaveLength(0);
  });

  test('a fingerprint mismatch (different user-agent) is denied as suspected_takeover (CRITICAL)', async () => {
    getCurrentSession.mockResolvedValue(
      fakeSession({ deviceFingerprintHash: KNOWN_FINGERPRINT, securityVersionAtIssue: 0, boundAt: Date.now() })
    );
    prisma.user.findUnique.mockResolvedValue({ security_version: 0 });
    const handler = withSessionSecurity(okHandler);

    // Different user-agent → different computed fingerprint than the one bound at sign-in.
    const res = await handler(fakeRequest({ 'user-agent': 'ATTACKER-UA' }), {});
    expect(res.status).toBe(401);
    expect(okHandler).not.toHaveBeenCalled();
    const events = sink.ofType('suspected_takeover');
    expect(events).toHaveLength(1);
    expect(events[0]?.severity).toBe('CRITICAL');
  });

  test('a bumped security_version ("sign out everywhere" / privilege rotation) is denied as session_revoked', async () => {
    getCurrentSession.mockResolvedValue(
      fakeSession({ deviceFingerprintHash: KNOWN_FINGERPRINT, securityVersionAtIssue: 0, boundAt: Date.now() })
    );
    prisma.user.findUnique.mockResolvedValue({ security_version: 1 }); // bumped since sign-in
    const handler = withSessionSecurity(okHandler);

    const res = await handler(fakeRequest(), {});
    expect(res.status).toBe(401);
    expect(okHandler).not.toHaveBeenCalled();
    expect(sink.ofType('session_revoked')).toHaveLength(1);
  });

  test('an idle-expired session is denied as session_revoked', async () => {
    const boundAt = Date.now() - 2 * 60 * 60 * 1000; // signed in 2 hours ago
    getCurrentSession.mockResolvedValue(
      fakeSession({ deviceFingerprintHash: KNOWN_FINGERPRINT, securityVersionAtIssue: 0, boundAt })
    );
    prisma.user.findUnique.mockResolvedValue({ security_version: 0 });
    // No activity recorded since sign-in → lastActivityAt defaults to boundAt, which is now
    // well outside the 30-minute idle window.
    const handler = withSessionSecurity(okHandler);

    const res = await handler(fakeRequest(), {});
    expect(res.status).toBe(401);
    expect(sink.ofType('session_revoked')).toHaveLength(1);
  });
});
