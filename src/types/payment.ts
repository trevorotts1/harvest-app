// WP10 — Payment & subscription types (§0.2 / §15).
//
// ██ MANDATED TIER PURGE (T-47) ██
// The retired v1.0.0 `SubscriptionTier` enum (the FREE/ESSENTIAL/PRO/ELITE labels) and all its void
// pricing that this file used to declare are DELETED. They were re-specified away by the three
// locked product decisions (§0.2): the ONLY tiers that exist are $0 sponsored / $297-mo individual /
// $25,000-yr enterprise (§15.1). A surviving retired-tier label or a void price anywhere in the tree
// is a gate failure (qc-checklist WP10 checkpoint 1; §0.4 rule 9), so this module now carries
// neither — the runtime enums are the Prisma ones, and the locked pricing lives in the single source
// of truth `src/services/payment/tiers.ts`.
//
// The old local `SubscriptionStatus` TS enum (which also carried a spurious `TRIALING` state §15
// never defines) is likewise purged; the authoritative status enum is the Prisma
// `SubscriptionStatus` (ACTIVE / PAST_DUE / CANCELED / EXPIRED / DISPUTED — prisma/schema.prisma).

import { AccessTier, SponsorshipState, SubscriptionStatus } from '@prisma/client';

export { AccessTier, SponsorshipState, SubscriptionStatus };

/**
 * The `plan_tier` code stored on `Subscription.plan_tier` (§15.1: "The `plan_tier` values in code
 * are `free | individual | enterprise` (the baseline `pro` label is retired)"). This is the code
 * name of a locked tier; the human-facing price/label live in `tiers.ts`.
 */
export type PlanTier = 'free' | 'individual' | 'enterprise';

/** `Subscription.billing_cycle`. Individual is monthly (annual option); enterprise is annual. */
export type BillingCycle = 'monthly' | 'annual';

/**
 * The lifecycle "phase" a subscriber is in (§15.4). Distinct from the persisted
 * `SubscriptionStatus` enum: `grace` and `soft_suspended` are DERIVED phases (a `PAST_DUE` row
 * within/after its grace window), and `member_grace` is derived from the member's `Sponsorship`
 * state, not their own `Subscription`. `entitlement.ts` computes this.
 */
export type BillingPhase =
  | 'active'
  | 'grace'
  | 'soft_suspended'
  | 'canceled_active_until'
  | 'expired'
  | 'disputed'
  | 'member_active'
  | 'member_grace';

/** A read-only projection of a user's current billing state, for the UI and entitlement checks. */
export interface BillingStateView {
  user_id: string;
  plan_tier: PlanTier;
  billing_cycle: BillingCycle | null;
  status: SubscriptionStatus | null;
  phase: BillingPhase;
  current_period_end: string | null;
  /** Set only for a sponsored member: their sponsor's identity + coverage end (uiux §5.8). */
  sponsor_user_id: string | null;
  sponsorship_state: SponsorshipState | null;
  sponsorship_term_end: string | null;
  sponsorship_grace_until: string | null;
  /** Payment method brand + last4 ONLY — never a PAN (§15.7-10 / SAQ-A). Null for sponsored/no-card. */
  payment_method: { brand: string | null; last4: string | null } | null;
}
