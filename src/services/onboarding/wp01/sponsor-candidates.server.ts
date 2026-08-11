// WP01 §6.5 — the REAL Downline-Sponsor candidate pool resolver (R-08).
//
// The matcher (`sponsor-matching.ts`) is pure: it decides `'linked'` vs `'waitlisted'` from a
// candidate pool it is handed. This module is the OTHER half the live flow was missing — it
// resolves that pool from the REAL platform state (actual uplines/sponsors on the platform), so
// `OnboardingFlow.tsx` can stop hard-coding `candidates: []` (which made every session resolve
// 'waitlisted' and made the 'linked' branch unreachable) and instead feed the matcher candidates
// that genuinely exist.
//
// POOL-POLICY (role-appropriate, per the R-08 card + R-01's pairing-policy):
//   - An RVP is NEVER a candidate: RVPs own their own organization and are never paired with
//     anyone (`pairing-policy.ts` `sponsorStepSkippedForRole`). Excluding them here means the
//     platform's own RVPs can never be silently auto-paired into a supervisory/sponsor role by
//     the automated matcher.
//   - A user holding a sponsor-eligible role (REP/UPLINE/DUAL — DUAL's upline-side being
//     explicitly sponsor-eligible) who ALREADY has real sponsorship/linkage rows is preferred:
//     active `Sponsorship` rows they hold as sponsor, confirmed `OrgTreeEdge` rows they hold as
//     sponsor, or a named `upline_id` (they are themselves a sponsored member of an upline, the
//     canonical "has a sponsor relationship on the platform" signal). Preferring these users is
//     the card's "prefer users with a sponsor-eligible role + their sponsorship/linkage rows".
//   - Remaining sponsor-eligible users are ranked after them, so a brand-new platform with no
//     linked users still produces a REAL, reachable pool (the 'linked' branch must be reachable
//     whenever real candidates exist — the card's acceptance bar).
//   - The pool is scoped to the rep's own org type (§6.5 "matches ... by desired organization
//     type" — the pure matcher enforces this again on the ids it is handed, so this resolver can
//     never make the matcher link a wrong-org candidate even if it wanted to).
//   - The onboarding user themself and any user already under a suspension hard-block are never
//     candidates (a user cannot sponsor themselves; a suspended account cannot carry a
//     sponsorship).
//
// The pure `rankSponsorCandidates` below is the decision core (deterministic, testable without a
// database); `resolveSponsorCandidatePool` is the thin Prisma read that feeds it. Both follow this
// codebase's narrow-Prisma-delegate + constructor-injection convention (session-store.ts /
// sponsor-invite.service.ts / data-rights.ts): no live database needed in tests.
//
// NOTE: this file imports Prisma types only, never Prisma runtime — its `select` shapes are
// compile-time-checked against the real `User`/`Sponsorship`/`OrgTreeEdge` models by `tsc`, and
// satisfied at runtime by the real `@/lib/prisma` singleton (or a fake) exactly like
// `OnboardingSessionPrismaClient`/`SponsorInvitePrismaClient` are.

import type { Role, SponsorshipState } from '@prisma/client';

import { sponsorStepSkippedForRole } from './pairing-policy';

/** The real `User` row columns this module reads. */
export interface SponsorCandidateUserRow {
  id: string;
  role: Role;
  upline_id: string | null;
}

/** The real `Sponsorship` row columns this module reads. */
export interface SponsorCandidateSponsorshipRow {
  sponsor_user_id: string;
  state: string;
}

/** The real `OrgTreeEdge` row columns this module reads. */
export interface SponsorCandidateEdgeRow {
  sponsor_id: string;
}

/** Narrow Prisma slice this module needs — DI-mockable, matching the sibling service convention. */
export interface SponsorCandidatePrismaClient {
  user: {
    findMany(args: {
      where: { org_type: string; id: { not: string }; role?: { in: string[] } };
      select: { id: true; role: true; upline_id: true };
    }): Promise<SponsorCandidateUserRow[]>;
  };
  sponsorship: {
    findMany(args: {
      where: { sponsor_user_id: { in: string[] }; state: SponsorshipState };
      select: { sponsor_user_id: true; state: true };
    }): Promise<SponsorCandidateSponsorshipRow[]>;
  };
  orgTreeEdge: {
    findMany(args: {
      where: { sponsor_id: { in: string[] }; edge_type: 'upline_sponsor'; is_recruit_confirmed: true };
      select: { sponsor_id: true };
    }): Promise<SponsorCandidateEdgeRow[]>;
  };
}

/**
 * The role-eligibility rule for the DOWNLINE-SPONSOR pool (R-08): a candidate must hold a
 * sponsor-eligible role AND must never be an RVP (R-01 — an RVP owns their own organization and
 * is never paired with anyone; `sponsorStepSkippedForRole` is the same single role-keyed policy
 * the registration wizard and the onboarding flow consult, so the pool can never drift from it).
 * REP/UPLINE/DUAL qualify; ADMIN (the system role) and RVP never do.
 */
export function isSponsorEligibleRole(role: Role): boolean {
  if (sponsorStepSkippedForRole(role)) return false;
  return role !== 'ADMIN';
}

/**
 * The pure candidate-ranking core (R-08). Deterministic and total over its input:
 *
 *  1. Never-candidates are filtered out structurally (an RVP, the rep themself, a user whose
 *     role is not sponsor-eligible).
 *  2. Eligibility tier A — the card's "prefer users with a sponsor-eligible role + their
 *     sponsorship/linkage rows": the candidate already carries at least one real linkage row
 *     (an ACTIVE `Sponsorship` they sponsor, a confirmed `OrgTreeEdge` they sponsor, or a named
 *     `upline_id`). Tier B — every other sponsor-eligible user of the same org type.
 *  3. Within a tier, candidates sort by `userId` ascending so the pool (and therefore the
 *     matcher's least-loaded pick) is deterministic across calls.
 *
 * Returns the ordered pool the matcher may choose from. An empty result is the ONLY way the
 * matcher legitimately resolves 'waitlisted' with real platform data — and it is now genuinely
 * rare (only a platform with no other same-org sponsor-eligible user at all), never the
 * hard-coded universal.
 */
export function rankSponsorCandidates(input: {
  repUserId: string;
  /** sponsor-eligible users of the rep's own org type, excluding the rep themself */
  sponsorEligibleUsers: readonly SponsorCandidateUserRow[];
  /** ACTIVE sponsorships the pool users already hold as sponsor */
  activeSponsorships: ReadonlyMap<string, number>;
  /** confirmed upline_sponsor org-tree edges the pool users already hold as sponsor */
  confirmedEdges: ReadonlyMap<string, number>;
}): string[] {
  const tierA: string[] = [];
  const tierB: string[] = [];

  for (const user of input.sponsorEligibleUsers) {
    if (user.id === input.repUserId) continue;
    if (!isSponsorEligibleRole(user.role)) continue;
    const hasLinkage =
      (input.activeSponsorships.get(user.id) ?? 0) > 0 ||
      (input.confirmedEdges.get(user.id) ?? 0) > 0 ||
      user.upline_id !== null;
    (hasLinkage ? tierA : tierB).push(user.id);
  }

  const byId = (a: string, b: string) => a.localeCompare(b);
  return [...tierA.sort(byId), ...tierB.sort(byId)];
}

/** One resolved pool candidate: its id plus its REAL active-sponsorship load (what the §6.5
 *  matcher's least-loaded rule actually weighs — `Sponsorship` rows with state ACTIVE). */
export interface ResolvedSponsorCandidate {
  userId: string;
  activeSponsorshipCount: number;
}

/**
 * Resolves the REAL candidate pool for a rep: same-org-type, sponsor-eligible, never-RVP,
 * never-the-rep, linkage-row-preferred order — via `rankSponsorCandidates` (deterministic) — and
 * carries each candidate's REAL active-sponsorship load so the §6.5 matcher's least-loaded rule
 * (sponsor-matching.ts) genuinely load-balances instead of weighing a fabricated zero.
 */
export async function resolveSponsorCandidatePool(
  prisma: SponsorCandidatePrismaClient,
  input: { orgType: string; repUserId: string; suspendedUserIds: readonly string[] }
): Promise<ResolvedSponsorCandidate[]> {
  const { orgType, repUserId, suspendedUserIds } = input;

  const users = await prisma.user.findMany({
    where: {
      org_type: orgType,
      id: { not: repUserId },
      ...(suspendedUserIds.length > 0 ? { role: { in: ['REP', 'UPLINE', 'DUAL'] as string[] } } : {}),
    },
    select: { id: true, role: true, upline_id: true },
  });

  // Exclude any user already under a suspension hold (§16.4, T-R56 `is_suspended` — a suspended
  // account cannot carry a sponsorship).
  const eligible = users.filter(
    (u) => isSponsorEligibleRole(u.role) && !suspendedUserIds.includes(u.id)
  );
  if (eligible.length === 0) return [];

  const poolIds = eligible.map((u) => u.id);

  const [sponsorshipRows, edgeRows] = await Promise.all([
    prisma.sponsorship.findMany({
      where: { sponsor_user_id: { in: poolIds }, state: 'ACTIVE' as SponsorshipState },
      select: { sponsor_user_id: true, state: true },
    }),
    prisma.orgTreeEdge.findMany({
      where: { sponsor_id: { in: poolIds }, edge_type: 'upline_sponsor', is_recruit_confirmed: true },
      select: { sponsor_id: true },
    }),
  ]);

  const activeSponsorships = new Map<string, number>();
  for (const row of sponsorshipRows) {
    activeSponsorships.set(row.sponsor_user_id, (activeSponsorships.get(row.sponsor_user_id) ?? 0) + 1);
  }
  const confirmedEdges = new Map<string, number>();
  for (const row of edgeRows) {
    confirmedEdges.set(row.sponsor_id, (confirmedEdges.get(row.sponsor_id) ?? 0) + 1);
  }

  const ranked = rankSponsorCandidates({
    repUserId,
    sponsorEligibleUsers: eligible,
    activeSponsorships,
    confirmedEdges,
  });

  return ranked.map((userId) => ({ userId, activeSponsorshipCount: activeSponsorships.get(userId) ?? 0 }));
}
