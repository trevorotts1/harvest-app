// T-43 (WP07 §12.8 P1, §12.9-9) — POST /api/gamification/ask-harvest: the in-app coach. Grounded
// exclusively in the course/objection/doctrine sources; clearly labeled coaching; never sends
// outbound (there is no send path in this route at all — see ask-harvest.service.ts's file header).

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { askHarvest } from '@/services/gamification/ask-harvest.service';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req) => {
  let body: { question?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.question || typeof body.question !== 'string' || body.question.trim().length === 0) {
    return NextResponse.json({ error: '"question" is required.' }, { status: 400 });
  }
  const result = await askHarvest(body.question);
  return NextResponse.json(result);
});
