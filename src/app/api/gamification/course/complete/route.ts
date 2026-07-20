// T-43 (WP07 §12.9-8) — POST /api/gamification/course/complete: marks a module COMPLETED, credits
// the Momentum Score exactly once (idempotent), which is what "triggers a celebration" in practice —
// the client shows a micro-celebration on a fresh (non-`alreadyCompleted`) completion.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { completeModule } from '@/services/gamification/course.service';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: { moduleKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.moduleKey) {
    return NextResponse.json({ error: '"moduleKey" is required.' }, { status: 400 });
  }
  const result = await completeModule(prisma as never, identity.userId, body.moduleKey);
  if (!result.ok) {
    return NextResponse.json({ error: 'Unknown module key.' }, { status: 404 });
  }
  return NextResponse.json(result);
});
