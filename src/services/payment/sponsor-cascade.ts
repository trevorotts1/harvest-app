// WP10 — Downline-Sponsor lapse cascade + anniversary (P0) (§15.3 / §18.3; qc-checklist WP10
// checkpoints 4 & 5). THE most reputationally-loaded logic in payments: it must NEVER punish a
// sponsored member instantly for their sponsor's card.
//
// Three flows, all pure over an injected store + notification sink (production wiring runs them on a
// daily Inngest cron — payment-inngest-functions.ts):
//
//   1. SPONSOR-LAPSE CASCADE (§15.3): when a sponsor's own payment lapses, every ACTIVE sponsored
//      member under them is moved to `MEMBER_GRACE` with a PROTECTED 30-DAY WINDOW (`grace_until =
//      now + 30d`) — full function throughout (see entitlement.ts) — and sponsor + member + RVP are
//      notified. Self-convert / re-match are offered (see `convertMemberToIndividual` /
//      `rematchMember`). NEVER an instant lock (critical-failure condition if violated).
//   2. MEMBER-GRACE EXPIRY: a member still in `MEMBER_GRACE` after `grace_until` (took no
//      convert/re-match) transitions to `ENDED` (then soft suspension — data intact), with a
//      final notice. This is the ONLY point a sponsored member loses function, and only after the
//      full protected window with warnings.
//   3. ANNIVERSARY (§15.3): 60/30/7-day advance notices before `term_end`, with explicit
//      renew/convert/lapse flows; at the first threshold the sponsorship enters `ANNIVERSARY_PENDING`.

import { SponsorshipState } from '@prisma/client';

import type { BillingNotification, BillingNotificationSink } from './notifications';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The protected window a sponsored member gets when their sponsor lapses (§15.3 — locked at 30 days). */
export const SPONSOR_LAPSE_GRACE_DAYS = 30;

/** Advance anniversary notice thresholds, in days before `term_end` (§15.3 — locked at 60/30/7). */
export const ANNIVERSARY_NOTICE_DAYS = [60, 30, 7] as const;

export function computeGraceUntilMs(nowMs: number): number {
  return nowMs + SPONSOR_LAPSE_GRACE_DAYS * DAY_MS;
}

/** A sponsored member whose sponsor has lapsed and who is still ACTIVE (not yet protected). */
export interface LapsedSponsorMembership {
  sponsorshipId: string;
  memberUserId: string;
  sponsorUserId: string;
  organizationId: string;
  /** The RVP to notify for this org, if resolvable (§15.3). */
  rvpUserId: string | null;
}

export interface MemberGraceMembership {
  sponsorshipId: string;
  memberUserId: string;
  sponsorUserId: string;
  graceUntilMs: number;
}

export interface AnniversaryApproaching {
  sponsorshipId: string;
  memberUserId: string;
  sponsorUserId: string;
  termEndMs: number;
  /** Which threshold this row crossed (60, 30, or 7). */
  daysOut: number;
  alreadyPending: boolean;
}

/** DI store — production impl is Prisma-backed (see payment-inngest-functions.ts). */
export interface SponsorCascadeStore {
  /** ACTIVE sponsorships whose SPONSOR's subscription is lapsed (past_due-past-grace/expired/disputed/canceled). */
  findLapsedSponsorMemberships(): Promise<LapsedSponsorMembership[]>;
  /** Move a member into the 30-day protected window. */
  moveMemberToGrace(sponsorshipId: string, graceUntil: Date): Promise<void>;
  /** Members currently in MEMBER_GRACE (to check expiry). */
  findMemberGraceMemberships(): Promise<MemberGraceMembership[]>;
  /** End a sponsorship whose protected window elapsed with no convert/re-match. */
  endSponsorship(sponsorshipId: string): Promise<void>;
  /** ACTIVE/ANNIVERSARY_PENDING sponsorships whose term_end is within the notice windows. */
  findAnniversaryApproaching(nowMs: number): Promise<AnniversaryApproaching[]>;
  /** Enter ANNIVERSARY_PENDING at the first crossed threshold. */
  markAnniversaryPending(sponsorshipId: string): Promise<void>;
}

export interface CascadeResult {
  membersProtected: number;
  notifications: number;
}

/**
 * Flow 1 — the sponsor-lapse cascade. For every ACTIVE member under a lapsed sponsor: protect them
 * (30-day `member_grace`) and notify sponsor + member + RVP. Idempotent: only ACTIVE memberships
 * are returned by the store, so a member already protected is not re-processed.
 */
export async function runSponsorLapseCascade(
  store: SponsorCascadeStore,
  sink: BillingNotificationSink,
  nowMs: number = Date.now()
): Promise<CascadeResult> {
  const lapsed = await store.findLapsedSponsorMemberships();
  const graceUntil = new Date(computeGraceUntilMs(nowMs));
  let notifications = 0;

  for (const m of lapsed) {
    // PROTECT FIRST — the member never loses function at this step (§15.3).
    await store.moveMemberToGrace(m.sponsorshipId, graceUntil);

    const notices: BillingNotification[] = [
      {
        type: 'member_sponsor_lapsed_protected',
        recipientRole: 'member',
        recipientUserId: m.memberUserId,
        subjectUserId: m.memberUserId,
        context: { protected_days: SPONSOR_LAPSE_GRACE_DAYS, grace_until: graceUntil.toISOString() },
      },
      {
        type: 'sponsor_payment_failed',
        recipientRole: 'sponsor',
        recipientUserId: m.sponsorUserId,
        subjectUserId: m.memberUserId,
        context: { grace_until: graceUntil.toISOString() },
      },
    ];
    if (m.rvpUserId) {
      notices.push({
        type: 'rvp_sponsor_lapsed',
        recipientRole: 'rvp',
        recipientUserId: m.rvpUserId,
        subjectUserId: m.memberUserId,
        context: { sponsor_user_id: m.sponsorUserId },
      });
    }
    for (const n of notices) {
      await sink.notify(n);
      notifications += 1;
    }
  }

  return { membersProtected: lapsed.length, notifications };
}

/**
 * Flow 2 — member-grace expiry. A member still in MEMBER_GRACE past their `grace_until` (no
 * convert/re-match) → ENDED (soft suspension, data intact). Emits a final "grace ending" notice so
 * the loss of function is never silent.
 */
export async function expireElapsedMemberGrace(
  store: SponsorCascadeStore,
  sink: BillingNotificationSink,
  nowMs: number = Date.now()
): Promise<{ ended: number }> {
  const inGrace = await store.findMemberGraceMemberships();
  let ended = 0;
  for (const m of inGrace) {
    if (nowMs > m.graceUntilMs) {
      await store.endSponsorship(m.sponsorshipId);
      await sink.notify({
        type: 'member_grace_ending',
        recipientRole: 'member',
        recipientUserId: m.memberUserId,
        subjectUserId: m.memberUserId,
        context: { grace_until: new Date(m.graceUntilMs).toISOString() },
      });
      ended += 1;
    }
  }
  return { ended };
}

/** Map a crossed threshold (60/30/7) to its notification type. */
function anniversaryNoticeType(daysOut: number): BillingNotification['type'] {
  if (daysOut >= 60) return 'anniversary_60';
  if (daysOut >= 30) return 'anniversary_30';
  return 'anniversary_7';
}

/**
 * Flow 3 — anniversary notices (§15.3). Fires the 60/30/7-day advance notice to BOTH parties and,
 * at the first crossed threshold, enters ANNIVERSARY_PENDING (the state the renew/convert/lapse UI
 * keys off — uiux §5.8).
 */
export async function runAnniversaryNotices(
  store: SponsorCascadeStore,
  sink: BillingNotificationSink,
  nowMs: number = Date.now()
): Promise<{ noticed: number }> {
  const approaching = await store.findAnniversaryApproaching(nowMs);
  let noticed = 0;
  for (const a of approaching) {
    if (!a.alreadyPending) {
      await store.markAnniversaryPending(a.sponsorshipId);
    }
    const type = anniversaryNoticeType(a.daysOut);
    const context = { term_end: new Date(a.termEndMs).toISOString(), days_out: a.daysOut };
    // Notice to both parties (§15.3 "advance notices to both parties").
    await sink.notify({
      type,
      recipientRole: 'member',
      recipientUserId: a.memberUserId,
      subjectUserId: a.memberUserId,
      context,
    });
    await sink.notify({
      type,
      recipientRole: 'sponsor',
      recipientUserId: a.sponsorUserId,
      subjectUserId: a.memberUserId,
      context,
    });
    noticed += 2;
  }
  return { noticed };
}

/**
 * Given a term_end, the TIGHTEST anniversary threshold `now` has crossed (the most urgent notice
 * due), or null if the term is more than the widest threshold away. e.g. 5 days out → 7 (the 7-day
 * notice); 25 → 30; 59 → 60; 120 → null.
 */
export function anniversaryThresholdCrossed(termEndMs: number, nowMs: number): number | null {
  const daysUntil = Math.ceil((termEndMs - nowMs) / DAY_MS);
  if (daysUntil < 0) return null;
  const ascending = [...ANNIVERSARY_NOTICE_DAYS].sort((a, b) => a - b);
  for (const threshold of ascending) {
    if (daysUntil <= threshold) return threshold;
  }
  return null;
}

// ─── Member self-convert / re-match transitions (called from routes) ────────────────────────────

export interface MemberTransitionStore {
  /** Mark the member's sponsorship CONVERTED (they took their own $297 plan). */
  markSponsorshipConverted(sponsorshipId: string): Promise<void>;
  /** Find the member's current protected/active sponsorship id. */
  findMemberSponsorshipId(
    memberUserId: string,
    states: SponsorshipState[]
  ): Promise<string | null>;
}

/**
 * A sponsored member self-converts to the $297 individual plan (§15.3 "self-convert"). Marks their
 * sponsorship CONVERTED so the entitlement gate stops treating them as sponsored and reads their new
 * paid subscription instead. The actual $297 subscription is created by the Stripe checkout webhook;
 * this only flips the sponsorship state. Idempotent (no sponsorship found → no-op).
 */
export async function markMemberConverted(
  store: MemberTransitionStore,
  memberUserId: string
): Promise<{ converted: boolean }> {
  const sponsorshipId = await store.findMemberSponsorshipId(memberUserId, [
    SponsorshipState.ACTIVE,
    SponsorshipState.MEMBER_GRACE,
    SponsorshipState.ANNIVERSARY_PENDING,
  ]);
  if (!sponsorshipId) return { converted: false };
  await store.markSponsorshipConverted(sponsorshipId);
  return { converted: true };
}
