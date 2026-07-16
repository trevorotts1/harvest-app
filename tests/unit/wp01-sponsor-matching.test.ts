// WP01 §6.5 — Downline Sponsor matching. Proves (a): a rep with no direct sponsor lands on the
// WAITLIST — a real queued state, never a dead-end error/rejection — and always carries the honest
// $297 path alongside it ("no upline yet" is a first-class completion path, §6.10-5).

import { AccessTier, OrgType } from '@prisma/client';

import {
  buildOrgTreeEdgeInsert,
  buildSponsorshipInsert,
  matchSponsor,
  SPONSORSHIP_TERM_MS,
  type SponsorCandidate,
} from '../../src/services/onboarding/wp01/sponsor-matching';

const NOW = new Date('2026-07-16T12:00:00Z');

describe('WP01 sponsor matching — §6.5', () => {
  describe('an existing sponsor (invite or Primerica-portal OAuth) is linked immediately, skipping matching', () => {
    test('existingSponsorId short-circuits candidate search entirely', () => {
      const candidates: SponsorCandidate[] = [
        { userId: 'other-sponsor', orgType: OrgType.EXTERNAL, activeSponsorshipCount: 0 },
      ];
      const outcome = matchSponsor(
        { orgType: OrgType.EXTERNAL, existingSponsorId: 'sponsor-from-invite', candidates },
        NOW
      );
      expect(outcome.kind).toBe('linked');
      if (outcome.kind === 'linked') {
        expect(outcome.sponsorId).toBe('sponsor-from-invite');
        expect(outcome.source).toBe('invite_or_portal');
        expect(outcome.termEnd.getTime() - outcome.termStart.getTime()).toBe(SPONSORSHIP_TERM_MS);
      }
    });
  });

  describe('automated matching by organization type', () => {
    test('matches the least-loaded eligible candidate of the SAME org type', () => {
      const candidates: SponsorCandidate[] = [
        { userId: 'sponsor-busy', orgType: OrgType.PRIMERICA, activeSponsorshipCount: 5 },
        { userId: 'sponsor-free', orgType: OrgType.PRIMERICA, activeSponsorshipCount: 1 },
        { userId: 'sponsor-wrong-org', orgType: OrgType.EXTERNAL, activeSponsorshipCount: 0 },
      ];
      const outcome = matchSponsor({ orgType: OrgType.PRIMERICA, candidates }, NOW);
      expect(outcome.kind).toBe('linked');
      if (outcome.kind === 'linked') {
        expect(outcome.sponsorId).toBe('sponsor-free');
        expect(outcome.source).toBe('automated_match');
      }
    });

    test('ties in load are broken deterministically by userId', () => {
      const candidates: SponsorCandidate[] = [
        { userId: 'z-sponsor', orgType: OrgType.EXTERNAL, activeSponsorshipCount: 2 },
        { userId: 'a-sponsor', orgType: OrgType.EXTERNAL, activeSponsorshipCount: 2 },
      ];
      const outcome = matchSponsor({ orgType: OrgType.EXTERNAL, candidates }, NOW);
      expect(outcome.kind).toBe('linked');
      if (outcome.kind === 'linked') expect(outcome.sponsorId).toBe('a-sponsor');
    });

    test('a candidate of the WRONG org type is never matched, even if it is the only candidate', () => {
      const candidates: SponsorCandidate[] = [
        { userId: 'external-sponsor', orgType: OrgType.EXTERNAL, activeSponsorshipCount: 0 },
      ];
      const outcome = matchSponsor({ orgType: OrgType.PRIMERICA, candidates }, NOW);
      expect(outcome.kind).toBe('waitlisted');
    });
  });

  // (a) THE load-bearing proof: no sponsor available → WAITLIST, never a dead end.
  describe('no sponsor available → an honest waitlist, NEVER a dead end (§6.5, §6.10-5, teeth)', () => {
    test('an empty candidate pool waitlists — does not throw, does not return null/undefined', () => {
      expect(() => matchSponsor({ orgType: OrgType.EXTERNAL, candidates: [] }, NOW)).not.toThrow();
      const outcome = matchSponsor({ orgType: OrgType.EXTERNAL, candidates: [] }, NOW);
      expect(outcome).toBeDefined();
      expect(outcome.kind).toBe('waitlisted');
    });

    test('the waitlist outcome always carries the $297 (PAID_INDIVIDUAL) path and the "no upline yet" completion flag', () => {
      const outcome = matchSponsor({ orgType: OrgType.EXTERNAL, candidates: [] }, NOW);
      expect(outcome.kind).toBe('waitlisted');
      if (outcome.kind === 'waitlisted') {
        expect(outcome.paidPathTier).toBe(AccessTier.PAID_INDIVIDUAL);
        expect(outcome.noUplineYetIsComplete).toBe(true);
        expect(outcome.orgType).toBe(OrgType.EXTERNAL);
        expect(outcome.waitlistedAt).toEqual(NOW);
      }
    });

    test('matchSponsor is TOTAL: every kind/orgType combination returns a well-formed outcome, never an exception', () => {
      const orgTypes = [OrgType.PRIMERICA, OrgType.EXTERNAL];
      for (const orgType of orgTypes) {
        for (const candidates of [[], [{ userId: 'x', orgType, activeSponsorshipCount: 0 }]]) {
          expect(() => matchSponsor({ orgType, candidates }, NOW)).not.toThrow();
          const outcome = matchSponsor({ orgType, candidates }, NOW);
          expect(['linked', 'waitlisted']).toContain(outcome.kind);
        }
      }
    });
  });

  describe('shaping the Sponsorship / OrgTreeEdge inserts', () => {
    test('a linked outcome produces a real Sponsorship insert (state=ACTIVE, one-year term) and an OrgTreeEdge insert', () => {
      const outcome = matchSponsor(
        { orgType: OrgType.EXTERNAL, existingSponsorId: 'sponsor-1' },
        NOW
      );
      const sponsorship = buildSponsorshipInsert(outcome, 'member-1', 'org-1');
      const edge = buildOrgTreeEdgeInsert(outcome, 'member-1');

      expect(sponsorship).toEqual({
        sponsor_user_id: 'sponsor-1',
        member_user_id: 'member-1',
        organization_id: 'org-1',
        state: 'ACTIVE',
        term_start: NOW,
        term_end: new Date(NOW.getTime() + SPONSORSHIP_TERM_MS),
      });
      expect(edge).toEqual({
        sponsor_id: 'sponsor-1',
        recruit_id: 'member-1',
        edge_type: 'upline_sponsor',
        is_recruit_confirmed: true,
      });
    });

    test('a waitlisted outcome produces NEITHER insert (nothing to persist yet) — never a partial/garbage row', () => {
      const outcome = matchSponsor({ orgType: OrgType.EXTERNAL, candidates: [] }, NOW);
      expect(buildSponsorshipInsert(outcome, 'member-1', 'org-1')).toBeNull();
      expect(buildOrgTreeEdgeInsert(outcome, 'member-1')).toBeNull();
    });
  });
});
