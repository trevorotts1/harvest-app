// WP10 — Billing lifecycle state machine + graceful-suspension contract (§15.4 / §15.7-6;
// qc-checklist WP10 checkpoint 6).
//
// "Failed payment → grace (full function + banner) → graceful soft suspension (agents wrap up
// in-flight threads, data intact, read-only Mission Control) → instant restoration; no mid-thread
// ghosting." This module is the PURE status-transition function that Stripe webhooks + the daily
// lifecycle sweep drive, PLUS the explicit agent-suspension contract WP04/WP05 consume so a
// suspension never ghosts a live conversation.

import { SubscriptionStatus } from '@prisma/client';

import type { BillingPhase } from '@/types/payment';

/** The lifecycle events that move a subscription between statuses. */
export type LifecycleEvent =
  | 'payment_failed' // Stripe invoice.payment_failed
  | 'payment_succeeded' // Stripe invoice.payment_succeeded
  | 'grace_window_elapsed' // daily sweep: PAST_DUE past its grace window
  | 'dispute_opened' // Stripe charge.dispute.created
  | 'dispute_resolved' // dispute closed in our favor
  | 'canceled' // user cancels (end-of-period or immediate)
  | 'reactivated'; // reactivation within the retention window

/**
 * The pure §15.4 transition. Returns the next status, or `null` if the event does not apply to the
 * current status (a no-op — e.g. `payment_succeeded` on an already-ACTIVE row). Fail-safe: unknown
 * combinations are no-ops, never a silent downgrade.
 *
 * Note §15.4's "active ↔ past_due", "past_due → expired", "active → canceled", "canceled → active".
 * `dispute_opened` overrides to DISPUTED from any live status (§15.5).
 */
export function nextSubscriptionStatus(
  current: SubscriptionStatus,
  event: LifecycleEvent
): SubscriptionStatus | null {
  switch (event) {
    case 'payment_failed':
      // active → past_due (enter the grace window). A DISPUTED row is not moved by a failed payment.
      return current === SubscriptionStatus.ACTIVE ? SubscriptionStatus.PAST_DUE : null;
    case 'payment_succeeded':
      // Instant restoration from past_due OR a soft-suspended (EXPIRED) row (§15.4 "instant
      // restoration on payment"). A DISPUTED row is NOT cleared by a payment — only by dispute
      // resolution.
      return current === SubscriptionStatus.PAST_DUE || current === SubscriptionStatus.EXPIRED
        ? SubscriptionStatus.ACTIVE
        : null;
    case 'grace_window_elapsed':
      // past_due → expired (soft suspension) once the grace window is over.
      return current === SubscriptionStatus.PAST_DUE ? SubscriptionStatus.EXPIRED : null;
    case 'dispute_opened':
      // Any live status → disputed (§15.5). A canceled/expired row is left as-is.
      return current === SubscriptionStatus.ACTIVE ||
        current === SubscriptionStatus.PAST_DUE
        ? SubscriptionStatus.DISPUTED
        : null;
    case 'dispute_resolved':
      return current === SubscriptionStatus.DISPUTED ? SubscriptionStatus.ACTIVE : null;
    case 'canceled':
      return current === SubscriptionStatus.ACTIVE || current === SubscriptionStatus.PAST_DUE
        ? SubscriptionStatus.CANCELED
        : null;
    case 'reactivated':
      // canceled → active (reactivation), or expired → active (restore within the retention window).
      return current === SubscriptionStatus.CANCELED || current === SubscriptionStatus.EXPIRED
        ? SubscriptionStatus.ACTIVE
        : null;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * The agent-suspension contract WP04/WP05 read so a suspension is GRACEFUL (§15.7-6 — "agents wrap
 * up in-flight threads with no mid-thread ghosting and data intact"). Given a billing phase, this
 * says exactly what the agent runtime may do:
 *   • `allowNewOutbound` — may the agents START a new outbound thread?
 *   • `allowInFlightWrapUp` — may the agents FINISH a conversation already in flight? (True in soft
 *     suspension — this is the anti-ghosting rule: never cut a live thread mid-reply.)
 *   • `readOnly` — is the surface read-only (Mission Control read-only)?
 *   • `dataIntact` — is all data preserved? (ALWAYS true — no phase destroys data.)
 */
export interface SuspensionAgentEffect {
  allowNewOutbound: boolean;
  allowInFlightWrapUp: boolean;
  readOnly: boolean;
  dataIntact: boolean;
}

export function suspensionAgentEffect(phase: BillingPhase): SuspensionAgentEffect {
  switch (phase) {
    case 'active':
    case 'grace':
    case 'member_active':
    case 'member_grace':
    case 'canceled_active_until':
      return { allowNewOutbound: true, allowInFlightWrapUp: true, readOnly: false, dataIntact: true };
    case 'disputed':
      // Outbound suspended (§15.5), but never mid-thread: in-flight threads still wrap up. Read kept.
      return { allowNewOutbound: false, allowInFlightWrapUp: true, readOnly: false, dataIntact: true };
    case 'soft_suspended':
    case 'expired':
      // Read-only Mission Control; NO new outbound; in-flight threads are allowed to finish
      // gracefully (no ghosting); data intact.
      return { allowNewOutbound: false, allowInFlightWrapUp: true, readOnly: true, dataIntact: true };
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
