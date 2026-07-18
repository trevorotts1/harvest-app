// T-33 — POST /api/approval-inbox/approve: approve EXACTLY ONE draft (master-spec §9.2/§9.9-2/
// §9.9-3; uiux AC-5.6-2 "no batch-approve affordance exists"). Body: `{ draftId: string }` — there is
// no array/plural field on this contract anywhere, and `rejectBatchApprove` (§8.5-style
// architectural guard, mirroring T-27's action-boundary.ts) refuses one explicitly if a caller tries
// to smuggle one in, before the service ever runs.
//
// Session-gated (withOnboardingGate, never x-user-id); ownership is enforced inside
// `ApprovalInboxService.approveDraft` (a draftId not owned by the session user resolves to
// `not_found`, not a leak-y 403).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ApprovalInboxService, type ApprovalInboxPrismaClient } from '@/services/approval-inbox/approval-inbox.service';
import { ApprovalAntiPatternBlockedError, rejectBatchApprove } from '@/services/approval-inbox/approval-boundary';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    // THE NO-BATCH-APPROVE GUARD — must run before any field is read out of `body`.
    rejectBatchApprove(body);
  } catch (error) {
    if (error instanceof ApprovalAntiPatternBlockedError) {
      return NextResponse.json(
        { error: error.message, code: 'ANTI_PATTERN_BLOCKED', antiPattern: error.antiPattern },
        { status: 400 }
      );
    }
    throw error;
  }

  const { draftId } = body as { draftId?: unknown };
  if (!draftId || typeof draftId !== 'string') {
    return NextResponse.json({ error: '"draftId" (a single string id) is required.' }, { status: 400 });
  }

  const service = new ApprovalInboxService(prisma as unknown as ApprovalInboxPrismaClient);
  const result = await service.approveDraft(identity.userId, draftId);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }
    // not_approvable — a HELD/blocked/already-terminal draft. Mirrors the CFE's own 403 for a
    // blocked verdict (uiux AC-5.6-4: "cannot be approved by any UI path").
    return NextResponse.json(
      {
        error: `This draft cannot be approved from its current state (${result.currentState}).`,
        code: 'NOT_APPROVABLE',
        currentState: result.currentState,
      },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true, draft: result.draft });
});
