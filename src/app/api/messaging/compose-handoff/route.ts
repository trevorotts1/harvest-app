// T-37 — POST /api/messaging/compose-handoff: turn a CFE-cleared, human-approved first-touch draft
// into the one-tap `sms:` composer handoff payload (master-spec §10.1; uiux §4.4/AC-5.6-6). Body:
// `{ draftId: string }`.
//
// Session-gated (withOnboardingGate — the caller's identity comes from the VERIFIED Auth.js
// session, never a client-forged `x-user-id`; this route reads no such header, so a forged one is
// inert by construction). Ownership is enforced inside the service: a draft/contact not owned by
// the session user resolves to NOT_FOUND (404), never a leaky 403. Every service/client is
// constructed HERE, per request, from lazily-read config — no module-scope key read.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { FirstTouchComposerService } from '@/services/messaging/send';
import type { SendPrismaClient } from '@/services/messaging/send';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { draftId } = body as { draftId?: unknown };
  if (!draftId || typeof draftId !== 'string') {
    return NextResponse.json({ error: '"draftId" (a single string id) is required.' }, { status: 400 });
  }

  const service = new FirstTouchComposerService(prisma as unknown as SendPrismaClient);
  const result = await service.prepareHandoff(identity.userId, draftId);

  if (result.status === 'NOT_FOUND') {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }
  if (result.status === 'HELD') {
    // Fail-closed: nothing was composed/handed off. Mirrors the CFE's held/blocked posture.
    return NextResponse.json(
      { error: 'This first touch is held — nothing was lost.', code: 'SEND_HELD', reason: result.reason },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, payload: result.payload, messageId: result.messageId });
});
