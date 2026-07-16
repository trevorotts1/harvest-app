import bcrypt from 'bcryptjs';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = jest.requireMock('@/lib/prisma') as { prisma: { user: { findUnique: jest.Mock } } };

import { authOptions } from '../../src/lib/auth/options';
import {
  InMemoryLoginHistoryStore,
  setLoginHistoryStore,
} from '../../src/services/security/credential-stuffing';
import {
  InMemoryRateLimitStore,
  setLoginRateLimitStore,
} from '../../src/services/security/rate-limiter';
import { InMemorySecurityEventSink, setSecurityEventSink } from '../../src/services/security/security-event';

type Authorize = (
  credentials: Record<string, string> | undefined,
  req: { headers?: Record<string, unknown> }
) => Promise<unknown>;

// The Credentials provider's `authorize` is what src/lib/auth/options.ts wires §16.4's real
// rate-limiting/credential-stuffing/session-binding logic into — exercising it directly (rather
// than only its extracted helper modules) is what proves the wiring itself, not just the pieces.
//
// NOTE: next-auth v4.24's `CredentialsProvider()` factory (node_modules/next-auth/providers/
// credentials.js) hardcodes the returned provider's top-level `.authorize` to a stub
// (`() => null`) and stashes the actual config — including the real `authorize` we passed in —
// under `.options`. The library's own internal sign-in flow reads `provider.options.authorize`,
// not `provider.authorize`; this is what this test must call too.
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: Authorize } })
  .options.authorize;

const REQ = { headers: { 'user-agent': 'TestUA', 'x-forwarded-for': '198.51.100.1' } };

let sink: InMemorySecurityEventSink;

beforeEach(async () => {
  sink = new InMemorySecurityEventSink();
  setSecurityEventSink(sink);
  setLoginRateLimitStore(new InMemoryRateLimitStore());
  setLoginHistoryStore(new InMemoryLoginHistoryStore());
  prisma.user.findUnique.mockReset();
});

describe('authorize() — login wiring (§16.4/§18.10, T-12)', () => {
  test('correct credentials succeed and return the session-binding fields', async () => {
    const password_hash = await bcrypt.hash('CorrectHorseBatteryStaple!', 12);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'rep@example.com',
      name: 'Rep One',
      password_hash,
      role: 'REP',
      org_type: 'EXTERNAL',
      organization_id: null,
      access_tier: 'FREE_ORG_LINKED',
      mfa_enrolled: false,
      security_version: 0,
    });

    const result = (await authorize(
      { email: 'rep@example.com', password: 'CorrectHorseBatteryStaple!' },
      REQ
    )) as Record<string, unknown> | null;

    expect(result).not.toBeNull();
    expect(result?.id).toBe('user-1');
    expect(result?.deviceFingerprintHash).toBeTruthy();
    expect(result?.securityVersionAtIssue).toBe(0);
    expect(sink.ofType('login_success')).toHaveLength(1);
  });

  test('wrong password fails and emits login_failure (never revealing which check failed)', async () => {
    const password_hash = await bcrypt.hash('TheRealPassword1!', 12);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'rep@example.com',
      password_hash,
      role: 'REP',
      org_type: 'EXTERNAL',
      organization_id: null,
      access_tier: 'FREE_ORG_LINKED',
      mfa_enrolled: false,
      security_version: 0,
    });

    const result = await authorize({ email: 'rep@example.com', password: 'WrongPassword!' }, REQ);
    expect(result).toBeNull();
    expect(sink.ofType('login_failure')).toHaveLength(1);
  });

  test('a non-existent email fails identically to a wrong password (no enumeration)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const result = await authorize({ email: 'nobody@example.com', password: 'Whatever1!' }, REQ);
    expect(result).toBeNull();
    expect(sink.ofType('login_failure')).toHaveLength(1);
  });

  test('rate limiting: the account is locked out after repeated failures, and FAILS CLOSED (returns null, not the user)', async () => {
    const password_hash = await bcrypt.hash('TheRealPassword1!', 12);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'rep@example.com',
      password_hash,
      role: 'REP',
      org_type: 'EXTERNAL',
      organization_id: null,
      access_tier: 'FREE_ORG_LINKED',
      mfa_enrolled: false,
      security_version: 0,
    });

    // Exceed the login rate limit (5 attempts/5min per LOGIN_RATE_LIMIT) with wrong passwords.
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      await authorize({ email: 'rep@example.com', password: 'WrongPassword!' }, REQ);
    }

    // Even the CORRECT password is now denied — the account is locked out, not just "wrong
    // password" rejected. This is the fail-closed behavior: a locked key blocks everyone,
    // including the legitimate owner, until the lockout window elapses.
    const result = await authorize({ email: 'rep@example.com', password: 'TheRealPassword1!' }, REQ);
    expect(result).toBeNull();
    expect(sink.ofType('rate_limited').length).toBeGreaterThan(0);
  });

  test('missing credentials return null without touching the database', async () => {
    const result = await authorize({ email: '', password: '' }, REQ);
    expect(result).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
