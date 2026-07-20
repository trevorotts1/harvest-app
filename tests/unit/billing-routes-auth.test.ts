// WP10 (T-47) — billing route auth/RBAC/org-scoping + the Stripe webhook route (qc-checklist WP10
// checkpoints 7 & 9). Mirrors the module-boundary-mocking pattern of compliance-routes-auth.test.ts:
// `getCurrentSession` + `prisma` are mocked so the REAL withOnboardingGate-wrapped handlers run,
// with a forged `x-user-id` header attached to prove identity comes ONLY from the session.

import { createHmac } from 'node:crypto';

import { Role, OrgType, AccessTier, OnboardingStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

// The webhook route builds Prisma-backed handlers from production-wiring — mock it to no-op handlers
// so this stays a pure verify→idempotency→dispatch route test (the handlers are proven elsewhere).
jest.mock('@/services/payment/production-wiring', () => ({
  buildStripeWebhookHandlers: () => ({
    onCheckoutCompleted: jest.fn(),
    onPaymentSucceeded: jest.fn(),
    onPaymentFailed: jest.fn(),
    onSubscriptionUpdated: jest.fn(),
    onDisputeCreated: jest.fn(),
  }),
}));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET as subscriptionGET } from '@/app/api/billing/subscription/route';
import { GET as orgGET } from '@/app/api/billing/org/route';
import { POST as webhookPOST } from '@/app/api/stripe/webhook/route';

const mockGetSession = getCurrentSession as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

function session(role: Role, organizationId: string | null): Session {
  return {
    expires: '2999-01-01',
    user: {
      id: 'user-1',
      role,
      orgType: OrgType.EXTERNAL,
      organizationId,
      accessTier: AccessTier.FREE_PAID_EXTERNAL,
      onboardingStatus: OnboardingStatus.GATED_COMPLETE,
      mfaEnrolled: false,
      mfaVerifiedAt: null,
      deviceFingerprintHash: 'fp',
      securityVersionAtIssue: 0,
      boundAt: Date.now(),
    },
  } as unknown as Session;
}

/** Onboarding gate reads user.findUnique(onboarding_status); complete so the handler proceeds. */
function primeGateComplete() {
  db.user = {
    findUnique: jest.fn().mockResolvedValue({ onboarding_status: OnboardingStatus.GATED_COMPLETE, onboarding_sessions: [] }),
  };
}

const FORGED = { 'x-user-id': 'victim-999' };

beforeEach(() => {
  jest.clearAllMocks();
  primeGateComplete();
});

describe('GET /api/billing/subscription (own billing; forged header inert)', () => {
  test('401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await subscriptionGET(
      new NextRequest('http://localhost/api/billing/subscription', { headers: FORGED }),
      {} as never
    );
    expect(res.status).toBe(401);
  });

  test('200 for the authenticated caller — identity from session, not the forged header', async () => {
    mockGetSession.mockResolvedValue(session(Role.REP, 'orgA'));
    db.subscription = {
      findFirst: jest.fn().mockResolvedValue({
        id: 's1',
        plan_tier: 'individual',
        billing_cycle: 'monthly',
        status: 'ACTIVE',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 1e9),
        org_sponsored: false,
        sponsor_user_id: null,
      }),
    };
    db.sponsorship = { findFirst: jest.fn().mockResolvedValue(null) };
    db.paymentMethod = { findFirst: jest.fn().mockResolvedValue({ brand: 'visa', last4: '4242' }) };

    const res = await subscriptionGET(
      new NextRequest('http://localhost/api/billing/subscription', { headers: FORGED }),
      {} as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.user_id).toBe('user-1'); // the SESSION user, never 'victim-999'
    expect(body.tiers).toHaveLength(3);
    // No PAN — only brand+last4.
    expect(body.state.payment_method).toEqual({ brand: 'visa', last4: '4242' });
  });
});

describe('GET /api/billing/org (billing RBAC + org isolation) — checkpoint 9', () => {
  test('REP is DENIED (403) — billing_org read is upline/rvp/admin only', async () => {
    mockGetSession.mockResolvedValue(session(Role.REP, 'orgA'));
    const res = await orgGET(new NextRequest('http://localhost/api/billing/org'), {} as never);
    expect(res.status).toBe(403);
  });

  test('UPLINE sees their OWN org', async () => {
    mockGetSession.mockResolvedValue(session(Role.UPLINE, 'orgA'));
    db.sponsorship = { findMany: jest.fn().mockResolvedValue([]) };
    const res = await orgGET(new NextRequest('http://localhost/api/billing/org'), {} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organization_id).toBe('orgA');
  });

  test('cross-org request returns 404 (not 403 — presence not leaked)', async () => {
    mockGetSession.mockResolvedValue(session(Role.UPLINE, 'orgA'));
    db.sponsorship = { findMany: jest.fn() };
    const res = await orgGET(new NextRequest('http://localhost/api/billing/org?orgId=orgB'), {} as never);
    expect(res.status).toBe(404);
    expect(db.sponsorship.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/stripe/webhook (machine-to-machine; verify → idempotency → dispatch)', () => {
  const SECRET = 'whsec_route_test';
  const payload = JSON.stringify({ id: 'evt_route_1', type: 'invoice.payment_succeeded', data: { object: { subscription: 'sub_1' } } });

  function signedHeaders(t: number, secret = SECRET) {
    const sig = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
    return { 'stripe-signature': `t=${t},v1=${sig}` };
  }

  test('400 for a missing/forged signature', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const res = await webhookPOST(
      new NextRequest('http://localhost/api/stripe/webhook', { method: 'POST', body: payload })
    );
    expect(res.status).toBe(400);
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  test('500 (fail-closed) when the webhook secret is absent', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const t = Math.floor(Date.now() / 1000);
    const res = await webhookPOST(
      new NextRequest('http://localhost/api/stripe/webhook', { method: 'POST', body: payload, headers: signedHeaders(t) })
    );
    expect(res.status).toBe(500);
  });

  test('200 handled for a valid event; a DUPLICATE delivery is deduplicated (no double-action)', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const claimed = new Set<string>();
    db.idempotencyLog = {
      create: jest.fn(async ({ data }: { data: { key: string } }) => {
        if (claimed.has(data.key)) {
          const e = new Error('dup') as Error & { code: string };
          e.code = 'P2002';
          throw e;
        }
        claimed.add(data.key);
      }),
      findUnique: jest.fn(),
      delete: jest.fn(async ({ where }: { where: { key: string } }) => claimed.delete(where.key)),
    };

    const t = Math.floor(Date.now() / 1000);
    const first = await webhookPOST(
      new NextRequest('http://localhost/api/stripe/webhook', { method: 'POST', body: payload, headers: signedHeaders(t) })
    );
    expect(first.status).toBe(200);
    expect((await first.json()).handled).toBe(true);

    const dup = await webhookPOST(
      new NextRequest('http://localhost/api/stripe/webhook', { method: 'POST', body: payload, headers: signedHeaders(t) })
    );
    expect(dup.status).toBe(200);
    expect((await dup.json()).deduplicated).toBe(true);
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });
});
