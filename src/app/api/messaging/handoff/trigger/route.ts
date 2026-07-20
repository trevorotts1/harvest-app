// T-40R (WP05 GATE remediation, master-spec §10.5/§10.6; uiux §5.7 "bridge my upline") — POST
// /api/messaging/handoff/trigger: the rep's "bridge my upline into this conversation" action. Body:
// `{ contactId: string, reason: 'BUYING_SIGNAL' | 'HARD_QUESTION' | 'MANUAL', threadId?: string }`.
//
// Before T-40R, `ThreeWayHandoffService.trigger` and `EdificationService.generate` had no reachable
// caller. This route wires BOTH: it resolves the rep's upline (from `User.upline_id`), generates the
// doctrine-safe edification script introducing that upline (§10.6 "CFE-cleared before display" — the
// deterministic vocabulary screen is the fail-closed DISPLAY floor here; the copy is withheld unless
// `displayable`), and bridges the upline via the ORG-GATED handoff (the handoff row carries the rep's
// `organization_id`, and upline visibility filters on org + upline id — §2.5, enforced in the service).
//
// Session-gated (withOnboardingGate); no `x-user-id` is read. Ownership: the contact must belong to
// the session rep (404 otherwise). Fails closed if the rep has no upline on file (409 NO_UPLINE) or no
// organization on the session (400). Lazy, in-handler construction.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import {
  ThreeWayHandoffService,
  type ThreeWayHandoffPrismaClient,
  type TriggerReason,
} from '@/services/messaging/handoff/three-way-handoff.service';
import { EdificationService } from '@/services/messaging/edification/edification.service';

export const dynamic = 'force-dynamic';

const VALID_REASONS: readonly TriggerReason[] = ['BUYING_SIGNAL', 'HARD_QUESTION', 'MANUAL'];

function isTriggerReason(value: unknown): value is TriggerReason {
  return typeof value === 'string' && (VALID_REASONS as readonly string[]).includes(value);
}

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { contactId, reason, threadId } = body as { contactId?: unknown; reason?: unknown; threadId?: unknown };
  if (!contactId || typeof contactId !== 'string') {
    return NextResponse.json({ error: '"contactId" (a single string id) is required.' }, { status: 400 });
  }
  if (!isTriggerReason(reason)) {
    return NextResponse.json(
      { error: '"reason" must be one of BUYING_SIGNAL | HARD_QUESTION | MANUAL.' },
      { status: 400 }
    );
  }
  if (threadId !== undefined && threadId !== null && typeof threadId !== 'string') {
    return NextResponse.json({ error: '"threadId" must be a string when provided.' }, { status: 400 });
  }

  // Ownership: the contact must belong to THIS rep (404 otherwise, never a leak).
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, user_id: identity.userId },
    select: { id: true },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  // Resolve the rep (for their upline + org + display name).
  const rep = await prisma.user.findUnique({
    where: { id: identity.userId },
    select: { id: true, name: true, upline_id: true, organization_id: true },
  });
  if (!rep) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }
  if (!rep.organization_id) {
    return NextResponse.json(
      { error: 'A three-way handoff requires an organization on your account.', code: 'NO_ORGANIZATION' },
      { status: 400 }
    );
  }
  if (!rep.upline_id) {
    // Fail closed: nothing to bridge (mirrors ThreeWayHandoffService.trigger's own NO_UPLINE).
    return NextResponse.json(
      { error: 'You do not have an upline on file to bridge into this conversation.', code: 'NO_UPLINE' },
      { status: 409 }
    );
  }

  const upline = await prisma.user.findUnique({
    where: { id: rep.upline_id },
    select: { name: true, rank: true },
  });
  if (!upline) {
    return NextResponse.json(
      { error: 'Your upline could not be found to bridge into this conversation.', code: 'NO_UPLINE' },
      { status: 409 }
    );
  }

  // Wire the edification script (§10.6). The deterministic vocabulary screen is the fail-closed DISPLAY
  // floor — if the copy is not `displayable` (doctrine-vocabulary hit), it is withheld, never shown.
  const edification = new EdificationService().generate(rep.name, {
    displayName: upline.name,
    rank: upline.rank,
  });

  const service = new ThreeWayHandoffService(prisma as unknown as ThreeWayHandoffPrismaClient);
  const result = await service.trigger({
    userId: identity.userId,
    contactId,
    uplineId: rep.upline_id,
    organizationId: rep.organization_id,
    threadId: (threadId as string | null | undefined) ?? null,
    reason,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: 'You do not have an upline on file to bridge into this conversation.', code: 'NO_UPLINE' },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    handoff: {
      id: result.handoff.id,
      state: result.handoff.state,
      triggerReason: result.handoff.trigger_reason,
      returnDeadlineAt: result.handoff.return_deadline_at,
    },
    // The edification copy the rep can use to warm-introduce their upline — withheld (null) unless it
    // clears the deterministic doctrine-vocabulary floor (§10.6 "CFE-cleared before display").
    edification: edification.displayable ? edification.script : null,
    edificationDisplayable: edification.displayable,
  });
});
