// T-R30 (parity GAP 1) — proves `/api/onboarding/contacts-import` (the REAL onboarding-time CSV
// ingestion route, replacing OnboardingFlow.tsx's faked `contactCount=24`, T-51):
//   (1) no session → 401, VaultService never runs (deny-by-default, same as every gated route);
//   (2) UNLIKE `/api/contacts/import`, this route succeeds for an authenticated caller who is NOT
//       yet `GATED_COMPLETE` — the whole point of building it on `withRole` instead of
//       `withOnboardingGate` (T-21R's consent route already established this exact posture, and
//       this is the proof that the SAME posture actually reaches the Vault here);
//   (3) a forged `x-user-id` header has zero effect — the session id is what reaches VaultService;
//   (4) missing csvText/idempotencyKey → 400, never reaches VaultService;
//   (5) an oversized import → 413 IMPORT_LIMIT_EXCEEDED, never a 500.
//
// `VaultService` is mocked here (its own correctness — encryption, dedupe, CSV parsing/malformed-row
// isolation — is proven independently in tests/unit/vault.test.ts against a real in-memory Prisma
// fake); this suite proves ONLY the route/auth wiring, mirroring
// tests/unit/contacts-import-route.test.ts's and tests/unit/onboarding-consent-route.test.ts's
// established module-boundary-mocking pattern.

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

const mockImportBatch = jest.fn();
jest.mock('@/services/warm-market/vault/vault.service', () => {
  return {
    VaultService: jest.fn().mockImplementation(() => ({ importBatch: mockImportBatch })),
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { POST } from '@/app/api/onboarding/contacts-import/route';
import { ImportLimitExceededError } from '@/services/warm-market/vault/csv-parser';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;

function fakeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'onboarding-user-1',
      role: Role.REP,
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

function postRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/onboarding/contacts-import', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const SAMPLE_CSV = 'name,phone\nJane Doe,312-555-0100\n';

beforeEach(() => {
  mockedSession.mockReset();
  mockImportBatch.mockReset();
});

describe('POST /api/onboarding/contacts-import — session-gated, NOT onboarding-complete-gated', () => {
  test('no session → 401, VaultService.importBatch never runs', async () => {
    mockedSession.mockResolvedValue(null);

    const res = await POST(postRequest({ csvText: SAMPLE_CSV, idempotencyKey: 'k' }), {});
    expect(res.status).toBe(401);
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('TEETH: an authenticated caller who is NOT GATED_COMPLETE still reaches VaultService — this is the whole point of this route existing separately from /api/contacts/import', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockImportBatch.mockResolvedValue({
      batchId: 'b-onboarding-1',
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
    // Note: no `onboarding_status`/`user.findUnique` mock is even wired up here — proving this route
    // never reads onboarding completeness at all, unlike `withOnboardingGate`-wrapped routes.

    const res = await POST(postRequest({ csvText: SAMPLE_CSV, idempotencyKey: 'k' }), {});
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.importedCount).toBe(1);
    expect(mockImportBatch).toHaveBeenCalledTimes(1);
  });

  test('a forged x-user-id header has ZERO effect — the route uses the SESSION user id, never the header', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'real-onboarding-session-user' }));
    mockImportBatch.mockResolvedValue({
      batchId: 'b-2',
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
      postRequest({ csvText: SAMPLE_CSV, idempotencyKey: 'k' }, { 'x-user-id': 'some-other-victim-id' }),
      {}
    );
    expect(res.status).toBe(201);
    expect(mockImportBatch.mock.calls[0][0]).toBe('real-onboarding-session-user');
    expect(mockImportBatch.mock.calls[0][0]).not.toBe('some-other-victim-id');
  });

  test('missing csvText → 400, never reaches VaultService', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await POST(postRequest({ idempotencyKey: 'k' }), {});
    expect(res.status).toBe(400);
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('empty-string csvText → 400, never reaches VaultService', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await POST(postRequest({ csvText: '   ', idempotencyKey: 'k' }), {});
    expect(res.status).toBe(400);
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('missing idempotencyKey → 400, never reaches VaultService (no accidental non-idempotent import)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await POST(postRequest({ csvText: SAMPLE_CSV }), {});
    expect(res.status).toBe(400);
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('an oversized import surfaces as 413 with the granular machine code, never a 500', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockImportBatch.mockRejectedValue(new ImportLimitExceededError('too many rows', 'CSV_TOO_MANY_ROWS'));

    const res = await POST(postRequest({ csvText: SAMPLE_CSV, idempotencyKey: 'k' }), {});
    expect(res.status).toBe(413);
    const body = await res.json();
    // T-57 RE-GATE B [af7789d3] Finding 1 — the route forwards the ERROR'S OWN granular `code`
    // (CSV_TOO_LARGE vs CSV_TOO_MANY_ROWS vs IMPORT_ROWS_LIMIT_EXCEEDED), not a single bucket code,
    // so the client can resolve a DISTINCT, correctly-worded Spanish `errors.*` catalog string per
    // failure kind (never the raw English `body.error`, which this test does NOT assert on).
    expect(body.code).toBe('CSV_TOO_MANY_ROWS');
    expect(typeof body.error).toBe('string');
  });

  test('malformed body (invalid JSON) → 400, never throws unhandled', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const req = new NextRequest('http://localhost/api/onboarding/contacts-import', {
      method: 'POST',
      body: '{not valid json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req, {});
    expect(res.status).toBe(400);
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('the batch is still IN_PROGRESS (resumable) → 202', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockImportBatch.mockResolvedValue({
      batchId: 'b-3',
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

    const res = await POST(postRequest({ csvText: SAMPLE_CSV, idempotencyKey: 'k' }), {});
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.resumable).toBe(true);
  });
});
