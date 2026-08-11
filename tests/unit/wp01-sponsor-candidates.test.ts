// R-08 (refinements catalog 2026-07-28) — the REAL Downline-Sponsor candidate pool resolver.
//
// Proves the pool-resolution half of the fix:
//   (a) the pure ranking core (`rankSponsorCandidates`) is role-appropriate — an RVP is never a
//       candidate (R-01's pairing policy is the single role-keyed source), the rep themself never
//       is, linkage-row holders (sponsorship/org-tree/upline) rank before plain eligible users,
//       and ordering is deterministic;
//   (b) the Prisma-backed resolver (`resolveSponsorCandidatePool`) maps the real platform state
//       into that pool and excludes suspended accounts (T-R56 `is_suspended`).
//
// The pool being REAL is what makes the 'linked' branch reachable: `matchSponsor` (proven in
// wp01-sponsor-matching.test.ts) links whenever the pool is non-empty — this suite proves the pool
// is non-empty whenever a real same-org, sponsor-eligible, non-RVP user exists.

import { OrgType, Role } from '@prisma/client';

import {
  isSponsorEligibleRole,
  rankSponsorCandidates,
  resolveSponsorCandidatePool,
  type SponsorCandidatePrismaClient,
  type SponsorCandidateUserRow,
} from '../../src/services/onboarding/wp01/sponsor-candidates.server';

describe('R-08 — sponsor-eligible role rule (pairing-policy-consistent)', () => {
  test('REP/UPLINE/DUAL are sponsor-eligible; RVP never is (R-01: an RVP is never paired)', () => {
    expect(isSponsorEligibleRole(Role.REP)).toBe(true);
    expect(isSponsorEligibleRole(Role.UPLINE)).toBe(true);
    expect(isSponsorEligibleRole(Role.DUAL)).toBe(true);
    expect(isSponsorEligibleRole(Role.RVP)).toBe(false);
  });

  test('ADMIN (the system role) is never a sponsor candidate', () => {
    expect(isSponsorEligibleRole(Role.ADMIN)).toBe(false);
  });
});

describe('R-08 — rankSponsorCandidates (pure decision core)', () => {
  const users: SponsorCandidateUserRow[] = [
    { id: 'upline-holder', role: Role.REP, upline_id: 'their-upline' },
    { id: 'sponsor-holder', role: Role.UPLINE, upline_id: null },
    { id: 'edge-holder', role: Role.REP, upline_id: null },
    { id: 'plain-eligible', role: Role.REP, upline_id: null },
    { id: 'an-rvp', role: Role.RVP, upline_id: 'svp-1' },
    { id: 'admin-user', role: Role.ADMIN, upline_id: null },
  ];
  const empty = new Map<string, number>();

  test('linkage-row holders (sponsorship / org-tree edge / upline_id) rank BEFORE plain eligible users', () => {
    const ranked = rankSponsorCandidates({
      repUserId: 'rep-me',
      sponsorEligibleUsers: users,
      activeSponsorships: new Map([['sponsor-holder', 2]]),
      confirmedEdges: new Map([['edge-holder', 1]]),
    });
    // Tier A first: upline-holder (upline_id), sponsor-holder (sponsorship), edge-holder (edge).
    // Tier B after: plain-eligible. RVP and ADMIN are never in the pool.
    expect(ranked.slice(0, 3)).toEqual(['edge-holder', 'sponsor-holder', 'upline-holder']);
    expect(ranked.slice(3)).toEqual(['plain-eligible']);
    expect(ranked).not.toContain('an-rvp');
    expect(ranked).not.toContain('admin-user');
  });

  test('an RVP is never a candidate even with linkage rows (R-01 — the policy cannot be outranked)', () => {
    const ranked = rankSponsorCandidates({
      repUserId: 'rep-me',
      sponsorEligibleUsers: [{ id: 'rvp-sponsor', role: Role.RVP, upline_id: null }],
      activeSponsorships: new Map([['rvp-sponsor', 9]]),
      confirmedEdges: empty,
    });
    expect(ranked).toEqual([]);
  });

  test('the rep themself is never a candidate (no self-sponsorship)', () => {
    const ranked = rankSponsorCandidates({
      repUserId: 'upline-holder',
      sponsorEligibleUsers: users,
      activeSponsorships: empty,
      confirmedEdges: empty,
    });
    expect(ranked).not.toContain('upline-holder');
  });

  test('ordering is deterministic — same input, same pool (tier order then userId ascending)', () => {
    const a = rankSponsorCandidates({
      repUserId: 'rep-me',
      sponsorEligibleUsers: users,
      activeSponsorships: empty,
      confirmedEdges: empty,
    });
    const b = rankSponsorCandidates({
      repUserId: 'rep-me',
      sponsorEligibleUsers: users,
      activeSponsorships: empty,
      confirmedEdges: empty,
    });
    expect(a).toEqual(b);
    // `upline-holder` carries an upline_id (linkage -> tier A) even with empty sponsorship/edge
    // maps; the other three have no linkage -> tier B, sorted by userId ascending.
    expect(a).toEqual(['upline-holder', 'edge-holder', 'plain-eligible', 'sponsor-holder']);
  });
});

describe('R-08 — resolveSponsorCandidatePool (real platform state → pool)', () => {
  function makeFakePrisma(seed: {
    users: Array<SponsorCandidateUserRow & { org_type?: OrgType }>;
    sponsorships?: Array<{ sponsor_user_id: string; state: string }>;
    edges?: Array<{ sponsor_id: string }>;
  }): SponsorCandidatePrismaClient {
    return {
      user: {
        async findMany({ where }) {
          const allowedRoles = where.role?.in ?? ['REP', 'UPLINE', 'DUAL'];
          return seed.users
            .filter(
              (u) =>
                u.id !== where.id.not &&
                allowedRoles.includes(u.role) &&
                (u.org_type ?? OrgType.EXTERNAL) === where.org_type
            )
            .map(({ id, role, upline_id }) => ({ id, role, upline_id }));
        },
      },
      sponsorship: {
        async findMany({ where }) {
          const ids = where.sponsor_user_id.in;
          return (seed.sponsorships ?? []).filter(
            (s) => ids.includes(s.sponsor_user_id) && s.state === where.state
          );
        },
      },
      orgTreeEdge: {
        async findMany({ where }) {
          const ids = where.sponsor_id.in;
          return (seed.edges ?? []).filter((e) => ids.includes(e.sponsor_id));
        },
      },
    };
  }

  test('resolves a REAL pool when a same-org, sponsor-eligible, non-RVP user exists', async () => {
    const prisma = makeFakePrisma({
      users: [
        { id: 'rep-me', role: Role.REP, upline_id: null, org_type: OrgType.PRIMERICA },
        { id: 'sponsor-alice', role: Role.UPLINE, upline_id: 'someone-up', org_type: OrgType.PRIMERICA },
        { id: 'other-org-user', role: Role.REP, upline_id: null, org_type: OrgType.EXTERNAL },
      ],
    });
    const pool = await resolveSponsorCandidatePool(prisma, {
      orgType: OrgType.PRIMERICA,
      repUserId: 'rep-me',
      suspendedUserIds: [],
    });
    expect(pool).toEqual([{ userId: 'sponsor-alice', activeSponsorshipCount: 0 }]);
  });

  test('excludes a suspended account (T-R56 is_suspended) — a suspended user cannot carry a sponsorship', async () => {
    const prisma = makeFakePrisma({
      users: [
        { id: 'rep-me', role: Role.REP, upline_id: null },
        { id: 'suspended-sponsor', role: Role.UPLINE, upline_id: null },
      ],
    });
    const pool = await resolveSponsorCandidatePool(prisma, {
      orgType: OrgType.EXTERNAL,
      repUserId: 'rep-me',
      suspendedUserIds: ['suspended-sponsor'],
    });
    expect(pool).toEqual([]);
  });

  test('the pool is genuinely empty only when NO same-org eligible candidate exists (the honest waitlist condition)', async () => {
    const prisma = makeFakePrisma({
      users: [
        { id: 'rep-me', role: Role.REP, upline_id: null },
        { id: 'only-rvp', role: Role.RVP, upline_id: null },
      ],
    });
    const pool = await resolveSponsorCandidatePool(prisma, {
      orgType: OrgType.EXTERNAL,
      repUserId: 'rep-me',
      suspendedUserIds: [],
    });
    expect(pool).toEqual([]);
  });

  test('each candidate carries its REAL active-sponsorship load (the least-loaded rule weighs reality, never a fabricated zero)', async () => {
    const prisma = makeFakePrisma({
      users: [
        { id: 'rep-me', role: Role.REP, upline_id: null },
        { id: 'busy-sponsor', role: Role.REP, upline_id: null },
        { id: 'free-sponsor', role: Role.UPLINE, upline_id: null },
      ],
      sponsorships: [
        { sponsor_user_id: 'busy-sponsor', state: 'ACTIVE' },
        { sponsor_user_id: 'busy-sponsor', state: 'ACTIVE' },
        { sponsor_user_id: 'busy-sponsor', state: 'ACTIVE' },
      ],
    });
    const pool = await resolveSponsorCandidatePool(prisma, {
      orgType: OrgType.EXTERNAL,
      repUserId: 'rep-me',
      suspendedUserIds: [],
    });
    expect(pool).toEqual([
      { userId: 'busy-sponsor', activeSponsorshipCount: 3 },
      { userId: 'free-sponsor', activeSponsorshipCount: 0 },
    ]);
  });
});
