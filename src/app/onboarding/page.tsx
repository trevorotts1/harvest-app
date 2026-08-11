// WP01 §5.1 (uiux) — the onboarding entry page. Renders the O-1..O-9 orchestrator (Flow A cinematic
// rep track; the dense upline/RVP track for non-rep roles), replacing the pre-T-20 five-step demo
// scaffold. A fresh rep starts at the vision splash; the parallel `/onboarding/resume` route
// (the §6.10-1 gate's redirect target) starts a returning rep on their persisted step.
//
// R-01 (refinements catalog 2026-07-28) — the registrant's REAL persisted role (persisted at
// registration since R-07, src/app/api/auth/register/route.ts) is now handed to the flow. Before
// this fix the page rendered `<OnboardingFlow />` with the component's REP default, so an RVP
// registrant (whose whole R-01 behavior — no pairing, no sponsor step — keys off the stored role)
// silently ran the rep track. The role comes from the SERVER session (the same server-computed
// role the JWT carries and every role-gated route authorizes with) — never from client input.
//
// R-02 (refinements catalog 2026-08-10) — the SAME server-session pattern now carries the org:
// the registration-time org determination (persisted as `User.org_type`, fail-closed to EXTERNAL
// at src/app/api/auth/register/route.ts) is read from the session and handed to the flow, so the
// onboarding UI never asks "Where do you build?" again — the whole org-gated flow runs off this
// single persisted determination, and a non-Primerica user sees zero Primerica strings.

import { OrgType, Role } from '@prisma/client';

import { getCurrentSession } from '@/lib/auth/session';

import OnboardingFlow from './OnboardingFlow';

// Reads the live session (server component) — never statically prerender the onboarding entry.
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getCurrentSession();
  const role = (session?.user?.role as Role | undefined) ?? Role.REP;
  // R-02 — the persisted org, read from the SERVER session like the role; fails closed to the
  // universal branch (EXTERNAL), mirroring the registration route's own fail-closed resolution.
  const orgType = (session?.user?.orgType as OrgType | undefined) ?? OrgType.EXTERNAL;
  return <OnboardingFlow role={role} orgType={orgType} />;
}
