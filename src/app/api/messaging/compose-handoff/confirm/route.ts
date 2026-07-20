// T-37 — POST /api/messaging/compose-handoff/confirm: the one-tap "Did it send?" confirmation for a
// first-touch composer handoff (uiux §4.4). Body: `{ messageId: string; sent: boolean }` — `sent:
// true` records `handoff_confirmed`; `sent: false` marks it not-sent (the item returns to the queue,
// no shame copy). Session-gated; ownership enforced through the message's thread (NOT_FOUND for
// another rep's message). Reads no forged identity header.

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

  const { messageId, sent } = body as { messageId?: unknown; sent?: unknown };
  if (!messageId || typeof messageId !== 'string') {
    return NextResponse.json({ error: '"messageId" (a single string id) is required.' }, { status: 400 });
  }
  if (typeof sent !== 'boolean') {
    return NextResponse.json({ error: '"sent" (boolean) is required.' }, { status: 400 });
  }

  const service = new FirstTouchComposerService(prisma as unknown as SendPrismaClient);
  const result = await service.confirmHandoff(identity.userId, messageId, sent);

  if (result.status === 'NOT_FOUND') {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, status: result.status, messageId: result.messageId });
});
