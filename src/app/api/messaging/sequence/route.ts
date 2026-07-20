// T-40R (WP05 GATE remediation, master-spec §10.2) — POST /api/messaging/sequence: enroll a contact
// into a doctrine-safe outreach cadence (FAST_TRACK | STANDARD | NURTURE | RE_ENGAGEMENT). Body:
// `{ contactId: string, sequenceType: SequenceType, stepDraftIds?: (string|null)[], intervalDays?: number[] }`.
//
// This is the rep-facing WRITE that was missing: before T-40R, `SequenceService.enroll` had no reachable
// caller, so a rep could never start a sequence. Enrollment only CREATES the sequence + its scheduled
// steps — it sends nothing. Each later step is fired by the hourly cadence cron
// (sequence-scheduled-run.ts) THROUGH the fully-gated T-37 seam (CFE + SendComplianceGate +
// deliverability); this route opens no send path of its own.
//
// Session-gated (withOnboardingGate) — identity comes from the VERIFIED session, never a client-forged
// `x-user-id` (this route reads no such header). Ownership: the contact MUST belong to the session rep,
// or this is a 404 (indistinguishable from "does not exist", never a leak). Lazy, in-handler
// construction (no module-scope key read).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildSequenceService } from '@/services/messaging/send/production-wiring';
import { isSequenceType } from '@/services/messaging/sequence/sequence-cadence';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { contactId, sequenceType, stepDraftIds, intervalDays } = body as {
    contactId?: unknown;
    sequenceType?: unknown;
    stepDraftIds?: unknown;
    intervalDays?: unknown;
  };

  if (!contactId || typeof contactId !== 'string') {
    return NextResponse.json({ error: '"contactId" (a single string id) is required.' }, { status: 400 });
  }
  if (!isSequenceType(sequenceType)) {
    return NextResponse.json(
      { error: '"sequenceType" must be one of FAST_TRACK | STANDARD | NURTURE | RE_ENGAGEMENT.' },
      { status: 400 }
    );
  }
  if (stepDraftIds !== undefined && !Array.isArray(stepDraftIds)) {
    return NextResponse.json({ error: '"stepDraftIds" must be an array when provided.' }, { status: 400 });
  }
  if (intervalDays !== undefined && (!Array.isArray(intervalDays) || !intervalDays.every((n) => typeof n === 'number'))) {
    return NextResponse.json({ error: '"intervalDays" must be an array of numbers when provided.' }, { status: 400 });
  }

  // Ownership: the contact must belong to THIS rep before we enroll it (never a 403, always a 404).
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, user_id: identity.userId },
    select: { id: true },
  });
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const service = buildSequenceService(prisma);
  const { sequence, steps } = await service.enroll({
    userId: identity.userId,
    contactId,
    sequenceType,
    stepDraftIds: stepDraftIds as (string | null)[] | undefined,
    intervalDays: intervalDays as number[] | undefined,
  });

  return NextResponse.json({
    ok: true,
    sequenceId: sequence.id,
    sequenceType: sequence.sequence_type,
    state: sequence.state,
    steps: steps.map((s) => ({
      stepIndex: s.step_index,
      channel: s.channel,
      scheduledAt: s.scheduled_at,
      status: s.status,
    })),
  });
});
