// T-33 — POST /api/approval-inbox/edit: edit EXACTLY ONE draft's content — and, unconditionally,
// RE-ENTER THE CFE before the edited text can be approved/sent (master-spec §9.2/§9.9-2, §5.5;
// uiux §5.6 "any edit re-enters the CFE ... actions disabled until the new band returns", AC-5.6-3).
//
// This route does not itself call the CFE — `ApprovalInboxService.editDraft` does, exactly once,
// BEFORE persisting the new body/state (see that method's own header comment for the fail-closed
// guarantee). This route only wires the session-derived identity + role through, applies the same
// no-batch guard as approve/decline (an edit is still a per-item action; no array/plural draftId
// field is accepted here either), and translates the service result into the HTTP contract the uiux
// spec describes: a held/blocked re-check renders as a 200 with `approvalState: 'HELD'` (never a
// silent 403 — the rep needs to SEE the new band, uiux §5.6 "the new band replaces the old").

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

  const { draftId, body: newBody } = body as { draftId?: unknown; body?: unknown };
  if (!draftId || typeof draftId !== 'string') {
    return NextResponse.json({ error: '"draftId" (a single string id) is required.' }, { status: 400 });
  }
  if (typeof newBody !== 'string') {
    return NextResponse.json({ error: '"body" (the edited text) must be a string.' }, { status: 400 });
  }

  // Lazy: constructed per-request. `ApprovalInboxService`'s default `ComplianceFilterEngine` reads no
  // key at construction (only `evaluateContent`, called inside `editDraft`, does) — build-safe.
  const service = new ApprovalInboxService(prisma as unknown as ApprovalInboxPrismaClient);
  const result = await service.editDraft(identity.userId, draftId, newBody, identity.role);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }
    if (result.reason === 'empty_body') {
      return NextResponse.json({ error: '"body" cannot be empty.' }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: `A declined draft cannot be edited (current state: ${result.currentState}) — start a new draft instead.`,
        code: 'TERMINAL_STATE',
        currentState: result.currentState,
      },
      { status: 409 }
    );
  }

  // The re-checked band ALWAYS replaces the old one in the response — never the pre-edit verdict.
  return NextResponse.json({
    ok: true,
    draft: result.draft,
    cfe: {
      band: result.verdict.band,
      score: result.verdict.score,
      held: result.verdict.held,
      released: result.verdict.released,
    },
  });
});
