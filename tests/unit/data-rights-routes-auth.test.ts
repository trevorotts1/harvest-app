// T-R29 (compliance-reachability build) — T-51 found `DataRightsService.processExport`/
// `processDeletion` (T-11) had ZERO production callers: no route, no UI. This proves the REAL,
// reachable `/api/data-rights/**` routes are session-gated, step-up-MFA-gated (§16.4, row 8 of the
// §16.6 matrix), own-data-only (cross-user id -> 404, never a leak), and that deletion cannot be
// confirmed without (a) an explicit `confirm: true`, (b) owning the request, (c) it still being
// PENDING, and (d) the 24-hour cooling-off window having elapsed (§9.3/§5.7).
//
// Mirrors the exact module-boundary-mocking pattern of tests/unit/taprooting-routes-auth.test.ts /
// tests/unit/conversation-route.test.ts: `getCurrentSession` + `prisma` are mocked, and the
// production service factory (`buildProductionDataRightsService`) is mocked to a plain stub object
// so this file proves ONLY the route/auth/ownership/confirmation wiring — `DataRightsService`'s own
// decrypt/secret-exclusion correctness is proven independently in tests/unit/data-rights.test.ts,
// and reproven end-to-end (real service, real crypto) in
// tests/unit/data-rights-export-route-secrets.test.ts.
//
// NOTE on jest.mock hoisting: every `jest.mock(...)` is at module top level (never nested inside a
// `describe`) — consolidating each mocked module path to exactly one `jest.mock` call avoids the
// last-write-wins hoisting trap (see taprooting-routes-auth.test.ts's own note on this).

import { AccessTier, OnboardingStatus, OrgType, Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

const mockRequestExport = jest.fn();
const mockProcessExport = jest.fn();
const mockRequestDeletion = jest.fn();
const mockProcessDeletion = jest.fn();

jest.mock('@/services/compliance/data-rights', () => ({
  buildProductionDataRightsService: jest.fn(() => ({
    requestExport: mockRequestExport,
    processExport: mockProcessExport,
    requestDeletion: mockRequestDeletion,
    processDeletion: mockProcessDeletion,
  })),
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { POST as exportCreatePOST } from '@/app/api/data-rights/export/route';
import { GET as exportDownloadGET } from '@/app/api/data-rights/export/[exportId]/route';
import { GET as deletionStatusGET, POST as deletionRequestPOST } from '@/app/api/data-rights/deletion/route';
import { POST as deletionConfirmPOST } from '@/app/api/data-rights/deletion/confirm/route';

const mockGetSession = getCurrentSession as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const FORGED = { 'x-user-id': 'victim-999' };
const REAL_USER_ID = 'real-session-user';

function session(overrides: Partial<Session['user']> = {}): Session {
  return {
    expires: '2999-01-01',
    user: {
      id: REAL_USER_ID,
      role: Role.REP,
      orgType: OrgType.EXTERNAL,
      organizationId: 'org-1',
      accessTier: AccessTier.FREE_PAID_EXTERNAL,
      onboardingStatus: OnboardingStatus.GATED_COMPLETE,
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      deviceFingerprintHash: 'fp',
      securityVersionAtIssue: 0,
      boundAt: Date.now(),
      ...overrides,
    },
  } as unknown as Session;
}

const FRESH_VERIFIED_AT = () => new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
const STALE_VERIFIED_AT = () => new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago

function freshSession(overrides: Partial<Session['user']> = {}): Session {
  return session({ mfaEnrolled: true, mfaVerifiedAt: FRESH_VERIFIED_AT(), ...overrides });
}

beforeEach(() => {
  jest.clearAllMocks();
  db.userDataExport = { findUnique: jest.fn() };
  db.userDataDeletion = { findUnique: jest.fn(), findFirst: jest.fn() };
});

// ─── POST /api/data-rights/export ───────────────────────────────────────────────────────────────

describe('POST /api/data-rights/export (create) — session-gated, step-up-MFA-gated, own-data-only', () => {
  function req(headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost/api/data-rights/export', { method: 'POST', headers });
  }

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await exportCreatePOST(req(), {});
    expect(res.status).toBe(401);
    expect(mockRequestExport).not.toHaveBeenCalled();
  });

  test('no MFA factor enrolled -> 403 MFA_ENROLLMENT_REQUIRED, requestExport never called', async () => {
    mockGetSession.mockResolvedValue(session({ mfaEnrolled: false, mfaVerifiedAt: null }));
    const res = await exportCreatePOST(req(), {});
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(mockRequestExport).not.toHaveBeenCalled();
  });

  test('enrolled but STALE step-up -> 403 STEP_UP_REQUIRED, requestExport never called', async () => {
    mockGetSession.mockResolvedValue(session({ mfaEnrolled: true, mfaVerifiedAt: STALE_VERIFIED_AT() }));
    const res = await exportCreatePOST(req(), {});
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('STEP_UP_REQUIRED');
    expect(mockRequestExport).not.toHaveBeenCalled();
  });

  test('FRESH step-up -> 201, requestExport called with the SESSION user id, forged x-user-id ignored', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    mockRequestExport.mockResolvedValue({
      id: 'exp-1',
      user_id: REAL_USER_ID,
      status: 'PENDING',
      expires_at: '2026-07-21T00:00:00.000Z',
      created_at: '2026-07-20T00:00:00.000Z',
    });
    const res = await exportCreatePOST(req(FORGED), {});
    expect(res.status).toBe(201);
    expect(mockRequestExport).toHaveBeenCalledWith({ user_id: REAL_USER_ID });
    expect(mockRequestExport).not.toHaveBeenCalledWith({ user_id: 'victim-999' });
  });
});

// ─── GET /api/data-rights/export/[exportId] ─────────────────────────────────────────────────────

describe('GET /api/data-rights/export/[exportId] (download) — ownership + step-up gated', () => {
  function req(qs = '', headers: Record<string, string> = {}) {
    return new NextRequest(`http://localhost/api/data-rights/export/exp-1${qs}`, { headers });
  }
  const ctx = { params: { exportId: 'exp-1' } };

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await exportDownloadGET(req(), ctx);
    expect(res.status).toBe(401);
    expect(db.userDataExport.findUnique).not.toHaveBeenCalled();
  });

  test('no MFA factor enrolled -> 403 MFA_ENROLLMENT_REQUIRED, ownership lookup never runs', async () => {
    mockGetSession.mockResolvedValue(session({ mfaEnrolled: false, mfaVerifiedAt: null }));
    const res = await exportDownloadGET(req(), ctx);
    expect(res.status).toBe(403);
    expect(db.userDataExport.findUnique).not.toHaveBeenCalled();
    expect(mockProcessExport).not.toHaveBeenCalled();
  });

  test("TEETH (ownership): export not found -> 404, never a leak, processExport never runs", async () => {
    mockGetSession.mockResolvedValue(freshSession());
    db.userDataExport.findUnique.mockResolvedValue(null);
    const res = await exportDownloadGET(req(), ctx);
    expect(res.status).toBe(404);
    expect(mockProcessExport).not.toHaveBeenCalled();
  });

  test('TEETH (cross-user): export exists but belongs to a DIFFERENT user -> 404, identical to not-found, never leaks the owner', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    db.userDataExport.findUnique.mockResolvedValue({ id: 'exp-1', user_id: 'someone-elses-id', status: 'PENDING' });
    const res = await exportDownloadGET(req(), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('someone-elses-id');
    expect(mockProcessExport).not.toHaveBeenCalled();
  });

  test('owned export -> 200, downloadable payload, defaults to JSON format', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    db.userDataExport.findUnique.mockResolvedValue({ id: 'exp-1', user_id: REAL_USER_ID, status: 'PENDING' });
    mockProcessExport.mockResolvedValue({
      record: { id: 'exp-1', user_id: REAL_USER_ID, status: 'COMPLETED', expires_at: '2026-07-21T00:00:00.000Z', created_at: '2026-07-20T00:00:00.000Z' },
      payload: '{"user":{}}',
      sla_deadline: '2026-07-20T00:05:00.000Z',
    });
    const res = await exportDownloadGET(req(), ctx);
    expect(res.status).toBe(200);
    expect(mockProcessExport).toHaveBeenCalledWith('exp-1', 'json');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(await res.text()).toBe('{"user":{}}');
  });

  test('?format=csv is threaded through to processExport', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    db.userDataExport.findUnique.mockResolvedValue({ id: 'exp-1', user_id: REAL_USER_ID, status: 'PENDING' });
    mockProcessExport.mockResolvedValue({
      record: { id: 'exp-1', user_id: REAL_USER_ID, status: 'COMPLETED', expires_at: '', created_at: '' },
      payload: 'a,b\n1,2',
      sla_deadline: '',
    });
    const res = await exportDownloadGET(req('?format=csv'), ctx);
    expect(res.status).toBe(200);
    expect(mockProcessExport).toHaveBeenCalledWith('exp-1', 'csv');
    expect(res.headers.get('content-type')).toContain('text/csv');
  });

  test('forged x-user-id header has ZERO effect — ownership is decided by the SESSION user id', async () => {
    mockGetSession.mockResolvedValue(freshSession({ id: REAL_USER_ID }));
    db.userDataExport.findUnique.mockResolvedValue({ id: 'exp-1', user_id: REAL_USER_ID, status: 'PENDING' });
    mockProcessExport.mockResolvedValue({
      record: { id: 'exp-1', user_id: REAL_USER_ID, status: 'COMPLETED', expires_at: '', created_at: '' },
      payload: '{}',
      sla_deadline: '',
    });
    const res = await exportDownloadGET(req('', FORGED), ctx);
    expect(res.status).toBe(200); // owned by the SESSION id, regardless of the forged header claiming to be someone else
  });
});

// ─── GET /api/data-rights/deletion (status) ─────────────────────────────────────────────────────

describe('GET /api/data-rights/deletion (own status) — session-scoped, no step-up (read-only)', () => {
  function req() {
    return new NextRequest('http://localhost/api/data-rights/deletion');
  }

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await deletionStatusGET(req(), {});
    expect(res.status).toBe(401);
  });

  test('no MFA required for a plain status read — returns null when no request exists yet', async () => {
    mockGetSession.mockResolvedValue(session({ mfaEnrolled: false, mfaVerifiedAt: null }));
    db.userDataDeletion.findFirst.mockResolvedValue(null);
    const res = await deletionStatusGET(req(), {});
    expect(res.status).toBe(200);
    expect((await res.json()).deletion).toBeNull();
    expect(db.userDataDeletion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: REAL_USER_ID } })
    );
  });

  test('returns the existing record, scoped to the session user id only', async () => {
    mockGetSession.mockResolvedValue(session());
    const requestedAt = new Date('2026-07-19T00:00:00.000Z');
    db.userDataDeletion.findFirst.mockResolvedValue({
      id: 'del-1', user_id: REAL_USER_ID, status: 'PENDING', anonymized_fields: [], retained_fields: [],
      deletion_certificate_url: null, requested_at: requestedAt, completed_at: null,
    });
    const res = await deletionStatusGET(req(), {});
    const body = await res.json();
    expect(body.deletion.id).toBe('del-1');
    expect(body.deletion.requested_at).toBe(requestedAt.toISOString());
  });
});

// ─── POST /api/data-rights/deletion (request) ───────────────────────────────────────────────────

describe('POST /api/data-rights/deletion (request) — step-up-gated, idempotent', () => {
  function req(headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost/api/data-rights/deletion', { method: 'POST', headers });
  }

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await deletionRequestPOST(req(), {});
    expect(res.status).toBe(401);
    expect(mockRequestDeletion).not.toHaveBeenCalled();
  });

  test('no MFA enrolled -> 403 MFA_ENROLLMENT_REQUIRED, requestDeletion never called', async () => {
    mockGetSession.mockResolvedValue(session({ mfaEnrolled: false, mfaVerifiedAt: null }));
    const res = await deletionRequestPOST(req(), {});
    expect(res.status).toBe(403);
    expect(mockRequestDeletion).not.toHaveBeenCalled();
  });

  test('STALE step-up -> 403 STEP_UP_REQUIRED, requestDeletion never called', async () => {
    mockGetSession.mockResolvedValue(session({ mfaEnrolled: true, mfaVerifiedAt: STALE_VERIFIED_AT() }));
    const res = await deletionRequestPOST(req(), {});
    expect(res.status).toBe(403);
    expect(mockRequestDeletion).not.toHaveBeenCalled();
  });

  test('FRESH step-up + no existing request -> 201, creates via requestDeletion with the SESSION id, forged header ignored', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    db.userDataDeletion.findFirst.mockResolvedValue(null);
    mockRequestDeletion.mockResolvedValue({
      id: 'del-new', user_id: REAL_USER_ID, status: 'PENDING', anonymized_fields: [], retained_fields: [],
      deletion_certificate_url: null, requested_at: '2026-07-20T00:00:00.000Z', completed_at: null,
    });
    const res = await deletionRequestPOST(req(FORGED), {});
    expect(res.status).toBe(201);
    expect(mockRequestDeletion).toHaveBeenCalledWith({ user_id: REAL_USER_ID, requested_by: REAL_USER_ID });
  });

  test('idempotent: an existing PENDING request is returned as-is — requestDeletion (the service) is never called again', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    const existing = {
      id: 'del-existing', user_id: REAL_USER_ID, status: 'PENDING', anonymized_fields: [], retained_fields: [],
      deletion_certificate_url: null, requested_at: new Date('2026-07-19T00:00:00.000Z'), completed_at: null,
    };
    db.userDataDeletion.findFirst.mockResolvedValue(existing);
    const res = await deletionRequestPOST(req(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deletion.id).toBe('del-existing');
    expect(body.alreadyRequested).toBe(true);
    expect(mockRequestDeletion).not.toHaveBeenCalled();
  });
});

// ─── POST /api/data-rights/deletion/confirm ─────────────────────────────────────────────────────

describe('POST /api/data-rights/deletion/confirm — explicit confirmation + own-data-only + cooling-off', () => {
  function req(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost/api/data-rights/deletion/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    });
  }

  const READY_REQUESTED_AT = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago — past cooling-off
  const TOO_SOON_REQUESTED_AT = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago — inside cooling-off

  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await deletionConfirmPOST(req({ deletion_id: 'del-1', confirm: true }), {});
    expect(res.status).toBe(401);
    expect(mockProcessDeletion).not.toHaveBeenCalled();
  });

  test('no MFA enrolled -> 403 MFA_ENROLLMENT_REQUIRED before any body/ownership logic runs', async () => {
    mockGetSession.mockResolvedValue(session({ mfaEnrolled: false, mfaVerifiedAt: null }));
    const res = await deletionConfirmPOST(req({ deletion_id: 'del-1', confirm: true }), {});
    expect(res.status).toBe(403);
    expect(mockProcessDeletion).not.toHaveBeenCalled();
  });

  test('missing deletion_id -> 400, processDeletion never called', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    const res = await deletionConfirmPOST(req({ confirm: true }), {});
    expect(res.status).toBe(400);
    expect(mockProcessDeletion).not.toHaveBeenCalled();
  });

  test('TEETH (explicit confirmation): confirm is missing/false -> 400 CONFIRMATION_REQUIRED, never processed', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    const res = await deletionConfirmPOST(req({ deletion_id: 'del-1', confirm: false }), {});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CONFIRMATION_REQUIRED');
    expect(mockProcessDeletion).not.toHaveBeenCalled();
    expect(db.userDataDeletion.findUnique).not.toHaveBeenCalled(); // rejected before even reading the row
  });

  test('a truthy-but-not-literal-true confirm value (e.g. the string "true") is rejected — only the boolean true counts', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    const res = await deletionConfirmPOST(req({ deletion_id: 'del-1', confirm: 'true' }), {});
    expect(res.status).toBe(400);
    expect(mockProcessDeletion).not.toHaveBeenCalled();
  });

  test('TEETH (ownership): deletion request not found -> 404, never a leak', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    db.userDataDeletion.findUnique.mockResolvedValue(null);
    const res = await deletionConfirmPOST(req({ deletion_id: 'del-ghost', confirm: true }), {});
    expect(res.status).toBe(404);
    expect(mockProcessDeletion).not.toHaveBeenCalled();
  });

  test('TEETH (cross-user, own-data-only): deletion request belongs to a DIFFERENT user -> 404, identical to not-found', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    db.userDataDeletion.findUnique.mockResolvedValue({
      id: 'del-1', user_id: 'someone-elses-id', status: 'PENDING', requested_at: READY_REQUESTED_AT,
    });
    const res = await deletionConfirmPOST(req({ deletion_id: 'del-1', confirm: true }), {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('someone-elses-id');
    expect(mockProcessDeletion).not.toHaveBeenCalled();
  });

  test('already COMPLETED -> 409 ALREADY_PROCESSED, never re-run', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    db.userDataDeletion.findUnique.mockResolvedValue({
      id: 'del-1', user_id: REAL_USER_ID, status: 'COMPLETED', requested_at: READY_REQUESTED_AT,
    });
    const res = await deletionConfirmPOST(req({ deletion_id: 'del-1', confirm: true }), {});
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ALREADY_PROCESSED');
    expect(mockProcessDeletion).not.toHaveBeenCalled();
  });

  test('HELD (legal hold) -> 409 ALREADY_PROCESSED (not re-attempted through this route)', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    db.userDataDeletion.findUnique.mockResolvedValue({
      id: 'del-1', user_id: REAL_USER_ID, status: 'HELD', requested_at: READY_REQUESTED_AT,
    });
    const res = await deletionConfirmPOST(req({ deletion_id: 'del-1', confirm: true }), {});
    expect(res.status).toBe(409);
    expect(mockProcessDeletion).not.toHaveBeenCalled();
  });

  test('TEETH (cooling-off): PENDING but requested less than 24h ago -> 409 TOO_EARLY with a readyAt, never processed', async () => {
    mockGetSession.mockResolvedValue(freshSession());
    db.userDataDeletion.findUnique.mockResolvedValue({
      id: 'del-1', user_id: REAL_USER_ID, status: 'PENDING', requested_at: TOO_SOON_REQUESTED_AT,
    });
    const res = await deletionConfirmPOST(req({ deletion_id: 'del-1', confirm: true }), {});
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('TOO_EARLY');
    expect(typeof body.readyAt).toBe('string');
    expect(mockProcessDeletion).not.toHaveBeenCalled();
  });

  test('PENDING, past cooling-off, explicit confirm:true, fresh step-up -> 200, processDeletion called with the SESSION user id, forged header ignored', async () => {
    mockGetSession.mockResolvedValue(freshSession({ id: REAL_USER_ID }));
    db.userDataDeletion.findUnique.mockResolvedValue({
      id: 'del-1', user_id: REAL_USER_ID, status: 'PENDING', requested_at: READY_REQUESTED_AT,
    });
    mockProcessDeletion.mockResolvedValue({
      record: { id: 'del-1', user_id: REAL_USER_ID, status: 'COMPLETED', anonymized_fields: ['User.email'], retained_fields: [], deletion_certificate_url: 'https://x', requested_at: READY_REQUESTED_AT.toISOString(), completed_at: '2026-07-20T00:00:00.000Z' },
      certificate: { user_id: REAL_USER_ID, deletion_id: 'del-1', requested_at: READY_REQUESTED_AT.toISOString(), completed_at: '2026-07-20T00:00:00.000Z', status: 'COMPLETED', deleted_fields: ['User.email'], retained_records: [], cascade_hashes: [], certificate_url: 'https://x' },
    });
    const res = await deletionConfirmPOST(req({ deletion_id: 'del-1', confirm: true }, FORGED), {});
    expect(res.status).toBe(200);
    expect(mockProcessDeletion).toHaveBeenCalledWith('del-1', REAL_USER_ID);
    expect(mockProcessDeletion).not.toHaveBeenCalledWith('del-1', 'victim-999');
    const body = await res.json();
    expect(body.certificate.status).toBe('COMPLETED');
  });
});
