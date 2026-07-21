// T-09 (master-spec §5.5 AC-3b) — POST /api/compliance-review/adjudicate: an UPLINE adjudicates ONE
// flagged item. Body: `{ queueId | draftId, action: 'APPROVE'|'REJECT'|'MODIFY', feedback?, body? }`.
//
// Session-gated (`withOnboardingGate`, never x-user-id); RBAC via the §16.6 `compliance_audit.approve`
// capability (UPLINE/RVP/ADMIN + DUAL union) — the previously-DEAD grant this unit finally consumes.
// Strict org-scoping + the fail-closed HELD/BLOCK refusal + the immutable audit write all live inside
// `CfeAdjudicationService.adjudicate`. A cross-org / nonexistent target is `not_found` → 404 (never a
// leaky 403). Per-item only — there is no batch/array shape on this contract.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { hasCapability } from '@/lib/auth/rbac';
import {
  CfeAdjudicationService,
  type AdjudicationAction,
  type CfeAdjudicationPrismaClient,
} from '@/services/compliance/adjudication';

export const dynamic = 'force-dynamic';

const ACTIONS: readonly AdjudicationAction[] = ['APPROVE', 'REJECT', 'MODIFY'];

export const POST = withOnboardingGate(async (req, _ctx, session, identity) => {
  if (!hasCapability(session, 'compliance_audit', 'approve')) {
    return NextResponse.json(
      { error: 'You are not permitted to adjudicate flagged content (§16.6 compliance_audit.approve).' },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { queueId, draftId, action, feedback, body: newBody } = body as {
    queueId?: unknown;
    draftId?: unknown;
    action?: unknown;
    feedback?: unknown;
    body?: unknown;
  };

  if (typeof action !== 'string' || !ACTIONS.includes(action as AdjudicationAction)) {
    return NextResponse.json({ error: '"action" must be one of APPROVE | REJECT | MODIFY.' }, { status: 400 });
  }
  if ((queueId === undefined || queueId === null) && (draftId === undefined || draftId === null)) {
    return NextResponse.json({ error: 'Either "queueId" or "draftId" (a single string id) is required.' }, { status: 400 });
  }
  if (queueId !== undefined && queueId !== null && typeof queueId !== 'string') {
    return NextResponse.json({ error: '"queueId" must be a single string id.' }, { status: 400 });
  }
  if (draftId !== undefined && draftId !== null && typeof draftId !== 'string') {
    return NextResponse.json({ error: '"draftId" must be a single string id.' }, { status: 400 });
  }

  const service = new CfeAdjudicationService({ prisma: prisma as unknown as CfeAdjudicationPrismaClient });
  const result = await service.adjudicate(
    { id: identity.userId, role: identity.role, organizationId: identity.organizationId },
    {
      queueId: typeof queueId === 'string' ? queueId : undefined,
      draftId: typeof draftId === 'string' ? draftId : undefined,
      action: action as AdjudicationAction,
      feedback: typeof feedback === 'string' ? feedback : null,
      newBody: typeof newBody === 'string' ? newBody : null,
    }
  );

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'Review item not found' }, { status: 404 });
    }
    if (result.reason === 'empty_body') {
      return NextResponse.json({ error: 'A MODIFY requires a non-empty "body".', code: 'EMPTY_BODY' }, { status: 400 });
    }
    if (result.reason === 'invalid_action') {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    // not_adjudicable — a HELD/BLOCK or already-terminal draft. Mirrors the CFE's own refusal: a
    // held/blocked item cannot be approved by ANY path, upline included (§5.2, fail-closed).
    return NextResponse.json(
      {
        error: `This item cannot be ${result.currentState === 'HELD' ? 'approved' : 'adjudicated'} from its current state (${result.currentState}).`,
        code: 'NOT_ADJUDICABLE',
        currentState: result.currentState,
        cfeOutcome: result.cfeOutcome,
      },
      { status: 403 }
    );
  }

  return NextResponse.json(result);
});
