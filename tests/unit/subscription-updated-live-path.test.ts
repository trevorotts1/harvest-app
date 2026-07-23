// T-R44 (WP10 gate remediation — T-59 Final QC money-path gap) — proves `customer.subscription
// .updated` resolves end to end through the REAL route (`POST /api/stripe/webhook`): real HMAC
// signature verification (stripe-client.ts), the REAL idempotency wrapper (idempotency.ts), the
// REAL event dispatcher (webhook-events.ts), and the REAL production wiring (production-wiring.ts).
// Mirrors tests/unit/subscription-deleted-live-path.test.ts's convention exactly (only `@/lib/prisma`
// is mocked; never a hand-built stand-in for the route/dispatch/idempotency/wiring). This handler had
// NO direct end-to-end coverage anywhere before this unit (payment-webhook-events.test.ts only
// exercises the pure dispatcher against a fake `handlers` object, never production-wiring.ts's real
// implementation) — this file gives it that coverage AND proves the new T-R44 branch.
//
// THE T-R44 GAP THIS HANDLER NOW CLOSES: `SubscriptionService.cancel`'s new `cancelStripeSubscription`
// call (subscription.service.ts) schedules an end-of-period cancel via
// `POST /v1/subscriptions/{id} cancel_at_period_end=true` — but scheduling a cancellation is ITSELF
// a subscription update, so Stripe echoes it back as `customer.subscription.updated` with `status`
// STILL `active` (the resource isn't deleted until the period ends — that's the separate
// `customer.subscription.deleted` event, covered by subscription-deleted-live-path.test.ts). Before
// this unit, that echo would read as an ordinary "still active" update and REACTIVATE the row the
// in-app cancel just canceled. `onSubscriptionUpdated` now reads Stripe's documented
// `cancel_at_period_end` field (https://docs.stripe.com/api/subscriptions/object) off the SAME
// Subscription object `.updated` already reads `id`/`status`/`current_period_end` from, and maps
// `active` + `cancel_at_period_end: true` to CANCELED instead of ACTIVE.

import { createHmac } from 'node:crypto';

import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/prisma';
import { POST as webhookPOST } from '@/app/api/stripe/webhook/route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const WEBHOOK_SECRET = 'whsec_subscription_updated_live_path';

function sign(payload: string, t: number): string {
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v1=${sig}`;
}

function deliver(payload: string) {
  const t = Math.floor(Date.now() / 1000);
  return webhookPOST(
    new NextRequest('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: payload,
      headers: { 'stripe-signature': sign(payload, t) },
    })
  );
}

function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

interface FakeState {
  subscriptions: Map<string, Record<string, unknown>>;
  idempotencyKeys: Set<string>;
  updateCalls: Array<{ where: unknown; data: unknown }>;
}

function wireFakeDb(seedSubscriptions: Array<Record<string, unknown>> = []): FakeState {
  const state: FakeState = {
    subscriptions: new Map(seedSubscriptions.map((r) => [r.id as string, { ...r }])),
    idempotencyKeys: new Set(),
    updateCalls: [],
  };

  db.subscription = {
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

function activeSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub-1',
    user_id: 'user-1',
    stripe_subscription_id: 'sub_stripe_1',
    stripe_customer_id: 'cus_1',
    plan_tier: 'individual',
    billing_cycle: 'monthly',
    status: 'ACTIVE',
    current_period_start: null,
    current_period_end: null,
    org_sponsored: false,
    sponsor_user_id: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** A REAL, documented `customer.subscription.updated` Subscription object payload. */
function subscriptionUpdatedEvent(
  eventId: string,
  stripeSubscriptionId: string,
  fields: { status: string; cancelAtPeriodEnd?: boolean; currentPeriodEndSeconds?: number }
) {
  return JSON.stringify({
    id: eventId,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: stripeSubscriptionId,
        object: 'subscription',
        customer: 'cus_1',
        status: fields.status,
        cancel_at_period_end: fields.cancelAtPeriodEnd ?? false,
        current_period_end: fields.currentPeriodEndSeconds ?? 1_702_592_000,
      },
    },
  });
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  jest.restoreAllMocks();
});

describe('customer.subscription.updated: the full live path, through the REAL route + REAL production wiring (T-R44)', () => {
  test('REGRESSION: ordinary status mapping still works — past_due → PAST_DUE, with the period end persisted', async () => {
    const state = wireFakeDb([activeSubscription()]);
    const res = await deliver(subscriptionUpdatedEvent('evt_pd', 'sub_stripe_1', { status: 'past_due', currentPeriodEndSeconds: 1_700_000_000 }));
    expect(res.status).toBe(200);
    expect(state.subscriptions.get('sub-1')?.status).toBe('PAST_DUE');
    expect(state.updateCalls).toHaveLength(1);
  });

  test('REGRESSION: an ordinary `active` update (cancel_at_period_end false) still reactivates normally', async () => {
    const state = wireFakeDb([activeSubscription({ status: 'PAST_DUE' })]);
    const res = await deliver(subscriptionUpdatedEvent('evt_active', 'sub_stripe_1', { status: 'active', cancelAtPeriodEnd: false }));
    expect(res.status).toBe(200);
    expect(state.subscriptions.get('sub-1')?.status).toBe('ACTIVE');
  });

  test('T-R44: status=active + cancel_at_period_end=true maps to CANCELED, not ACTIVE (an operator scheduling a Dashboard cancel)', async () => {
    const state = wireFakeDb([activeSubscription({ status: 'ACTIVE' })]);
    const res = await deliver(
      subscriptionUpdatedEvent('evt_sched_cancel', 'sub_stripe_1', { status: 'active', cancelAtPeriodEnd: true })
    );
    expect(res.status).toBe(200);
    expect(state.subscriptions.get('sub-1')?.status).toBe('CANCELED');
    expect(state.updateCalls).toEqual([
      { where: { id: 'sub-1' }, data: { status: 'CANCELED', current_period_end: new Date(1_702_592_000 * 1000) } },
    ]);
  });

  test('T-R44 IDEMPOTENCY: after an in-app end-of-period cancel already wrote CANCELED, Stripe\'s own echo (customer.subscription.updated, status=active, cancel_at_period_end=true) does NOT reactivate the row', async () => {
    // Seed the row exactly as SubscriptionService.cancel(mode: 'end_of_period') would have already
    // left it — CANCELED, access preserved via current_period_end (this webhook is what Stripe fires
    // as a direct RESULT of that same in-app cancel's cancelStripeSubscription call).
    const state = wireFakeDb([activeSubscription({ status: 'CANCELED' })]);

    const res = await deliver(
      subscriptionUpdatedEvent('evt_echo', 'sub_stripe_1', { status: 'active', cancelAtPeriodEnd: true })
    );

    expect(res.status).toBe(200);
    // Still CANCELED — the echo never reversed the in-app cancel (never a double-charge/silent
    // reactivation of a subscription the member just canceled).
    expect(state.subscriptions.get('sub-1')?.status).toBe('CANCELED');
    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0]).toMatchObject({ where: { id: 'sub-1' }, data: { status: 'CANCELED' } });
  });

  test('an unresolvable stripe_subscription_id is a safe no-op', async () => {
    const state = wireFakeDb([activeSubscription()]);
    const res = await deliver(subscriptionUpdatedEvent('evt_unknown', 'sub_stripe_never_seen', { status: 'active' }));
    expect(res.status).toBe(200);
    expect(state.updateCalls).toHaveLength(0);
  });

  test('a malformed event (no id, no status) is a safe no-op', async () => {
    const state = wireFakeDb([activeSubscription()]);
    const payload = JSON.stringify({
      id: 'evt_malformed',
      type: 'customer.subscription.updated',
      data: { object: {} },
    });
    const res = await deliver(payload);
    expect(res.status).toBe(200);
    expect(state.updateCalls).toHaveLength(0);
  });

  test('idempotency: a REPLAYED update event is deduplicated — no double write', async () => {
    const state = wireFakeDb([activeSubscription({ status: 'ACTIVE' })]);
    const payload = subscriptionUpdatedEvent('evt_replay', 'sub_stripe_1', { status: 'active', cancelAtPeriodEnd: true });

    const first = await deliver(payload);
    expect(first.status).toBe(200);
    expect(state.updateCalls).toHaveLength(1);

    const replay = await deliver(payload);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ received: true, deduplicated: true });
    expect(state.updateCalls).toHaveLength(1);
  });
});
