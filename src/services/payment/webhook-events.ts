// WP10 — The Stripe webhook EVENT MAP (§15.5; qc-checklist WP10 checkpoint 7). Pure dispatcher over
// an ALREADY-VERIFIED, ALREADY-DEDUPLICATED event (signature verification is stripe-client.ts;
// idempotency is idempotency.ts; the route wires all three together). This module only decides,
// per event `type`, which handler fires and with which extracted fields — so the full event map is
// unit-testable without a live Stripe.
//
// Event map (§15.5): `checkout.session.completed`, `invoice.payment_succeeded`,
// `invoice.payment_failed`, `customer.subscription.updated`, `charge.dispute.created`,
// `customer.subscription.deleted` (T-R41 — closes the gap where a Stripe-dashboard/API-terminal
// cancellation never reached us; the in-app cancel flow already writes CANCELED directly via
// SubscriptionService.cancel, but a subscription deleted from Stripe's side — dashboard, API, or
// Stripe's own dunning giving up — previously fell through to the default no-op).

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
  /**
   * T-R44 — Stripe's documented `cancel_at_period_end` boolean on the SAME Subscription object
   * `.updated` already reads `id`/`status`/`current_period_end` off
   * (https://docs.stripe.com/api/subscriptions/object: "cancel_at_period_end boolean — If the
   * subscription has been canceled with the `at_period_end` flag set to true, `cancel_at_period_end`
   * on the subscription will be true."). Scheduling an end-of-period cancel — whether via
   * `SubscriptionService.cancel`'s new `cancelStripeSubscription` call, or an operator cancelling
   * directly in the Stripe Dashboard — is itself a subscription UPDATE, so Stripe fires
   * `customer.subscription.updated` for it with `status` still `active` (the resource is not
   * actually deleted until the period ends — that terminal moment is `customer.subscription.deleted`,
   * already handled by `onSubscriptionDeleted`). Without this field, that echo event would read as an
   * ordinary "still active" update and could reactivate a row an in-app cancel just canceled — see
   * production-wiring.ts's `onSubscriptionUpdated`.
   */
  cancelAtPeriodEnd: boolean | null;
}

export interface DisputeArgs {
  /** The disputed charge's id — a BARE id string on the Dispute object. Resolves the customer. */
  stripeChargeId: string | null;
  /** The disputed PaymentIntent id — also a bare id string; an alternate resolution path. */
  stripePaymentIntentId: string | null;
  disputeId: string;
}

/**
 * T-R41 — `customer.subscription.deleted`. Stripe's Subscription object (the SAME object shape
 * `customer.subscription.updated` above already reads `id`/`status`/`current_period_end` off) is
 * the `data.object` on this event too — Stripe documents ONE Subscription resource shared by both
 * the `.updated` and `.deleted` subscription events (https://docs.stripe.com/api/subscriptions/object,
 * https://docs.stripe.com/api/events/types#event_types-customer.subscription.deleted). Only `id`
 * is read here — the bare Stripe subscription id string, always present — which is all
 * `onSubscriptionDeleted` needs to look the row up by `stripe_subscription_id` and cancel it. No
 * invented field: this is a strict subset of the fields `SubscriptionUpdatedArgs` above already
 * reads from the identical object shape.
 */
export interface SubscriptionDeletedArgs {
  stripeSubscriptionId: string | null;
}

/** The handlers the dispatcher calls. Production wiring backs these with Prisma + provisioner + chargeback. */
export interface StripeWebhookHandlers {
  onCheckoutCompleted(args: CheckoutCompletedArgs): Promise<void>;
  onPaymentSucceeded(args: InvoiceArgs): Promise<void>;
  onPaymentFailed(args: InvoiceArgs): Promise<void>;
  onSubscriptionUpdated(args: SubscriptionUpdatedArgs): Promise<void>;
  onDisputeCreated(args: DisputeArgs): Promise<void>;
  /** T-R41 — `customer.subscription.deleted` (Stripe-side terminal cancellation). */
  onSubscriptionDeleted(args: SubscriptionDeletedArgs): Promise<void>;
}

function str(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

function num(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === 'number' ? v : null;
}

function bool(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  return typeof v === 'boolean' ? v : null;
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
        cancelAtPeriodEnd: bool(obj, 'cancel_at_period_end'),
      });
      return { handled: true, type: event.type };

    case 'customer.subscription.deleted':
      // T-R41. Reads only `id` — the bare Stripe subscription id string every real Subscription
      // object carries (see the SubscriptionDeletedArgs doc comment above for the Stripe-schema
      // citation). Deliberately does NOT read `status` here: unlike `customer.subscription.updated`
      // (where the status can be `active`/`past_due`/`canceled`/`unpaid` and the handler maps it),
      // a `.deleted` event's own existence IS the terminal signal — the subscription resource no
      // longer exists — so the handler always cancels; there is no other status this event could
      // rationally map to.
      await handlers.onSubscriptionDeleted({ stripeSubscriptionId: str(obj, 'id') });
      return { handled: true, type: event.type };

    case 'charge.dispute.created':
      // The Stripe Dispute object has NO top-level `customer` field — only bare `charge` /
      // `payment_intent` id strings. Customer identity is resolved downstream by RETRIEVING the
      // charge from the Stripe API (production-wiring.ts `onDisputeCreated`). Reading `customer`
      // here (as the original T-47R fix did) is always null on a real event — that was the bug.
      await handlers.onDisputeCreated({
        stripeChargeId: str(obj, 'charge'),
        stripePaymentIntentId: str(obj, 'payment_intent'),
        disputeId: str(obj, 'id') ?? 'unknown_dispute',
      });
      return { handled: true, type: event.type };

    default:
      return { handled: false, type: event.type };
  }
}
