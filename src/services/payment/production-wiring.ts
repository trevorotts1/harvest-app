// WP10 — Production wiring (§15). Assembles the REAL Prisma-backed stores + handlers the routes and
// Inngest cron use. Mirrors src/services/messaging/send/production-wiring.ts: everything is
// constructed LAZILY, per call, so a key-less/DB-less `next build` never constructs a Prisma client
// or reads a secret at module scope (build-safety / invariant #2). Most of the pure logic modules
// are tested directly with mocks and never need this file — but T-47R adds
// tests/unit/chargeback-live-path.test.ts, which DOES import `buildStripeWebhookHandlers` /
// `buildDisputeStore` / `buildBillingAuditReader` directly (with `@/lib/prisma` module-mocked) to
// prove the chargeback path end to end through this REAL composition root, not just the
// unit-tested `handleDisputeCreated` helper in isolation.

import { SponsorshipState, SubscriptionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { PrismaAuditRepository } from '@/services/compliance/audit/audit-service';

import { handleDisputeCreated } from './chargeback';
import type { BillingAuditReader, AuditEvidenceRow, DisputeStore } from './chargeback';
import type { BillingNotification, BillingNotificationSink } from './notifications';
import { nextSubscriptionStatus } from './billing-lifecycle';
import type {
  SponsorCascadeStore,
  LapsedSponsorMembership,
  MemberGraceMembership,
  AnniversaryApproaching,
  MemberTransitionStore,
} from './sponsor-cascade';
import { anniversaryThresholdCrossed } from './sponsor-cascade';
import { retrieveStripeCharge, StripeConfigError } from './stripe-client';
import type { StripeWebhookHandlers } from './webhook-events';

const DAY_MS = 24 * 60 * 60 * 1000;

// The sponsor statuses that count as "lapsed" for the cascade (§15.3 — "if the sponsor's own
// payment fails"): any non-ACTIVE live/terminal billing state.
const LAPSED_SPONSOR_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.EXPIRED,
  SubscriptionStatus.DISPUTED,
  SubscriptionStatus.CANCELED,
];

// ─── Notification sink (production) ──────────────────────────────────────────────────────────────
// DEVIATION (stated in the build report): no live transactional-email provider is wired in this
// environment (§15.4 dunning "runs on the transactional email provider"). This sink emits a
// structured log record per notice — a thin adapter to swap for the real provider. It carries only
// brand+last4-safe context (never a PAN — §15.7-10).
export function buildProductionNotificationSink(): BillingNotificationSink {
  return {
    notify(n: BillingNotification): void {
      // eslint-disable-next-line no-console
      console.log('[billing-notification]', JSON.stringify(n));
    },
  };
}

// ─── Sponsor-cascade store (Prisma) ─────────────────────────────────────────────────────────────

export class PrismaSponsorCascadeStore implements SponsorCascadeStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private db: any = prisma) {}

  async findLapsedSponsorMemberships(): Promise<LapsedSponsorMembership[]> {
    // Sponsors whose own subscription is lapsed.
    const lapsedSubs = await this.db.subscription.findMany({
      where: { status: { in: LAPSED_SPONSOR_STATUSES } },
      select: { user_id: true },
    });
    const sponsorIds: string[] = Array.from(new Set(lapsedSubs.map((s: { user_id: string }) => s.user_id)));
    if (sponsorIds.length === 0) return [];

    // Their still-ACTIVE sponsorships (members not yet protected).
    const sponsorships = await this.db.sponsorship.findMany({
      where: { sponsor_user_id: { in: sponsorIds }, state: SponsorshipState.ACTIVE },
      select: {
        id: true,
        member_user_id: true,
        sponsor_user_id: true,
        organization_id: true,
      },
    });

    const out: LapsedSponsorMembership[] = [];
    for (const s of sponsorships) {
      const rvp = await this.db.user.findFirst({
        where: { organization_id: s.organization_id, role: 'RVP' },
        select: { id: true },
      });
      out.push({
        sponsorshipId: s.id,
        memberUserId: s.member_user_id,
        sponsorUserId: s.sponsor_user_id,
        organizationId: s.organization_id,
        rvpUserId: rvp?.id ?? null,
      });
    }
    return out;
  }

  async moveMemberToGrace(sponsorshipId: string, graceUntil: Date): Promise<void> {
    await this.db.sponsorship.update({
      where: { id: sponsorshipId },
      data: { state: SponsorshipState.MEMBER_GRACE, grace_until: graceUntil },
    });
  }

  async findMemberGraceMemberships(): Promise<MemberGraceMembership[]> {
    const rows = await this.db.sponsorship.findMany({
      where: { state: SponsorshipState.MEMBER_GRACE },
      select: { id: true, member_user_id: true, sponsor_user_id: true, grace_until: true },
    });
    return rows.map(
      (r: { id: string; member_user_id: string; sponsor_user_id: string; grace_until: Date | null }) => ({
        sponsorshipId: r.id,
        memberUserId: r.member_user_id,
        sponsorUserId: r.sponsor_user_id,
        graceUntilMs: r.grace_until?.getTime() ?? 0,
      })
    );
  }

  async endSponsorship(sponsorshipId: string): Promise<void> {
    await this.db.sponsorship.update({
      where: { id: sponsorshipId },
      data: { state: SponsorshipState.ENDED },
    });
  }

  async findAnniversaryApproaching(nowMs: number): Promise<AnniversaryApproaching[]> {
    const horizon = new Date(nowMs + 60 * DAY_MS);
    const rows = await this.db.sponsorship.findMany({
      where: {
        state: { in: [SponsorshipState.ACTIVE, SponsorshipState.ANNIVERSARY_PENDING] },
        term_end: { lte: horizon, gte: new Date(nowMs) },
      },
      select: { id: true, member_user_id: true, sponsor_user_id: true, term_end: true, state: true },
    });
    const out: AnniversaryApproaching[] = [];
    for (const r of rows as Array<{
      id: string;
      member_user_id: string;
      sponsor_user_id: string;
      term_end: Date | null;
      state: SponsorshipState;
    }>) {
      if (!r.term_end) continue;
      const threshold = anniversaryThresholdCrossed(r.term_end.getTime(), nowMs);
      if (threshold === null) continue;
      out.push({
        sponsorshipId: r.id,
        memberUserId: r.member_user_id,
        sponsorUserId: r.sponsor_user_id,
        termEndMs: r.term_end.getTime(),
        daysOut: threshold,
        alreadyPending: r.state === SponsorshipState.ANNIVERSARY_PENDING,
      });
    }
    return out;
  }

  async markAnniversaryPending(sponsorshipId: string): Promise<void> {
    await this.db.sponsorship.update({
      where: { id: sponsorshipId },
      data: { state: SponsorshipState.ANNIVERSARY_PENDING },
    });
  }
}

// ─── Billing-lifecycle sweep store: PAST_DUE past grace → EXPIRED (soft suspension) ──────────────

export class PrismaLifecycleSweepStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private db: any = prisma, private graceDays = 14) {}

  /** Move PAST_DUE subscriptions whose grace window elapsed to EXPIRED (soft suspension, §15.4). */
  async expireElapsedGrace(nowMs: number = Date.now()): Promise<{ expired: number }> {
    const cutoff = new Date(nowMs - this.graceDays * DAY_MS);
    const rows = await this.db.subscription.findMany({
      where: { status: SubscriptionStatus.PAST_DUE, current_period_end: { lt: cutoff } },
      select: { id: true, status: true },
    });
    let expired = 0;
    for (const r of rows as Array<{ id: string; status: SubscriptionStatus }>) {
      const next = nextSubscriptionStatus(r.status, 'grace_window_elapsed');
      if (next) {
        await this.db.subscription.update({ where: { id: r.id }, data: { status: next } });
        expired += 1;
      }
    }
    return { expired };
  }
}

// ─── Member self-convert / re-match transition store (Prisma) ────────────────────────────────────

export function buildMemberTransitionStore(): MemberTransitionStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  return {
    async findMemberSponsorshipId(memberUserId, states) {
      const row = await db.sponsorship.findFirst({
        where: { member_user_id: memberUserId, state: { in: states } },
        orderBy: { created_at: 'desc' },
        select: { id: true },
      });
      return row?.id ?? null;
    },
    async markSponsorshipConverted(sponsorshipId) {
      await db.sponsorship.update({
        where: { id: sponsorshipId },
        data: { state: SponsorshipState.CONVERTED },
      });
    },
  };
}

// ─── Chargeback: audit-trail evidence reader + dispute store (Prisma) ────────────────────────────

export function buildBillingAuditReader(): BillingAuditReader {
  return {
    async queryUserAuditEntries(userId: string): Promise<AuditEvidenceRow[]> {
      // Read-only over the existing compliance audit trail (§5.6) — never mutates it. Uses the
      // append-only repository's `query` (the read side); the AuditService write path is untouched.
      const repository = new PrismaAuditRepository(prisma);
      const rows = await repository.query({ user_id: userId });
      return rows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        content_text: r.content_text ?? '',
        regulation: Array.isArray(r.regulation) ? r.regulation.join(',') : String(r.regulation ?? ''),
        outcome: String(r.outcome),
      }));
    },
  };
}

export function buildDisputeStore(): DisputeStore {
  return {
    async markSubscriptionDisputed(userId: string): Promise<boolean> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = prisma as any;
      const sub = await db.subscription.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        select: { id: true, status: true },
      });
      if (!sub) return false;
      const next = nextSubscriptionStatus(sub.status, 'dispute_opened');
      if (!next) return false;
      await db.subscription.update({ where: { id: sub.id }, data: { status: next } });
      return true;
    },
  };
}

// ─── Stripe webhook handlers (Prisma) ────────────────────────────────────────────────────────────

const STRIPE_STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: SubscriptionStatus.ACTIVE,
  past_due: SubscriptionStatus.PAST_DUE,
  canceled: SubscriptionStatus.CANCELED,
  unpaid: SubscriptionStatus.EXPIRED,
};

/** Build the production Stripe webhook handlers (§15.5 event map) backed by Prisma. */
export function buildStripeWebhookHandlers(): StripeWebhookHandlers {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;

  const periodEndDate = (seconds: number | null): Date | undefined =>
    seconds !== null ? new Date(seconds * 1000) : undefined;

  return {
    // `checkout.session.completed` → activate the paid subscription for the user, link the Stripe id
    // (§15.5 "checkout.session.completed webhook provisions"). Reconciles the user's live row to
    // individual/ACTIVE (a sponsored member converting keeps their history; org_sponsored flips off).
    //
    // T-47R: also PERSISTS the Stripe customer id (the checkout session always carries one — it is
    // the id `charge.dispute.created` will later carry too). This is the only live write path for
    // `stripe_customer_id`; `onDisputeCreated` below reads it back to resolve a dispute to a user.
    async onCheckoutCompleted({ userId, stripeSubscriptionId, stripeCustomerId }) {
      if (!userId) return;
      const sub = await db.subscription.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        select: { id: true },
      });
      // The checkout session itself carries no period end — the subsequent invoice.payment_succeeded
      // webhook sets the authoritative period dates. Here we activate + link the Stripe ids.
      const data = {
        plan_tier: 'individual',
        status: SubscriptionStatus.ACTIVE,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_customer_id: stripeCustomerId,
        org_sponsored: false,
      };
      if (sub) {
        await db.subscription.update({ where: { id: sub.id }, data });
      } else {
        await db.subscription.create({
          data: { user_id: userId, billing_cycle: 'monthly', ...data },
        });
      }
    },

    async onPaymentSucceeded({ stripeSubscriptionId, periodEndSeconds }) {
      if (!stripeSubscriptionId) return;
      const sub = await db.subscription.findUnique({
        where: { stripe_subscription_id: stripeSubscriptionId },
        select: { id: true, status: true },
      });
      if (!sub) return;
      // Instant restoration (§15.4). If already ACTIVE, just refresh the period end.
      const next = nextSubscriptionStatus(sub.status, 'payment_succeeded') ?? sub.status;
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: next, current_period_end: periodEndDate(periodEndSeconds) },
      });
    },

    async onPaymentFailed({ stripeSubscriptionId }) {
      if (!stripeSubscriptionId) return;
      const sub = await db.subscription.findUnique({
        where: { stripe_subscription_id: stripeSubscriptionId },
        select: { id: true, status: true },
      });
      if (!sub) return;
      const next = nextSubscriptionStatus(sub.status, 'payment_failed');
      if (next) await db.subscription.update({ where: { id: sub.id }, data: { status: next } });
    },

    async onSubscriptionUpdated({ stripeSubscriptionId, stripeStatus, periodEndSeconds }) {
      if (!stripeSubscriptionId || !stripeStatus) return;
      const mapped = STRIPE_STATUS_MAP[stripeStatus];
      if (!mapped) return;
      const sub = await db.subscription.findUnique({
        where: { stripe_subscription_id: stripeSubscriptionId },
        select: { id: true },
      });
      if (!sub) return;
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: mapped, current_period_end: periodEndDate(periodEndSeconds) },
      });
    },

    // `customer.subscription.deleted` (T-R41) → Stripe-side terminal cancellation (dashboard, API,
    // or Stripe itself giving up after dunning). Same find-by-`stripe_subscription_id`, no-op-if-
    // unresolvable pattern as `onPaymentFailed`/`onSubscriptionUpdated` above. Writes CANCELED
    // UNCONDITIONALLY — mirroring `SubscriptionService.cancel`'s own direct write for the in-app
    // cancel flow — rather than routing through `nextSubscriptionStatus` (billing-lifecycle.ts):
    // that state machine intentionally leaves a DISPUTED/EXPIRED row untouched by ordinary payment
    // events, but a `.deleted` event means Stripe has ALREADY deleted the subscription resource —
    // that terminal fact is true regardless of what phase our own row was in, so it always wins.
    // Idempotent the same way every other handler here is: the route's `withIdempotency` wrapper
    // (idempotency.ts) claims the Stripe event id BEFORE dispatch, so a replayed `.deleted` event
    // for an already-CANCELED row never reaches this handler a second time.
    async onSubscriptionDeleted({ stripeSubscriptionId }) {
      if (!stripeSubscriptionId) return;
      const sub = await db.subscription.findUnique({
        where: { stripe_subscription_id: stripeSubscriptionId },
        select: { id: true },
      });
      if (!sub) return;
      await db.subscription.update({ where: { id: sub.id }, data: { status: SubscriptionStatus.CANCELED } });
    },

    // `charge.dispute.created` → chargeback handling (§15.5 / §15.7-8).
    //
    // CUSTOMER RESOLUTION (the T-47R2 fix). The Stripe Dispute object exposes NO top-level
    // `customer` field — only a bare `charge` id string (and `payment_intent`). So we RETRIEVE the
    // charge from the Stripe REST API (`retrieveStripeCharge`, mirroring the lazy/fail-closed
    // checkout fetch — no `stripe` SDK), read `charge.customer` off it, then look up the live
    // Subscription by `stripe_customer_id` (persisted by `onCheckoutCompleted` above) → user →
    // call the already-built, already-unit-tested `handleDisputeCreated` (chargeback.ts): status →
    // DISPUTED (entitlement.ts then denies `outbound` while retaining `read`), the audit-trail
    // evidence pack, and the support alert. (The original T-47R fix read `dispute.customer` off the
    // event — always null on a real payload — so it early-returned on EVERY genuine dispute.)
    //
    // FAIL-SAFE, not silent, and it DISTINGUISHES "couldn't resolve" from "resolved → suspended":
    //   • RETRIABLE (rethrow → idempotency claim released → route 500 → Stripe retries; never
    //     marked done): Stripe key absent (fail-closed), a charge-retrieval network/HTTP error, or
    //     a charge that came back with NO customer — none of these has actually resolved the
    //     disputing user, so the event must be re-attempted / held for manual review, not buried.
    //   • DEAD-END (log + return 200; marked done so Stripe does not retry-storm forever): the
    //     customer resolved but NO subscription row carries that id (a data gap / pre-migration
    //     checkout), or the event carried no charge id at all — retrying will never change the
    //     outcome, but the miss is LOGGED LOUDLY (`console.error`, the distinct `[chargeback-
    //     unresolved]` tag) so a genuinely-resolvable dispute that lands here due to a bug is
    //     observable in alerting rather than quietly dropped.
    async onDisputeCreated({ stripeChargeId, disputeId }) {
      // No charge id → the event is malformed/unresolvable; retrying cannot help (dead-end).
      if (!stripeChargeId) {
        // eslint-disable-next-line no-console
        console.error(
          '[chargeback-unresolved]',
          JSON.stringify({ disputeId, reason: 'dispute_event_missing_charge_id' })
        );
        return;
      }

      // Resolve the disputing customer by RETRIEVING the charge from Stripe (lazy, fail-closed).
      let stripeCustomerId: string | null;
      try {
        const charge = await retrieveStripeCharge({ chargeId: stripeChargeId });
        stripeCustomerId = charge.customer;
      } catch (error) {
        const reason =
          error instanceof StripeConfigError ? 'stripe_not_configured' : 'charge_retrieval_failed';
        // eslint-disable-next-line no-console
        console.error(
          '[chargeback-unresolved]',
          JSON.stringify({ disputeId, chargeId: stripeChargeId, reason, error: String(error) })
        );
        // RETRIABLE: the customer was never resolved (transient/config) — release + let Stripe retry.
        throw error;
      }

      // Charge retrieved but carries no customer → the user is still unresolved → RETRIABLE.
      if (!stripeCustomerId) {
        // eslint-disable-next-line no-console
        console.error(
          '[chargeback-unresolved]',
          JSON.stringify({ disputeId, chargeId: stripeChargeId, reason: 'charge_has_no_customer' })
        );
        throw new Error(
          `Dispute ${disputeId}: charge ${stripeChargeId} retrieved but has no customer; retriable.`
        );
      }

      const sub = await db.subscription.findFirst({
        where: { stripe_customer_id: stripeCustomerId },
        orderBy: { created_at: 'desc' },
        select: { user_id: true },
      });
      // Customer resolved but no subscription carries it → DEAD-END (retrying won't grow a row).
      if (!sub) {
        // eslint-disable-next-line no-console
        console.error(
          '[chargeback-unresolved]',
          JSON.stringify({
            disputeId,
            chargeId: stripeChargeId,
            stripeCustomerId,
            reason: 'no_subscription_for_stripe_customer_id',
          })
        );
        return;
      }

      await handleDisputeCreated({
        userId: sub.user_id,
        disputeId,
        store: buildDisputeStore(),
        auditReader: buildBillingAuditReader(),
        sink: buildProductionNotificationSink(),
      });
    },
  };
}
