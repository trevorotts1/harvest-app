// WP10 — The THREE LOCKED TIERS (§0.2 decision 1; §15.1 table). SINGLE SOURCE OF TRUTH for pricing.
//
// Every price string that renders in the app or is charged through Stripe derives from THIS table
// and no other. There are EXACTLY three tiers and no fourth may ever exist (qc-checklist WP10
// checkpoint 1; uiux AC-5.8-1). The retired v1.0.0 FREE/ESSENTIAL/PRO/ELITE tiers and their void
// pricing are purged (see src/types/payment.ts header) — the codes here are the §15.1-locked
// `free | individual | enterprise`.
//
// Cross-checked against WP01's `ACCESS_TIER_PRICE_CENTS` (src/services/onboarding/wp01/
// access-tier.ts): a compile-time + unit-test assertion (tiers.test.ts) proves the two tables agree
// on the locked cents, so there is exactly ONE pricing truth spanning the WP01→WP10 seam.

import { AccessTier } from '@prisma/client';

import type { BillingCycle, PlanTier } from '@/types/payment';

export interface TierPricing {
  /** Price in integer cents for this billing cycle, or `null` if the cycle doesn't apply. */
  monthly_cents: number | null;
  annual_cents: number | null;
}

export interface LockedTier {
  plan_tier: PlanTier;
  /** Human-facing tier name (uiux §5.8 card title). VOCAB-safe (§0.5). */
  display_name: string;
  /** The single price line the card renders (uiux §5.8 — "shown as its real total — no asterisks"). */
  price_line: string;
  pricing: TierPricing;
  /** The default (and, for free/enterprise, only) billing cycle this tier bills on. */
  default_cycle: BillingCycle | null;
  /** Whether a card/checkout is ever collected for this tier (free = never — SAQ-A / uiux AC-5.8-2). */
  collects_payment: boolean;
}

/**
 * The locked tiers. `price_line` strings are the EXACT copy uiux §5.8 mandates — "$0 to you",
 * "$297 / month", "$25,000 / year" — no other price string exists in the product (§15.7-1).
 */
export const LOCKED_TIERS: Readonly<Record<PlanTier, LockedTier>> = Object.freeze({
  free: {
    plan_tier: 'free',
    display_name: 'Sponsored',
    price_line: '$0 to you',
    pricing: { monthly_cents: 0, annual_cents: 0 },
    default_cycle: null,
    collects_payment: false,
  },
  individual: {
    plan_tier: 'individual',
    display_name: 'Individual',
    // §15.1: "$297 / month (monthly; annual option at a discount)". The annual line is the real
    // total (12 × $297 = $3,564), NOT a smaller "per month billed annually" figure — uiux §5.8:
    // "annual option, discounted, shown as its real total — no asterisks". No discount is invented
    // here beyond what pricing config will carry; the monthly figure is the locked headline.
    price_line: '$297 / month',
    pricing: { monthly_cents: 29_700, annual_cents: 356_400 },
    default_cycle: 'monthly',
    collects_payment: true,
  },
  enterprise: {
    plan_tier: 'enterprise',
    display_name: 'Enterprise',
    price_line: '$25,000 / year',
    pricing: { monthly_cents: null, annual_cents: 2_500_000 },
    default_cycle: 'annual',
    collects_payment: true,
  },
});

/** The three plan-tier codes, frozen — anything asking "what tiers exist" reads this, never a literal. */
export const ALL_PLAN_TIERS: readonly PlanTier[] = Object.freeze(['free', 'individual', 'enterprise']);

/**
 * The §15.2 / §6.7 mapping from the WP01-assigned `AccessTier` to the WP10 `plan_tier` a
 * subscription is provisioned on. `FREE_ORG_LINKED` and `FREE_PAID_EXTERNAL` both provision the
 * `free` plan (the difference — org-subsidized vs. self-serve-with-upsell — is carried by
 * `Subscription.org_sponsored` + the `Sponsorship` row, not a distinct tier). `PAID_INDIVIDUAL` →
 * `individual`; `ENTERPRISE` → `enterprise`.
 */
export function planTierForAccessTier(accessTier: AccessTier): PlanTier {
  switch (accessTier) {
    case AccessTier.FREE_ORG_LINKED:
    case AccessTier.FREE_PAID_EXTERNAL:
      return 'free';
    case AccessTier.PAID_INDIVIDUAL:
      return 'individual';
    case AccessTier.ENTERPRISE:
      return 'enterprise';
    default: {
      const _exhaustive: never = accessTier;
      throw new Error(`planTierForAccessTier: unknown access tier ${String(_exhaustive)}`);
    }
  }
}

/** True iff this access tier is one of the two sponsored/free provisioning paths (§15.1). */
export function isSponsoredAccessTier(accessTier: AccessTier): boolean {
  return accessTier === AccessTier.FREE_ORG_LINKED;
}

/** Whether a plan bills a recurring charge (individual/enterprise) — free never does (§15.1). */
export function planCollectsPayment(planTier: PlanTier): boolean {
  return LOCKED_TIERS[planTier].collects_payment;
}

/** The charge amount in cents for a plan on a given cycle. Throws for an unsupported cycle/plan combo. */
export function priceCentsFor(planTier: PlanTier, cycle: BillingCycle): number {
  const pricing = LOCKED_TIERS[planTier].pricing;
  const cents = cycle === 'monthly' ? pricing.monthly_cents : pricing.annual_cents;
  if (cents === null) {
    throw new Error(`priceCentsFor: plan '${planTier}' does not support billing cycle '${cycle}'`);
  }
  return cents;
}

/**
 * §15.5 — the Stripe Price id ENV VAR NAMES (never the id itself — §0.4 "by name") for the
 * tier/cycle combinations Stripe actually bills through a REAL recurring subscription. `individual`
 * (monthly/annual) is the ONLY one: enterprise is an annual invoice, not a Stripe subscription
 * (§15.1 "Annual invoice; custom onboarding"), and free never collects payment at all. This is the
 * single source of truth both the checkout route (`/api/billing/checkout`, creating the
 * subscription) and a REAL Stripe subscription's mid-cycle price swap
 * (`subscription.service.ts`'s `changePlan`, T-R44, updating it) read from — previously the
 * checkout route alone held this mapping as a private, unexported constant.
 */
const STRIPE_PRICE_ENV_BY_PLAN_CYCLE: Readonly<
  Partial<Record<PlanTier, Readonly<Partial<Record<BillingCycle, string>>>>>
> = Object.freeze({
  individual: Object.freeze({
    monthly: 'STRIPE_PRICE_INDIVIDUAL_MONTHLY',
    annual: 'STRIPE_PRICE_INDIVIDUAL_ANNUAL',
  }),
});

/**
 * The env var NAME (never the id) carrying the Stripe Price for `planTier`/`cycle`, or `null` if
 * that combination is never Stripe-billed (free never collects payment; enterprise is an annual
 * invoice, not a Stripe subscription — §15.1). A `null` return is the signal a caller must fail
 * closed on rather than guess/invent a price id.
 */
export function stripePriceEnvVarFor(planTier: PlanTier, cycle: BillingCycle): string | null {
  return STRIPE_PRICE_ENV_BY_PLAN_CYCLE[planTier]?.[cycle] ?? null;
}
