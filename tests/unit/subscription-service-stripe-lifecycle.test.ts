// T-R44 (WP10 gate remediation — T-59 Final QC money-path gap) — proves `SubscriptionService
// .changePlan`/`.cancel` now branch correctly on whether a subscription is REAL (Stripe-billed,
// `stripe_subscription_id` set) or DB-only (free/sponsored, or enterprise's annual-invoice tier —
// no Stripe subscription ever existed):
//   (a) a REAL subscription's change/cancel calls the REAL Stripe outbound function FIRST, and only
//       persists locally once Stripe confirms;
//   (b) if Stripe is unconfigured (or the target tier/cycle has no Stripe price), the call FAILS
//       CLOSED — the DB is NEVER mutated, never a silent DB-only lie about a real subscription;
//   (c) a DB-only subscription keeps the ORIGINAL DB-only write — no Stripe call is ever made for it
//       (correct: there is nothing at Stripe to reconcile);
//   (d) an in-app IMMEDIATE cancel + the `customer.subscription.deleted` webhook Stripe fires as a
//       direct result do not double-apply — both converge on the SAME CANCELED outcome.
//
// Convention: only `@/lib/prisma` and the global `fetch` (the Stripe API boundary) are mocked — the
// REAL `SubscriptionService` and, for (d), the REAL webhook route/dispatcher/production-wiring are
// exercised, mirroring tests/unit/chargeback-live-path.test.ts's "never a hand-built stand-in"
// convention. Stripe response fixtures are the SAME real, documented Subscription/SubscriptionItem
// shapes tests/unit/stripe-subscription-lifecycle.test.ts cites and uses.

import { createHmac } from 'node:crypto';

import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/prisma';
import { POST as webhookPOST } from '@/app/api/stripe/webhook/route';
import {
  SubscriptionService,
  type SubscriptionServicePrisma,
} from '@/services/payment/subscription.service';
import { StripeConfigError } from '@/services/payment/stripe-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET_KEY = 'sk_test_service_lifecycle';
const WEBHOOK_SECRET = 'whsec_service_lifecycle';
const ORIGINAL_FETCH = global.fetch;

function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

interface FakeState {
  subscriptions: Map<string, Record<string, unknown>>;
  idempotencyKeys: Set<string>;
  updateCalls: Array<{ where: unknown; data: unknown }>;
}

/** Same fake-delegate convention as chargeback-live-path.test.ts / subscription-deleted-live-path
 *  .test.ts: `findFirst` (SubscriptionService's own reads) AND `findUnique` (production-wiring's
 *  webhook-side reads) over the SAME backing store, so a service call and a webhook delivery in the
 *  same test observe each other's writes. */
function wireFakeDb(seedSubscriptions: Array<Record<string, unknown>> = []): FakeState {
  const state: FakeState = {
    subscriptions: new Map(seedSubscriptions.map((r) => [r.id as string, { ...r }])),
    idempotencyKeys: new Set(),
    updateCalls: [],
  };

  db.subscription = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const rows = Array.from(state.subscriptions.values()).filter((r) => matchWhere(r, where));
      return rows[0] ? { ...rows[0] } : null;
    },
    findUnique: async ({ where }: { where: Record<string, unknown> }) => {
      const row = Array.from(state.subscriptions.values()).find((r) => matchWhere(r, where));
      return row ? { ...row } : null;
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      state.updateCalls.push({ where, data });
      const row = Array.from(state.subscriptions.values()).find((r) => matchWhere(r, where));
      if (!row) throw new Error('fake db: update on missing row');
      Object.assign(row, data);
      return { ...row };
    },
  };
  db.sponsorship = { findFirst: async () => null };
  db.paymentMethod = { findFirst: async () => null };

  db.idempotencyLog = {
    create: async ({ data }: { data: { key: string } }) => {
      if (state.idempotencyKeys.has(data.key)) {
        const e = new Error('duplicate key') as Error & { code: string };
        e.code = 'P2002';
        throw e;
      }
      state.idempotencyKeys.add(data.key);
    },
    findUnique: async ({ where }: { where: { key: string } }) =>
      state.idempotencyKeys.has(where.key) ? { key: where.key } : null,
    delete: async ({ where }: { where: { key: string } }) => {
      state.idempotencyKeys.delete(where.key);
    },
  };

  return state;
}

function service(): SubscriptionService {
  return new SubscriptionService(db as unknown as SubscriptionServicePrisma);
}

function realStripeSubscriptionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    id: 'sub-1',
    user_id: 'user-1',
    stripe_subscription_id: 'sub_stripe_1',
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

/** A DB-only subscription: enterprise (annual invoice, never a Stripe subscription — §15.1). */
function dbOnlyEnterpriseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    id: 'sub-ent',
    user_id: 'user-1',
    stripe_subscription_id: null,
    plan_tier: 'enterprise',
    billing_cycle: 'annual',
    status: 'ACTIVE',
    current_period_start: new Date(now - 100 * DAY_MS),
    current_period_end: new Date(now + 265 * DAY_MS),
    org_sponsored: false,
    sponsor_user_id: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ── Real, documented Stripe Subscription/SubscriptionItem fixtures (same shapes cited/used by
//    stripe-subscription-lifecycle.test.ts — https://docs.stripe.com/api/subscriptions/object,
//    https://docs.stripe.com/api/subscription_items/object). ──
const STRIPE_ITEM_ID = 'si_1Item123';
function stripeSubscriptionObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_stripe_1',
    object: 'subscription',
    status: 'active',
    cancel_at_period_end: false,
    canceled_at: null,
    current_period_end: 1_702_592_000,
    items: {
      object: 'list',
      data: [{ id: STRIPE_ITEM_ID, object: 'subscription_item', price: { id: 'price_individual_monthly' } }],
    },
    ...overrides,
  };
}

/** Installs a scripted global.fetch (records calls; answers each call in sequence). */
function installScriptedFetch(responses: Array<{ ok: boolean; status?: number; json: unknown; text?: string }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string | undefined }> = [];
  let i = 0;
  const fn = jest.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: async () => r.json,
      text: async () => r.text ?? JSON.stringify(r.json),
    } as unknown as Response;
  });
  (global as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

function sign(payload: string, t: number): string {
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v1=${sig}`;
}

function deliverWebhook(payload: string) {
  const t = Math.floor(Date.now() / 1000);
  return webhookPOST(
    new NextRequest('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: payload,
      headers: { 'stripe-signature': sign(payload, t) },
    })
  );
}

function subscriptionDeletedEvent(eventId: string, stripeSubscriptionId: string) {
  return JSON.stringify({ id: eventId, type: 'customer.subscription.deleted', data: { object: { id: stripeSubscriptionId } } });
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = SECRET_KEY;
  process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY = 'price_individual_monthly';
  process.env.STRIPE_PRICE_INDIVIDUAL_ANNUAL = 'price_individual_annual';
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY;
  delete process.env.STRIPE_PRICE_INDIVIDUAL_ANNUAL;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  (global as unknown as { fetch: typeof fetch }).fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

describe('SubscriptionService.changePlan — real Stripe subscription vs. DB-only (T-R44)', () => {
  test('REAL subscription: calls the Stripe price-swap (GET item id, then POST with proration) BEFORE persisting plan_tier/billing_cycle', async () => {
    const state = wireFakeDb([realStripeSubscriptionRow()]);
    const { calls } = installScriptedFetch([
      { ok: true, json: stripeSubscriptionObject() },
      { ok: true, json: stripeSubscriptionObject({ items: { object: 'list', data: [{ id: STRIPE_ITEM_ID, price: { id: 'price_individual_annual' } }] } }) },
    ]);

    const result = await service().changePlan('user-1', 'individual', 'annual');

    expect(result.proration.summary).toEqual(expect.any(String));
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe('GET');
    expect(calls[1].method).toBe('POST');
    const body = new URLSearchParams(calls[1].body);
    expect(body.get('items[0][id]')).toBe(STRIPE_ITEM_ID);
    expect(body.get('items[0][price]')).toBe('price_individual_annual');
    expect(body.get('proration_behavior')).toBe('create_prorations');

    // Persisted ONLY after the Stripe call succeeded.
    expect(state.updateCalls).toEqual([
      { where: { id: 'sub-1' }, data: { plan_tier: 'individual', billing_cycle: 'annual' } },
    ]);
  });

  test('FAIL-CLOSED: Stripe unconfigured on a REAL subscription — throws, DB is NEVER mutated, no fetch is made', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const state = wireFakeDb([realStripeSubscriptionRow()]);
    const { calls } = installScriptedFetch([{ ok: true, json: stripeSubscriptionObject() }]);

    await expect(service().changePlan('user-1', 'individual', 'annual')).rejects.toThrow(StripeConfigError);

    expect(calls).toHaveLength(0);
    expect(state.updateCalls).toHaveLength(0); // never a silent DB-only lie about a real subscription
  });

  test('FAIL-CLOSED: the target tier/cycle has no Stripe price (e.g. "free") on a REAL subscription — throws, DB unchanged, no fetch', async () => {
    const state = wireFakeDb([realStripeSubscriptionRow()]);
    const { calls } = installScriptedFetch([{ ok: true, json: stripeSubscriptionObject() }]);

    await expect(service().changePlan('user-1', 'free', 'monthly')).rejects.toThrow(/no Stripe price configured/);

    expect(calls).toHaveLength(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  test('DB-ONLY subscription (enterprise, no stripe_subscription_id): stays DB-only — NO Stripe call at all', async () => {
    const state = wireFakeDb([dbOnlyEnterpriseRow()]);
    const { calls } = installScriptedFetch([{ ok: true, json: stripeSubscriptionObject() }]);

    const result = await service().changePlan('user-1', 'individual', 'monthly');

    expect(calls).toHaveLength(0); // nothing at Stripe to reconcile for a DB-only row
    expect(result.proration.summary).toEqual(expect.any(String));
    expect(state.updateCalls).toEqual([
      { where: { id: 'sub-ent' }, data: { plan_tier: 'individual', billing_cycle: 'monthly' } },
    ]);
  });
});

describe('SubscriptionService.cancel — real Stripe subscription vs. DB-only (T-R44)', () => {
  test('REAL subscription, mode "immediate": DELETE at Stripe BEFORE persisting CANCELED', async () => {
    const state = wireFakeDb([realStripeSubscriptionRow()]);
    const { calls } = installScriptedFetch([
      { ok: true, json: stripeSubscriptionObject({ status: 'canceled', canceled_at: 1_700_100_000 }) },
    ]);

    const outcome = await service().cancel('user-1', 'immediate');

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('DELETE');
    expect(outcome.mode).toBe('immediate');
    expect(state.updateCalls).toEqual([{ where: { id: 'sub-1' }, data: { status: 'CANCELED' } }]);
  });

  test('REAL subscription, mode "end_of_period": POST cancel_at_period_end=true BEFORE persisting CANCELED', async () => {
    const state = wireFakeDb([realStripeSubscriptionRow()]);
    const { calls } = installScriptedFetch([{ ok: true, json: stripeSubscriptionObject({ cancel_at_period_end: true }) }]);

    const outcome = await service().cancel('user-1', 'end_of_period');

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    const body = new URLSearchParams(calls[0].body);
    expect(body.get('cancel_at_period_end')).toBe('true');
    expect(outcome.mode).toBe('end_of_period');
    expect(state.updateCalls).toEqual([{ where: { id: 'sub-1' }, data: { status: 'CANCELED' } }]);
  });

  test('FAIL-CLOSED: Stripe unconfigured on a REAL subscription — throws, DB is NEVER mutated, no fetch is made', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const state = wireFakeDb([realStripeSubscriptionRow()]);
    const { calls } = installScriptedFetch([{ ok: true, json: stripeSubscriptionObject() }]);

    await expect(service().cancel('user-1', 'immediate')).rejects.toThrow(StripeConfigError);

    expect(calls).toHaveLength(0);
    expect(state.updateCalls).toHaveLength(0); // Stripe keeps billing — the DB must NOT claim CANCELED
  });

  test('DB-ONLY subscription (enterprise, no stripe_subscription_id): stays DB-only — NO Stripe call at all', async () => {
    const state = wireFakeDb([dbOnlyEnterpriseRow()]);
    const { calls } = installScriptedFetch([{ ok: true, json: stripeSubscriptionObject() }]);

    const outcome = await service().cancel('user-1', 'end_of_period');

    expect(calls).toHaveLength(0);
    expect(outcome.mode).toBe('end_of_period');
    expect(state.updateCalls).toEqual([{ where: { id: 'sub-ent' }, data: { status: 'CANCELED' } }]);
  });
});

describe('IDEMPOTENCY: in-app cancel + the real customer.subscription.deleted webhook converge on ONE CANCELED, never a double-apply (T-R44)', () => {
  test('an immediate in-app cancel followed by the resulting Stripe .deleted webhook is a safe no-op the second time', async () => {
    const state = wireFakeDb([realStripeSubscriptionRow()]);
    installScriptedFetch([{ ok: true, json: stripeSubscriptionObject({ status: 'canceled', canceled_at: 1_700_100_000 }) }]);

    // 1) The in-app cancel: real DELETE at Stripe, then persists CANCELED locally.
    const outcome = await service().cancel('user-1', 'immediate');
    expect(outcome.mode).toBe('immediate');
    expect(state.subscriptions.get('sub-1')?.status).toBe('CANCELED');
    expect(state.updateCalls).toHaveLength(1);

    // 2) Stripe's own `customer.subscription.deleted` webhook for the SAME cancellation arrives
    //    later (the real, separate route/dispatch/idempotency/production-wiring path).
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const res = await deliverWebhook(subscriptionDeletedEvent('evt_del_after_inapp_cancel', 'sub_stripe_1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });
    // Still CANCELED — applying it twice never double-charges/double-applies; the second write is a
    // same-value no-op re-assertion of the terminal state, not a new outcome.
    expect(state.subscriptions.get('sub-1')?.status).toBe('CANCELED');
    expect(state.updateCalls).toHaveLength(2);
    expect(state.updateCalls[1]).toEqual({ where: { id: 'sub-1' }, data: { status: 'CANCELED' } });
  });
});
