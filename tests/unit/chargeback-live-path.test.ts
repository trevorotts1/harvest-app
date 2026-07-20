// T-47R2 (WP10 gate remediation, master-spec §15.7-8 chargeback AC) — proves the chargeback
// subsystem resolves a REAL `charge.dispute.created` event end to end.
//
// WHY ROUND 1 (T-47R) FAILED — FALSE GREEN: the previous version of this suite FABRICATED a
// `customer` field on the Stripe Dispute object and read it directly. Stripe's real Dispute object
// carries NO top-level `customer` — only bare `charge` / `payment_intent` id strings. So the old
// `onDisputeCreated` (which read `dispute.customer`) early-returned on EVERY genuine dispute, and
// the test's fabricated payload masked that with a shape Stripe never emits.
//
// THIS suite uses the REALISTIC payload (no `customer`), MOCKS the Stripe charge-retrieval REST
// fetch, and drives the REAL route (`POST /api/stripe/webhook`) — real HMAC signature verification
// (stripe-client.ts), the REAL idempotency wrapper (idempotency.ts), the REAL event dispatcher
// (webhook-events.ts), and the REAL production wiring (production-wiring.ts). Only `@/lib/prisma`
// and the global `fetch` (the Stripe API boundary) are mocked — never a hand-built stand-in for the
// route/dispatch/idempotency/wiring, and never calling `handleDisputeCreated` directly.

import { createHmac } from 'node:crypto';

import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/prisma';
import { POST as webhookPOST } from '@/app/api/stripe/webhook/route';
import { isFeatureAccessible } from '@/services/payment/entitlement';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const WEBHOOK_SECRET = 'whsec_chargeback_live_path';
const STRIPE_SECRET_KEY = 'sk_test_chargeback_live_path';
const ORIGINAL_FETCH = global.fetch;

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

// ── The Stripe charge-retrieval fetch mock (GET /v1/charges/{id}) ───────────────────────────────
// production-wiring.ts `onDisputeCreated` calls `retrieveStripeCharge`, which fetches the charge to
// read `charge.customer` (the Dispute object never carries it). We stub that ONE outbound call.
type ChargeResult =
  | { ok: true; body: { id: string; customer: string | null } }
  | { ok: false; status: number; body: string }
  | Error;

function installChargeFetch(responder: (chargeId: string) => ChargeResult): jest.Mock {
  const marker = '/charges/';
  const fn = jest.fn(async (input: unknown) => {
    const url = String(input);
    const chargeId = decodeURIComponent(url.slice(url.indexOf(marker) + marker.length));
    const r = responder(chargeId);
    if (r instanceof Error) throw r;
    if (r.ok) {
      return {
        ok: true,
        status: 200,
        json: async () => r.body,
        text: async () => JSON.stringify(r.body),
      } as unknown as Response;
    }
    return {
      ok: false,
      status: r.status,
      json: async () => ({}),
      text: async () => r.body,
    } as unknown as Response;
  });
  (global as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn as unknown as jest.Mock;
}

function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

interface FakeState {
  subscriptions: Map<string, Record<string, unknown>>;
  auditRows: Array<Record<string, unknown>>;
  idempotencyKeys: Set<string>;
  updateCalls: Array<{ where: unknown; data: unknown }>;
}

/** Wires an in-memory stand-in for every Prisma delegate the real chargeback live path reads:
 *  `subscription` (production-wiring.ts + entitlement.ts), `sponsorship` (entitlement.ts, always
 *  empty here — these are self-serve, non-sponsored subscribers), `auditEntry`
 *  (PrismaAuditRepository, read by buildBillingAuditReader), and `idempotencyLog` (the real
 *  claim-first dedup, idempotency.ts) — the SAME fake-delegate convention
 *  tests/unit/billing-routes-auth.test.ts and tests/unit/production-wiring.test.ts already use. */
function wireFakeDb(seedSubscriptions: Array<Record<string, unknown>> = []): FakeState {
  const state: FakeState = {
    subscriptions: new Map(seedSubscriptions.map((r) => [r.id as string, { ...r }])),
    auditRows: [],
    idempotencyKeys: new Set(),
    updateCalls: [],
  };
  let n = state.subscriptions.size;

  db.subscription = {
    findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { created_at?: string } }) => {
      let rows = Array.from(state.subscriptions.values()).filter((r) => matchWhere(r, where));
      if (orderBy?.created_at === 'desc') {
        rows = rows.sort((a, b) => (b.created_at as Date).getTime() - (a.created_at as Date).getTime());
      }
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
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `sub-${++n}`, created_at: new Date(), ...data };
      state.subscriptions.set(row.id, row);
      return { ...row };
    },
  };

  db.sponsorship = { findFirst: async () => null };

  db.auditEntry = {
    findMany: async ({ where }: { where: { user_id?: string } }) =>
      state.auditRows
        .filter((r) => !where.user_id || r.user_id === where.user_id)
        .sort((a, b) => (a.sequence as number) - (b.sequence as number)),
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

function auditRow(id: string, sequence: number, userId: string, isoDate: string): Record<string, unknown> {
  return {
    id,
    sequence,
    user_id: userId,
    content_hash: `hash-${id}`,
    risk_score: 1,
    outcome: 'RECORDED',
    classifier_data: {},
    role: 'REP',
    created_at: new Date(isoDate),
    prev_hash: null,
    entry_hash: `entryhash-${id}`,
    content_id: null,
    content_text: `audit entry ${id}`,
    channel: null,
    rule_version: 'v1',
    regulation: ['GDPR'],
    reviewer_id: null,
    reviewer_action: null,
  };
}

function activeSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub-1',
    user_id: 'user-1',
    stripe_subscription_id: null,
    stripe_customer_id: null,
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

function checkoutCompletedEvent(eventId: string, userId: string, stripeSubscriptionId: string, stripeCustomerId: string) {
  return JSON.stringify({
    id: eventId,
    type: 'checkout.session.completed',
    // A checkout session genuinely DOES carry `customer` — this is real, and the only live write of
    // `stripe_customer_id` (onCheckoutCompleted). The dispute event below does NOT carry it.
    data: { object: { client_reference_id: userId, subscription: stripeSubscriptionId, customer: stripeCustomerId } },
  });
}

/**
 * A REALISTIC `charge.dispute.created` payload — the shape Stripe actually emits. Top-level fields
 * per Stripe's Dispute object: id, object, charge (BARE id), payment_intent (BARE id), status,
 * reason, … There is DELIBERATELY NO `customer` field: customer identity is reachable only by
 * retrieving the `charge` (or `payment_intent`) from the Stripe API. (Round 1 fabricated a
 * `customer` here — the regression guard test below asserts this payload never regrows it.)
 */
function disputeCreatedEvent(eventId: string, disputeId: string, chargeId: string, paymentIntentId = 'pi_realistic') {
  return JSON.stringify({
    id: eventId,
    type: 'charge.dispute.created',
    data: {
      object: {
        id: disputeId,
        object: 'dispute',
        charge: chargeId,
        payment_intent: paymentIntentId,
        status: 'warning_needs_response',
        reason: 'fraudulent',
      },
    },
  });
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_SECRET_KEY;
  (global as unknown as { fetch: typeof fetch }).fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

describe('chargeback: the full live path, through the REAL route + REAL production wiring', () => {
  test('REGRESSION GUARD: the charge.dispute.created payload has NO `customer` field (round-1 fabricated one)', () => {
    const parsed = JSON.parse(disputeCreatedEvent('evt', 'dp', 'ch_x', 'pi_x'));
    const obj = parsed.data.object as Record<string, unknown>;
    // The proof that this suite tests REALITY, not the shape Stripe never sends.
    expect(obj).not.toHaveProperty('customer');
    // Customer identity is reachable ONLY via these bare id strings → a charge retrieval.
    expect(obj.charge).toBe('ch_x');
    expect(obj.payment_intent).toBe('pi_x');
  });

  test('checkout persists stripe_customer_id → a real dispute (no customer field) resolves it via CHARGE RETRIEVAL → DISPUTED, outbound suspended, read retained, evidence pack assembled', async () => {
    const state = wireFakeDb([activeSubscription()]);
    state.auditRows.push(
      auditRow('ae-1', 1, 'user-1', '2026-02-01T00:00:00Z'),
      auditRow('ae-2', 2, 'user-1', '2026-02-02T00:00:00Z')
    );
    // The Stripe charge retrieval is what actually yields the customer id (cus_1) for charge ch_1.
    const fetchMock = installChargeFetch((chargeId) =>
      chargeId === 'ch_1' ? { ok: true, body: { id: 'ch_1', customer: 'cus_1' } } : { ok: false, status: 404, body: 'no charge' }
    );
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // 1) checkout.session.completed — the live path's ONLY write of stripe_customer_id.
    const checkoutRes = await deliver(checkoutCompletedEvent('evt_checkout_1', 'user-1', 'sub_stripe_1', 'cus_1'));
    expect(checkoutRes.status).toBe(200);
    expect((await checkoutRes.json()).handled).toBe(true);
    expect(state.subscriptions.get('sub-1')).toMatchObject({
      stripe_subscription_id: 'sub_stripe_1',
      stripe_customer_id: 'cus_1',
      status: 'ACTIVE',
    });
    // Checkout does not hit the Stripe charges API.
    expect(fetchMock).not.toHaveBeenCalled();

    // 2) charge.dispute.created — the event Stripe ACTUALLY sends: bare charge id, NO customer.
    const disputePayload = disputeCreatedEvent('evt_dispute_1', 'dp_1', 'ch_1');
    expect(JSON.parse(disputePayload).data.object).not.toHaveProperty('customer');
    const disputeRes = await deliver(disputePayload);
    expect(disputeRes.status).toBe(200);
    expect((await disputeRes.json()).handled).toBe(true);

    // The customer was resolved by RETRIEVING the charge from Stripe (GET /v1/charges/ch_1), then
    // mapping charge.customer → the subscription's stripe_customer_id → user.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/charges/ch_1');

    // DISPUTED is now the LIVE, persisted status — resolved via the charge, not a fabricated field.
    expect(state.subscriptions.get('sub-1')?.status).toBe('DISPUTED');

    // The support alert fired with the REAL evidence pack (assembled from the REAL audit reader
    // reading the seeded audit rows) — never a fabricated/empty pack.
    const notifyCalls = logSpy.mock.calls.filter(([tag]) => tag === '[billing-notification]');
    expect(notifyCalls).toHaveLength(1);
    const notification = JSON.parse(notifyCalls[0][1] as string);
    expect(notification).toMatchObject({
      type: 'chargeback_outbound_suspended',
      subjectUserId: 'user-1',
      context: { dispute_id: 'dp_1', evidence_entries: 2 },
    });

    // Outbound suspended, READ retained (§15.5) — through the REAL, UNTOUCHED entitlement gate,
    // reading the SAME now-DISPUTED row this webhook just persisted.
    const outboundDecision = await isFeatureAccessible(db, 'user-1', 'agent_outbound');
    expect(outboundDecision).toEqual({
      accessible: false,
      phase: 'disputed',
      reason: 'disputed_outbound_suspended',
    });
    const readDecision = await isFeatureAccessible(db, 'user-1', 'contacts_view');
    expect(readDecision).toEqual({ accessible: true, phase: 'disputed', reason: 'ok' });
  });

  test('idempotency: a REPLAYED charge.dispute.created event is deduplicated — no double transition, no double alert, no double charge retrieval', async () => {
    const state = wireFakeDb([activeSubscription({ stripe_customer_id: 'cus_2', status: 'ACTIVE' })]);
    state.auditRows.push(auditRow('ae-3', 1, 'user-1', '2026-02-01T00:00:00Z'));
    const fetchMock = installChargeFetch(() => ({ ok: true, body: { id: 'ch_2', customer: 'cus_2' } }));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const payload = disputeCreatedEvent('evt_dispute_replay', 'dp_2', 'ch_2');

    const first = await deliver(payload);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, handled: true });
    expect(state.subscriptions.get('sub-1')?.status).toBe('DISPUTED');
    expect(state.updateCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.filter(([tag]) => tag === '[billing-notification]')).toHaveLength(1);

    // Exact same Stripe event id delivered again (Stripe's own retry/replay semantics).
    const replay = await deliver(payload);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ received: true, deduplicated: true });

    // No second transition, no second alert, and — crucially — no second call to the Stripe API:
    // the claim-first idempotency wrapper short-circuits BEFORE dispatch reaches onDisputeCreated.
    expect(state.updateCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.filter(([tag]) => tag === '[billing-notification]')).toHaveLength(1);
  });

  test('FAIL-SAFE (a): the retrieved charge has NO customer → logged loudly, no crash, subscription untouched, event RETRIABLE', async () => {
    const state = wireFakeDb([activeSubscription({ stripe_customer_id: 'cus_a' })]);
    installChargeFetch(() => ({ ok: true, body: { id: 'ch_a', customer: null } }));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const res = await deliver(disputeCreatedEvent('evt_dispute_null_cus', 'dp_null_cus', 'ch_a'));

    // The user was never resolved → NOT marked done: 500 so the idempotency claim is released and
    // Stripe retries (and it surfaces for manual review), rather than being silently buried.
    expect(res.status).toBe(500);
    expect(state.idempotencyKeys.size).toBe(0); // claim RELEASED → retriable
    expect(errorSpy).toHaveBeenCalledWith('[chargeback-unresolved]', expect.stringContaining('charge_has_no_customer'));
    const [, payload] = errorSpy.mock.calls.find(([tag]) => tag === '[chargeback-unresolved]')!;
    expect(JSON.parse(payload as string)).toMatchObject({ disputeId: 'dp_null_cus', chargeId: 'ch_a', reason: 'charge_has_no_customer' });

    // Nothing mutated, nobody alerted.
    expect(state.subscriptions.get('sub-1')?.status).toBe('ACTIVE');
    expect(state.updateCalls).toHaveLength(0);
    expect(logSpy.mock.calls.filter(([tag]) => tag === '[billing-notification]')).toHaveLength(0);
  });

  test('FAIL-SAFE (b): charge retrieval returns HTTP 500 → logged loudly, no crash, RETRIABLE — and a later retry with a healthy API resolves it', async () => {
    const state = wireFakeDb([activeSubscription({ stripe_customer_id: 'cus_b' })]);
    state.auditRows.push(auditRow('ae-b', 1, 'user-1', '2026-02-01T00:00:00Z'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // First attempt: Stripe API is down (HTTP 500).
    installChargeFetch(() => ({ ok: false, status: 500, body: 'stripe down' }));
    const payload = disputeCreatedEvent('evt_dispute_http500', 'dp_http500', 'ch_b');

    const failed = await deliver(payload);
    expect(failed.status).toBe(500);
    expect(state.idempotencyKeys.size).toBe(0); // claim RELEASED → Stripe will retry
    expect(errorSpy).toHaveBeenCalledWith('[chargeback-unresolved]', expect.stringContaining('charge_retrieval_failed'));
    expect(state.subscriptions.get('sub-1')?.status).toBe('ACTIVE');
    expect(state.updateCalls).toHaveLength(0);

    // Retry (SAME event id) once the API recovers → now resolves and DISPUTED sticks. Proves the
    // failed attempt left the event genuinely retriable, not marked done.
    installChargeFetch(() => ({ ok: true, body: { id: 'ch_b', customer: 'cus_b' } }));
    const retried = await deliver(payload);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ received: true, handled: true });
    expect(state.subscriptions.get('sub-1')?.status).toBe('DISPUTED');
    expect(logSpy.mock.calls.filter(([tag]) => tag === '[billing-notification]')).toHaveLength(1);
  });

  test('FAIL-SAFE (b2): charge retrieval THROWS a network error → logged loudly, no crash, RETRIABLE', async () => {
    const state = wireFakeDb([activeSubscription({ stripe_customer_id: 'cus_net' })]);
    installChargeFetch(() => new Error('ECONNRESET'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver(disputeCreatedEvent('evt_dispute_net', 'dp_net', 'ch_net'));

    expect(res.status).toBe(500);
    expect(state.idempotencyKeys.size).toBe(0); // retriable
    expect(errorSpy).toHaveBeenCalledWith('[chargeback-unresolved]', expect.stringContaining('charge_retrieval_failed'));
    expect(state.subscriptions.get('sub-1')?.status).toBe('ACTIVE');
    expect(state.updateCalls).toHaveLength(0);
  });

  test('FAIL-SAFE (c): customer resolved but NO subscription carries it → logged fail-safe, DEAD-END (200, marked done), no unrelated row touched', async () => {
    const state = wireFakeDb([activeSubscription({ stripe_customer_id: 'cus_known' })]);
    installChargeFetch(() => ({ ok: true, body: { id: 'ch_c', customer: 'cus_never_seen' } }));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const res = await deliver(disputeCreatedEvent('evt_dispute_unknown', 'dp_unresolvable', 'ch_c'));

    // The customer WAS resolved (cus_never_seen) but no row carries it — retrying can never change
    // that, so it is a dead end: 200, marked done (no retry storm), but LOGGED LOUDLY for review.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true });
    expect(state.idempotencyKeys.size).toBe(1); // claim KEPT → not retriable (dead end)
    expect(errorSpy).toHaveBeenCalledWith('[chargeback-unresolved]', expect.stringContaining('cus_never_seen'));
    const [, payload] = errorSpy.mock.calls.find(([tag]) => tag === '[chargeback-unresolved]')!;
    expect(JSON.parse(payload as string)).toMatchObject({
      disputeId: 'dp_unresolvable',
      chargeId: 'ch_c',
      stripeCustomerId: 'cus_never_seen',
      reason: 'no_subscription_for_stripe_customer_id',
    });

    // The one unrelated, resolvable subscription is untouched — the fail-safe never guesses a row.
    expect(state.subscriptions.get('sub-1')?.status).toBe('ACTIVE');
    expect(state.updateCalls).toHaveLength(0);
    expect(logSpy.mock.calls.filter(([tag]) => tag === '[billing-notification]')).toHaveLength(0);
  });

  test('FAIL-SAFE (d): Stripe secret key absent → FAIL-CLOSED, logged loudly, no charge retrieval attempted, RETRIABLE', async () => {
    const state = wireFakeDb([activeSubscription({ stripe_customer_id: 'cus_d' })]);
    // The webhook secret stays set (signature must still verify) — only the API key is missing.
    delete process.env.STRIPE_SECRET_KEY;
    const fetchMock = installChargeFetch(() => ({ ok: true, body: { id: 'ch_d', customer: 'cus_d' } }));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver(disputeCreatedEvent('evt_dispute_nokey', 'dp_nokey', 'ch_d'));

    // Fail-closed: readStripeSecret throws BEFORE any fetch — never fakes a customer.
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.idempotencyKeys.size).toBe(0); // released → retriable once the key is configured
    expect(errorSpy).toHaveBeenCalledWith('[chargeback-unresolved]', expect.stringContaining('stripe_not_configured'));
    const [, payload] = errorSpy.mock.calls.find(([tag]) => tag === '[chargeback-unresolved]')!;
    expect(JSON.parse(payload as string)).toMatchObject({ disputeId: 'dp_nokey', chargeId: 'ch_d', reason: 'stripe_not_configured' });
    expect(state.subscriptions.get('sub-1')?.status).toBe('ACTIVE');
    expect(state.updateCalls).toHaveLength(0);
  });
});
