// T-40R (WP05 GATE remediation, master-spec §10.7; uiux §5.7 "objection coach — only you see this") —
// POST /api/messaging/objection: the rep-facing objection coach. Two actions:
//   • `{ action: 'list' }` → the full Socratic objection tree (clarifying question + branches) for the
//     in-thread coaching sheet. Read-only; invisible to the community member.
//   • `{ action: 'prepare', contactId, objectionKey, branchKey, channel? }` → materialize the chosen
//     branch response as a DraftMessage. Per §10.9-9 the draft is created PENDING with cfe_outcome=null
//     (ObjectionService.prepareResponseDraft) — deliberately NOT released — so the T-37 send seam
//     refuses it (NOT_CFE_CLEARED) until WP04's CFE pass + a human approval clear it. This route opens
//     NO send path; it only creates a held draft that must still clear every gate to ever go out.
//
// Session-gated (withOnboardingGate) — no client-forged `x-user-id` is read. Ownership on `prepare` is
// enforced inside ObjectionService (a contact not owned by the caller is CONTACT_NOT_FOUND → 404).
// Lazy, in-handler construction.

import { MessageChannel } from '@prisma/client';
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ObjectionService } from '@/services/messaging/objection/objection.service';
import type { ObjectionPrismaClient } from '@/services/messaging/objection/objection.service';

export const dynamic = 'force-dynamic';

function isMessageChannel(value: unknown): value is MessageChannel {
  return typeof value === 'string' && (Object.values(MessageChannel) as string[]).includes(value);
}

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const service = new ObjectionService(prisma as unknown as ObjectionPrismaClient);
  const action = (body as { action?: unknown }).action;

  // Default action is the read-only coaching sheet (no contact / no draft).
  if (action === undefined || action === 'list') {
    return NextResponse.json({ ok: true, objections: service.listObjections() });
  }

  if (action !== 'prepare') {
    return NextResponse.json({ error: '"action" must be "list" or "prepare".' }, { status: 400 });
  }

  const { contactId, objectionKey, branchKey, channel } = body as {
    contactId?: unknown;
    objectionKey?: unknown;
    branchKey?: unknown;
    channel?: unknown;
  };
  if (!contactId || typeof contactId !== 'string') {
    return NextResponse.json({ error: '"contactId" (a single string id) is required.' }, { status: 400 });
  }
  if (!objectionKey || typeof objectionKey !== 'string' || !branchKey || typeof branchKey !== 'string') {
    return NextResponse.json({ error: '"objectionKey" and "branchKey" are required.' }, { status: 400 });
  }
  if (channel !== undefined && !isMessageChannel(channel)) {
    return NextResponse.json({ error: '"channel" is not a valid message channel.' }, { status: 400 });
  }

  const result = await service.prepareResponseDraft(
    identity.userId,
    contactId,
    objectionKey,
    branchKey,
    channel ?? MessageChannel.SMS_HANDOFF
  );

  if (!result.ok) {
    if (result.code === 'CONTACT_NOT_FOUND') {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    // UNKNOWN_OBJECTION / UNKNOWN_BRANCH — a bad key from the client.
    return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    // The draft is held (PENDING, not CFE-cleared) — it must still pass CFE + approval + the seam.
    draftId: result.draftId,
    nextAction: result.nextAction,
    held: true,
    note: 'A held draft was prepared — it must pass the CFE and your approval before it can send.',
  });
});
