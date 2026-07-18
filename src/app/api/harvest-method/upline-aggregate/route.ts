import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withCapability } from '@/lib/auth/with-role';
import { MethodLayer } from '@/types/harvest-method';
import { assertAggregateOnly, computeUplineAggregateStats, type RepMethodSummary } from '@/services/harvest-method/upline-aggregate';

// T-26 (§8.4/§16.6) — "upline visibility of aggregate stats only ... never individual names,
// background, or scores." RBAC-gated on the §16.6 `downline_visibility` capability (rbac-matrix.ts
// row 2: upline=team, rvp=org-wide, admin=full) via `withCapability`, PLUS a same-organization
// defense-in-depth check (a role grant alone does not imply cross-org visibility, §17.2/§16.6 row 9).
//
// The "without explicit rep opt-in" consent gate this WP03 unit's brief names is the Mission
// Control/WP09 surface's job to collect and enforce (there is no consent record to check yet in
// this build unit's lane) — what THIS route guarantees is that whatever it returns, with or without
// that future consent check layered in front of it, can only ever be an aggregate: `assertAggregateOnly`
// throws (never silently strips) if the assembled payload ever picks up a contact-identifying field.
export const dynamic = 'force-dynamic';

export const GET = withCapability('downline_visibility', 'read', async (req: NextRequest, _ctx, session) => {
  const repUserId = req.nextUrl.searchParams.get('repUserId');
  if (!repUserId) {
    return NextResponse.json({ error: 'repUserId query parameter is required' }, { status: 400 });
  }

  const [caller, targetRep] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { organization_id: true, role: true } }),
    prisma.user.findUnique({ where: { id: repUserId }, select: { organization_id: true } }),
  ]);

  if (!targetRep) {
    return NextResponse.json({ error: 'Rep not found' }, { status: 404 });
  }

  // Defense-in-depth: a `downline_visibility: read` grant is a CAPABILITY, not a cross-org pass
  // (§17.2/§16.6 row 9 "cross-org visibility is gated behind admin approval"). ADMIN is exempt from
  // the same-org check (full visibility, §16.6); every other granted role must share an org.
  const sameOrg = caller?.organization_id != null && caller.organization_id === targetRep.organization_id;
  if (session.user.role !== 'ADMIN' && !sameOrg) {
    return NextResponse.json({ error: 'Cross-organization visibility requires admin approval (§17.2)' }, { status: 403 });
  }

  const [methodState, profiles] = await Promise.all([
    prisma.harvestMethodState.findUnique({ where: { user_id: repUserId } }),
    prisma.contactMethodProfile.findMany({
      where: { user_id: repUserId, is_seed: true },
      select: { readiness_score: true, readiness_tier: true },
    }),
  ]);

  const layersCompleted: MethodLayer[] = [];
  if (methodState?.blank_canvas_completed_at) layersCompleted.push(MethodLayer.BLANK_CANVAS);
  if (methodState?.qualities_flip_completed_at) layersCompleted.push(MethodLayer.QUALITIES_FLIP);
  if (methodState?.background_matching_completed_at) layersCompleted.push(MethodLayer.BACKGROUND_MATCHING);

  const summary: RepMethodSummary = {
    layersCompleted,
    entries: profiles
      .filter((p) => p.readiness_tier != null && p.readiness_score != null)
      .map((p) => ({ tier: p.readiness_tier!, score: p.readiness_score! })),
  };

  const stats = computeUplineAggregateStats(summary);
  assertAggregateOnly(stats);

  return NextResponse.json(stats);
});
