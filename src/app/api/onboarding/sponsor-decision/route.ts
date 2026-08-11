// R-08 (refinements catalog 2026-07-28) — the sponsor-outcome screen's buttons now persist a REAL
// choice server-side. This is the API half of the R-08 fix: `POST /api/onboarding/sponsor-decision`
// receives the rep's choice and records it on their registration/sponsorship row — for `accept`,
// a real `Sponsorship` + `OrgTreeEdge` + `User.upline_id` write (the exact `'linked'` outcome the
// §6.5 matcher produced is persisted, never a client-declared sponsor), and for the waitlist /
// "no upline yet" paths, the decision is recorded on the session's `sponsor_decision` JSON so the
// terminal `/complete` gate (and the admin audit surface) can read what actually happened — the
// buttons no longer evaporate client-side.
//
// WHY A DEDICATED ROUTE (not a new `/step`): `SPONSOR_MATCHING` exists as an `OnboardingStep`
// enum member but is in NO role's `ROLE_STEP_MAP` (types/onboarding.ts — documented at
// onboarding-step-client.ts:129) and the `/step` route 400s on any step that does not match its
// own persisted position. The sponsor screen is a UI sub-step the track shell does not enumerate
// (the same reason `contacts`/`reveal` fire no `/step` call — see `REP_SCREEN_STEP_PLAN`). This
// route is session-authenticated (`withRole`) and keyed by `authSession.user.id` — a caller can
// only ever record THEIR OWN sponsor decision, and only a choice the server's own matcher could
// have produced.
//
// FAIL-CLOSED SHAPE: `accept` requires the submitted sponsor id to be the SAME id the server's
// own real-pool matcher would have chosen for this rep (same org type, same policy, same
// least-loaded rule — `resolveSponsorCandidatePool` + `matchSponsor` with the rep's own persisted
// org type from the real `User` row). A tampered/unknown sponsor id, a sponsor id that resolves to
// waitlist, a non-rep role, or a rep with no org context yet all 400 — nothing is persisted and
// nothing is fabricated. The other paths (`join_waitlist`, `start_paid`, `no_upline_yet`) accept
// no sponsor id at all and only record the honest choice.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Role } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { withRole } from '@/lib/auth/with-role';
import {
  resolveSponsorCandidatePool,
  type SponsorCandidatePrismaClient,
} from '@/services/onboarding/wp01/sponsor-candidates.server';
import { matchSponsor, type SponsorCandidate } from '@/services/onboarding/wp01/sponsor-matching';

// Allow-list: every role runs onboarding. The route's own guards enforce the rep-only, RVP-excluded
// decision surface.
const ALL_ROLES = Object.values(Role);

export const dynamic = 'force-dynamic';

const DECISION_VALUES = ['accept', 'join_waitlist', 'start_paid', 'no_upline_yet'] as const;
type DecisionValue = (typeof DECISION_VALUES)[number];

function isDecisionValue(value: unknown): value is DecisionValue {
  return typeof value === 'string' && (DECISION_VALUES as readonly string[]).includes(value);
}

/**
 * GET the rep's REAL sponsor candidate pool — the fix's pool-resolution surface. Resolved from
 * actual platform state: same-org-type, sponsor-eligible, never-RVP users (R-01's pairing policy),
 * ranked with linkage-row holders (sponsorship/org-tree/upline) first, display names from the
 * candidates' real `User.name`. Empty ONLY when no eligible candidate genuinely exists — the
 * matcher's honest waitlist condition, never a hard-coded empty array.
 */
export const GET = withRole(ALL_ROLES, async (_req: NextRequest, _ctx, authSession) => {
  try {
    const userId = authSession.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, org_type: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'Onboarding session not found' }, { status: 404 });
    }
    if (user.role !== Role.REP) {
      // The sponsor surface only exists for the rep track — an RVP is never offered a pairing
      // (R-01); any other role's call gets the honest empty pool, never a fabricated one.
      return NextResponse.json({ ok: true, candidates: [] });
    }

    const suspended = await prisma.user.findMany({
      where: { is_suspended: true },
      select: { id: true },
    });
    const pool = await resolveSponsorCandidatePool(prisma as unknown as SponsorCandidatePrismaClient, {
      orgType: user.org_type,
      repUserId: userId,
      suspendedUserIds: suspended.map((s) => s.id),
    });

    const candidates = pool.length === 0 ? [] : await prisma.user.findMany({
      where: { id: { in: pool.map((c) => c.userId) } },
      select: { id: true, name: true },
    });

    // Preserve the resolver's deterministic order AND carry each candidate's REAL
    // active-sponsorship load — the client's displayed verdict (`matchSponsor` over this same
    // payload) is then identical to the server's accept-time re-derivation: the id a rep sees as
    // "your matched sponsor" is exactly the id the accept route will verify and persist.
    const byPoolOrder = new Map(pool.map((c, index) => [c.userId, index]));
    candidates.sort((a, b) => (byPoolOrder.get(a.id) ?? 0) - (byPoolOrder.get(b.id) ?? 0));
    const loadByUserId = new Map(pool.map((c) => [c.userId, c.activeSponsorshipCount]));

    return NextResponse.json({
      ok: true,
      candidates: candidates.map((c) => ({
        userId: c.id,
        name: c.name,
        activeSponsorshipCount: loadByUserId.get(c.id) ?? 0,
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

export const POST = withRole(ALL_ROLES, async (req: NextRequest, _ctx, authSession) => {
  try {
    const userId = authSession.user.id;

    let body: { decision?: unknown; sponsorId?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!isDecisionValue(body.decision)) {
      return NextResponse.json({ error: 'A valid decision is required' }, { status: 400 });
    }

    // Tampered input fails closed: a sponsor id is ONLY meaningful for `accept`, and only the id the
    // server's own matcher would have chosen. Any id on another decision is rejected outright — a
    // waitlist/no-upline choice can never silently carry a sponsor.
    const sponsorId = typeof body.sponsorId === 'string' && body.sponsorId.trim() !== '' ? body.sponsorId : null;
    if (body.decision !== 'accept' && sponsorId) {
      return NextResponse.json({ error: 'sponsorId is only accepted with decision "accept"' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, org_type: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'Onboarding session not found' }, { status: 404 });
    }

    // The sponsor surface only exists for the rep track (non-RVP). An RVP must never be paired —
    // R-01's pairing policy is the single role-keyed source of truth, enforced here server-side so
    // a stale/forged client can never pair an RVP (their own screen already skips the step).
    if (user.role !== Role.REP) {
      return NextResponse.json({ error: 'Only REP accounts use sponsor matching' }, { status: 400 });
    }

    if (body.decision === 'accept') {
      if (!sponsorId) {
        return NextResponse.json({ error: 'decision "accept" requires a sponsorId' }, { status: 400 });
      }

      // Re-resolve the real pool and run the SAME pure matcher the flow's preview used, with the
      // rep's real persisted org type (never a client-supplied one) and each candidate's REAL
      // active-sponsorship load (the least-loaded rule genuinely load-balances). The submitted id
      // must be the matcher's own choice — a fabricated or out-of-pool sponsor id can never be
      // persisted. A suspended account cannot carry a sponsorship (§16.4, T-R56 — `User.is_suspended`
      // is the account-hold flag; sign-in enforcement lives in auth/options.ts authorize()).
      const suspended = await prisma.user.findMany({
        where: { is_suspended: true },
        select: { id: true },
      });
      const pool = await resolveSponsorCandidatePool(prisma as unknown as SponsorCandidatePrismaClient, {
        orgType: user.org_type,
        repUserId: userId,
        suspendedUserIds: suspended.map((s) => s.id),
      });
      if (pool.length === 0) {
        return NextResponse.json({ error: 'No sponsor is available for your organization' }, { status: 409 });
      }
      const candidates: SponsorCandidate[] = pool.map((c) => ({
        userId: c.userId,
        orgType: user.org_type,
        activeSponsorshipCount: c.activeSponsorshipCount,
      }));
      const outcome = matchSponsor({ orgType: user.org_type, candidates }, new Date());
      if (outcome.kind !== 'linked' || outcome.sponsorId !== sponsorId) {
        return NextResponse.json({ error: 'That sponsor is not available' }, { status: 409 });
      }

      // Persist the REAL `'linked'` outcome: the Sponsorship row (ACTIVE, one-year term), the
      // OrgTreeEdge row, and the registration-sponsorship link on the rep's own User row
      // (`upline_id` — the column the app's upline/org-tree surfaces actually read; see
      // messaging/handoff/trigger, team-calendar/dashboard). Atomic: either all land or none.
      const now = new Date();
      const termEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      await prisma.$transaction([
        prisma.sponsorship.create({
          data: {
            sponsor_user_id: outcome.sponsorId,
            member_user_id: userId,
            organization_id: user.org_type,
            state: 'ACTIVE',
            term_start: now,
            term_end: termEnd,
          },
        }),
        prisma.orgTreeEdge.create({
          data: {
            sponsor_id: outcome.sponsorId,
            recruit_id: userId,
            edge_type: 'upline_sponsor',
            is_recruit_confirmed: true,
          },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { upline_id: outcome.sponsorId },
        }),
      ]);

      return NextResponse.json({ ok: true, outcome: 'linked', sponsorId: outcome.sponsorId });
    }

    // Waitlist / paid-path / "no upline yet": nothing to persist yet (there is no sponsor
    // relationship — the whole point of the waitlist state) — only the honest decision is
    // recorded on the session row so `/complete` and the audit surface can read it.
    await prisma.onboardingSession.updateMany({
      where: { user_id: userId },
      data: { sponsor_decision: { decision: body.decision, recordedAt: new Date().toISOString() } },
    });

    return NextResponse.json({ ok: true, outcome: body.decision });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
