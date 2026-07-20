// T-R22 (LOW/UX remediation from the T-40R re-QC, master-spec §10.6, §2.5 upline-visibility
// boundary) — GET /api/messaging/handoff/join's missing companion READ: before this route, the
// invited upline had no way to even SEE which bridges were waiting on them (POST /join was
// API-reachable only). This route lists the CALLER's own pending (still-INVITED, joinable) bridges
// so the new `/team` surface has something real to render a "Join" affordance over.
//
// ORG / OWNERSHIP boundary (§2.5) — CONSUMED, not reimplemented: this route never accepts a client-
// supplied upline id or organization id. It resolves the caller's OWN, live `organization_id` from
// the database (same re-fetch-from-DB convention as the sibling trigger route, deliberately never
// trusting the possibly-stale JWT `organizationId` claim for an org-gating-critical read), then
// hands `(identity.userId, organization_id)` to `ThreeWayHandoffService.visibleToUpline` — the same
// method T-39 already built and proved org/upline-scoped (three-way-handoff.service.test.ts). A rep
// with no organization on file sees an empty list (fail-closed), never an unscoped read.
//
// NO CONTACT PII, NO CONVERSATION CONTENT: a `ThreeWayHandoff` row never carries contact PII or
// message bodies (see the model's own doc comment) — this route hydrates ONLY the inviting rep's
// display name for the pre-join list. Per §2.5, conversation content is surfaced to the upline only
// once they have actually JOINED (via POST /join), so this list intentionally omits contact/thread
// detail even though it could join across `contact_id` — showing "who is asking", not "who they're
// talking to".
//
// Session-gated (withOnboardingGate); reads no `x-user-id`. Lazy, in-handler construction.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import {
  ThreeWayHandoffService,
  type ThreeWayHandoffPrismaClient,
} from '@/services/messaging/handoff/three-way-handoff.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  // Re-derive the caller's OWN organization live from the DB (never the client, never a query
  // param) — the same convention `handoff/trigger/route.ts` uses for this exact org-gating read.
  const me = await prisma.user.findUnique({
    where: { id: identity.userId },
    select: { organization_id: true },
  });

  // No organization on file → nothing this caller could legitimately be an upline within. Fail
  // closed to an empty list rather than an unscoped/organization-less query.
  if (!me?.organization_id) {
    return NextResponse.json({ count: 0, items: [] });
  }

  const service = new ThreeWayHandoffService(prisma as unknown as ThreeWayHandoffPrismaClient);
  const rows = await service.visibleToUpline(identity.userId, me.organization_id);
  const pending = rows.filter((r) => r.state === 'INVITED');

  // Hydrate ONLY the inviting rep's display name (never the contact's) for the list. Batched, not
  // N+1.
  const repIds = Array.from(new Set(pending.map((r) => r.user_id)));
  const reps = repIds.length
    ? await prisma.user.findMany({ where: { id: { in: repIds } }, select: { id: true, name: true } })
    : [];
  const repNameById = new Map(reps.map((r) => [r.id, r.name]));

  const items = pending.map((r) => ({
    id: r.id,
    repName: repNameById.get(r.user_id) ?? 'A rep on your team',
    triggerReason: r.trigger_reason,
    invitedAt: r.invited_at,
    returnDeadlineAt: r.return_deadline_at,
  }));

  return NextResponse.json({ count: items.length, items });
});
