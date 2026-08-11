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
jest.mock('@/lib/prisma', () => ({ prisma: { contact: { findMany: jest.fn() } } }));

const mockImportBatch = jest.fn();
jest.mock('@/services/warm-market/vault/vault.service', () => {
  // T-58 — this route now also imports/uses `ModalityNotAllowedError` (the native-source fail-closed
  // catch, mirroring /api/contacts/import's own mock in tests/unit/contacts-import-route.test.ts) —
  // must be a real exported class here or `err instanceof ModalityNotAllowedError` throws on ANY
  // error path, not just the modality one.
  class ModalityNotAllowedError extends Error {}
  return {
    VaultService: jest.fn().mockImplementation(() => ({ importBatch: mockImportBatch })),
    ModalityNotAllowedError,
  };
});

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET, POST } from '@/app/api/onboarding/contacts-import/route';
import { ImportLimitExceededError } from '@/services/warm-market/vault/csv-parser';
import { ModalityNotAllowedError } from '@/services/warm-market/vault/vault.service';
import { encryptOptionalField } from '@/services/warm-market/vault/vault-encryption';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedContactFindMany = (prisma as unknown as { contact: { findMany: jest.Mock } }).contact.findMany;

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
  mockedContactFindMany.mockReset();
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

// ─── T-58 — the REAL "Import from Phone" native-source path, replacing OnboardingFlow.tsx's other
// fake handler (`onRequestPermission` used to just do `setContactCount(24)`, no permission ever
// asked, no device contact ever read). This route is the ONLY ingestion surface reachable during
// onboarding for IOS_NATIVE/ANDROID_NATIVE, mirroring the CSV describe block above exactly.
describe('POST /api/onboarding/contacts-import — T-58 native contacts (IOS_NATIVE/ANDROID_NATIVE)', () => {
  const SAMPLE_ROW = { name: 'Jane Doe', phone: '312-555-0100', email: null, notes: null, industry: null, birthdate: null };

  test('IOS_NATIVE + matching clientPlatform "ios" + a mapped contacts array → reaches VaultService with the native source', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockImportBatch.mockResolvedValue({
      batchId: 'b-native-1',
      source: 'IOS_NATIVE',
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
      postRequest({ source: 'IOS_NATIVE', contacts: [SAMPLE_ROW], clientPlatform: 'ios', idempotencyKey: 'k' }),
      {}
    );
    expect(res.status).toBe(201);
    expect(mockImportBatch).toHaveBeenCalledTimes(1);
    const [userId, source, rows, opts] = mockImportBatch.mock.calls[0];
    expect(userId).toBe('onboarding-user-1');
    expect(source).toBe('IOS_NATIVE');
    expect(rows).toEqual([SAMPLE_ROW]);
    expect(opts.clientPlatform).toBe('ios');
    expect(opts.csvText).toBeUndefined();
  });

  test('ANDROID_NATIVE + clientPlatform declared via the x-harvest-platform header (not the body) also reaches VaultService', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockImportBatch.mockResolvedValue({
      batchId: 'b-native-2',
      source: 'ANDROID_NATIVE',
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
      postRequest({ source: 'ANDROID_NATIVE', contacts: [SAMPLE_ROW], idempotencyKey: 'k' }, { 'x-harvest-platform': 'android' }),
      {}
    );
    expect(res.status).toBe(201);
    expect(mockImportBatch.mock.calls[0][3].clientPlatform).toBe('android');
  });

  test('TEETH (fail-closed): IOS_NATIVE declared from a caller that never says "ios" → 400 MODALITY_NOT_ALLOWED, never a partial import', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockImportBatch.mockRejectedValue(new ModalityNotAllowedError('IOS_NATIVE contact import is only available from the native app shell'));

    const res = await POST(postRequest({ source: 'IOS_NATIVE', contacts: [SAMPLE_ROW], idempotencyKey: 'k' }), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('MODALITY_NOT_ALLOWED');
  });

  test('a native source with no "contacts" array at all → 400 CONTACTS_REQUIRED, never reaches VaultService', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await POST(postRequest({ source: 'IOS_NATIVE', clientPlatform: 'ios', idempotencyKey: 'k' }), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('CONTACTS_REQUIRED');
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('an unrecognized source (e.g. GOOGLE_OAUTH, not offered by this onboarding screen) → 400 SOURCE_INVALID', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await POST(
      postRequest({ source: 'GOOGLE_OAUTH', contacts: [SAMPLE_ROW], idempotencyKey: 'k' }),
      {}
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('SOURCE_INVALID');
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('omitting "source" entirely still defaults to CSV — pre-T-58 callers are byte-for-byte unaffected', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockImportBatch.mockResolvedValue({
      batchId: 'b-default-csv',
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

    const res = await POST(postRequest({ csvText: SAMPLE_CSV, idempotencyKey: 'k' }), {});
    expect(res.status).toBe(201);
    expect(mockImportBatch.mock.calls[0][1]).toBe('CSV');
    expect(mockImportBatch.mock.calls[0][3].clientPlatform).toBe('web');
  });
});

// ─── R-13 (refinements catalog 2026-07-28) — the REAL one-at-a-time contact-entry form's ingestion
// path: the ManualAddStep form (OnboardingFlow.tsx's 'manual' beat) POSTs each drafted contact as
// `source: MANUAL` + a single `contacts` row. Same Vault pipeline as every other source (encryption,
// dedupe, minors gate); web-safe like CSV (`assertModalityAllowed` only refuses the native-shell
// sources, so a MANUAL caller needs no declared platform).
describe('POST /api/onboarding/contacts-import — R-13 manual one-at-a-time (MANUAL)', () => {
  const MANUAL_ROW = { name: 'Jamie Rivera', phone: '312-555-0100', email: 'jamie@example.com' };

  test('MANUAL + a single contacts row → reaches VaultService with the manual source and a web clientPlatform (like CSV)', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockImportBatch.mockResolvedValue({
      batchId: 'b-manual-1',
      source: 'MANUAL',
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
      postRequest({ source: 'MANUAL', contacts: [MANUAL_ROW], clientPlatform: 'web', idempotencyKey: 'k' }),
      {}
    );
    expect(res.status).toBe(201);
    expect(mockImportBatch).toHaveBeenCalledTimes(1);
    const [userId, source, rows, opts] = mockImportBatch.mock.calls[0];
    expect(userId).toBe('onboarding-user-1');
    expect(source).toBe('MANUAL');
    expect(rows).toEqual([MANUAL_ROW]);
    expect(opts.clientPlatform).toBe('web');
    expect(opts.csvText).toBeUndefined();
  });

  test('a MANUAL caller that declares NO platform at all still succeeds — web-safe like CSV, never a MODALITY_NOT_ALLOWED dead end', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockImportBatch.mockResolvedValue({
      batchId: 'b-manual-2',
      source: 'MANUAL',
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

    const res = await POST(postRequest({ source: 'MANUAL', contacts: [MANUAL_ROW], idempotencyKey: 'k' }), {});
    expect(res.status).toBe(201);
    expect(mockImportBatch.mock.calls[0][3].clientPlatform).toBe('web');
  });

  test('a MANUAL source with no "contacts" array → 400 CONTACTS_REQUIRED, never reaches VaultService', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    const res = await POST(postRequest({ source: 'MANUAL', idempotencyKey: 'k' }), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('CONTACTS_REQUIRED');
    expect(mockImportBatch).not.toHaveBeenCalled();
  });

  test('still session-gated like every other source — no session → 401, VaultService never runs', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await POST(postRequest({ source: 'MANUAL', contacts: [MANUAL_ROW], idempotencyKey: 'k' }), {});
    expect(res.status).toBe(401);
    expect(mockImportBatch).not.toHaveBeenCalled();
  });
});

// ─── T-58 — the dedupe surface the real "Import from Phone" selection list reads before presenting
// device contacts (§7.6 "cross-source duplicate ... merge, keep most complete"). Minimal PII: only
// phone/email, decrypted for the owner's own read (same posture /api/contacts/import's GET already
// established) — never the full contact record.
describe('GET /api/onboarding/contacts-import — T-58 dedupe surface (session-gated, minimal PII)', () => {
  test('no session → 401, never reaches prisma', async () => {
    mockedSession.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/api/onboarding/contacts-import'), {});
    expect(res.status).toBe(401);
    expect(mockedContactFindMany).not.toHaveBeenCalled();
  });

  test('returns the caller\'s own contacts\' DECRYPTED phone/email (round-tripped through the real encryption), scoped to the session user id', async () => {
    mockedSession.mockResolvedValue(fakeSession({ id: 'dedupe-user-1' }));
    mockedContactFindMany.mockResolvedValue([
      { phone: encryptOptionalField('3125550100'), email: encryptOptionalField('jane@example.com') },
      { phone: null, email: null },
    ]);

    const res = await GET(new NextRequest('http://localhost/api/onboarding/contacts-import'), {});
    expect(res.status).toBe(200);
    expect(mockedContactFindMany).toHaveBeenCalledWith({
      where: { user_id: 'dedupe-user-1' },
      select: { phone: true, email: true },
    });
    const body = await res.json();
    expect(body.contacts).toEqual([
      { phone: '3125550100', email: 'jane@example.com' },
      { phone: null, email: null },
    ]);
    // Minimal-PII surface: no name/notes/pipeline fields are ever fetched or returned here.
    expect(body.contacts[0]).not.toHaveProperty('firstName');
    expect(body.contacts[0]).not.toHaveProperty('notes');
  });

  test('no existing contacts → an empty array, not an error', async () => {
    mockedSession.mockResolvedValue(fakeSession());
    mockedContactFindMany.mockResolvedValue([]);
    const res = await GET(new NextRequest('http://localhost/api/onboarding/contacts-import'), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts).toEqual([]);
  });
});
