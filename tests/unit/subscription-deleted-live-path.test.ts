// T-R41 (mid-cycle plan change/proration + Stripe webhook gap close) — proves the
// `customer.subscription.deleted` handler resolves end to end through the REAL route
// (`POST /api/stripe/webhook`): real HMAC signature verification (stripe-client.ts), the REAL
// idempotency wrapper (idempotency.ts), the REAL event dispatcher (webhook-events.ts), and the
// REAL production wiring (production-wiring.ts) — mirroring
// tests/unit/chargeback-live-path.test.ts's convention (only `@/lib/prisma` is mocked; never a
// hand-built stand-in for the route/dispatch/idempotency/wiring).
//
// EXTERNAL-PAYLOAD FALSE-GREEN GUARD (harvest-external-payload-false-green lesson): the payload
// below is Stripe's REAL, documented Subscription object shape — the SAME resource
// `customer.subscription.updated` already carries (Stripe exposes exactly one Subscription object
// across both the `.updated` and `.deleted` subscription events —
// https://docs.stripe.com/api/subscriptions/object,
// https://docs.stripe.com/api/events/types#event_types-customer.subscription.deleted). It is NOT a
// fabricated shape invented to make the handler pass — every field on it (`id`, `object`,
// `customer`, `status`, `current_period_end`, `canceled_at`, `cancel_at_period_end`, `items`, …) is
// a real, documented Subscription field. The regression-guard test below proves the handler
// persists CANCELED from a MINIMAL payload carrying ONLY the fields the handler is documented to
// read (`id`) — proving it never silently depends on a field a real terminal `.deleted` event
// might omit or that this suite happened to include only for realism.

import { createHmac } from 'node:crypto';

import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/prisma';
import { POST as webhookPOST } from '@/app/api/stripe/webhook/route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const WEBHOOK_SECRET = 'whsec_subscription_deleted_live_path';

function sign(payload: string, t: number): string {
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v1=${sig}`;
}

/** POSTs a correctly-signed webhook payload through the REAL route handler. */
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

/** Same fake-delegate convention as chargeback-live-path.test.ts / billing-routes-auth.test.ts. */
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

/**
 * A MINIMAL real `customer.subscription.deleted` payload — carries ONLY the field the handler is
 * documented to read (`id`). Proves the handler never depends on `status`/`customer`/anything else.
 */
function minimalSubscriptionDeletedEvent(eventId: string, stripeSubscriptionId: string) {
  return JSON.stringify({
    id: eventId,
    type: 'customer.subscription.deleted',
    data: { object: { id: stripeSubscriptionId } },
  });
}

/**
 * A FULL, realistic `customer.subscription.deleted` payload — every field Stripe's documented
 * Subscription object actually carries on a terminal-deleted event (a strict superset of the
 * minimal payload above). Used to prove the extra, real-but-unread fields never change the outcome.
 */
function fullSubscriptionDeletedEvent(eventId: string, stripeSubscriptionId: string, stripeCustomerId: string) {
  return JSON.stringify({
    id: eventId,
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: stripeSubscriptionId,
        object: 'subscription',
        customer: stripeCustomerId,
        status: 'canceled',
        cancel_at_period_end: false,
        canceled_at: 1_700_100_000,
        cancellation_details: { comment: null, feedback: null, reason: 'cancellation_requested' },
        current_period_start: 1_697_000_000,
        current_period_end: 1_700_000_000,
        collection_method: 'charge_automatically',
        currency: 'usd',
        items: { object: 'list', data: [], has_more: false, total_count: 0, url: '/v1/subscription_items' },
        livemode: false,
        metadata: {},
        start_date: 1_694_000_000,
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

describe('customer.subscription.deleted: the full live path, through the REAL route + REAL production wiring (T-R41)', () => {
  test('REGRESSION GUARD: a minimal real payload (id only) is enough — the handler never reads status/customer/etc.', async () => {
    const state = wireFakeDb([activeSubscription()]);

    const res = await deliver(minimalSubscriptionDeletedEvent('evt_del_minimal', 'sub_stripe_1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });
    expect(state.subscriptions.get('sub-1')?.status).toBe('CANCELED');
    expect(state.updateCalls).toEqual([{ where: { id: 'sub-1' }, data: { status: 'CANCELED' } }]);
  });

  test('a FULL realistic payload (every real Subscription field) persists CANCELED identically', async () => {
    const state = wireFakeDb([activeSubscription({ id: 'sub-2', stripe_subscription_id: 'sub_stripe_2' })]);

    const res = await deliver(fullSubscriptionDeletedEvent('evt_del_full', 'sub_stripe_2', 'cus_1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });
    expect(state.subscriptions.get('sub-2')?.status).toBe('CANCELED');
    expect(state.updateCalls).toEqual([{ where: { id: 'sub-2' }, data: { status: 'CANCELED' } }]);
  });

  test('CANCELED sticks REGARDLESS of the row\'s prior phase (PAST_DUE, DISPUTED, EXPIRED) — Stripe deletion is terminal', async () => {
    for (const priorStatus of ['ACTIVE', 'PAST_DUE', 'DISPUTED', 'EXPIRED']) {
      const state = wireFakeDb([activeSubscription({ status: priorStatus })]);
      const res = await deliver(minimalSubscriptionDeletedEvent(`evt_del_${priorStatus}`, 'sub_stripe_1'));
      expect(res.status).toBe(200);
      expect(state.subscriptions.get('sub-1')?.status).toBe('CANCELED');
    }
  });

  test('idempotency: a REPLAYED customer.subscription.deleted event is deduplicated — no double update', async () => {
    const state = wireFakeDb([activeSubscription()]);
    const payload = minimalSubscriptionDeletedEvent('evt_del_replay', 'sub_stripe_1');

    const first = await deliver(payload);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, handled: true });
    expect(state.subscriptions.get('sub-1')?.status).toBe('CANCELED');
    expect(state.updateCalls).toHaveLength(1);

    // Exact same Stripe event id delivered again (Stripe's own retry/replay semantics).
    const replay = await deliver(payload);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ received: true, deduplicated: true });

    // No second write — the claim-first idempotency wrapper short-circuits BEFORE dispatch reaches
    // onSubscriptionDeleted a second time.
    expect(state.updateCalls).toHaveLength(1);
  });

  test('an unresolvable stripe_subscription_id (no matching row) is a safe no-op — never throws, never touches an unrelated row', async () => {
    const state = wireFakeDb([activeSubscription()]);

    const res = await deliver(minimalSubscriptionDeletedEvent('evt_del_unknown', 'sub_stripe_never_seen'));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });
    expect(state.subscriptions.get('sub-1')?.status).toBe('ACTIVE'); // untouched
    expect(state.updateCalls).toHaveLength(0);
  });

  test('a malformed event carrying no subscription id at all is a safe no-op', async () => {
    const state = wireFakeDb([activeSubscription()]);
    const payload = JSON.stringify({
      id: 'evt_del_no_id',
      type: 'customer.subscription.deleted',
      data: { object: {} },
    });

    const res = await deliver(payload);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });
    expect(state.updateCalls).toHaveLength(0);
  });
});
