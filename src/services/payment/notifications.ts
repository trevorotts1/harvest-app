// WP10 — Billing notifications (§15.3 / §15.4). The sponsor-lapse cascade, anniversary notices, and
// dunning all need to notify the sponsor, the member, and/or the RVP. This module defines the
// notification RECORD shape and a DI-mockable SINK — mirroring the codebase's constructor-injection
// event-sink convention (`OnboardingEventSink` in downstream-contracts.ts). The pure cascade/
// anniversary/lifecycle logic emits these records; production wiring routes them to the
// transactional email provider.
//
// DEVIATION (stated per the build brief): no live transactional-email provider is wired in this
// environment. `InMemoryBillingNotificationSink` is the reference sink the unit suite asserts
// against (proving the RIGHT recipients get the RIGHT notice at the RIGHT time); a production sink
// that fans out to the email provider is a thin adapter over this same interface.

/** Who a billing notice is addressed to (§15.3 — "notifications to sponsor, member, and RVP"). */
export type BillingRecipientRole = 'sponsor' | 'member' | 'rvp';

/** The distinct billing notices the cascade/anniversary/lifecycle emit. */
export type BillingNotificationType =
  | 'sponsor_payment_failed' // to sponsor: your card failed; your sponsored members are protected
  | 'member_sponsor_lapsed_protected' // to member: nothing changes for you for 30 days (§15.3)
  | 'rvp_sponsor_lapsed' // to RVP: a sponsor in your org lapsed
  | 'member_grace_ending' // to member: your protected window is ending; convert or re-match
  | 'anniversary_60' // 60-day advance notice (§15.3)
  | 'anniversary_30'
  | 'anniversary_7'
  | 'payment_past_due' // dunning: grace banner (§15.4)
  | 'payment_soft_suspended' // soft suspension notice
  | 'payment_restored' // instant restoration (§15.4)
  | 'chargeback_outbound_suspended'; // §15.5

export interface BillingNotification {
  type: BillingNotificationType;
  recipientRole: BillingRecipientRole;
  /** The user id the notice is delivered to. */
  recipientUserId: string;
  /** The subscription/sponsorship subject this notice is about (member for a sponsorship notice). */
  subjectUserId: string;
  /** Structured context for the template (dates, amounts brand+last4 only — NEVER a PAN, §15.7-10). */
  context?: Record<string, string | number | null>;
}

export interface BillingNotificationSink {
  notify(notification: BillingNotification): void | Promise<void>;
}

/** Reference in-memory sink for tests/local composition. */
export class InMemoryBillingNotificationSink implements BillingNotificationSink {
  readonly sent: BillingNotification[] = [];

  notify(notification: BillingNotification): void {
    this.sent.push(notification);
  }

  ofType(type: BillingNotificationType): BillingNotification[] {
    return this.sent.filter((n) => n.type === type);
  }
}
