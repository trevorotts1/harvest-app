// T-33 — POST /api/approval-inbox/decline: decline/discard EXACTLY ONE draft (master-spec §9.2;
// uiux §5.6 "the decline reason selector" / AC-5.6-9 "the reason selector always intercepts
// declines"). Body: `{ draftId: string, reason: 'not_my_voice'|'wrong_person'|'wrong_time'|'other',
// note?: string }`. Same no-batch guard and ownership-scoping as the approve route.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import {
  ApprovalInboxService,
  DECLINE_REASONS,
  type ApprovalInboxPrismaClient,
} from '@/services/approval-inbox/approval-inbox.service';
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

  const { draftId, reason, note } = body as { draftId?: unknown; reason?: unknown; note?: unknown };
  if (!draftId || typeof draftId !== 'string') {
    return NextResponse.json({ error: '"draftId" (a single string id) is required.' }, { status: 400 });
  }
  if (!reason || typeof reason !== 'string') {
    return NextResponse.json(
      { error: `"reason" is required — one of: ${DECLINE_REASONS.join(', ')}.` },
      { status: 400 }
    );
  }
  if (note !== undefined && typeof note !== 'string') {
    return NextResponse.json({ error: '"note" must be a string.' }, { status: 400 });
  }

  const service = new ApprovalInboxService(prisma as unknown as ApprovalInboxPrismaClient);
  const result = await service.declineDraft(identity.userId, draftId, reason, note ?? null);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }
    if (result.reason === 'invalid_reason') {
      return NextResponse.json(
        { error: `"reason" must be one of: ${DECLINE_REASONS.join(', ')}.` },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: `This draft cannot be declined from its current state (${result.currentState}).`,
        code: 'NOT_DECLINABLE',
        currentState: result.currentState,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, draft: result.draft });
});
