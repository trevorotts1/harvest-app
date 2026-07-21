// T-R29 (compliance-reachability build) — proves the REAL, reachable
// `GET /api/data-rights/export/[exportId]` route, calling the REAL (unmocked) `DataRightsService`
// (T-11) through the REAL `buildProductionDataRightsService` composition root (T-R29), reproduces
// T-R7/T-R9's decrypt + secret-exclusion guarantees end to end — not merely at the service's own
// unit-test layer (tests/unit/data-rights.test.ts already proves that; this proves the NEW route
// wiring doesn't reintroduce a leak or otherwise weaken it).
//
// Only `@/lib/auth/session` and `@/lib/prisma` are mocked (module-boundary mocking, same convention
// as every other route test in this suite) — `DataRightsService`/`LegalHoldService`/`AuditService`
// and the real AES-256-GCM `encrypt`/`decrypt` primitives all run for real. Encryption keys
// (SOLUTION_NUMBER_ENCRYPTION_KEY, WHY_SESSION_ENCRYPTION_KEY, CONTACT_ENCRYPTION_KEY) are already
// seeded globally by tests/jest.setup.ts.
//
// THE PROOF (mutation test, per T-R9's own doc comment): if a future change re-adds
// `password_hash`/`mfa_methods` to `USER_EXPORT_ALLOWED_FIELDS` (data-rights.ts), or this route
// stops routing through `processExport` and instead forwards a raw Prisma row, this test fails.

import { AccessTier, OnboardingStatus, OrgType, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET as exportDownloadGET } from '@/app/api/data-rights/export/[exportId]/route';
import { encryptRequiredField, encryptOptionalField } from '@/services/warm-market/vault/vault-encryption';
import { encryptSolutionNumberForStorage } from '@/services/onboarding/wp01/solution-number';
import { encrypt } from '@/services/compliance/encryption/encryption';

const mockGetSession = getCurrentSession as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const REAL_USER_ID = 'real-session-user';
const REAL_BCRYPT_HASH = '$2b$12$reAlBcryptHashOfTheirRealPasswordAbCdEfGhIjKlMnOpQrSt';
const RAW_SOLUTION_NUMBER = '4821037';
const RAW_ANCHOR_STATEMENT = 'My family is why I show up before sunrise.';

function session(): Session {
  return {
    expires: '2999-01-01',
    user: {
      id: REAL_USER_ID,
      role: Role.REP,
      orgType: OrgType.EXTERNAL,
      organizationId: 'org-1',
      accessTier: AccessTier.FREE_PAID_EXTERNAL,
      onboardingStatus: OnboardingStatus.GATED_COMPLETE,
      mfaEnrolled: true,
      mfaVerifiedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // fresh step-up
      deviceFingerprintHash: 'fp',
      securityVersionAtIssue: 0,
      boundAt: Date.now(),
    },
  } as unknown as Session;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(session());

  db.userDataExport = {
    findUnique: jest.fn().mockResolvedValue({
      id: 'exp-1',
      user_id: REAL_USER_ID,
      status: 'PENDING',
      created_at: new Date('2026-07-20T00:00:00.000Z'),
      expires_at: new Date('2026-07-21T00:00:00.000Z'),
    }),
    update: jest.fn().mockResolvedValue({
      id: 'exp-1',
      user_id: REAL_USER_ID,
      status: 'COMPLETED',
      expires_at: new Date(),
      created_at: new Date(),
    }),
  };
  db.user = {
    findUnique: jest.fn().mockResolvedValue({
      id: REAL_USER_ID,
      email: 'real.rep@example.com',
      name: 'Real Rep Name',
      phone: '+15555550100',
      role: Role.REP,
      org_type: OrgType.EXTERNAL,
      // The two secrets that must NEVER leave via this route:
      password_hash: REAL_BCRYPT_HASH,
      mfa_methods: [{ type: 'totp', enrolledAt: '2026-01-01T00:00:00.000Z', secret: { ciphertext: 'x', iv: 'y', authTag: 'z', algorithm: 'aes-256-gcm' } }],
      // Ciphertext envelopes at rest — the route must return these DECRYPTED, never as raw ciphertext.
      solution_number: encryptSolutionNumberForStorage(RAW_SOLUTION_NUMBER),
      anchor_statement: JSON.stringify(encrypt(RAW_ANCHOR_STATEMENT, process.env.WHY_SESSION_ENCRYPTION_KEY as string)),
      calendar_preferences: { tz: 'America/New_York' },
      mfa_enrolled: true,
      organization_id: 'org-1',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    }),
  };
  db.contact = {
    findMany: jest.fn().mockResolvedValue([
      {
        id: 'contact-1',
        user_id: REAL_USER_ID,
        first_name: encryptRequiredField('Jane'),
        last_name: encryptRequiredField('Doe'),
        phone: encryptOptionalField('+15555550101'),
        email: encryptOptionalField('jane.doe@example.com'),
        notes: encryptOptionalField('Met at church picnic.'),
        phone_hash: 'hash-phone-1',
        email_hash: 'hash-email-1',
      },
    ]),
  };
  // The durable audit sink (DurableDataRightsAuditSink -> AuditService -> PrismaAuditRepository)
  // needs a minimal auditEntry delegate to append the export.requested/export.completed events.
  db.auditEntry = {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(null), // empty chain — this is the first entry
  };
});

function req() {
  return new NextRequest('http://localhost/api/data-rights/export/exp-1?format=json');
}

describe('GET /api/data-rights/export/[exportId] — end-to-end through the REAL DataRightsService (T-R7/T-R9 proof)', () => {
  test('happy path: 200, own data, decrypted contact + user PII readable, secrets EXCLUDED', async () => {
    const res = await exportDownloadGET(req(), { params: { exportId: 'exp-1' } });
    expect(res.status).toBe(200);

    const raw = await res.text();
    const parsed = JSON.parse(raw);

    // ── Positive proof: real decrypted data, not ciphertext, not placeholders ──
    expect(parsed.user.solution_number).toBe(RAW_SOLUTION_NUMBER);
    expect(parsed.user.anchor_statement).toBe(RAW_ANCHOR_STATEMENT);
    expect(parsed.contacts[0].first_name).toBe('Jane');
    expect(parsed.contacts[0].last_name).toBe('Doe');
    expect(parsed.contacts[0].email).toBe('jane.doe@example.com');
    expect(parsed.contacts[0].notes).toBe('Met at church picnic.');

    // ── THE SECRET-EXCLUSION PROOF (mutation test) ──
    // password_hash must be absent — not null, not redacted, KEY ABSENT.
    expect('password_hash' in parsed.user).toBe(false);
    expect(parsed.user.password_hash).toBeUndefined();
    // mfa_methods (encrypted TOTP secret + recovery-code hashes) must be absent entirely.
    expect('mfa_methods' in parsed.user).toBe(false);
    // Belt-and-suspenders: none of the raw secret material appears ANYWHERE in the serialized
    // payload, under any key — guards against a future refactor that renames the field but still
    // includes the value.
    expect(raw).not.toContain(REAL_BCRYPT_HASH);
    expect(raw).not.toContain('totp');
    // The raw ciphertext for solution_number must never appear either — only the decrypted value.
    expect(raw).not.toContain('ciphertext');
    expect(raw).not.toContain('authTag');

    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  test('cross-user: an export owned by someone else -> 404, DataRightsService.processExport never reached, no data of any kind returned', async () => {
    db.userDataExport.findUnique.mockResolvedValue({ id: 'exp-1', user_id: 'a-different-user', status: 'PENDING' });
    const res = await exportDownloadGET(req(), { params: { exportId: 'exp-1' } });
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain('password_hash');
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.contact.findMany).not.toHaveBeenCalled();
  });
});
