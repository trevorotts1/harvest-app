// T-R30 (parity GAP 1) — end-to-end proof that `/api/onboarding/contacts-import` really flows CSV
// text through the REAL `VaultService` (encryption, HMAC-dedupe, per-row error isolation) rather than
// a mocked stand-in: unlike `onboarding-contacts-import-route.test.ts` (which mocks `VaultService` to
// prove ONLY the route/auth wiring), this suite uses the real service against an in-memory fake
// Prisma — the same convention `tests/unit/vault.test.ts` establishes — and asserts malformed CSV
// rows (missing name column) are isolated as downloadable error rows, never a crash/500, and that
// valid rows in the SAME upload really land as encrypted Contact rows.

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

import type {
  VaultPrismaClient,
  ImportBatchRow,
  ContactRow,
} from '@/services/warm-market/vault/vault.service';

function createFakeVaultPrisma() {
  const contacts = new Map<string, Record<string, unknown>>();
  const batchesByKey = new Map<string, Record<string, unknown>>();
  const batchesById = new Map<string, Record<string, unknown>>();
  const optOuts = new Map<string, Record<string, unknown>>();
  let contactSeq = 0;
  let batchSeq = 0;

  const prisma: VaultPrismaClient = {
    importBatch: {
      findUnique: async ({ where }) => {
        const key = `${where.user_id_idempotency_key.user_id}::${where.user_id_idempotency_key.idempotency_key}`;
        return (batchesByKey.get(key) as unknown as ImportBatchRow) ?? null;
      },
      create: async ({ data }) => {
        const id = `batch-${++batchSeq}`;
        const row = { id, ...data };
        batchesByKey.set(`${data.user_id}::${data.idempotency_key}`, row);
        batchesById.set(id, row);
        return row as unknown as ImportBatchRow;
      },
      update: async ({ where, data }) => {
        const row = batchesById.get(where.id)!;
        Object.assign(row, data);
        return row as unknown as ImportBatchRow;
      },
    },
    contact: {
      findFirst: async ({ where }: { where: { user_id: string; OR?: Array<{ phone_hash?: string; email_hash?: string }> } }) => {
        for (const c of contacts.values()) {
          if (c.user_id !== where.user_id) continue;
          const or = where.OR ?? [];
          const matches = or.some(
            (cond) =>
              (cond.phone_hash && c.phone_hash === cond.phone_hash) ||
              (cond.email_hash && c.email_hash === cond.email_hash)
          );
          if (matches) return c as unknown as ContactRow;
        }
        return null;
      },
      create: async ({ data }) => {
        const id = `contact-${++contactSeq}`;
        const row = { id, ...data };
        contacts.set(id, row);
        return row as unknown as ContactRow;
      },
      update: async ({ where, data }) => {
        const row = contacts.get(where.id)!;
        Object.assign(row, data);
        return row as unknown as ContactRow;
      },
    },
    contactInteraction: { create: async (args) => args.data },
    optOutRegistry: {
      upsert: async ({ create }) => {
        const key = `${create.identifier_hash}::${create.channel}`;
        if (!optOuts.has(key)) optOuts.set(key, create);
        return optOuts.get(key);
      },
    },
  };

  return { prisma, contacts };
}

const { prisma: fakePrisma, contacts: fakeContacts } = createFakeVaultPrisma();

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: fakePrisma }));

import { getCurrentSession } from '@/lib/auth/session';
import { POST } from '@/app/api/onboarding/contacts-import/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;

function fakeSession(userId: string): Session {
  return {
    user: {
      id: userId,
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: null,
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/onboarding/contacts-import', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/onboarding/contacts-import — real Vault, malformed CSV isolation (§7.6)', () => {
  beforeEach(() => {
    mockedSession.mockReset();
    fakeContacts.clear();
  });

  test('a malformed row (missing name) is isolated as a downloadable error row — never a crash, never 500', async () => {
    mockedSession.mockResolvedValue(fakeSession('onboarding-user-malformed'));
    const csvText = ['name,phone,email', 'Jane Doe,312-555-0100,jane@example.com', ',,noNameHere@example.com'].join(
      '\n'
    );

    const res = await POST(postRequest({ csvText, idempotencyKey: 'k-malformed-1' }), {});
    expect(res.status).not.toBe(500);
    expect([201, 202]).toContain(res.status);

    const body = await res.json();
    expect(body.importedCount).toBe(1); // only the valid row lands
    expect(body.errorRows).toHaveLength(1);
    expect(body.errorRows[0].reason).toMatch(/name/i);
  });

  test('a valid row really lands as an ENCRYPTED Contact row in the Vault — not a plaintext parallel path', async () => {
    mockedSession.mockResolvedValue(fakeSession('onboarding-user-encrypted'));
    const csvText = 'name,phone,email\nJohn Smith,312-555-0199,john@example.com\n';

    const res = await POST(postRequest({ csvText, idempotencyKey: 'k-encrypted-1' }), {});
    expect(res.status).toBe(201);

    const landed = [...fakeContacts.values()].find((c) => c.user_id === 'onboarding-user-encrypted');
    expect(landed).toBeDefined();
    // The raw name/phone/email never appear in plaintext on the persisted row — each PII field is an
    // encrypted envelope (VaultService's AES-256-GCM encryption, T-22), not the literal string.
    expect(JSON.stringify(landed)).not.toContain('John Smith');
    expect(JSON.stringify(landed)).not.toContain('312-555-0199');
    expect(JSON.stringify(landed)).not.toContain('john@example.com');
    // The keyed-HMAC dedupe hash IS present in plaintext (it is a hash, not the PII itself).
    expect(landed!.phone_hash).toBeTruthy();
  });

  test('an entirely empty CSV (header only) imports zero rows without error, never a crash', async () => {
    mockedSession.mockResolvedValue(fakeSession('onboarding-user-empty'));
    const res = await POST(postRequest({ csvText: 'name,phone,email\n', idempotencyKey: 'k-empty-1' }), {});
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.importedCount).toBe(0);
    expect(body.totalRows).toBe(0);
  });
});
