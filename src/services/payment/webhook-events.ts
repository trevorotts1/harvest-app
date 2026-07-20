// WP10 — The Stripe webhook EVENT MAP (§15.5; qc-checklist WP10 checkpoint 7). Pure dispatcher over
// an ALREADY-VERIFIED, ALREADY-DEDUPLICATED event (signature verification is stripe-client.ts;
// idempotency is idempotency.ts; the route wires all three together). This module only decides,
// per event `type`, which handler fires and with which extracted fields — so the full event map is
// unit-testable without a live Stripe.
//
// Event map (§15.5): `checkout.session.completed`, `invoice.payment_succeeded`,
// `invoice.payment_failed`, `customer.subscription.updated`, `charge.dispute.created`.

import type { StripeEvent } from './stripe-client';

export interface CheckoutCompletedArgs {
  /** Our internal user id (Stripe `client_reference_id`). */
  userId: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
}

export interface InvoiceArgs {
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  /** Epoch seconds of the new period end, if present. */
  periodEndSeconds: number | null;
}

export interface SubscriptionUpdatedArgs {
  stripeSubscriptionId: string | null;
  /** Stripe subscription status string (e.g. `active`, `past_due`, `canceled`). */
  stripeStatus: string | null;
  periodEndSeconds: number | null;
}

export interface DisputeArgs {
  stripeChargeId: string | null;
  stripeCustomerId: string | null;
  disputeId: string;
}

/** The handlers the dispatcher calls. Production wiring backs these with Prisma + provisioner + chargeback. */
export interface StripeWebhookHandlers {
  onCheckoutCompleted(args: CheckoutCompletedArgs): Promise<void>;
  onPaymentSucceeded(args: InvoiceArgs): Promise<void>;
  onPaymentFailed(args: InvoiceArgs): Promise<void>;
  onSubscriptionUpdated(args: SubscriptionUpdatedArgs): Promise<void>;
  onDisputeCreated(args: DisputeArgs): Promise<void>;
}

function str(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

function num(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === 'number' ? v : null;
}

export interface DispatchResult {
  handled: boolean;
  type: string;
}

/**
 * Dispatch a verified+deduplicated Stripe event to the right handler. An event `type` not in the
 * §15.5 map is a safe no-op (`handled: false`) — Stripe sends many event types; only the mapped
 * ones act. Field extraction is defensive (missing fields → null) so a malformed-but-signed event
 * never throws in the dispatcher itself.
 */
export async function dispatchStripeEvent(
  event: StripeEvent,
  handlers: StripeWebhookHandlers
): Promise<DispatchResult> {
  const obj = event.data?.object ?? {};

  switch (event.type) {
    case 'checkout.session.completed':
      await handlers.onCheckoutCompleted({
        userId: str(obj, 'client_reference_id'),
        stripeSubscriptionId: str(obj, 'subscription'),
        stripeCustomerId: str(obj, 'customer'),
      });
      return { handled: true, type: event.type };

    case 'invoice.payment_succeeded':
      await handlers.onPaymentSucceeded({
        stripeSubscriptionId: str(obj, 'subscription'),
        stripeCustomerId: str(obj, 'customer'),
        periodEndSeconds: num(obj, 'period_end'),
      });
      return { handled: true, type: event.type };

    case 'invoice.payment_failed':
      await handlers.onPaymentFailed({
        stripeSubscriptionId: str(obj, 'subscription'),
        stripeCustomerId: str(obj, 'customer'),
        periodEndSeconds: num(obj, 'period_end'),
      });
      return { handled: true, type: event.type };

    case 'customer.subscription.updated':
      await handlers.onSubscriptionUpdated({
        stripeSubscriptionId: str(obj, 'id'),
        stripeStatus: str(obj, 'status'),
        periodEndSeconds: num(obj, 'current_period_end'),
      });
      return { handled: true, type: event.type };

    case 'charge.dispute.created':
      await handlers.onDisputeCreated({
        stripeChargeId: str(obj, 'charge'),
        stripeCustomerId: str(obj, 'customer'),
        disputeId: str(obj, 'id') ?? 'unknown_dispute',
      });
      return { handled: true, type: event.type };

    default:
      return { handled: false, type: event.type };
  }
}
