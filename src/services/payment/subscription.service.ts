// WP10 — Subscription service (§15). Prisma-backed billing-state reads + lifecycle mutators, the
// service the billing routes + Subscription UI consume.
//
// ██ MANDATED TIER PURGE (T-47) ██
// This module previously carried the RETIRED v1.0.0 `PLAN_CONFIGS` with the void FREE/ESSENTIAL/
// PRO/ELITE tiers and their void pricing, over an in-memory store. ALL of that is DELETED. Pricing
// now comes exclusively from the three locked tiers (`tiers.ts`), and the store is the real
// `Subscription`/`Sponsorship`/`PaymentMethod` Prisma models (§15.1). There is no retired-tier enum
// and no void price anywhere in this file (qc-checklist WP10 checkpoint 1).

import { SponsorshipState, SubscriptionStatus } from '@prisma/client';

import type {
  BillingCycle,
  BillingStateView,
  PlanTier,
} from '@/types/payment';

import { resolveBillingPhase } from './entitlement';
import { resolveCancellationOutcome, type CancellationMode } from './cancellation';
import { computeProration, type ProrationPreview } from './proration';
import { LOCKED_TIERS, planCollectsPayment, priceCentsFor, stripePriceEnvVarFor } from './tiers';
import {
  STRIPE_SECRET_KEY_ENV_VAR,
  StripeConfigError,
  cancelStripeSubscription,
  isStripeConfigured,
  updateStripeSubscription,
} from './stripe-client';

/** The narrow Prisma slice this service reads/writes — DI-mockable in tests. */
export interface SubscriptionServicePrisma {
  subscription: {
    findFirst(args: {
      where: { user_id: string };
      orderBy: { created_at: 'desc' };
      select: {
        id: true;
        plan_tier: true;
        billing_cycle: true;
        status: true;
        current_period_start: true;
        current_period_end: true;
        org_sponsored: true;
        sponsor_user_id: true;
        stripe_subscription_id: true;
      };
    }): Promise<{
      id: string;
      plan_tier: string;
      billing_cycle: string;
      status: SubscriptionStatus;
      current_period_start: Date | null;
      current_period_end: Date | null;
      org_sponsored: boolean;
      sponsor_user_id: string | null;
      /** T-R44 — non-null iff this row is backed by a REAL Stripe subscription (created via
       *  `checkout.session.completed` — production-wiring.ts `onCheckoutCompleted`). Null for a
       *  DB-only subscription (free/sponsored, or enterprise's annual-invoice tier — §15.1) that
       *  never had a Stripe subscription to begin with. `changePlan`/`cancel` branch on this to
       *  decide whether a real outbound Stripe call is required before persisting. */
      stripe_subscription_id: string | null;
    } | null>;
    update(args: {
      where: { id: string };
      data: Partial<{
        plan_tier: string;
        billing_cycle: string;
        status: SubscriptionStatus;
        current_period_end: Date;
      }>;
    }): Promise<unknown>;
  };
  sponsorship: {
    findFirst(args: {
      where: { member_user_id: string; state: { in: SponsorshipState[] } };
      orderBy: { created_at: 'desc' };
      select: { state: true; term_end: true; grace_until: true; sponsor_user_id: true };
    }): Promise<{
      state: SponsorshipState;
      term_end: Date | null;
      grace_until: Date | null;
      sponsor_user_id: string;
    } | null>;
  };
  paymentMethod: {
    findFirst(args: {
      where: { user_id: string; is_default: true };
      select: { brand: true; last4: true };
    }): Promise<{ brand: string | null; last4: string | null } | null>;
  };
}

const ACTIVE_SPONSORSHIP_STATES: SponsorshipState[] = [
  'ACTIVE',
  'MEMBER_GRACE',
  'SPONSOR_LAPSED',
  'ANNIVERSARY_PENDING',
];

export class SubscriptionNotFoundError extends Error {
  constructor(userId: string) {
    super(`No subscription found for user ${userId}.`);
    this.name = 'SubscriptionNotFoundError';
  }
}

export class SubscriptionService {
  constructor(private prisma: SubscriptionServicePrisma) {}

  /**
   * The read the GET billing route + the Subscription UI consume. Assembles the honest
   * `BillingStateView` — current tier, derived phase, sponsor identity/term, and payment method as
   * brand+last4 ONLY (never a PAN — §15.7-10). A sponsored member's `payment_method` is always null
   * (no card on file — §15.1 / uiux AC-5.8-2).
   */
  async getBillingState(userId: string, nowMs: number = Date.now()): Promise<BillingStateView> {
    const [subscription, sponsorship] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          plan_tier: true,
          billing_cycle: true,
          status: true,
          current_period_start: true,
          current_period_end: true,
          org_sponsored: true,
          sponsor_user_id: true,
          stripe_subscription_id: true,
        },
      }),
      this.prisma.sponsorship.findFirst({
        where: { member_user_id: userId, state: { in: ACTIVE_SPONSORSHIP_STATES } },
        orderBy: { created_at: 'desc' },
        select: { state: true, term_end: true, grace_until: true, sponsor_user_id: true },
      }),
    ]);

    const planTier = (subscription?.plan_tier as PlanTier) ?? 'free';
    const isSponsored = subscription?.org_sponsored ?? !!sponsorship;

    // A sponsored member NEVER has a card on file — do not even query for one (§15.1 / AC-5.8-2).
    const paymentMethod = isSponsored
      ? null
      : await this.prisma.paymentMethod.findFirst({
          where: { user_id: userId, is_default: true },
          select: { brand: true, last4: true },
        });

    const phase = resolveBillingPhase(
      {
        plan_tier: planTier,
        status: subscription?.status ?? null,
        currentPeriodEndMs: subscription?.current_period_end?.getTime() ?? null,
        sponsorshipState: sponsorship?.state ?? null,
        sponsorshipGraceUntilMs: sponsorship?.grace_until?.getTime() ?? null,
      },
      nowMs
    );

    return {
      user_id: userId,
      plan_tier: planTier,
      billing_cycle: (subscription?.billing_cycle as BillingCycle) ?? null,
      status: subscription?.status ?? null,
      phase,
      current_period_end: subscription?.current_period_end?.toISOString() ?? null,
      sponsor_user_id: sponsorship?.sponsor_user_id ?? subscription?.sponsor_user_id ?? null,
      sponsorship_state: sponsorship?.state ?? null,
      sponsorship_term_end: sponsorship?.term_end?.toISOString() ?? null,
      sponsorship_grace_until: sponsorship?.grace_until?.toISOString() ?? null,
      payment_method: paymentMethod
        ? { brand: paymentMethod.brand, last4: paymentMethod.last4 }
        : null,
    };
  }

  /**
   * Preview the exact proration for a mid-cycle tier change BEFORE confirm (§15.4 / AC-5.8-7). Reads
   * the current subscription's period + price and the target tier's price. Pure computation via
   * `computeProration`.
   */
  async previewPlanChange(
    userId: string,
    toPlan: PlanTier,
    toCycle: BillingCycle,
    nowMs: number = Date.now()
  ): Promise<ProrationPreview> {
    const sub = await this.prisma.subscription.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        plan_tier: true,
        billing_cycle: true,
        status: true,
        current_period_start: true,
        current_period_end: true,
        org_sponsored: true,
        sponsor_user_id: true,
        stripe_subscription_id: true,
      },
    });
    if (!sub) throw new SubscriptionNotFoundError(userId);

    const fromPlan = sub.plan_tier as PlanTier;
    const fromCycle = (sub.billing_cycle as BillingCycle) ?? 'monthly';
    const fromCents = planCollectsPayment(fromPlan) ? priceCentsFor(fromPlan, fromCycle) : 0;
    const toCents = planCollectsPayment(toPlan) ? priceCentsFor(toPlan, toCycle) : 0;

    const startMs = sub.current_period_start?.getTime() ?? nowMs;
    const endMs = sub.current_period_end?.getTime() ?? nowMs;

    return computeProration({ fromCents, toCents, periodStartMs: startMs, periodEndMs: endMs, changeMs: nowMs });
  }

  /**
   * Record a plan change (§15.4 proration).
   *
   * T-R44 (closes a T-59 Final QC gap): a subscription with a real `stripe_subscription_id` (created
   * via Stripe Checkout — production-wiring.ts `onCheckoutCompleted`) is ACTUALLY billed at Stripe,
   * so the price swap has to happen THERE first — `updateStripeSubscription` (proration_behavior=
   * create_prorations, §15.4) — and only once Stripe confirms it do we persist the local plan_tier/
   * billing_cycle. FAIL CLOSED: if Stripe is unconfigured, has no price for the target tier/cycle, or
   * the call itself fails, this throws and the `subscription.update` below is NEVER reached — no
   * silent DB-only lie about a real Stripe subscription (the exact bug this unit closes: previously
   * this method wrote the DB unconditionally and Stripe never heard about the change at all, so it
   * kept billing the OLD price while the app showed a proration that never charged).
   *
   * A DB-only subscription (no `stripe_subscription_id` — free/sponsored, or enterprise's annual-
   * invoice tier, §15.1) has nothing to reconcile at Stripe, so it keeps the original DB-only write —
   * that branch was always correct.
   */
  async changePlan(
    userId: string,
    toPlan: PlanTier,
    toCycle: BillingCycle,
    nowMs: number = Date.now()
  ): Promise<{ proration: ProrationPreview }> {
    const proration = await this.previewPlanChange(userId, toPlan, toCycle, nowMs);
    const sub = await this.prisma.subscription.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        plan_tier: true,
        billing_cycle: true,
        status: true,
        current_period_start: true,
        current_period_end: true,
        org_sponsored: true,
        sponsor_user_id: true,
        stripe_subscription_id: true,
      },
    });
    if (!sub) throw new SubscriptionNotFoundError(userId);

    if (sub.stripe_subscription_id) {
      const priceEnvVar = stripePriceEnvVarFor(toPlan, toCycle);
      if (!priceEnvVar) {
        // The target tier/cycle is never Stripe-billed (e.g. 'free' or 'enterprise' — only
        // 'individual' monthly/annual has a locked Stripe price, §15.1). A REAL Stripe subscription
        // cannot be "updated" onto a tier Stripe has no price for; fail closed rather than silently
        // leaving Stripe billing the old price while the DB claims a different plan.
        throw new Error(
          `changePlan: plan '${toPlan}' cycle '${toCycle}' has no Stripe price configured — cannot ` +
            `update the real Stripe subscription ${sub.stripe_subscription_id} onto it (fail-closed, T-R44).`
        );
      }
      const priceId = process.env[priceEnvVar];
      if (!priceId) {
        // Fail-closed by NAME only (§0.4) — never logs/echoes a key or price id value.
        throw new StripeConfigError(priceEnvVar);
      }
      if (!isStripeConfigured()) {
        throw new StripeConfigError(STRIPE_SECRET_KEY_ENV_VAR);
      }
      // Real outbound call FIRST — only a confirmed Stripe result reaches the DB write below.
      await updateStripeSubscription({
        stripeSubscriptionId: sub.stripe_subscription_id,
        priceId,
        idempotencyKey: `billing-change:${userId}:${sub.id}:${toPlan}:${toCycle}`,
      });
    }

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { plan_tier: toPlan, billing_cycle: toCycle },
    });
    return { proration };
  }

  /**
   * Cancel (§15.4 no-dark-pattern). Default `end_of_period` honors the paid-through date; access is
   * kept until then and reactivation is possible within the retention window. Returns the outcome
   * (access-until + reactivate-until dates) for the confirmation screen.
   *
   * T-R44: exactly the same real-vs-DB-only branch as `changePlan` above. A real Stripe subscription
   * is ACTUALLY canceled at Stripe first (`cancelStripeSubscription` — `cancel_at_period_end=true` for
   * `end_of_period`, so Stripe bills nothing further but the resource stays live until the paid-
   * through date; a real `DELETE` for `immediate`); only once Stripe confirms does the local `status`
   * flip to CANCELED. FAIL CLOSED if Stripe is unconfigured or the call fails — previously this wrote
   * CANCELED to the DB unconditionally while Stripe kept auto-renewing/billing the member, exactly the
   * gap T-59 Final QC found. A DB-only subscription (no `stripe_subscription_id`) has nothing to
   * cancel at Stripe, so it keeps the original DB-only write.
   *
   * IDEMPOTENT with the `customer.subscription.deleted` webhook (production-wiring.ts
   * `onSubscriptionDeleted`): an `immediate` cancel here also triggers that terminal event at Stripe,
   * which writes the SAME status (CANCELED) to the SAME row — applying it twice is a no-op, never a
   * double-charge/double-apply. For `end_of_period`, Stripe's OWN echo of this very call is a
   * `customer.subscription.updated` event with `status: active` (the resource isn't deleted yet) —
   * `onSubscriptionUpdated` now recognizes `cancel_at_period_end: true` on that event and does NOT
   * let it reactivate the row this method just canceled (see production-wiring.ts).
   */
  async cancel(userId: string, mode: CancellationMode = 'end_of_period', nowMs: number = Date.now()) {
    const sub = await this.prisma.subscription.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        plan_tier: true,
        billing_cycle: true,
        status: true,
        current_period_start: true,
        current_period_end: true,
        org_sponsored: true,
        sponsor_user_id: true,
        stripe_subscription_id: true,
      },
    });
    if (!sub) throw new SubscriptionNotFoundError(userId);

    const outcome = resolveCancellationOutcome(mode, sub.current_period_end?.getTime() ?? null, nowMs);

    if (sub.stripe_subscription_id) {
      // Real outbound call FIRST — only a confirmed Stripe result reaches the DB write below.
      await cancelStripeSubscription({
        stripeSubscriptionId: sub.stripe_subscription_id,
        mode,
        idempotencyKey: `billing-cancel:${userId}:${sub.id}:${mode}`,
      });
    }

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SubscriptionStatus.CANCELED },
    });
    return outcome;
  }
}

/** The three locked tiers, for a UI/route that needs to render the tier cards (uiux §5.8). */
export function listLockedTiers() {
  return [LOCKED_TIERS.free, LOCKED_TIERS.individual, LOCKED_TIERS.enterprise];
}
