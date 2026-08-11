// R-18 (admin-mediated password recovery — the SMTP-free recovery path, T-59/W1) — PROOF of the
// CONFIRM half end-to-end at the route level: POST /api/auth/password-reset/confirm consumes the
// one-time token (single-use + expiry — via the real consume path against the mocked store), sets
// the NEW bcrypt password on the user row, bumps `security_version` (the "sign out everywhere"
// revocation on a trust-boundary event, src/lib/auth/session-security.ts), and emits the
// password_reset + session_revoked SecurityEvents. Mirrors tests/unit/login-authorize.test.ts's
// module-boundary-mocking pattern (mock @/lib/prisma, inject real in-memory stores via the
// module-level setters; never mock the security machinery being proven).
//
// Together with tests/unit/admin-reset-password-route.test.ts (the ISSUANCE half) this closes the
// loop the card names: an admin issues a token out-of-band, the user redeems it here, and the
// password is changed — no SMTP anywhere.

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  security_version: number;
  role: Role;
}

const usersByEmail = new Map<string, UserRow>();
const verificationTokens: Array<{ identifier: string; token: string; expires: Date }> = [];

function seedUser(overrides: Partial<UserRow> & { email: string }): void {
  usersByEmail.set(overrides.email, {
    id: 'user-1',
    password_hash: bcrypt.hashSync('old-password-123', 4), // 4 rounds: fast test hash, still real bcrypt
    security_version: 0,
    role: Role.REP,
    ...overrides,
  });
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async (args: { where: { email: string } }) => usersByEmail.get(args.where.email) ?? null),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const user = Array.from(usersByEmail.values()).find((u) => u.id === args.where.id);
        if (!user) throw new Error('not found');
        // Honor Prisma's `{ increment: n }` shape (the confirm route bumps security_version that way).
        const mutable = user as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(args.data)) {
          if (typeof value === 'object' && value !== null && 'increment' in value) {
            mutable[key] = (mutable[key] as number) + (value as { increment: number }).increment;
          } else {
            mutable[key] = value;
          }
        }
        return user;
      }),
    },
    verificationToken: {
      create: jest.fn(async (args: { data: { identifier: string; token: string; expires: Date } }) => {
        verificationTokens.push(args.data);
      }),
      findUnique: jest.fn(async (args: { where: { identifier_token: { identifier: string; token: string } } }) => {
        const row = verificationTokens.find(
          (t) => t.identifier === args.where.identifier_token.identifier && t.token === args.where.identifier_token.token
        );
        return row ? { expires: row.expires } : null;
      }),
      delete: jest.fn(async (args: { where: { identifier_token: { identifier: string; token: string } } }) => {
        const idx = verificationTokens.findIndex(
          (t) =>
            t.identifier === args.where.identifier_token.identifier && t.token === args.where.identifier_token.token
        );
        if (idx >= 0) verificationTokens.splice(idx, 1);
      }),
    },
  },
}));

import { POST as confirmPOST } from '@/app/api/auth/password-reset/confirm/route';
import { InMemorySecurityEventSink, setSecurityEventSink } from '@/services/security/security-event';
import { InMemoryRateLimitStore, setPasswordResetRateLimitStore } from '@/services/security/rate-limiter';
import { setBreachedPasswordChecker, StaticBreachedPasswordList } from '@/services/security/credential-stuffing';
import {
  issuePasswordResetToken,
  PrismaVerificationTokenStore,
  type VerificationTokenPrismaClient,
} from '@/services/security/password-reset';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/password-reset/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let sink: InMemorySecurityEventSink;

beforeEach(async () => {
  sink = new InMemorySecurityEventSink();
  setSecurityEventSink(sink);
  setPasswordResetRateLimitStore(new InMemoryRateLimitStore());
  setBreachedPasswordChecker(new StaticBreachedPasswordList());
  usersByEmail.clear();
  verificationTokens.length = 0;
  seedUser({ email: 'target1@example.com' });
});

describe('POST /api/auth/password-reset/confirm — token consume sets a NEW bcrypt password + revokes sessions (R-18 recovery-path confirm)', () => {
  it('valid token: consumes it, sets the new bcrypt password, bumps security_version, emits password_reset + session_revoked', async () => {
    // Issue a token exactly like the admin route does (same mechanism, same store shape).
    const store = new PrismaVerificationTokenStore(
      jest.requireMock('@/lib/prisma').prisma as unknown as VerificationTokenPrismaClient
    );
    const rawToken = await issuePasswordResetToken(store, 'target1@example.com');

    const res = await confirmPOST(
      req({ email: 'target1@example.com', token: rawToken, newPassword: 'Fresh-Safe-Pass-77' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reset).toBe(true);

    // The password actually changed, to a REAL bcrypt hash of the new password.
    const user = usersByEmail.get('target1@example.com')!;
    expect(user.password_hash).toMatch(/^\$2[aby]\$/);
    expect(bcrypt.compareSync('Fresh-Safe-Pass-77', user.password_hash)).toBe(true);
    expect(bcrypt.compareSync('old-password-123', user.password_hash)).toBe(false);
    expect(user.security_version).toBe(1); // "sign out everywhere" bump

    // The token was consumed — the same token cannot be replayed.
    const replay = await confirmPOST(
      req({ email: 'target1@example.com', token: rawToken, newPassword: 'Another-Pass-88' })
    );
    expect(replay.status).toBe(400);

    // SecurityEvents: exactly one password_reset + one session_revoked for the user.
    expect(sink.ofType('password_reset')).toHaveLength(1);
    expect(sink.ofType('session_revoked')).toHaveLength(1);
    expect(sink.ofType('password_reset')[0]?.user_id).toBe('user-1');
  });

  it('an expired token is rejected (and consumed), password unchanged, no password_reset SecurityEvent', async () => {
    const issuedAt = new Date(Date.now() - 31 * 60 * 1000); // 31 minutes ago — beyond the 30-min TTL
    // Seed an expired token directly through the same hashed store shape the route reads.
    const store = new PrismaVerificationTokenStore(
      jest.requireMock('@/lib/prisma').prisma as unknown as VerificationTokenPrismaClient
    );
    const { createHash } = await import('node:crypto');
    verificationTokens.push({
      identifier: 'target1@example.com',
      token: createHash('sha256').update('stale-token').digest('hex'),
      expires: new Date(issuedAt.getTime() + 30 * 60 * 1000),
    });

    const res = await confirmPOST(req({ email: 'target1@example.com', token: 'stale-token', newPassword: 'Fresh-Pass-99' }));
    expect(res.status).toBe(400);
    const user = usersByEmail.get('target1@example.com')!;
    expect(bcrypt.compareSync('old-password-123', user.password_hash)).toBe(true);
    expect(user.security_version).toBe(0);
    expect(sink.ofType('password_reset')).toHaveLength(0);
  });

  it('a breached new password is rejected (screen before set, §18.10), token not consumed, nothing changed', async () => {
    const store = new PrismaVerificationTokenStore(
      jest.requireMock('@/lib/prisma').prisma as unknown as VerificationTokenPrismaClient
    );
    const rawToken = await issuePasswordResetToken(store, 'target1@example.com');

    const res = await confirmPOST(req({ email: 'target1@example.com', token: rawToken, newPassword: 'password123' }));
    expect(res.status).toBe(400);
    const user = usersByEmail.get('target1@example.com')!;
    expect(bcrypt.compareSync('old-password-123', user.password_hash)).toBe(true);
    expect(user.security_version).toBe(0);
    // Token survives (consume happens after the breach screen) — replayable later with a safe password.
    expect(verificationTokens).toHaveLength(1);
  });

  it('missing fields -> 400', async () => {
    const res = await confirmPOST(req({ email: 'target1@example.com' }));
    expect(res.status).toBe(400);
  });
});
