// T-47R (WP10 gate remediation, master-spec §15.7-8 chargeback AC) — proves the chargeback
// subsystem is no longer dead scaffold. Before this fix, `handleDisputeCreated`/
// `assembleChargebackEvidencePack`/`buildDisputeStore`/`buildBillingAuditReader` (chargeback.ts)
// were fully built and unit-tested (tests/unit/payment-webhook-events.test.ts) but had ZERO
// production callers: `onDisputeCreated` in production-wiring.ts was a bare no-op, because the
// schema had no `stripe_customer_id` to resolve a `charge.dispute.created` event's customer id
// back to a subscription/user.
//
// This suite drives the REAL route (`POST /api/stripe/webhook`) — real HMAC signature
// verification (stripe-client.ts), the REAL idempotency wrapper (idempotency.ts), the REAL event
// dispatcher (webhook-events.ts), and the REAL production wiring (production-wiring.ts) — never a
// hand-built stand-in for any of those, and never calling `handleDisputeCreated` directly the way
// the existing unit test does. Only `@/lib/prisma` is mocked, at the Prisma-delegate boundary,
// exactly like tests/unit/billing-routes-auth.test.ts already does for the other webhook events.

import { createHmac } from 'node:crypto';

import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { prisma } from '@/lib/prisma';
import { POST as webhookPOST } from '@/app/api/stripe/webhook/route';
import { isFeatureAccessible } from '@/services/payment/entitlement';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const SECRET = 'whsec_chargeback_live_path';

function sign(payload: string, t: number): string {
  const sig = createHmac('sha256', SECRET).update(`${t}.${payload}`, 'utf8').digest('hex');
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

function checkoutCompletedEvent(eventId: string, userId: string, stripeSubscriptionId: string, stripeCustomerId: string) {
  return JSON.stringify({
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: userId, subscription: stripeSubscriptionId, customer: stripeCustomerId } },
  });
}

function disputeCreatedEvent(eventId: string, disputeId: string, chargeId: string, stripeCustomerId: string | null) {
  return JSON.stringify({
    id: eventId,
    type: 'charge.dispute.created',
    data: { object: { id: disputeId, charge: chargeId, customer: stripeCustomerId } },
  });
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

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  jest.restoreAllMocks();
});

describe('chargeback: the full live path, through the REAL route + REAL production wiring', () => {
  test('checkout persists stripe_customer_id → a later dispute resolves it → DISPUTED, outbound suspended, read retained, evidence pack assembled', async () => {
    const state = wireFakeDb([activeSubscription()]);
    state.auditRows.push(
      auditRow('ae-1', 1, 'user-1', '2026-02-01T00:00:00Z'),
      auditRow('ae-2', 2, 'user-1', '2026-02-02T00:00:00Z')
    );
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // 1) checkout.session.completed — the live path's ONLY write of stripe_customer_id.
    const checkoutRes = await deliver(
      checkoutCompletedEvent('evt_checkout_1', 'user-1', 'sub_stripe_1', 'cus_1')
    );
    expect(checkoutRes.status).toBe(200);
    expect((await checkoutRes.json()).handled).toBe(true);
    expect(state.subscriptions.get('sub-1')).toMatchObject({
      stripe_subscription_id: 'sub_stripe_1',
      stripe_customer_id: 'cus_1',
      status: 'ACTIVE',
    });

    // 2) charge.dispute.created for that SAME Stripe customer id — the event Stripe actually sends
    // (no user id, no subscription id — only charge + customer).
    const disputeRes = await deliver(disputeCreatedEvent('evt_dispute_1', 'dp_1', 'ch_1', 'cus_1'));
    expect(disputeRes.status).toBe(200);
    expect((await disputeRes.json()).handled).toBe(true);

    // DISPUTED is now the LIVE, persisted status — resolved purely from stripe_customer_id.
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
    // reading the SAME now-DISPUTED row this webhook just persisted. This is the proof the fix
    // reaches all the way to the entitlement layer, not just the Subscription row.
    const outboundDecision = await isFeatureAccessible(db, 'user-1', 'agent_outbound');
    expect(outboundDecision).toEqual({
      accessible: false,
      phase: 'disputed',
      reason: 'disputed_outbound_suspended',
    });
    const readDecision = await isFeatureAccessible(db, 'user-1', 'contacts_view');
    expect(readDecision).toEqual({ accessible: true, phase: 'disputed', reason: 'ok' });
  });

  test('idempotency: a REPLAYED charge.dispute.created event is deduplicated — no double transition, no double alert', async () => {
    const state = wireFakeDb([
      activeSubscription({ stripe_customer_id: 'cus_2', status: 'ACTIVE' }),
    ]);
    state.auditRows.push(auditRow('ae-3', 1, 'user-1', '2026-02-01T00:00:00Z'));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const payload = disputeCreatedEvent('evt_dispute_replay', 'dp_2', 'ch_2', 'cus_2');

    const first = await deliver(payload);
    expect(first.status).toBe(200);
    expect((await first.json())).toMatchObject({ received: true, handled: true });
    expect(state.subscriptions.get('sub-1')?.status).toBe('DISPUTED');
    expect(state.updateCalls).toHaveLength(1);
    const notifyCallsAfterFirst = logSpy.mock.calls.filter(([tag]) => tag === '[billing-notification]');
    expect(notifyCallsAfterFirst).toHaveLength(1);

    // Exact same Stripe event id delivered again (Stripe's own retry/replay semantics).
    const replay = await deliver(payload);
    expect(replay.status).toBe(200);
    expect((await replay.json())).toMatchObject({ received: true, deduplicated: true });

    // No second status transition, no second alert — the claim-first idempotency wrapper (already
    // proven at the unit level in idempotency.ts's own suite) reaches all the way through the real
    // dispute path.
    expect(state.updateCalls).toHaveLength(1);
    const notifyCallsAfterReplay = logSpy.mock.calls.filter(([tag]) => tag === '[billing-notification]');
    expect(notifyCallsAfterReplay).toHaveLength(1);
  });

  test('fails SAFE for an unresolvable dispute (unknown Stripe customer id): logged loudly, no crash, no mutation of any unrelated subscription', async () => {
    const state = wireFakeDb([activeSubscription({ stripe_customer_id: 'cus_known' })]);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const res = await deliver(disputeCreatedEvent('evt_dispute_unknown', 'dp_unresolvable', 'ch_9', 'cus_never_seen'));

    // No crash: the route still returns its normal success shape, not a 500 — an unresolvable
    // dispute is a business-logic dead end, not a thrown error, so it never triggers an endless
    // Stripe retry storm over an id that will never resolve.
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ received: true, handled: true });

    // But it is NEVER silently swallowed: a loud, distinctly-tagged log line records exactly which
    // dispute/customer could not be resolved, so a genuinely resolvable dispute that lands here due
    // to a bug is observable rather than hidden.
    expect(errorSpy).toHaveBeenCalledWith(
      '[chargeback-unresolved]',
      expect.stringContaining('cus_never_seen')
    );
    const [, payload] = errorSpy.mock.calls.find(([tag]) => tag === '[chargeback-unresolved]')!;
    expect(JSON.parse(payload as string)).toMatchObject({
      disputeId: 'dp_unresolvable',
      stripeCustomerId: 'cus_never_seen',
      reason: 'no_subscription_for_stripe_customer_id',
    });

    // The one unrelated, resolvable subscription in the table is untouched — the fail-safe path
    // never guesses/falls back to some other row.
    expect(state.subscriptions.get('sub-1')?.status).toBe('ACTIVE');
    expect(state.updateCalls).toHaveLength(0);
    // No chargeback support alert either — nothing to alert on for an unidentified user.
    expect(logSpy.mock.calls.filter(([tag]) => tag === '[billing-notification]')).toHaveLength(0);
  });

  test('fails SAFE when the dispute event itself carries no Stripe customer id at all', async () => {
    const state = wireFakeDb([activeSubscription()]);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deliver(disputeCreatedEvent('evt_dispute_no_customer', 'dp_no_customer', 'ch_10', null));

    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      '[chargeback-unresolved]',
      expect.stringContaining('dispute_event_missing_stripe_customer_id')
    );
    expect(state.subscriptions.get('sub-1')?.status).toBe('ACTIVE');
    expect(state.updateCalls).toHaveLength(0);
  });
});
