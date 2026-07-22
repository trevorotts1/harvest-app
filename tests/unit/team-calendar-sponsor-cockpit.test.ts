// T-45 (WP09 §14.5 P0; uiux §5.9 AC-5.9-6) — SponsorCockpitService: activation, seat cost (§4.5
// cost roll-up), recruits activated, appointments generated, and the mandatory safe-harbor line on
// any ROI figure. Ownership-scoped (sponsor_user_id = caller) is proven at the route layer; this
// suite proves the DATA is correct given a sponsor id.

import { SponsorCockpitService, type SponsorCockpitPrismaClient } from '../../src/services/team-calendar/sponsor-cockpit.service';

function makeMockPrisma(fixtures: {
  sponsorships?: { id: string; sponsor_user_id: string; member_user_id: string; organization_id: string; state: string; term_start: Date | null; term_end: Date | null; grace_until: Date | null }[];
  users?: { id: string; name: string; onboarding_status: string; access_tier: string }[];
  agentRuns?: { user_id: string; cost_cents: number }[];
  orgTreeEdges?: { sponsor_id: string; is_recruit_confirmed: boolean }[];
  appointments?: { rep_id: string }[];
}): SponsorCockpitPrismaClient {
  return {
    sponsorship: {
      async findMany({ where }) {
        const sponsorId = (where as { sponsor_user_id?: string }).sponsor_user_id;
        return (fixtures.sponsorships ?? []).filter((s) => s.sponsor_user_id === sponsorId);
      },
    },
    user: {
      async findMany({ where }) {
        const ids = (where as { id?: { in?: string[] } }).id?.in ?? [];
        return (fixtures.users ?? []).filter((u) => ids.includes(u.id));
      },
    },
    agentRun: {
      async findMany({ where }) {
        const ids = (where as { user_id?: { in?: string[] } }).user_id?.in ?? [];
        return (fixtures.agentRuns ?? []).filter((r) => ids.includes(r.user_id));
      },
    },
    orgTreeEdge: {
      async findMany({ where }) {
        const ids = (where as { sponsor_id?: { in?: string[] } }).sponsor_id?.in ?? [];
        return (fixtures.orgTreeEdges ?? []).filter((e) => ids.includes(e.sponsor_id) && e.is_recruit_confirmed);
      },
    },
    appointment: {
      async findMany({ where }) {
        const ids = (where as { rep_id?: { in?: string[] } }).rep_id?.in ?? [];
        return (fixtures.appointments ?? []).filter((a) => ids.includes(a.rep_id));
      },
    },
  };
}

describe('WP09 SponsorCockpitService', () => {
  it('returns raw activation/sponsorship tokens, seat cost, recruits activated, and appointments generated per sponsored seat (T-57 RG7: rep-facing ROI note + safe harbor are composed & localized client-side)', async () => {
    const prisma = makeMockPrisma({
      sponsorships: [
        { id: 's1', sponsor_user_id: 'sponsor-1', member_user_id: 'member-1', organization_id: 'org-1', state: 'active', term_start: new Date('2025-01-01'), term_end: new Date('2026-01-01'), grace_until: null },
      ],
      users: [{ id: 'member-1', name: 'Member One', onboarding_status: 'GATED_COMPLETE', access_tier: 'FREE_ORG_LINKED' }],
      agentRuns: [{ user_id: 'member-1', cost_cents: 150 }, { user_id: 'member-1', cost_cents: 50 }],
      orgTreeEdges: [{ sponsor_id: 'member-1', is_recruit_confirmed: true }],
      appointments: [{ rep_id: 'member-1' }, { rep_id: 'member-1' }],
    });

    const service = new SponsorCockpitService(prisma);
    const seats = await service.getCockpit('sponsor-1', new Date('2025-01-01'));

    expect(seats.length).toBe(1);
    expect(seats[0].memberName).toBe('Member One');
    // T-57 RG7 — RAW OnboardingStatus token (was the English label 'Active'); the client localizes it.
    expect(seats[0].activationStatus).toBe('GATED_COMPLETE');
    expect(seats[0].seatCostCents).toBe(200);
    expect(seats[0].recruitsActivated).toBe(1);
    expect(seats[0].appointmentsGenerated).toBe(2);
    expect(seats[0].renewalDate).toBe(new Date('2026-01-01').toISOString());
    // T-57 RG7 — the service hands the RAW sponsorship-state token (client localizes) and the raw
    // counts above; it no longer composes any rep-facing English (the ROI note + FTC safe-harbor line
    // are built & localized client-side in team/cockpit/page.tsx). Proven here: the returned object
    // carries the raw token, not a pre-composed English `roiNote`.
    expect(seats[0].sponsorshipState).toBe('active');
    expect('roiNote' in seats[0]).toBe(false);
  });

  it('returns an empty cockpit (never a crash) when the caller sponsors no one — the recruit-your-first-sponsee state', async () => {
    const prisma = makeMockPrisma({});
    const service = new SponsorCockpitService(prisma);
    const seats = await service.getCockpit('sponsor-with-none', new Date());
    expect(seats).toEqual([]);
  });

  it('never mixes another sponsor\'s seats into the result (ownership scoping)', async () => {
    const prisma = makeMockPrisma({
      sponsorships: [
        { id: 's1', sponsor_user_id: 'sponsor-1', member_user_id: 'member-1', organization_id: 'org-1', state: 'active', term_start: null, term_end: null, grace_until: null },
        { id: 's2', sponsor_user_id: 'sponsor-2', member_user_id: 'member-2', organization_id: 'org-1', state: 'active', term_start: null, term_end: null, grace_until: null },
      ],
      users: [
        { id: 'member-1', name: 'Member One', onboarding_status: 'GATED_COMPLETE', access_tier: 'FREE_ORG_LINKED' },
        { id: 'member-2', name: 'Member Two', onboarding_status: 'GATED_COMPLETE', access_tier: 'FREE_ORG_LINKED' },
      ],
    });
    const service = new SponsorCockpitService(prisma);
    const seats = await service.getCockpit('sponsor-1', new Date());
    expect(seats.length).toBe(1);
    expect(seats[0].memberUserId).toBe('member-1');
  });
});
