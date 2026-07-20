// T-43 (WP07 §12.3) — POST /api/gamification/milestones/acknowledge: the client calls this once a
// milestone's full-bloom (or pinned card) has been shown, so `computeBloomOverride` never re-triggers
// the ONE-TIME celebratory overlay for it again (the milestone itself remains permanently pinned/
// visible — unmutable by design; this only stops the transient bloom animation from repeating).

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { acknowledgeMilestone, ALL_MILESTONE_KEYS, MilestoneKey } from '@/services/gamification/celebration.service';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.key || !ALL_MILESTONE_KEYS.includes(body.key as MilestoneKey)) {
    return NextResponse.json({ error: '"key" must be a valid milestone key.' }, { status: 400 });
  }
  await acknowledgeMilestone(prisma as never, identity.userId, body.key as MilestoneKey);
  return NextResponse.json({ ok: true });
});
