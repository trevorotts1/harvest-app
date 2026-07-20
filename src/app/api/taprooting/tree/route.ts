// WP08 §13.1/§13.4/§13.5 — GET the org tree / orchard (or the universal rings view). Session-gated
// via `withOnboardingGate` (never a client-forged `x-user-id`); optional `?repId=` lets an
// upline/rvp/admin drill into ONE of their own downline's subtrees (RBAC + reachability-checked in
// `getOrgTreeView` — never trusts the query param). Recomputes and persists the WP08-owned
// `OrgTreeEdge` columns on every read (see taprooting.service.ts's module doc for why this is what
// makes the org-switch instant-wipe property true without a cache to invalidate).
//
// §13.4 "at the moment of completion": when a rep opens their OWN tree (no `?repId=`), this route
// runs the FULL milestone-detection pass first (recruit/leg/team/leader Milestone rows + the
// phase-timeline auto-items) — the lowest-latency real production caller for detection, since a
// rep who just had a recruit confirmed sees it reflected the instant they next open `/grow`,
// without waiting for the once-daily sweep (`sweep.ts`/`taprooting-inngest-functions.ts`, which
// still covers stagnation and any rep who never revisits the app). Best-effort: a detection hiccup
// is swallowed (logged, not thrown) so a transient failure here never breaks the tree READ itself —
// the daily sweep will catch it on the next tick regardless.
//
// Lazy, in-handler construction only (no module-scope secret/client construction, §0.4 rule 2).

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { getOrgTreeView } from '@/services/taprooting/taprooting.service';
import { runMilestoneDetection } from '@/services/taprooting/milestone-detection.service';
import { buildLicensingService } from '@/services/taprooting/timeline.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (req, _ctx, session, identity) => {
  const repId = req.nextUrl.searchParams.get('repId') ?? undefined;

  if (!repId) {
    try {
      await runMilestoneDetection(identity.userId, buildLicensingService());
    } catch {
      // Best-effort — see module doc above; the daily sweep is the backstop.
    }
  }

  const outcome = await getOrgTreeView(identity.userId, session.user.role, repId);
  if (!outcome.ok) {
    // Never distinguish "doesn't exist" from "not yours to see" (§16.6/§18.10).
    return NextResponse.json({ error: 'Org tree not found' }, { status: 404 });
  }
  return NextResponse.json(outcome.result);
});
