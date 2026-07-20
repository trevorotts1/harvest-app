// WP10 — Real-time entitlement gate (§15.1 / §15.7-3; qc-checklist WP10 checkpoint 3).
//
// "Entitlement is checked in REAL TIME on every gated route via `isFeatureAccessible(user_id,
// feature)` (status gate + tier-limit check), not only at login." This module is that function.
//
// Two layers, exactly as §15.1 states:
//   1. STATUS GATE — derives the billing PHASE (§15.4 lifecycle) from the user's live Subscription
//      status + their Sponsorship state, and decides read/write/outbound access from it. The
//      cardinal rule (§15.4): degradation is GRACEFUL and NEVER destroys data —
//        • grace (PAST_DUE, within window) & member_grace (sponsor lapse, 30-day) → FULL function;
//        • soft suspension (EXPIRED / PAST_DUE past window) → READ-ONLY (data intact);
//        • disputed (chargeback) → outbound suspended, READ retained (§15.5);
//      A sponsored member is NEVER instantly locked for their sponsor's card (§15.3) — that is the
//      `member_grace` branch, which grants full function for the protected window.
//   2. TIER-LIMIT CHECK — enterprise-only capabilities require the `enterprise` plan.
//
// Pure decision (`evaluateEntitlement` / `resolveBillingPhase`) + a Prisma-backed resolver
// (`isFeatureAccessible`). The pure layer is exhaustively unit-tested; the resolver is a thin read.

import type { SponsorshipState, SubscriptionStatus } from '@prisma/client';

import type { BillingPhase, PlanTier } from '@/types/payment';

/**
 * Payment-failure grace window (days) before soft suspension (§15.4 "grace period → soft
 * suspension"). §15.4 fixes the SPONSOR-lapse protection at 30 days (§15.3) but leaves the
 * ordinary failed-payment dunning window to the operator's retry cadence; 14 days is the documented
 * default here (a standard Stripe dunning span) and is the single place it is defined.
 */
export const PAYMENT_GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How a feature degrades under a restricted billing phase. */
export type FeatureCategory =
  /** Viewing/reading/exporting existing data — preserved in every phase except a (never-used) hard lock. */
  | 'read'
  /** Mutating app data (creating contacts, editing drafts) — preserved except soft suspension. */
  | 'write'
  /** Anything that sends OUTBOUND on the member's behalf (agent sends, messaging) — the first thing suspended. */
  | 'outbound'
  /** Enterprise-only capability (org analytics, seat-pool management) — tier-gated. */
  | 'enterprise';

/**
 * The feature registry the gate classifies against. Unknown features fail CLOSED to `outbound`
 * (the most-restricted non-enterprise category) so a new, unregistered feature name is never
 * accidentally granted in a suspended phase.
 */
export const FEATURE_CATEGORY: Readonly<Record<string, FeatureCategory>> = Object.freeze({
  mission_control_view: 'read',
  contacts_view: 'read',
  data_export: 'read',
  contacts_edit: 'write',
  draft_edit: 'write',
  agent_outbound: 'outbound',
  messaging_send: 'outbound',
  sequence_send: 'outbound',
  org_analytics: 'enterprise',
  seat_pool_management: 'enterprise',
});

export function categoryForFeature(feature: string): FeatureCategory {
  return FEATURE_CATEGORY[feature] ?? 'outbound';
}

export interface BillingSnapshot {
  plan_tier: PlanTier;
  status: SubscriptionStatus | null;
  /** Epoch ms of `current_period_end`, or null. Drives the grace/soft-suspension window and cancel access-until. */
  currentPeriodEndMs: number | null;
  /** The member's Sponsorship state, if they are a sponsored member; null for self-serve subscribers. */
  sponsorshipState: SponsorshipState | null;
  /** Epoch ms of the sponsor-lapse `grace_until`, if in MEMBER_GRACE. */
  sponsorshipGraceUntilMs: number | null;
}

export interface EntitlementDecision {
  accessible: boolean;
  phase: BillingPhase;
  /** Machine-readable reason a denial happened (for the UI's honest explainer copy). */
  reason:
    | 'ok'
    | 'soft_suspended_read_only'
    | 'disputed_outbound_suspended'
    | 'expired'
    | 'enterprise_tier_required';
}

/**
 * Resolve the billing PHASE (§15.4) from a live snapshot. A sponsored member's phase is governed by
 * their SPONSORSHIP first (member_grace protects them regardless of any subscription row); a
 * self-serve subscriber's phase is governed by their Subscription status + the grace window.
 */
export function resolveBillingPhase(snapshot: BillingSnapshot, nowMs: number): BillingPhase {
  // ── Sponsored member: sponsorship state wins (§15.3 — never punished for the sponsor's card). ──
  if (snapshot.sponsorshipState) {
    switch (snapshot.sponsorshipState) {
      case 'MEMBER_GRACE':
        // 30-day protected window: full function while `grace_until` is in the future.
        if (snapshot.sponsorshipGraceUntilMs !== null && nowMs <= snapshot.sponsorshipGraceUntilMs) {
          return 'member_grace';
        }
        // Grace window elapsed with no self-convert/re-match → soft suspension, data intact.
        return 'soft_suspended';
      case 'ACTIVE':
      case 'ANNIVERSARY_PENDING':
        // Anniversary approaching is still full function (§15.3 — notices, not a lock).
        return 'member_active';
      case 'SPONSOR_LAPSED':
        // Sponsor lapsed but the member has NOT yet been moved into the protected window — the
        // cascade sweep does that. Until then, still protected (fail-safe toward the member).
        return 'member_grace';
      case 'CONVERTED':
        // The member converted to their own paid plan — fall through to the subscription branch.
        break;
      case 'ENDED':
        return 'soft_suspended';
    }
  }

  // ── Self-serve subscriber (or a converted ex-member): subscription status + window. ──
  switch (snapshot.status) {
    case 'ACTIVE':
      return 'active';
    case 'DISPUTED':
      return 'disputed';
    case 'PAST_DUE': {
      // Within the grace window (period_end + PAYMENT_GRACE_DAYS) → full function + banner;
      // past it → soft suspension even if the lifecycle sweep hasn't flipped the row yet (the
      // gate is REAL-TIME authoritative, §15.7-3).
      const graceEndMs =
        snapshot.currentPeriodEndMs !== null
          ? snapshot.currentPeriodEndMs + PAYMENT_GRACE_DAYS * DAY_MS
          : null;
      if (graceEndMs === null || nowMs <= graceEndMs) return 'grace';
      return 'soft_suspended';
    }
    case 'CANCELED': {
      // Canceled but paid through `current_period_end` → full function until then (no dark pattern:
      // access-until is honored — §15.4 / uiux AC-5.8-6); after that → expired.
      if (snapshot.currentPeriodEndMs !== null && nowMs <= snapshot.currentPeriodEndMs) {
        return 'canceled_active_until';
      }
      return 'expired';
    }
    case 'EXPIRED':
      return 'soft_suspended';
    case null:
      // No subscription row at all → treat as expired/none (fail-closed for a paid feature).
      return 'expired';
    default: {
      const _exhaustive: never = snapshot.status;
      return _exhaustive;
    }
  }
}

/** Phases in which the member has FULL function (read + write + outbound). */
const FULL_FUNCTION_PHASES: ReadonlySet<BillingPhase> = new Set<BillingPhase>([
  'active',
  'grace',
  'member_active',
  'member_grace',
  'canceled_active_until',
]);

/**
 * The pure §15.1 gate: does `feature` (classified by category) resolve accessible in `phase`,
 * for `planTier`?
 */
export function evaluateEntitlement(
  feature: string,
  phase: BillingPhase,
  planTier: PlanTier
): EntitlementDecision {
  const category = categoryForFeature(feature);

  // TIER-LIMIT layer: enterprise-only features require the enterprise plan, in ANY phase.
  if (category === 'enterprise' && planTier !== 'enterprise') {
    return { accessible: false, phase, reason: 'enterprise_tier_required' };
  }

  // STATUS layer.
  if (FULL_FUNCTION_PHASES.has(phase)) {
    return { accessible: true, phase, reason: 'ok' };
  }

  if (phase === 'disputed') {
    // Chargeback: outbound suspended; read + write retained (§15.5 "read access maintained").
    if (category === 'outbound') {
      return { accessible: false, phase, reason: 'disputed_outbound_suspended' };
    }
    return { accessible: true, phase, reason: 'ok' };
  }

  if (phase === 'soft_suspended') {
    // Read-only Mission Control (§15.4). Reads succeed; writes and outbound are held. Data intact.
    if (category === 'read') {
      return { accessible: true, phase, reason: 'ok' };
    }
    return { accessible: false, phase, reason: 'soft_suspended_read_only' };
  }

  // expired (hard) — reads still succeed (data is never destroyed — §15.4); everything else denied.
  if (category === 'read') {
    return { accessible: true, phase, reason: 'ok' };
  }
  return { accessible: false, phase, reason: 'expired' };
}

/** The narrow Prisma slice the resolver reads — DI-mockable. */
export interface EntitlementPrismaClient {
  subscription: {
    findFirst(args: {
      where: { user_id: string };
      orderBy: { created_at: 'desc' };
      select: {
        plan_tier: true;
        status: true;
        current_period_end: true;
      };
    }): Promise<{
      plan_tier: string;
      status: SubscriptionStatus;
      current_period_end: Date | null;
    } | null>;
  };
  sponsorship: {
    findFirst(args: {
      where: { member_user_id: string; state: { in: SponsorshipState[] } };
      orderBy: { created_at: 'desc' };
      select: { state: true; grace_until: true };
    }): Promise<{ state: SponsorshipState; grace_until: Date | null } | null>;
  };
}

const ACTIVE_SPONSORSHIP_STATES: SponsorshipState[] = [
  'ACTIVE',
  'MEMBER_GRACE',
  'SPONSOR_LAPSED',
  'ANNIVERSARY_PENDING',
];

/**
 * The REAL-TIME resolver §15.7-3 requires: reads the live subscription + sponsorship for `userId`
 * and answers whether `feature` is accessible right now. Never cached at login — every gated route
 * calls this on the request path.
 */
export async function isFeatureAccessible(
  prismaClient: EntitlementPrismaClient,
  userId: string,
  feature: string,
  nowMs: number = Date.now()
): Promise<EntitlementDecision> {
  const [subscription, sponsorship] = await Promise.all([
    prismaClient.subscription.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { plan_tier: true, status: true, current_period_end: true },
    }),
    prismaClient.sponsorship.findFirst({
      where: { member_user_id: userId, state: { in: ACTIVE_SPONSORSHIP_STATES } },
      orderBy: { created_at: 'desc' },
      select: { state: true, grace_until: true },
    }),
  ]);

  const snapshot: BillingSnapshot = {
    plan_tier: (subscription?.plan_tier as PlanTier) ?? 'free',
    status: subscription?.status ?? null,
    currentPeriodEndMs: subscription?.current_period_end?.getTime() ?? null,
    sponsorshipState: sponsorship?.state ?? null,
    sponsorshipGraceUntilMs: sponsorship?.grace_until?.getTime() ?? null,
  };

  const phase = resolveBillingPhase(snapshot, nowMs);
  return evaluateEntitlement(feature, phase, snapshot.plan_tier);
}
