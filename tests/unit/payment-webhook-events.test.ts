// WP10 (T-47) — the Stripe webhook event map (§15.5). PROVE each mapped event routes to the right
// handler with the right fields, and an unmapped event is a safe no-op; plus the chargeback handler
// (§15.7-8): DISPUTED + evidence pack from the audit trail + support alert.

import { InMemoryBillingNotificationSink } from '@/services/payment/notifications';
import {
  assembleChargebackEvidencePack,
  handleDisputeCreated,
  type AuditEvidenceRow,
  type BillingAuditReader,
  type DisputeStore,
} from '@/services/payment/chargeback';
import { dispatchStripeEvent, type StripeWebhookHandlers } from '@/services/payment/webhook-events';
import type { StripeEvent } from '@/services/payment/stripe-client';

function handlers(): StripeWebhookHandlers & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const rec = (k: string) => (args: unknown) => {
    (calls[k] ??= []).push(args);
    return Promise.resolve();
  };
  return {
    calls,
    onCheckoutCompleted: rec('checkout'),
    onPaymentSucceeded: rec('succeeded'),
    onPaymentFailed: rec('failed'),
    onSubscriptionUpdated: rec('updated'),
    onDisputeCreated: rec('dispute'),
  };
}

function evt(type: string, object: Record<string, unknown>): StripeEvent {
  return { id: `evt_${type}`, type, data: { object } };
}

describe('dispatchStripeEvent (§15.5 event map)', () => {
  test('checkout.session.completed → onCheckoutCompleted with client_reference_id + subscription', async () => {
    const h = handlers();
    const r = await dispatchStripeEvent(
      evt('checkout.session.completed', { client_reference_id: 'u1', subscription: 'sub_1', customer: 'cus_1' }),
      h
    );
    expect(r.handled).toBe(true);
    expect(h.calls.checkout[0]).toMatchObject({ userId: 'u1', stripeSubscriptionId: 'sub_1' });
  });
  test('invoice.payment_succeeded / _failed → the right handlers', async () => {
    const h = handlers();
    await dispatchStripeEvent(evt('invoice.payment_succeeded', { subscription: 'sub_1', period_end: 123 }), h);
    await dispatchStripeEvent(evt('invoice.payment_failed', { subscription: 'sub_1' }), h);
    expect(h.calls.succeeded[0]).toMatchObject({ stripeSubscriptionId: 'sub_1', periodEndSeconds: 123 });
    expect(h.calls.failed[0]).toMatchObject({ stripeSubscriptionId: 'sub_1' });
  });
  test('customer.subscription.updated → onSubscriptionUpdated', async () => {
    const h = handlers();
    await dispatchStripeEvent(evt('customer.subscription.updated', { id: 'sub_1', status: 'past_due', current_period_end: 999 }), h);
    expect(h.calls.updated[0]).toMatchObject({ stripeSubscriptionId: 'sub_1', stripeStatus: 'past_due', periodEndSeconds: 999 });
  });
  test('charge.dispute.created → onDisputeCreated with the dispute id', async () => {
    const h = handlers();
    await dispatchStripeEvent(evt('charge.dispute.created', { id: 'dp_1', charge: 'ch_1', customer: 'cus_1' }), h);
    expect(h.calls.dispute[0]).toMatchObject({ disputeId: 'dp_1' });
  });
  test('an UNMAPPED event type is a safe no-op (handled:false)', async () => {
    const h = handlers();
    const r = await dispatchStripeEvent(evt('customer.created', {}), h);
    expect(r.handled).toBe(false);
    expect(Object.keys(h.calls)).toHaveLength(0);
  });
});

describe('chargeback handling (§15.7-8)', () => {
  const entries: AuditEvidenceRow[] = [
    { id: 'a2', created_at: '2026-02-01T00:00:00Z', content_text: 'later', regulation: 'GDPR', outcome: 'RECORDED' },
    { id: 'a1', created_at: '2026-01-01T00:00:00Z', content_text: 'earlier', regulation: 'FINRA', outcome: 'RECORDED' },
  ];

  test('assembleChargebackEvidencePack orders entries and summarizes', () => {
    const pack = assembleChargebackEvidencePack('u1', 'dp_1', entries, '2026-03-01T00:00:00Z');
    expect(pack.entry_count).toBe(2);
    expect(pack.entries.map((e) => e.id)).toEqual(['a1', 'a2']); // chronological
    expect(pack.summary).toMatch(/dp_1/);
  });

  test('handleDisputeCreated → DISPUTED, evidence pack, support alert', async () => {
    const store: DisputeStore = { markSubscriptionDisputed: jest.fn().mockResolvedValue(true) };
    const reader: BillingAuditReader = { queryUserAuditEntries: jest.fn().mockResolvedValue(entries) };
    const sink = new InMemoryBillingNotificationSink();

    const result = await handleDisputeCreated({
      userId: 'u1',
      disputeId: 'dp_1',
      store,
      auditReader: reader,
      sink,
      supportUserId: 'support1',
    });

    expect(store.markSubscriptionDisputed).toHaveBeenCalledWith('u1');
    expect(result.transitioned).toBe(true);
    expect(result.evidencePack.entry_count).toBe(2);
    expect(sink.ofType('chargeback_outbound_suspended')[0].recipientUserId).toBe('support1');
  });
});
