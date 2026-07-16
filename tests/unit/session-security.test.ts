import {
  ABSOLUTE_SESSION_LIFETIME_MS,
  computeDeviceFingerprint,
  evaluateSessionSecurity,
  extractClientIp,
  extractHeader,
  hashIp,
  IDLE_TIMEOUT_MS,
  isStepUpFresh,
  sessionActivityKey,
  type SessionSecurityContext,
} from '../../src/lib/auth/session-security';

const BASE_CONTEXT: SessionSecurityContext = {
  fingerprintHash: 'fp-abc123',
  boundAt: 1_000_000,
  securityVersionAtIssue: 0,
};

/**
 * Proves (T-12 build brief, PROVE item d): "fingerprint mismatch challenges/invalidates session."
 * Also covers the other three session-hijack/expiry axes (idle timeout, absolute lifetime, and
 * version-based revocation, which is what "sign out everywhere" and privilege rotation both use).
 */
describe('evaluateSessionSecurity (§16.4/§18.10 session-hijack + expiry)', () => {
  function validCheck(overrides: Partial<Parameters<typeof evaluateSessionSecurity>[1]> = {}) {
    return {
      currentFingerprintHash: BASE_CONTEXT.fingerprintHash,
      now: BASE_CONTEXT.boundAt + 60_000,
      currentSecurityVersion: BASE_CONTEXT.securityVersionAtIssue,
      lastActivityAt: BASE_CONTEXT.boundAt + 60_000,
      ...overrides,
    };
  }

  test('a session with no anomaly is valid', () => {
    const result = evaluateSessionSecurity(BASE_CONTEXT, validCheck());
    expect(result.valid).toBe(true);
  });

  test('a device-fingerprint mismatch invalidates the session (suspected hijack)', () => {
    const result = evaluateSessionSecurity(
      BASE_CONTEXT,
      validCheck({ currentFingerprintHash: 'fp-DIFFERENT' })
    );
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.reason).toBe('fingerprint_mismatch');
  });

  test('idle timeout: no activity for > 30 minutes invalidates the session', () => {
    const now = BASE_CONTEXT.boundAt + IDLE_TIMEOUT_MS + 1;
    const result = evaluateSessionSecurity(
      BASE_CONTEXT,
      validCheck({ now, lastActivityAt: BASE_CONTEXT.boundAt })
    );
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.reason).toBe('idle_expired');
  });

  test('recent activity within the idle window keeps the session valid', () => {
    const now = BASE_CONTEXT.boundAt + IDLE_TIMEOUT_MS - 1_000;
    const result = evaluateSessionSecurity(
      BASE_CONTEXT,
      validCheck({ now, lastActivityAt: BASE_CONTEXT.boundAt })
    );
    expect(result.valid).toBe(true);
  });

  test('absolute session lifetime: expires even with continuous activity', () => {
    const now = BASE_CONTEXT.boundAt + ABSOLUTE_SESSION_LIFETIME_MS + 1;
    const result = evaluateSessionSecurity(
      BASE_CONTEXT,
      validCheck({ now, lastActivityAt: now }) // "active" right up to the absolute ceiling
    );
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.reason).toBe('absolute_expired');
  });

  test('revocation: a security_version mismatch invalidates the session ("sign out everywhere" / privilege rotation)', () => {
    const result = evaluateSessionSecurity(BASE_CONTEXT, validCheck({ currentSecurityVersion: 1 }));
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.reason).toBe('revoked');
  });

  test('revocation takes precedence when it and a fingerprint mismatch both fire', () => {
    const result = evaluateSessionSecurity(
      BASE_CONTEXT,
      validCheck({ currentSecurityVersion: 1, currentFingerprintHash: 'fp-DIFFERENT' })
    );
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable');
    expect(result.reason).toBe('revoked');
  });
});

describe('computeDeviceFingerprint / hashIp', () => {
  test('is deterministic for the same inputs', () => {
    const a = computeDeviceFingerprint({ userAgent: 'UA-1', ip: '1.2.3.4', acceptLanguage: 'en-US' });
    const b = computeDeviceFingerprint({ userAgent: 'UA-1', ip: '1.2.3.4', acceptLanguage: 'en-US' });
    expect(a).toBe(b);
  });

  test('changes when the user-agent changes (a real device/browser change)', () => {
    const a = computeDeviceFingerprint({ userAgent: 'UA-1', ip: '1.2.3.4', acceptLanguage: 'en-US' });
    const b = computeDeviceFingerprint({ userAgent: 'UA-2', ip: '1.2.3.4', acceptLanguage: 'en-US' });
    expect(a).not.toBe(b);
  });

  test('changes when the IP changes', () => {
    const a = computeDeviceFingerprint({ userAgent: 'UA-1', ip: '1.2.3.4', acceptLanguage: 'en-US' });
    const b = computeDeviceFingerprint({ userAgent: 'UA-1', ip: '9.9.9.9', acceptLanguage: 'en-US' });
    expect(a).not.toBe(b);
  });

  test('hashIp never returns the raw IP', () => {
    const hash = hashIp('203.0.113.7');
    expect(hash).not.toContain('203.0.113.7');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('extractClientIp / extractHeader (shared by authorize() and the API-route wrappers)', () => {
  test('reads from a plain-object header source (NextAuth RequestInternal.headers shape)', () => {
    const headers = { 'x-forwarded-for': '198.51.100.5, 10.0.0.1', 'user-agent': 'TestUA' };
    expect(extractClientIp(headers)).toBe('198.51.100.5');
    expect(extractHeader(headers, 'user-agent')).toBe('TestUA');
  });

  test('reads from a real Headers instance (NextRequest.headers shape)', () => {
    const headers = new Headers({ 'x-real-ip': '198.51.100.9', 'user-agent': 'TestUA2' });
    expect(extractClientIp(headers)).toBe('198.51.100.9');
    expect(extractHeader(headers, 'user-agent')).toBe('TestUA2');
  });

  test('falls back to null when nothing is present', () => {
    expect(extractClientIp(null)).toBeNull();
    expect(extractClientIp({})).toBeNull();
  });
});

describe('isStepUpFresh', () => {
  test('null verifiedAt is never fresh', () => {
    expect(isStepUpFresh(null)).toBe(false);
  });

  test('a recent timestamp is fresh; a stale one is not', () => {
    const now = 10_000_000;
    const recent = new Date(now - 60_000).toISOString();
    const stale = new Date(now - 20 * 60_000).toISOString();
    expect(isStepUpFresh(recent, now)).toBe(true);
    expect(isStepUpFresh(stale, now)).toBe(false);
  });
});

describe('sessionActivityKey', () => {
  test('is stable for the same user+boundAt and distinct across users/sign-ins', () => {
    expect(sessionActivityKey('user-1', 1000)).toBe(sessionActivityKey('user-1', 1000));
    expect(sessionActivityKey('user-1', 1000)).not.toBe(sessionActivityKey('user-1', 2000));
    expect(sessionActivityKey('user-1', 1000)).not.toBe(sessionActivityKey('user-2', 1000));
  });
});
