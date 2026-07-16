// WP01 §6.5 — Downline Sponsor matching.
//
// "If the rep arrived under a sponsor (invite or Primerica portal), the sponsor is linked and the
// free tier activates. Otherwise The Harvest **matches** the rep to a Downline Sponsor by desired
// organization type; on match + onboarding, the sponsor covers one year of access (§15). If no
// sponsor is available for the org type, the rep gets an honest **waitlist state + a $297 path** —
// never a dead end. 'No upline yet' is a first-class path, not an error."
//
// THE LOAD-BEARING INVARIANT (§6.10-5, QC "critical failure" list): `matchSponsor` below is a
// TOTAL function over its input — every call returns exactly one of two outcomes
// (`'linked' | 'waitlisted'`), never throws, never returns null/undefined, and the `'waitlisted'`
// outcome always carries the $297 (`PAID_INDIVIDUAL`) path alongside it. There is no third,
// error-shaped outcome. This is what makes "sponsor matching never dead-ends" a property a test can
// assert on every input, not just the happy path.
//
// Pure decision logic only — no Prisma import, matching `../roles.ts`/`../org-gate.ts` (T-17).
// `sponsor-invite.service.ts` is where this is wired to real `Sponsorship`/`OrgTreeEdge` writes.

import { AccessTier, OrgType } from '@prisma/client';

/** One year, in milliseconds — the sponsor's covered term (§6.5 "the sponsor covers one year of access", §15.1). */
export const SPONSORSHIP_TERM_MS = 365 * 24 * 60 * 60 * 1000;

/** A candidate Downline Sponsor The Harvest can match a new rep to. */
export interface SponsorCandidate {
  userId: string;
  /** Must equal the rep's own `orgType` for §6.5's "matches ... by desired organization type" rule. */
  orgType: OrgType;
  /** Current count of active sponsorships this candidate already carries — used to load-balance matches. */
  activeSponsorshipCount: number;
}

export interface SponsorMatchInput {
  /** The new rep's own organization type — matching is scoped to candidates of the SAME org type. */
  orgType: OrgType;
  /**
   * Set when the rep already arrived under a sponsor — via an accepted `UplineInvite` or via
   * Primerica-portal OAuth (§6.5's first sentence) — which skips automated matching entirely.
   */
  existingSponsorId?: string | null;
  /**
   * Pool of sponsors The Harvest can automatically match against, when there is no existing
   * sponsor. Optional — irrelevant (and safely omittable) when `existingSponsorId` is set, and
   * defaults to an empty pool (→ waitlisted) otherwise.
   */
  candidates?: readonly SponsorCandidate[];
}

export type SponsorMatchOutcome =
  | {
      readonly kind: 'linked';
      readonly sponsorId: string;
      /** Whether the sponsor came from an invite/portal arrival vs. The Harvest's automated match. */
      readonly source: 'invite_or_portal' | 'automated_match';
      readonly termStart: Date;
      readonly termEnd: Date;
    }
  | {
      readonly kind: 'waitlisted';
      readonly orgType: OrgType;
      /** The honest, always-present non-dead-end alternative (§6.5, §15.3, §6.10-5). */
      readonly paidPathTier: typeof AccessTier.PAID_INDIVIDUAL;
      /** A first-class completion path — "no upline yet" is not an error (§6.10-5). */
      readonly noUplineYetIsComplete: true;
      readonly waitlistedAt: Date;
    };

/**
 * §6.5's matching decision. TOTAL over its input (see the module doc above): always returns
 * `'linked'` or `'waitlisted'`, never throws.
 *
 *  1. An `existingSponsorId` (arrived via invite or Primerica-portal OAuth) is linked immediately —
 *     automated matching is skipped entirely, per the spec's first sentence.
 *  2. Otherwise, candidates are filtered to the rep's own `orgType` ("matches ... by desired
 *     organization type"). If any exist, the least-loaded one is picked (lowest
 *     `activeSponsorshipCount`, ties broken by `userId` ascending for determinism) so matching
 *     naturally load-balances across available sponsors rather than always picking the same one.
 *  3. If no candidate of the rep's org type exists, the rep is waitlisted — NEVER an error, NEVER a
 *     null/undefined result — with the $297 (`PAID_INDIVIDUAL`) path always attached.
 */
export function matchSponsor(input: SponsorMatchInput, now: Date = new Date()): SponsorMatchOutcome {
  if (input.existingSponsorId) {
    return linkedOutcome(input.existingSponsorId, 'invite_or_portal', now);
  }

  const eligible = (input.candidates ?? []).filter((c) => c.orgType === input.orgType);
  if (eligible.length === 0) {
    return {
      kind: 'waitlisted',
      orgType: input.orgType,
      paidPathTier: AccessTier.PAID_INDIVIDUAL,
      noUplineYetIsComplete: true,
      waitlistedAt: now,
    };
  }

  const chosen = [...eligible].sort((a, b) => {
    if (a.activeSponsorshipCount !== b.activeSponsorshipCount) {
      return a.activeSponsorshipCount - b.activeSponsorshipCount;
    }
    return a.userId.localeCompare(b.userId);
  })[0];

  return linkedOutcome(chosen.userId, 'automated_match', now);
}

function linkedOutcome(
  sponsorId: string,
  source: 'invite_or_portal' | 'automated_match',
  now: Date
): SponsorMatchOutcome {
  return {
    kind: 'linked',
    sponsorId,
    source,
    termStart: now,
    termEnd: new Date(now.getTime() + SPONSORSHIP_TERM_MS),
  };
}

// ─── Shaping the persisted rows a `'linked'` match produces (§3.3 Sponsorship / OrgTreeEdge) ────

/** The `Sponsorship` create payload a `'linked'` match produces (`state = ACTIVE`, one-year term, §15.3). */
export interface SponsorshipInsert {
  sponsor_user_id: string;
  member_user_id: string;
  organization_id: string;
  state: 'ACTIVE';
  term_start: Date;
  term_end: Date;
}

/** The `OrgTreeEdge` create payload linking sponsor → new member into the org tree (§3.3, §13). */
export interface OrgTreeEdgeInsert {
  sponsor_id: string;
  recruit_id: string;
  edge_type: 'upline_sponsor';
  is_recruit_confirmed: true;
}

/**
 * Builds the `Sponsorship` row for a `'linked'` outcome. Returns `null` for `'waitlisted'` — there
 * is nothing to persist yet (the whole point of the waitlist state: no sponsor relationship exists
 * until/unless one is later matched or the rep self-converts).
 */
export function buildSponsorshipInsert(
  outcome: SponsorMatchOutcome,
  memberUserId: string,
  organizationId: string
): SponsorshipInsert | null {
  if (outcome.kind !== 'linked') return null;
  return {
    sponsor_user_id: outcome.sponsorId,
    member_user_id: memberUserId,
    organization_id: organizationId,
    state: 'ACTIVE',
    term_start: outcome.termStart,
    term_end: outcome.termEnd,
  };
}

/** Builds the `OrgTreeEdge` row for a `'linked'` outcome; `null` for `'waitlisted'` (same reasoning as above). */
export function buildOrgTreeEdgeInsert(
  outcome: SponsorMatchOutcome,
  recruitUserId: string
): OrgTreeEdgeInsert | null {
  if (outcome.kind !== 'linked') return null;
  return {
    sponsor_id: outcome.sponsorId,
    recruit_id: recruitUserId,
    edge_type: 'upline_sponsor',
    is_recruit_confirmed: true,
  };
}
