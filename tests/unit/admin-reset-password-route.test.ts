// R-18 (admin-mediated password recovery — the SMTP-free recovery path, T-59/W1) — PROOF:
// POST /api/admin/users/[userId]/reset-password is session-gated (never trusts `x-user-id`),
// ADMIN passes / non-ADMIN gets 401 (no session) / 403 (wrong role), and an ADMIN issuance
// (a) returns the RAW one-time token ONLY in the response body, (b) records exactly one
// hash-chained AuditEntry (action `user_password_reset_issued`) via the REAL AuditService/
// InMemoryAuditRepository, (c) emits one INFO `password_reset` SecurityEvent through the real
// InMemorySecurityEventSink, (d) writes ONLY the token's SHA-256 hash into the VerificationToken
// store (the raw token must never be persisted anywhere). Mirrors
// tests/unit/admin-users-routes.test.ts's exact module-boundary-mocking pattern.
//
// The confirmation side of this recovery path (single-use + expiry enforcement, bcrypt set,
// security_version bump, "sign out everywhere") is already proven by the existing
// tests/unit/password-reset.test.ts (issue/consume semantics) and the confirm-route test in
// tests/unit/password-reset-confirm-route.test.ts — this test proves the ADMIN-ISSUANCE half
// end-to-end, including that a token issued here is consumable by the same consume path.

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

interface FakeUserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  org_type: string;
  organization_id: string | null;
  access_tier: string;
  onboarding_status: string;
  is_suspended: boolean;
  suspended_at: Date | null;
  suspended_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

const usersById = new Map<string, FakeUserRow>();
const auditEntries: Array<Record<string, unknown>> = [];
const verificationTokens: Array<{ identifier: string; token: string; expires: Date }> = [];

function seedUser(row: Partial<FakeUserRow> & { id: string }): void {
  usersById.set(row.id, {
    email: 'user@example.com',
    name: 'Some User',
    role: Role.REP,
    org_type: 'EXTERNAL',
    organization_id: null,
    access_tier: 'FREE_ORG_LINKED',
    onboarding_status: 'GATED_COMPLETE',
    is_suspended: false,
    suspended_at: null,
    suspended_reason: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...row,
  });
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async (args: { where: { id: string } }) => usersById.get(args.where.id) ?? null),
    },
    auditEntry: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        auditEntries.push(args.data);
        return args.data;
      }),
      findMany: jest.fn(async () => [...auditEntries].sort((a, b) => (a.sequence as number) - (b.sequence as number))),
      findUnique: jest.fn(async (args: { where: { id: string } }) => auditEntries.find((e) => e.id === args.where.id) ?? null),
      findFirst: jest.fn(async () => {
        if (auditEntries.length === 0) return null;
        return [...auditEntries].sort((a, b) => (b.sequence as number) - (a.sequence as number))[0];
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

import { getCurrentSession } from '@/lib/auth/session';
import { POST as resetPasswordPOST } from '@/app/api/admin/users/[userId]/reset-password/route';
import { InMemorySecurityEventSink, setSecurityEventSink } from '@/services/security/security-event';
import {
  consumePasswordResetToken,
  PrismaVerificationTokenStore,
  type VerificationTokenPrismaClient,
} from '@/services/security/password-reset';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'admin-caller',
      role: Role.ADMIN,
      orgType: 'EXTERNAL',
      organizationId: null,
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`http://localhost${url}`, init);
}

let sink: InMemorySecurityEventSink;

beforeEach(() => {
  mockedSession.mockReset();
  usersById.clear();
  auditEntries.length = 0;
  verificationTokens.length = 0;
  sink = new InMemorySecurityEventSink();
  setSecurityEventSink(sink);
  seedUser({ id: 'admin-caller', role: Role.ADMIN });
  seedUser({ id: 'target-1', email: 'target1@example.com', name: 'Target One', role: Role.REP });
});

// ── POST /api/admin/users/[userId]/reset-password — admin-mediated recovery ────────────────────
describe('POST /api/admin/users/[userId]/reset-password — ADMIN-gated, audited, SecurityEvent, hash-only persistence', () => {
  const ctx = { params: { userId: 'target-1' } };

  it('401 with no session; no token issued, no AuditEntry, no SecurityEvent', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await resetPasswordPOST(req('/api/admin/users/target-1/reset-password', { method: 'POST' }), ctx);
    expect(res.status).toBe(401);
    expect(verificationTokens).toHaveLength(0);
    expect(auditEntries).toHaveLength(0);
    expect(sink.all()).toHaveLength(0);
  });

  it('403 for a non-ADMIN role (REP); no token issued, no AuditEntry', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.REP }));
    const res = await resetPasswordPOST(req('/api/admin/users/target-1/reset-password', { method: 'POST' }), ctx);
    expect(res.status).toBe(403);
    expect(verificationTokens).toHaveLength(0);
    expect(auditEntries).toHaveLength(0);
  });

  it('403 for a non-ADMIN role (UPLINE) — user_profile.manage is ADMIN-only, no adminBypass loophole for other elevated roles', async () => {
    mockedSession.mockResolvedValue(fakeSession({ role: Role.UPLINE }));
    const res = await resetPasswordPOST(req('/api/admin/users/target-1/reset-password', { method: 'POST' }), ctx);
    expect(res.status).toBe(403);
    expect(verificationTokens).toHaveLength(0);
    expect(auditEntries).toHaveLength(0);
  });

  it('a forged x-user-id header never substitutes for the real session', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await resetPasswordPOST(
      req('/api/admin/users/target-1/reset-password', { method: 'POST', headers: { 'x-user-id': 'admin-caller' } }),
      ctx
    );
    expect(res.status).toBe(401);
    expect(verificationTokens).toHaveLength(0);
  });

  it('200 for ADMIN: returns the raw token + expiry ONLY in the body, writes exactly one hash-chained AuditEntry (user_password_reset_issued), emits one INFO password_reset SecurityEvent, and persists only the token hash', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await resetPasswordPOST(req('/api/admin/users/target-1/reset-password', { method: 'POST' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
    const expiryMs = new Date(body.expiresAt).getTime();
    expect(expiryMs).toBeGreaterThan(Date.now());

    // Audit trail: exactly one row, keyed to the TARGET user, attributed to the acting admin.
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].user_id).toBe('target-1');
    expect(auditEntries[0].reviewer_id).toBe('admin-caller');
    expect(auditEntries[0].reviewer_action).toBe('user_password_reset_issued');
    expect(auditEntries[0].entry_hash).toBeTruthy();
    expect(auditEntries[0].content_text).toContain('password-reset token');
    expect(auditEntries[0].content_text).not.toContain(body.token); // the raw token NEVER reaches an audit row

    // SecurityEvent stream: exactly one INFO password_reset row for the target user.
    const events = sink.ofType('password_reset');
    expect(events).toHaveLength(1);
    expect(events[0]?.user_id).toBe('target-1');
    expect(events[0]?.severity).toBe('INFO');

    // Persistence: the store holds the SHA-256 hash of the raw token — never the raw value.
    expect(verificationTokens).toHaveLength(1);
    expect(verificationTokens[0]?.identifier).toBe('target1@example.com');
    expect(verificationTokens[0]?.token).not.toBe(body.token);
    expect(verificationTokens[0]?.token).toMatch(/^[0-9a-f]{64}$/); // sha256 hex digest shape
  });

  it('a token issued here round-trips through the REAL consume path (PrismaVerificationTokenStore + consumePasswordResetToken) the confirm route uses — single-use', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await resetPasswordPOST(req('/api/admin/users/target-1/reset-password', { method: 'POST' }), ctx);
    const body = await res.json();

    // Bind the real Prisma-backed store to the same mocked prisma the route wrote through — this
    // is exactly the object the confirm route constructs at runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mockedPrisma = jest.requireMock('@/lib/prisma').prisma as unknown as VerificationTokenPrismaClient;
    const store = new PrismaVerificationTokenStore(mockedPrisma);

    const firstUse = await consumePasswordResetToken(store, 'target1@example.com', body.token as string);
    expect(firstUse).toBe(true); // valid + unexpired

    const replay = await consumePasswordResetToken(store, 'target1@example.com', body.token as string);
    expect(replay).toBe(false); // single-use — consumed on first use
  });

  it('404 for an unknown target; no token, no AuditEntry, no SecurityEvent', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await resetPasswordPOST(req('/api/admin/users/ghost/reset-password', { method: 'POST' }), {
      params: { userId: 'ghost' },
    });
    expect(res.status).toBe(404);
    expect(verificationTokens).toHaveLength(0);
    expect(auditEntries).toHaveLength(0);
    expect(sink.all()).toHaveLength(0);
  });
});
