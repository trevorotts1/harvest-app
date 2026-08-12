// T-R76 (password-reset email delivery, WP05 seam) — PROOF of the REQUEST half end-to-end at the
// route level: POST /api/auth/password-reset/request issues a single-use token and, when the
// transactional-email client is configured, emails the reset link; it answers the SAME generic
// 200 with the SAME body for every input state (existing / missing account, configured /
// unconfigured client, rate-limited, send-failure) — the §16.4 non-enumeration invariant. This
// suite exists because the card's original route carried NO test and the send-failure path broke
// the invariant (a throw escaped to a 500 that revealed account existence).
//
// Module-boundary mocking (same convention as tests/unit/password-reset-confirm-route.test.ts):
// mock @/lib/prisma with in-memory user + verificationToken stores; inject the email client via
// jest.mock of '@/services/messaging/send/email-send-client' (createEmailSendClient → configurable
// fake). Never mock the security machinery being proven (real issue/revoke paths against the
// in-memory store; real hmacForMatch + rate limiter via its in-memory store setter).

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
}

const usersByEmail = new Map<string, UserRow>();
const verificationTokens: Array<{ identifier: string; token: string; expires: Date }> = [];

function seedUser(overrides: Partial<UserRow> & { email: string }): void {
  usersByEmail.set(overrides.email, {
    id: 'user-1',
    password_hash: bcrypt.hashSync('old-password-123', 4),
    role: Role.REP,
    ...overrides,
  });
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async (args: { where: { email: string } }) => usersByEmail.get(args.where.email) ?? null),
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

// --- Configurable email-client fake (module-boundary mock of the RESEND seam) ---
const sentEmails: Array<{ to: string; from: string; subject: string; body: string }> = [];
let emailClientConfigured = true;
let failNextSend = false;

jest.mock('@/services/messaging/send/email-send-client', () => ({
  createEmailSendClient: jest.fn(() => {
    if (!emailClientConfigured) return null;
    return {
      sendEmail: jest.fn(async (input: { to: string; from: string; subject: string; body: string }) => {
        if (failNextSend) {
          failNextSend = false;
          throw new Error('provider 4xx');
        }
        sentEmails.push(input);
        return { id: 'email_123', status: 'queued' };
      }),
    };
  }),
}));

import { POST } from '@/app/api/auth/password-reset/request/route';
import { InMemorySecurityEventSink, setSecurityEventSink } from '@/services/security/security-event';
import { InMemoryRateLimitStore, setPasswordResetRateLimitStore } from '@/services/security/rate-limiter';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/password-reset/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const GENERIC_MESSAGE = 'If an account exists for that email, reset instructions have been sent.';

let sink: InMemorySecurityEventSink;

beforeEach(async () => {
  sink = new InMemorySecurityEventSink();
  setSecurityEventSink(sink);
  setPasswordResetRateLimitStore(new InMemoryRateLimitStore());
  emailClientConfigured = true;
  failNextSend = false;
  sentEmails.length = 0;
  verificationTokens.length = 0;
  usersByEmail.clear();
  seedUser({ email: 'existing@example.com' });
});

describe('POST /api/auth/password-reset/request — issuance + delivery (T-R76)', () => {
  it('existing account + configured client: generic 200, token issued (hash-only), email sent with the link', async () => {
    const res = await POST(req({ email: 'existing@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: GENERIC_MESSAGE });
    // Token persisted as SHA-256 hash (64 hex chars), never the raw value.
    expect(verificationTokens).toHaveLength(1);
    expect(verificationTokens[0].identifier).toBe('existing@example.com');
    expect(verificationTokens[0].token).toMatch(/^[0-9a-f]{64}$/);
    // Email sent with the link carrying the RAW token (the only place it ever lives).
    expect(sentEmails).toHaveLength(1);
    const body = sentEmails[0].body;
    expect(body).toContain('/auth/reset-password?email=existing%40example.com&token=');
    expect(body).not.toContain(verificationTokens[0].token); // never the hash in the email either
    // No security WARNING event on success.
    expect(sink.ofType('password_reset_delivery_failed')).toHaveLength(0);
  });

  it('non-existing account: SAME generic 200, NO token issued, NO email sent (non-enumeration)', async () => {
    const res = await POST(req({ email: 'ghost@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: GENERIC_MESSAGE });
    expect(verificationTokens).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it('send FAILURE: still generic 200 (no 500 — the enumeration gap), token revoked, WARNING recorded', async () => {
    failNextSend = true;
    const res = await POST(req({ email: 'existing@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: GENERIC_MESSAGE });
    // The just-issued token was revoked: nothing redeemable remains in the store.
    expect(verificationTokens).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
    expect(sink.ofType('password_reset_delivery_failed')).toHaveLength(1);
  });

  it('unconfigured client (no RESEND key): generic 200, token issued but no email attempted (fail-closed no-crash)', async () => {
    emailClientConfigured = false;
    const res = await POST(req({ email: 'existing@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: GENERIC_MESSAGE });
    expect(verificationTokens).toHaveLength(1); // token issued; delivery simply never happens
    expect(sentEmails).toHaveLength(0);
  });

  it('missing email body: generic 200, no token, no email', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: GENERIC_MESSAGE });
    expect(verificationTokens).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it('rate-limited: still generic 200, no NEW token/email, WARNING recorded', async () => {
    // Drive the REAL limiter over its threshold (PASSWORD_RESET_RATE_LIMIT.maxAttempts = 3):
    // saturate the `password_reset:account:<hmac(email)>` key the route checks, then confirm the
    // next request is denied BEFORE issuance and still answers the same generic 200.
    for (let i = 0; i < 5; i++) {
      await POST(req({ email: 'existing@example.com' }));
    }
    const tokensBefore = verificationTokens.length;
    const emailsBefore = sentEmails.length;
    const res = await POST(req({ email: 'existing@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: GENERIC_MESSAGE });
    expect(verificationTokens.length).toBe(tokensBefore); // denied before issuance — nothing new
    expect(sentEmails.length).toBe(emailsBefore); // and nothing new sent
    expect(sink.ofType('rate_limited').length).toBeGreaterThan(0);
  });
});
