// T-22 — proves `/api/contacts/import` (the Vault's real ingestion route, §7.1) is actually gated:
// no session → 401; authenticated but not GATED_COMPLETE → 403 ONBOARDING_INCOMPLETE; a forged
// `x-user-id` header has ZERO effect (the route only trusts the session); and only once GATED_COMPLETE
// does the handler run, using the SESSION's user id. Mirrors the exact module-boundary-mocking
// pattern already established in tests/unit/wp01-onboarding-gate.test.ts and
// tests/unit/onboarding-consent-route.test.ts: mock `@/lib/auth/session` + `@/lib/prisma`, then
// exercise the REAL `withOnboardingGate`-wrapped route handlers — this is what would fail if
// `withOnboardingGate` were ever removed from this route or swapped back for the old
// `x-user-id`-trusting demo store.
//
// `VaultService` itself is mocked here — its correctness (encryption, dedupe, idempotency,
// resumability, minors) is proven independently in tests/unit/vault.test.ts with a real in-memory
// Prisma fake. This suite proves ONLY the route/auth wiring: does the right (session-derived) user id
// reach VaultService, and is the wrong caller denied before it ever does.

import { OnboardingStatus, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    contact: { findMany: jest.fn() },
    importBatch: { findFirst: jest.fn() },
  },
}));

const mockImportBatch = jest.fn();
jest.mock('@/services/warm-market/vault/vault.service', () => {
  class ModalityNotAllowedError extends Error {}
  return {
    VaultService: jest.fn().mockImplementation(() => ({ importBatch: mockImportBatch })),
    ModalityNotAllowedError,
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { POST, GET } from '@/app/api/contacts/import/route';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedUserFindUnique = (prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique;
const mockedContactFindMany = (prisma as unknown as { contact: { findMany: jest.Mock } }).contact.findMany;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'user-vault-1',
      role: Role.REP,
      orgType: 'EXTERNAL',
      organizationId: 'org-1',
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      ...overrides,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function seedOnboarding(status: OnboardingStatus | null) {
  mockedUserFindUnique.mockResolvedValue(
    status === null ? null : { onboarding_status: status, onboarding_sessions: [{ current_step: 'REGISTER' }] }
  );
}

function postRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/contacts/import', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedUserFindUnique.mockReset();
  mockedContactFindMany.mockReset();
  mockImportBatch.mockReset();
});

describe('POST /api/contacts/import — the §6.10-1 hard gate at the Vault ingestion route', () => {
  test('no session → 401, VaultService.importBatch never runs', async () => {
    mockedSession.mockResolvedValue(null);

    const res = await POST(postRequest({ source: 'CSV', contacts: [], idempotencyKey: 'k' }), {});
    expect(res.status).toBe(401);
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('authenticated but NOT gated_complete → 403 ONBOARDING_INCOMPLETE, VaultService never runs', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.IN_PROGRESS);

    const res = await POST(postRequest({ source: 'CSV', contacts: [], idempotencyKey: 'k' }), {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ONBOARDING_INCOMPLETE');
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header has ZERO effect — the route uses the SESSION user id, never the header', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-session-user' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockImportBatch.mockResolvedValue({
      batchId: 'b-1',
      source: 'CSV',
      status: 'COMPLETED',
      totalRows: 1,
      cursor: 1,
      importedCount: 1,
      mergedCount: 0,
      minorFlaggedCount: 0,
      errorRows: [],
      resumable: false,
      idempotentReplay: false,
    });

    const res = await POST(
      postRequest(
        { source: 'CSV', contacts: [{ name: 'Someone' }], idempotencyKey: 'k' },
        { 'x-user-id': 'some-other-victim-id' }
      ),
      {}
    );

    expect(res.status).toBe(201);
    expect(mockImportBatch).toHaveBeenCalledTimes(1);
    // First positional arg to VaultService.importBatch is userId — must be the SESSION id.
    expect(mockImportBatch.mock.calls[0][0]).toBe('real-session-user');
    expect(mockImportBatch.mock.calls[0][0]).not.toBe('some-other-victim-id');
  });

  test('missing idempotencyKey → 400, never reaches VaultService (no accidental non-idempotent import)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);

    const res = await POST(postRequest({ source: 'CSV', contacts: [] }), {});
    expect(res.status).toBe(400);
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('an invalid source → 400, never reaches VaultService', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);

    const res = await POST(postRequest({ source: 'LEAD_SCRAPER', contacts: [], idempotencyKey: 'k' }), {});
    expect(res.status).toBe(400);
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('GATED_COMPLETE + valid body → 202 while the batch is still IN_PROGRESS (resumable)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockImportBatch.mockResolvedValue({
      batchId: 'b-2',
      source: 'CSV',
      status: 'IN_PROGRESS',
      totalRows: 5,
      cursor: 2,
      importedCount: 2,
      mergedCount: 0,
      minorFlaggedCount: 0,
      errorRows: [],
      resumable: true,
      idempotentReplay: false,
    });

    const res = await POST(postRequest({ source: 'CSV', contacts: [{ name: 'A' }], idempotencyKey: 'k' }), {});
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.resumable).toBe(true);
    expect(body.processed).toBe(2); // route maps the batch's `cursor` field to `processed` in the response
  });
});

describe('GET /api/contacts/import — same hard gate applies to reading the Vault', () => {
  test('no session → 401, never reaches prisma', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/api/contacts/import'), {});
    expect(res.status).toBe(401);
    expect(mockedContactFindMany).not.toHaveBeenCalled();
  });

  test('GATED_COMPLETE lists the caller\'s own contacts, keyed by the session id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'user-vault-1' }));
    seedOnboarding(OnboardingStatus.GATED_COMPLETE);
    mockedContactFindMany.mockResolvedValue([]);

    const res = await GET(new NextRequest('http://localhost/api/contacts/import'), {});
    expect(res.status).toBe(200);
    expect(mockedContactFindMany).toHaveBeenCalledWith({ where: { user_id: 'user-vault-1' } });
  });
});
