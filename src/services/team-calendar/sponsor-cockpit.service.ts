// T-45 (WP09 — master-spec §14.5 "Sponsor Cockpit (P0)"; uiux §5.9 item 7, AC-5.9-6) — the free-tier
// growth-engine instrumentation: per sponsored seat, activation status, seat cost (§4.5 cost
// roll-up), recruits activated, and appointments generated, with the FTC safe-harbor treatment on
// any projected/ROI figure (master-spec §4.8/§8, uiux §5.1 "used by ... Sponsor Cockpit ROI (§5.9)").
//
// OWNERSHIP SCOPE (not a role restriction, §15.3 "any existing account can sponsor"): every result
// here is scoped to `sponsor_user_id = callerId` — a rep, upline, or RVP all see exactly their OWN
// sponsees, never anyone else's. The route layer (src/app/api/team/cockpit/route.ts) never accepts
// a caller-supplied sponsor id; it always passes the SESSION user's own id.

// T-57 RG7 (i18n; dimension B, uiux §6.2/§0.5) — this service used to COMPOSE the per-seat `roiNote`
// as a hardcoded-English template (`\`${n} recruit(s) activated …\` + SAFE_HARBOR_LINE`), a rep-facing
// string a Spanish rep saw in English no matter how the client rendered it — the exact server-side
// i18n leak `guard-server-i18n-leak.mjs` now catches (blind-spot c). It also used a Record to turn the
// raw `onboarding_status` token into an English `activationStatus` label. Both English compositions are
// GONE: the service now returns the RAW tokens (`activationStatus`, `sponsorshipState`) and the RAW
// counts (`recruitsActivated`/`appointmentsGenerated`), and `team/cockpit/page.tsx` composes the
// localized ROI note client-side via the catalog + the mandatory FTC safe-harbor key
// (`grow.goalCard.potentialNotPromise`, the sanctioned ES translation), doctrine-clean ("teammate(s)").

export interface SponsorshipRow {
  id: string;
  sponsor_user_id: string;
  member_user_id: string;
  organization_id: string;
  state: string;
  term_start: Date | null;
  term_end: Date | null;
  grace_until: Date | null;
}

export interface SponsorCockpitPrismaClient {
  sponsorship: {
    findMany(args: { where: Record<string, unknown> }): Promise<SponsorshipRow[]>;
  };
  user: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ id: string; name: string; onboarding_status: string; access_tier: string }[]>;
  };
  agentRun: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ user_id: string; cost_cents: number }[]>;
  };
  orgTreeEdge: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ sponsor_id: string; is_recruit_confirmed: boolean }[]>;
  };
  appointment: {
    findMany(args: { where: Record<string, unknown> }): Promise<{ rep_id: string }[]>;
  };
}

export interface SponsorCockpitSeat {
  memberUserId: string;
  memberName: string;
  activationStatus: string; // RAW OnboardingStatus token (IN_PROGRESS | GATED_COMPLETE); client localizes via activationStatusLabel
  sponsorshipState: string; // RAW SponsorshipState token (ACTIVE | MEMBER_GRACE | ...); client localizes via sponsorshipStateLabel
  seatCostCents: number; // this billing period's real AgentRun cost roll-up (§4.5)
  recruitsActivated: number; // client renders the localized, doctrine-clean ("teammate(s)") ROI note from this + appointmentsGenerated
  appointmentsGenerated: number;
  renewalDate: string | null; // aligned to §5.8 anniversary flow (term_end)
}

export class SponsorCockpitService {
  constructor(private readonly prisma: SponsorCockpitPrismaClient) {}

  /** `periodStart` bounds the seat-cost roll-up (§4.5) to the current billing period; there is no
   *  upper bound to pass — a real AgentRun row can never be dated in the future. */
  async getCockpit(sponsorUserId: string, periodStart: Date): Promise<SponsorCockpitSeat[]> {
    const sponsorships = await this.prisma.sponsorship.findMany({ where: { sponsor_user_id: sponsorUserId } });
    if (sponsorships.length === 0) return [];

    const memberIds = sponsorships.map((s) => s.member_user_id);
    const [members, agentRuns, orgTreeEdges, appointments] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: memberIds } } }),
      this.prisma.agentRun.findMany({ where: { user_id: { in: memberIds }, created_at: { gte: periodStart } } }),
      this.prisma.orgTreeEdge.findMany({ where: { sponsor_id: { in: memberIds }, is_recruit_confirmed: true } }),
      this.prisma.appointment.findMany({ where: { rep_id: { in: memberIds } } }),
    ]);

    return sponsorships.map((s) => {
      const member = members.find((m) => m.id === s.member_user_id);
      const seatCostCents = agentRuns.filter((r) => r.user_id === s.member_user_id).reduce((sum, r) => sum + r.cost_cents, 0);
      const recruitsActivated = orgTreeEdges.filter((e) => e.sponsor_id === s.member_user_id).length;
      const appointmentsGenerated = appointments.filter((a) => a.rep_id === s.member_user_id).length;

      return {
        memberUserId: s.member_user_id,
        memberName: member?.name ?? 'Sponsored member',
        activationStatus: member ? member.onboarding_status : 'UNKNOWN',
        sponsorshipState: s.state,
        seatCostCents,
        recruitsActivated,
        appointmentsGenerated,
        renewalDate: s.term_end ? s.term_end.toISOString() : null,
      } satisfies SponsorCockpitSeat;
    });
  }
}
