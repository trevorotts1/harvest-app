// T-38 (master-spec §10.4; qc-checklist WP05 block, item 5: "Any new route (opt-out webhook /
// consent capture in src/app/api/compliance/): authenticated, never trust x-user-id, lazy
// in-handler"). PROOF (e) of the T-38 build brief's VERIFY list: "any route authenticated +
// forged-x-user-id inert."
//
// Mirrors the exact module-boundary-mocking pattern already established by
// tests/unit/onboarding-consent-route.test.ts / tests/unit/hidden-earnings-route.test.ts:
// `getCurrentSession` and `prisma` are mocked at the module boundary so the REAL `withRole`-wrapped
// route handlers run, with a forged `x-user-id` header attached to every authenticated request to
// prove the route derives identity ONLY from the session, never the header. The
// `OptOutRegistryService` / `MessagingConsentLedger` classes are mocked too, so this stays a pure
// route/auth-gating + ownership-check test (the business logic itself is proven with real
// Prisma-shaped mocks in opt-out-registry.test.ts / messaging-consent-ledger.test.ts).
//
// `/api/compliance/opt-out/inbound` has no session at all (a machine-to-machine Twilio-shaped
// webhook, see that route's own header comment) — its own auth is a shared-secret header, proven
// separately below, and a forged `x-user-id` on that route is simply never read at all.

import { Role } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: { contact: { findFirst: jest.fn() } },
}));

const mockRecordOptOutForContact = jest.fn();
const mockRecordInboundMessage = jest.fn();
jest.mock('@/services/compliance/opt-out/opt-out-registry', () => ({
  OptOutRegistryService: jest.fn().mockImplementation(() => ({
    recordOptOutForContact: mockRecordOptOutForContact,
    recordInboundMessage: mockRecordInboundMessage,
  })),
  // Real value (not a jest.fn()) — this is a plain string constant, not behavior to mock; the
  // route imports this SAME constant from this SAME module (see opt-out-registry.ts's doc
  // comment on why it lives here rather than in the route.ts file).
  INBOUND_WEBHOOK_SECRET_ENV_VAR: 'INBOUND_SMS_WEBHOOK_SECRET',
}));

const mockCaptureConsent = jest.fn();
const mockRevokeConsent = jest.fn();
jest.mock('@/services/compliance/messaging-consent/messaging-consent-ledger', () => ({
  MessagingConsentLedger: jest.fn().mockImplementation(() => ({
    captureConsent: mockCaptureConsent,
    revokeConsent: mockRevokeConsent,
  })),
}));

jest.mock('@/services/compliance/encryption/encryption', () => ({
  hmacForMatch: jest.fn((value: string) => `hash(${value})`),
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { POST as optOutPOST } from '@/app/api/compliance/opt-out/route';
import { POST as inboundPOST } from '@/app/api/compliance/opt-out/inbound/route';
import { POST as consentPOST, DELETE as consentDELETE } from '@/app/api/compliance/messaging-consent/route';

// The webhook's shared-secret env-var-name constant is homed in the SERVICE module, not the route
// (a `route.ts` file may only export recognized Next.js route fields — see
// opt-out-registry.ts's own doc comment on this constant for why).
import { INBOUND_WEBHOOK_SECRET_ENV_VAR } from '@/services/compliance/opt-out/opt-out-registry';

const mockedSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockedContactFindFirst = (prisma as unknown as { contact: { findFirst: jest.Mock } }).contact.findFirst;

function fakeSession(userId: string, role: Role = Role.REP): Session {
  return {
    user: {
      id: userId,
      role,
      orgType: 'EXTERNAL',
      organizationId: 'org-1',
      accessTier: 'FREE_ORG_LINKED',
      mfaEnrolled: false,
      mfaVerifiedAt: null,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

// A request carrying a forged x-user-id header pointed at a DIFFERENT user than the real session —
// every "authenticated" test below sends this header and asserts it has zero effect.
function forgedRequest(url: string, init: { method: string; body?: unknown; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: init.method,
    headers: { 'x-user-id': 'attacker-victim-id', 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/compliance/opt-out (§10.8 rep-initiated manual opt-out — PROOF e)', () => {
  test('no session -> 401, never reaches the registry', async () => {
    mockedSession.mockResolvedValue(null);
    const req = forgedRequest('/api/compliance/opt-out', { method: 'POST', body: { contactId: 'c-1', reason: 'manual' } });
    const res = await optOutPOST(req, {});
    expect(res.status).toBe(401);
    expect(mockRecordOptOutForContact).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header is INERT — ownership is checked against the SESSION id, not the header', async () => {
    mockedSession.mockResolvedValue(fakeSession('real-rep-id'));
    mockedContactFindFirst.mockResolvedValue({ phone_hash: 'ph-1', email_hash: null });

    const req = forgedRequest('/api/compliance/opt-out', { method: 'POST', body: { contactId: 'c-1', reason: 'manual' } });
    const res = await optOutPOST(req, {});

    expect(res.status).toBe(200);
    // The ownership lookup used the SESSION's user id ('real-rep-id'), never the forged header.
    expect(mockedContactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c-1', user_id: 'real-rep-id' } })
    );
    expect(mockRecordOptOutForContact).toHaveBeenCalledTimes(1);
  });

  test('a contactId that does not belong to the SESSION user (even if it belongs to the forged header id) 404s and never records an opt-out', async () => {
    mockedSession.mockResolvedValue(fakeSession('real-rep-id'));
    mockedContactFindFirst.mockResolvedValue(null); // not found for (contactId, real-rep-id)

    const req = forgedRequest('/api/compliance/opt-out', { method: 'POST', body: { contactId: 'someone-elses-contact', reason: 'manual' } });
    const res = await optOutPOST(req, {});

    expect(res.status).toBe(404);
    expect(mockRecordOptOutForContact).not.toHaveBeenCalled();
  });

  test('an invalid reason (not rep-selectable) is rejected with 400 before any DB read', async () => {
    mockedSession.mockResolvedValue(fakeSession('real-rep-id'));
    const req = forgedRequest('/api/compliance/opt-out', { method: 'POST', body: { contactId: 'c-1', reason: 'minor' } });
    const res = await optOutPOST(req, {});
    expect(res.status).toBe(400);
    expect(mockedContactFindFirst).not.toHaveBeenCalled();
  });
});

describe('POST/DELETE /api/compliance/messaging-consent (§10.4 TCPA per-contact consent capture — PROOF e)', () => {
  test('no session -> 401 on grant, never reaches the ledger', async () => {
    mockedSession.mockResolvedValue(null);
    const req = forgedRequest('/api/compliance/messaging-consent', { method: 'POST', body: { contactId: 'c-1', given: true } });
    const res = await consentPOST(req, {});
    expect(res.status).toBe(401);
    expect(mockCaptureConsent).not.toHaveBeenCalled();
  });

  test('a forged x-user-id header is INERT on grant — captureConsent is called with the SESSION id as the owning rep', async () => {
    mockedSession.mockResolvedValue(fakeSession('real-rep-id'));
    mockedContactFindFirst.mockResolvedValue({ id: 'c-1' });
    mockCaptureConsent.mockResolvedValue({ given: true, version: 1, timestamp: '2026-07-15T00:00:00.000Z' });

    const req = forgedRequest('/api/compliance/messaging-consent', { method: 'POST', body: { contactId: 'c-1', given: true } });
    const res = await consentPOST(req, {});

    expect(res.status).toBe(200);
    expect(mockedContactFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c-1', user_id: 'real-rep-id' } })
    );
    expect(mockCaptureConsent).toHaveBeenCalledWith('real-rep-id', 'c-1', true, expect.anything());
  });

  test('a contactId not owned by the SESSION user 404s on grant and never writes a consent record', async () => {
    mockedSession.mockResolvedValue(fakeSession('real-rep-id'));
    mockedContactFindFirst.mockResolvedValue(null);

    const req = forgedRequest('/api/compliance/messaging-consent', { method: 'POST', body: { contactId: 'not-mine', given: true } });
    const res = await consentPOST(req, {});

    expect(res.status).toBe(404);
    expect(mockCaptureConsent).not.toHaveBeenCalled();
  });

  test('DELETE (revoke) also uses the SESSION id, ignoring the forged header, and 404s for an unowned contact', async () => {
    mockedSession.mockResolvedValue(fakeSession('real-rep-id'));
    mockedContactFindFirst.mockResolvedValue(null);

    const req = forgedRequest('/api/compliance/messaging-consent', { method: 'DELETE', body: { contactId: 'not-mine' } });
    const res = await consentDELETE(req, {});

    expect(res.status).toBe(404);
    expect(mockRevokeConsent).not.toHaveBeenCalled();
  });

  test('DELETE (revoke) on an owned contact calls revokeConsent with the SESSION id', async () => {
    mockedSession.mockResolvedValue(fakeSession('real-rep-id'));
    mockedContactFindFirst.mockResolvedValue({ id: 'c-1' });
    mockRevokeConsent.mockResolvedValue({ given: false, version: 2, timestamp: '2026-07-15T00:00:00.000Z' });

    const req = forgedRequest('/api/compliance/messaging-consent', { method: 'DELETE', body: { contactId: 'c-1' } });
    const res = await consentDELETE(req, {});

    expect(res.status).toBe(200);
    expect(mockRevokeConsent).toHaveBeenCalledWith('real-rep-id', 'c-1');
  });
});

describe('POST /api/compliance/opt-out/inbound (machine-to-machine webhook — shared-secret auth, PROOF e)', () => {
  const ORIGINAL_ENV = process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR];

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR];
    else process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR] = ORIGINAL_ENV;
  });

  test('an UNCONFIGURED secret fails closed (401) even with a forged x-user-id header attached', async () => {
    delete process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR];
    const req = forgedRequest('/api/compliance/opt-out/inbound', {
      method: 'POST',
      body: { from: '+15551234567', body: 'STOP' },
      headers: { 'x-inbound-webhook-secret': 'whatever' },
    });
    const res = await inboundPOST(req);
    expect(res.status).toBe(401);
    expect(mockRecordInboundMessage).not.toHaveBeenCalled();
  });

  test('a missing/wrong shared secret is rejected 401 — a forged x-user-id header is never even read on this route', async () => {
    process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR] = 'correct-secret';
    const req = forgedRequest('/api/compliance/opt-out/inbound', {
      method: 'POST',
      body: { from: '+15551234567', body: 'STOP' },
      headers: { 'x-inbound-webhook-secret': 'wrong-secret' },
    });
    const res = await inboundPOST(req);
    expect(res.status).toBe(401);
    expect(mockRecordInboundMessage).not.toHaveBeenCalled();
  });

  test('the CORRECT shared secret authenticates and records the inbound STOP, regardless of any x-user-id header present', async () => {
    process.env[INBOUND_WEBHOOK_SECRET_ENV_VAR] = 'correct-secret';
    mockRecordInboundMessage.mockResolvedValue(true);

    const req = forgedRequest('/api/compliance/opt-out/inbound', {
      method: 'POST',
      body: { from: '+15551234567', body: 'STOP' },
      headers: { 'x-inbound-webhook-secret': 'correct-secret' },
    });
    const res = await inboundPOST(req);

    expect(res.status).toBe(200);
    expect(mockRecordInboundMessage).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.optedOut).toBe(true);
  });
});
