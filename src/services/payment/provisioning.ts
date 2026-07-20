// WP10 — Provisioning from the §6.7 / §15.2 AccessTier contract (qc-checklist WP10 checkpoint 2).
//
// "On `user.onboarding_completed`, WP10 provisions from `access_tier` (WP10 must not provision
// before this event)." This module is the ONLY place a subscription is provisioned from an access
// tier, and it CONSUMES THE §6.7 CONTRACT rather than re-deriving one: its input is the
// `WP10PaymentContract` produced by `projectToWP10(event)` (src/services/onboarding/wp01/
// downstream-contracts.ts) — the single source of truth for `{ user_id, access_tier }`. There is no
// parallel provisioning path.
//
// FAIL-CLOSED PRECONDITION (§15.2): before provisioning anything, it reads the user's LIVE
// `onboarding_status` and REFUSES (throws `ProvisioningNotAllowedError`) unless it is
// `GATED_COMPLETE`. This holds even if a caller fires the contract early — provisioning-before-
// onboarding is a critical-failure condition (qc-checklist WP10), so the guard is independent of
// the trigger.
//
// IDEMPOTENT: a user may have at most one ACTIVE subscription (the partial unique index in
// prisma/schema.prisma). If one already exists this returns it unchanged (`provisioned: false`) —
// so replaying the onboarding-completed event, or a Stripe `checkout.session.completed` for an
// already-provisioned user, never double-provisions (qc-checklist WP10 — "double-provision" guard).

import { AccessTier, OnboardingStatus, SubscriptionStatus, SponsorshipState } from '@prisma/client';

import type { WP10PaymentContract } from '@/types/onboarding';
import type { BillingCycle, PlanTier } from '@/types/payment';

import { LOCKED_TIERS, isSponsoredAccessTier, planTierForAccessTier } from './tiers';

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

export class ProvisioningNotAllowedError extends Error {
  constructor(userId: string, status: OnboardingStatus | null) {
    super(
      `Refusing to provision ${userId}: onboarding_status is ${status ?? 'null'}, not GATED_COMPLETE ` +
        `— WP10 must not provision before user.onboarding_completed (§15.2).`
    );
    this.name = 'ProvisioningNotAllowedError';
  }
}

export interface ProvisionedSubscription {
  id: string;
  user_id: string;
  plan_tier: string;
  status: SubscriptionStatus;
  org_sponsored: boolean;
  sponsor_user_id: string | null;
}

export interface ProvisioningResult {
  provisioned: boolean;
  subscription: ProvisionedSubscription;
}

/** The narrow Prisma slice provisioning needs — DI-mockable in tests. */
export interface ProvisioningPrismaClient {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { onboarding_status: true };
    }): Promise<{ onboarding_status: OnboardingStatus } | null>;
  };
  subscription: {
    findFirst(args: {
      where: { user_id: string; status: SubscriptionStatus };
      select: {
        id: true;
        user_id: true;
        plan_tier: true;
        status: true;
        org_sponsored: true;
        sponsor_user_id: true;
      };
    }): Promise<ProvisionedSubscription | null>;
    create(args: {
      data: {
        user_id: string;
        plan_tier: string;
        billing_cycle: string;
        status: SubscriptionStatus;
        current_period_start: Date;
        current_period_end: Date;
        org_sponsored: boolean;
        sponsor_user_id: string | null;
      };
      select: {
        id: true;
        user_id: true;
        plan_tier: true;
        status: true;
        org_sponsored: true;
        sponsor_user_id: true;
      };
    }): Promise<ProvisionedSubscription>;
  };
  sponsorship: {
    findFirst(args: {
      where: { member_user_id: string; state: SponsorshipState };
      select: { sponsor_user_id: true };
    }): Promise<{ sponsor_user_id: string } | null>;
  };
}

function periodEndFor(planTier: PlanTier, cycle: BillingCycle, startMs: number): number {
  if (planTier === 'enterprise') return startMs + YEAR_MS; // annual invoice
  if (cycle === 'annual') return startMs + YEAR_MS;
  return startMs + MONTH_MS; // individual monthly / free term tick
}

/**
 * Provision (or confirm) a subscription for the user named in the §6.7 contract.
 *
 * @param contract The `WP10PaymentContract` from `projectToWP10(event)` — `{ user_id, access_tier }`.
 */
export async function provisionFromContract(
  prisma: ProvisioningPrismaClient,
  contract: WP10PaymentContract,
  nowMs: number = Date.now()
): Promise<ProvisioningResult> {
  const { user_id, access_tier } = contract;

  // ── §15.2 FAIL-CLOSED PRECONDITION: only after user.onboarding_completed. ──
  const user = await prisma.user.findUnique({
    where: { id: user_id },
    select: { onboarding_status: true },
  });
  if (!user || user.onboarding_status !== OnboardingStatus.GATED_COMPLETE) {
    throw new ProvisioningNotAllowedError(user_id, user?.onboarding_status ?? null);
  }

  // ── IDEMPOTENT: one ACTIVE subscription per user (partial unique index). ──
  const existing = await prisma.subscription.findFirst({
    where: { user_id, status: SubscriptionStatus.ACTIVE },
    select: {
      id: true,
      user_id: true,
      plan_tier: true,
      status: true,
      org_sponsored: true,
      sponsor_user_id: true,
    },
  });
  if (existing) {
    return { provisioned: false, subscription: existing };
  }

  const planTier = planTierForAccessTier(access_tier);
  const sponsored = isSponsoredAccessTier(access_tier);
  const cycle: BillingCycle = LOCKED_TIERS[planTier].default_cycle ?? 'monthly';

  // For an org-linked sponsored member, carry the sponsor's identity from the WP01-created
  // Sponsorship (§15.3 — "on match a Sponsorship row is created"); WP10 links, never re-matches.
  let sponsorUserId: string | null = null;
  if (sponsored) {
    const sponsorship = await prisma.sponsorship.findFirst({
      where: { member_user_id: user_id, state: SponsorshipState.ACTIVE },
      select: { sponsor_user_id: true },
    });
    sponsorUserId = sponsorship?.sponsor_user_id ?? null;
  }

  const startMs = nowMs;
  const endMs = periodEndFor(planTier, cycle, startMs);

  const created = await prisma.subscription.create({
    data: {
      user_id,
      plan_tier: planTier,
      billing_cycle: cycle,
      // Free provisions ACTIVE immediately (no payment — §15.1). Paid tiers are also recorded ACTIVE
      // here keyed by access_tier (§15.2); the Stripe `checkout.session.completed` / invoice webhooks
      // are authoritative for a paid plan's real stripe id + period dates and reconcile this row.
      status: SubscriptionStatus.ACTIVE,
      current_period_start: new Date(startMs),
      current_period_end: new Date(endMs),
      // §15.1: sponsored member has NO card on file — `org_sponsored` marks that no PaymentMethod
      // is ever collected for this subscription (the UI shows no card-entry — uiux AC-5.8-2).
      org_sponsored: sponsored,
      sponsor_user_id: sponsorUserId,
    },
    select: {
      id: true,
      user_id: true,
      plan_tier: true,
      status: true,
      org_sponsored: true,
      sponsor_user_id: true,
    },
  });

  return { provisioned: true, subscription: created };
}

/** The set of access tiers that provision WITHOUT ever collecting a card (§15.1 / uiux AC-5.8-2). */
export function accessTierRequiresNoCard(accessTier: AccessTier): boolean {
  return (
    accessTier === AccessTier.FREE_ORG_LINKED || accessTier === AccessTier.FREE_PAID_EXTERNAL
  );
}
