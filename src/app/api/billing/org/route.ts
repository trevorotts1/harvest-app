// WP10 — GET org / downline-sponsored billing status (§15.6; qc-checklist WP10 checkpoint 9).
//
// BILLING RBAC AT THE GATEWAY (§15.6 / §16.6 row 6 "Billing (downline/org-sponsored)"): read is
// granted to UPLINE / RVP / ADMIN only — a REP hitting this gets 403 (deny-by-default via the
// authoritative matrix `can(role, 'billing_org', 'read')`). ORG ISOLATION: the data is scoped to the
// caller's OWN organization; a request for any OTHER org's data returns 404 (cross-org → 404), the
// one exception being an ADMIN with cross-org visibility (§16.6 row 9).

import { NextResponse } from 'next/server';
import { Role } from '@prisma/client';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { can } from '@/lib/auth/rbac-matrix';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  // ── Billing RBAC at the gateway (deny-by-default). ──
  if (!can(identity.role, 'billing_org', 'read')) {
    return NextResponse.json(
      { error: 'Not permitted to view org billing (§16.6 row 6).', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  const callerOrg = identity.organizationId;
  const requestedOrg = new URL(req.url).searchParams.get('orgId');

  // ── Org isolation: resolve the target org, cross-org → 404 (unless ADMIN cross-org). ──
  const isAdminCrossOrg = identity.role === Role.ADMIN && can(identity.role, 'cross_org', 'read');
  let targetOrg: string | null;
  if (requestedOrg && requestedOrg !== callerOrg) {
    if (!isAdminCrossOrg) {
      // Deny existence of another org's billing — 404, not 403, so cross-org presence isn't leaked.
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
    targetOrg = requestedOrg;
  } else {
    targetOrg = callerOrg;
  }

  if (!targetOrg) {
    // No org context → nothing to show (a rep-only account with no org can't reach this data).
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const sponsorships = await db.sponsorship.findMany({
    where: { organization_id: targetOrg },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      member_user_id: true,
      sponsor_user_id: true,
      state: true,
      term_start: true,
      term_end: true,
      grace_until: true,
    },
  });

  return NextResponse.json({
    organization_id: targetOrg,
    seats: sponsorships.map(
      (s: {
        id: string;
        member_user_id: string;
        sponsor_user_id: string;
        state: string;
        term_start: Date | null;
        term_end: Date | null;
        grace_until: Date | null;
      }) => ({
        sponsorship_id: s.id,
        member_user_id: s.member_user_id,
        sponsor_user_id: s.sponsor_user_id,
        state: s.state,
        term_start: s.term_start?.toISOString() ?? null,
        term_end: s.term_end?.toISOString() ?? null,
        grace_until: s.grace_until?.toISOString() ?? null,
      })
    ),
    _meta: { demo: false },
  });
});
