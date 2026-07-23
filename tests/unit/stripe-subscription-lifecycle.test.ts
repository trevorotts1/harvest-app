// T-R44 (WP10 gate remediation — T-59 Final QC money-path gap) — proves the two Stripe outbound
// calls this unit adds: `updateStripeSubscription` (mid-cycle price swap + proration, §15.4) and
// `cancelStripeSubscription` (end-of-period or immediate, §15.4). Before this unit, checkout
// (`createCheckoutSession`, mode: subscription) was the ONLY outbound Stripe call in the repo —
// `SubscriptionService.changePlan`/`.cancel` wrote the DB only, so a live Stripe subscription and
// the local DB/UI diverged once real creds existed.
//
// EXTERNAL-PAYLOAD FALSE-GREEN GUARD (harvest-external-payload-false-green lesson): every fixture
// below is Stripe's REAL, documented shape, not an invented one —
//   • Subscription object: https://docs.stripe.com/api/subscriptions/object — `id`, `status`,
//     `cancel_at_period_end`, `canceled_at`, `current_period_end`, `items` (a List of
//     SubscriptionItem), `collection_method`, `currency`, `livemode`, `metadata`, `start_date`.
//   • SubscriptionItem object: https://docs.stripe.com/api/subscription_items/object — `id` (an
//     `si_...` string), `object: 'subscription_item'`, `price`, `subscription`.
//   • Update endpoint: https://docs.stripe.com/api/subscriptions/update — the `items[]` param
//     requires an EXISTING item `id` to modify a line (vs. adding a new one), and
//     `proration_behavior` (`create_prorations` | `none` | `always_invoice`).
//   • Cancel endpoint: https://docs.stripe.com/api/subscriptions/cancel (DELETE, immediate) vs.
//     scheduling via `cancel_at_period_end=true` on update
//     (https://docs.stripe.com/billing/subscriptions/cancel).
// The regression-guard tests below prove the code reads ONLY documented fields (never a field a
// real payload lacks) and that the request bodies carry the fields §15.4 requires.

import {
  StripeConfigError,
  cancelStripeSubscription,
  updateStripeSubscription,
} from '@/services/payment/stripe-client';

const SECRET_KEY = 'sk_test_lifecycle';
const env: Record<string, string | undefined> = { STRIPE_SECRET_KEY: SECRET_KEY };

const SUB_ID = 'sub_1Abc123';
const ITEM_ID = 'si_1Item123';
const NEW_PRICE_ID = 'price_individual_annual';

/** A REAL, documented Stripe Subscription object (GET response) — one item, price not yet swapped. */
function subscriptionObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SUB_ID,
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    cancel_at_period_end: false,
    canceled_at: null,
    collection_method: 'charge_automatically',
    currency: 'usd',
    livemode: false,
    metadata: {},
    start_date: 1_694_000_000,
    items: {
      object: 'list',
      data: [
        {
          id: ITEM_ID,
          object: 'subscription_item',
          price: { id: 'price_individual_monthly', object: 'price' },
          subscription: SUB_ID,
        },
      ],
      has_more: false,
      total_count: 1,
      url: `/v1/subscription_items?subscription=${SUB_ID}`,
    },
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Records every call and answers with a scripted sequence of responses (in call order). */
function scriptedFetch(responses: Array<{ ok: boolean; status?: number; json: unknown; text?: string }>) {
  const calls: FetchCall[] = [];
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
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('updateStripeSubscription (§15.4 mid-cycle price swap + proration)', () => {
  test('retrieves the subscription (GET) to find the EXISTING item id, then POSTs the price swap with proration_behavior=create_prorations', async () => {
    const { fn, calls } = scriptedFetch([
      { ok: true, json: subscriptionObject() },
      {
        ok: true,
        json: subscriptionObject({
          items: {
            object: 'list',
            data: [{ id: ITEM_ID, object: 'subscription_item', price: { id: NEW_PRICE_ID }, subscription: SUB_ID }],
          },
        }),
      },
    ]);

    const result = await updateStripeSubscription({
      stripeSubscriptionId: SUB_ID,
      priceId: NEW_PRICE_ID,
      idempotencyKey: 'billing-change:u1:sub-row-1:individual:annual',
      env,
      fetchImpl: fn,
    });

    expect(calls).toHaveLength(2);

    // Call 1: GET the subscription — no body, Bearer auth.
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`https://api.stripe.com/v1/subscriptions/${SUB_ID}`);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${SECRET_KEY}`);

    // Call 2: POST the price swap — items[0][id] is the EXISTING item id (never a bare price add),
    // items[0][price] is the target price, proration_behavior is explicit (§15.4).
    expect(calls[1].method).toBe('POST');
    expect(calls[1].url).toBe(`https://api.stripe.com/v1/subscriptions/${SUB_ID}`);
    const body = new URLSearchParams(calls[1].body);
    expect(body.get('items[0][id]')).toBe(ITEM_ID);
    expect(body.get('items[0][price]')).toBe(NEW_PRICE_ID);
    expect(body.get('proration_behavior')).toBe('create_prorations');
    expect(calls[1].headers['Idempotency-Key']).toBe('billing-change:u1:sub-row-1:individual:annual');

    expect(result).toMatchObject({ id: SUB_ID, status: 'active' });
  });

  test('REGRESSION GUARD: a minimal real GET response (id + one item id only) is enough — no invented field is read', async () => {
    const { fn } = scriptedFetch([
      { ok: true, json: { id: SUB_ID, items: { data: [{ id: ITEM_ID }] } } },
      { ok: true, json: { id: SUB_ID, status: 'active', cancel_at_period_end: false, current_period_end: 1_702_592_000 } },
    ]);
    const result = await updateStripeSubscription({
      stripeSubscriptionId: SUB_ID,
      priceId: NEW_PRICE_ID,
      idempotencyKey: 'k1',
      env,
      fetchImpl: fn,
    });
    expect(result.id).toBe(SUB_ID);
    expect(result.cancelAtPeriodEnd).toBe(false);
    expect(result.currentPeriodEndSeconds).toBe(1_702_592_000);
  });

  test('FAIL-CLOSED: no STRIPE_SECRET_KEY — throws StripeConfigError, no fetch is ever made', async () => {
    const { fn, calls } = scriptedFetch([{ ok: true, json: subscriptionObject() }]);
    await expect(
      updateStripeSubscription({
        stripeSubscriptionId: SUB_ID,
        priceId: NEW_PRICE_ID,
        idempotencyKey: 'k1',
        env: {},
        fetchImpl: fn,
      })
    ).rejects.toThrow(StripeConfigError);
    expect(calls).toHaveLength(0);
  });

  test('a subscription with NO items (data: []) throws rather than fabricating an item id', async () => {
    const { fn } = scriptedFetch([{ ok: true, json: { id: SUB_ID, items: { data: [] } } }]);
    await expect(
      updateStripeSubscription({ stripeSubscriptionId: SUB_ID, priceId: NEW_PRICE_ID, idempotencyKey: 'k1', env, fetchImpl: fn })
    ).rejects.toThrow(/item id/);
  });

  test('a non-2xx retrieve (GET) throws and never reaches the POST', async () => {
    const { fn, calls } = scriptedFetch([{ ok: false, status: 404, json: {}, text: 'no such subscription' }]);
    await expect(
      updateStripeSubscription({ stripeSubscriptionId: SUB_ID, priceId: NEW_PRICE_ID, idempotencyKey: 'k1', env, fetchImpl: fn })
    ).rejects.toThrow(/retrieve failed \(404\)/);
    expect(calls).toHaveLength(1); // never reached the POST
  });

  test('a non-2xx update (POST) throws', async () => {
    const { fn } = scriptedFetch([
      { ok: true, json: subscriptionObject() },
      { ok: false, status: 402, json: {}, text: 'card issue' },
    ]);
    await expect(
      updateStripeSubscription({ stripeSubscriptionId: SUB_ID, priceId: NEW_PRICE_ID, idempotencyKey: 'k1', env, fetchImpl: fn })
    ).rejects.toThrow(/update failed \(402\)/);
  });
});

describe('cancelStripeSubscription (§15.4 "active → canceled (end-of-period or immediate)")', () => {
  test('end_of_period → POST cancel_at_period_end=true (subscription stays active until the period ends)', async () => {
    const { fn, calls } = scriptedFetch([
      {
        ok: true,
        json: subscriptionObject({ cancel_at_period_end: true }),
      },
    ]);
    const result = await cancelStripeSubscription({
      stripeSubscriptionId: SUB_ID,
      mode: 'end_of_period',
      idempotencyKey: 'billing-cancel:u1:sub-row-1:end_of_period',
      env,
      fetchImpl: fn,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    const body = new URLSearchParams(calls[0].body);
    expect(body.get('cancel_at_period_end')).toBe('true');
    expect(calls[0].headers['Idempotency-Key']).toBe('billing-cancel:u1:sub-row-1:end_of_period');
    // The resource is STILL `active` at Stripe — it is not deleted until the period ends.
    expect(result.status).toBe('active');
    expect(result.cancelAtPeriodEnd).toBe(true);
  });

  test('immediate → DELETE (ends billing right now)', async () => {
    const { fn, calls } = scriptedFetch([
      { ok: true, json: { id: SUB_ID, status: 'canceled', cancel_at_period_end: false, canceled_at: 1_700_100_000, current_period_end: 1_702_592_000 } },
    ]);
    const result = await cancelStripeSubscription({
      stripeSubscriptionId: SUB_ID,
      mode: 'immediate',
      idempotencyKey: 'billing-cancel:u1:sub-row-1:immediate',
      env,
      fetchImpl: fn,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].headers['Idempotency-Key']).toBe('billing-cancel:u1:sub-row-1:immediate');
    expect(result.status).toBe('canceled');
  });

  test('FAIL-CLOSED: no STRIPE_SECRET_KEY — throws StripeConfigError, no fetch is ever made', async () => {
    const { fn, calls } = scriptedFetch([{ ok: true, json: subscriptionObject() }]);
    await expect(
      cancelStripeSubscription({ stripeSubscriptionId: SUB_ID, mode: 'immediate', idempotencyKey: 'k1', env: {}, fetchImpl: fn })
    ).rejects.toThrow(StripeConfigError);
    expect(calls).toHaveLength(0);
  });

  test('a non-2xx cancel response throws', async () => {
    const { fn } = scriptedFetch([{ ok: false, status: 400, json: {}, text: 'already canceled' }]);
    await expect(
      cancelStripeSubscription({ stripeSubscriptionId: SUB_ID, mode: 'immediate', idempotencyKey: 'k1', env, fetchImpl: fn })
    ).rejects.toThrow(/cancel failed \(400\)/);
  });
});
