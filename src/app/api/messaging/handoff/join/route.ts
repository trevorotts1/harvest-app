// T-40R (WP05 GATE remediation, master-spec §10.6) — POST /api/messaging/handoff/join: the invited
// upline joins the three-way. Body: `{ handoffId: string }`. The joiner is the VERIFIED session user
// (the upline), never a client-forged id.
//
// ORG / OWNERSHIP boundary (§2.5): the join is authorized inside `ThreeWayHandoffService.join`, which
// permits a join ONLY when the session user IS this handoff's `upline_id` and the handoff is still
// INVITED. Anyone who is not the invited upline gets NOT_YOUR_HANDOFF (a 404 here — never a leak of a
// handoff that isn't theirs); a non-INVITED handoff gets NOT_JOINABLE (409). Conversation content is
// only ever surfaced to the upline once they have JOINED, consistent with the RBAC boundary.
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

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { handoffId } = body as { handoffId?: unknown };
  if (!handoffId || typeof handoffId !== 'string') {
    return NextResponse.json({ error: '"handoffId" (a single string id) is required.' }, { status: 400 });
  }

  const service = new ThreeWayHandoffService(prisma as unknown as ThreeWayHandoffPrismaClient);
  // identity.userId is the joining upline — the service checks it against the handoff's upline_id.
  const result = await service.join(identity.userId, handoffId);

  if (!result.ok) {
    if (result.code === 'NOT_JOINABLE') {
      return NextResponse.json(
        { error: 'This handoff can no longer be joined.', code: 'NOT_JOINABLE' },
        { status: 409 }
      );
    }
    // NOT_FOUND or NOT_YOUR_HANDOFF both resolve to a plain 404 — never distinguish "does not exist"
    // from "is not yours" (no leak of another rep-line's handoff).
    return NextResponse.json({ error: 'Handoff not found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    handoff: { id: result.handoff.id, state: result.handoff.state, joinedAt: result.handoff.joined_at },
  });
});
