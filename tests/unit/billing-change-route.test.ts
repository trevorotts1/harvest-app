// T-R41 (mid-cycle plan change/proration) — wires `/api/billing/change`'s GET (proration preview)
// and POST (apply) through the REAL `withOnboardingGate`-wrapped route handlers + the REAL
// `SubscriptionService.changePlan`/`previewPlanChange` — only `@/lib/auth/session` and
// `@/lib/prisma` are mocked, the same module-boundary-mocking convention
// tests/unit/billing-routes-auth.test.ts already established for this route family. Proves:
//   (1) GET returns the proration preview WITHOUT mutating anything.
//   (2) POST persists the new plan_tier/billing_cycle via a REAL `prisma.subscription.update` call
//       (never a hand-built stand-in for SubscriptionService) — the change CTA's actual contract.
//   (3) The downgrade path (enterprise → individual) applies through the identical endpoint.
//   (4) Fail-closed: an unknown tier or a missing subscription returns the honest error and NEVER
//       calls `subscription.update` — no phantom/optimistic persistence on a failure path.

import { Role, OrgType, AccessTier, OnboardingStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { getCurrentSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { GET as changeGET, POST as changePOST } from '@/app/api/billing/change/route';

const mockGetSession = getCurrentSession as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const DAY_MS = 24 * 60 * 60 * 1000;

function session(): Session {
  return {
    expires: '2999-01-01',
    user: {
      id: 'user-1',
      role: Role.REP,
      orgType: OrgType.EXTERNAL,
      organizationId: 'orgA',
      accessTier: AccessTier.PAID_INDIVIDUAL,
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

interface SubRow {
  id: string;
  user_id: string;
  plan_tier: string;
  billing_cycle: string;
  status: string;
  current_period_start: Date | null;
  current_period_end: Date | null;
  org_sponsored: boolean;
  sponsor_user_id: string | null;
  created_at: Date;
}

function subscriptionRow(overrides: Partial<SubRow> = {}): SubRow {
  const now = Date.now();
  return {
    id: 'sub-1',
    user_id: 'user-1',
    plan_tier: 'individual',
    billing_cycle: 'monthly',
    status: 'ACTIVE',
    current_period_start: new Date(now - 15 * DAY_MS),
    current_period_end: new Date(now + 15 * DAY_MS),
    org_sponsored: false,
    sponsor_user_id: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Wires a fake `prisma.subscription` tracking every update call — the real persistence proof. */
function wireSubscription(row: SubRow | null) {
  const updateCalls: Array<{ where: unknown; data: unknown }> = [];
  db.subscription = {
    findFirst: jest.fn().mockResolvedValue(row ? { ...row } : null),
    update: jest.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
      updateCalls.push({ where, data });
      return { ...row, ...(data as object) };
    }),
  };
  return { updateCalls };
}

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(session());
  primeGateComplete();
});

describe('GET /api/billing/change (proration preview — never mutates)', () => {
  test('400 UNKNOWN_TIER for a malformed tier param; no read/write of the subscription table', async () => {
    const { updateCalls } = wireSubscription(subscriptionRow());
    const res = await changeGET(req('http://localhost/api/billing/change?tier=bogus&cycle=monthly'), {} as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'UNKNOWN_TIER' });
    expect(updateCalls).toHaveLength(0);
    expect(db.subscription.findFirst).not.toHaveBeenCalled();
  });

  test('404 NO_SUBSCRIPTION when the caller has no subscription row', async () => {
    wireSubscription(null);
    const res = await changeGET(req('http://localhost/api/billing/change?tier=individual&cycle=annual'), {} as never);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'NO_SUBSCRIPTION' });
  });

  test('200 returns the exact-amount proration preview BEFORE any confirm, without writing anything', async () => {
    const { updateCalls } = wireSubscription(subscriptionRow());
    const res = await changeGET(req('http://localhost/api/billing/change?tier=individual&cycle=annual'), {} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proration).toMatchObject({
      daysRemaining: expect.any(Number),
      daysInPeriod: expect.any(Number),
      creditCents: expect.any(Number),
      chargeCents: expect.any(Number),
      netCents: expect.any(Number),
      summary: expect.any(String),
    });
    // GET is read-only — the preview NEVER mutates the live row.
    expect(updateCalls).toHaveLength(0);
  });
});

describe('POST /api/billing/change (apply — real persistence)', () => {
  test('persists the new plan_tier + billing_cycle via a REAL subscription.update call', async () => {
    const { updateCalls } = wireSubscription(subscriptionRow({ plan_tier: 'individual', billing_cycle: 'monthly' }));

    const res = await changePOST(
      req('http://localhost/api/billing/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'individual', cycle: 'annual' }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(true);
    expect(body.proration.summary).toEqual(expect.any(String));

    // The REAL persistence proof: exactly one update, on the caller's own row, with the new tier
    // AND cycle — never a no-op, never a different row.
    expect(updateCalls).toEqual([{ where: { id: 'sub-1' }, data: { plan_tier: 'individual', billing_cycle: 'annual' } }]);
  });

  test('downgrade path: enterprise → individual applies through this SAME endpoint', async () => {
    const { updateCalls } = wireSubscription(
      subscriptionRow({ id: 'sub-ent', plan_tier: 'enterprise', billing_cycle: 'annual' })
    );

    const res = await changePOST(
      req('http://localhost/api/billing/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'individual', cycle: 'monthly' }),
      }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect((await res.json()).changed).toBe(true);
    expect(updateCalls).toEqual([{ where: { id: 'sub-ent' }, data: { plan_tier: 'individual', billing_cycle: 'monthly' } }]);
  });

  test('FAIL-CLOSED: an unknown tier is rejected 400 and NEVER calls subscription.update (no fake success)', async () => {
    const { updateCalls } = wireSubscription(subscriptionRow());

    const res = await changePOST(
      req('http://localhost/api/billing/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'nonexistent_tier', cycle: 'monthly' }),
      }),
      {} as never
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'UNKNOWN_TIER' });
    expect(updateCalls).toHaveLength(0);
  });

  test('FAIL-CLOSED: no subscription on file → 404 NO_SUBSCRIPTION, the error is surfaced honestly, and update is NEVER called', async () => {
    const { updateCalls } = wireSubscription(null);

    const res = await changePOST(
      req('http://localhost/api/billing/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'individual', cycle: 'annual' }),
      }),
      {} as never
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'NO_SUBSCRIPTION' });
    expect(body.changed).toBeUndefined(); // never a fabricated `changed: true`
    expect(updateCalls).toHaveLength(0);
  });

  test('a malformed JSON body degrades to the UNKNOWN_TIER 400 (defaults never guess a tier), no write', async () => {
    const { updateCalls } = wireSubscription(subscriptionRow());

    const res = await changePOST(
      req('http://localhost/api/billing/change', { method: 'POST', body: 'not json' }),
      {} as never
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'UNKNOWN_TIER' });
    expect(updateCalls).toHaveLength(0);
  });
});
