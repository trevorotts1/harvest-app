// T-41 (WP06 §11.5) — attempt to publish ONE content item RIGHT NOW (rather than waiting for its
// scheduled time / the cron tick). Goes through the exact same PublishingService.attemptPublish the
// scheduled tick uses — same CFE-offline pause (no bypass), same retry-counter/manual-fallback rule.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildPublishingService } from '@/services/social-content/production-wiring';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate<{ params: { id: string } }>(async (_req, ctx, _session, identity) => {
  const id = ctx?.params?.id;
  if (!id) return NextResponse.json({ error: '"id" is required.' }, { status: 400 });

  const service = buildPublishingService(prisma);
  const result = await service.attemptPublish(identity.userId, id);

  if (result.status === 'NOT_FOUND') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (result.status === 'PAUSED') {
    // §11.5 rule 1 — no bypass. 503 (service unavailable), never a 200 pretending it published.
    return NextResponse.json({ status: result.status, reason: result.reason }, { status: 503 });
  }
  return NextResponse.json(result);
});
