// T-43 (WP07 §12.3) — POST /api/gamification/milestones/share: builds the anchor-tied share-to-
// social text for a milestone, CFE-CLEARED before it is ever returned to the client (§12.9-3 "shares
// are CFE-filtered"). A held/flagged/blocked verdict returns 200 with `status: 'held'` and NO text —
// never a partially-cleared string.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildMilestoneShareText, ALL_MILESTONE_KEYS, MilestoneKey } from '@/services/gamification/celebration.service';
import { readAnchorStatement } from '@/services/gamification/anchor';
import { prisma } from '@/lib/prisma';

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

  const anchor = await readAnchorStatement(prisma as never, identity.userId);
  const result = await buildMilestoneShareText(body.key as MilestoneKey, anchor, { user_id: identity.userId, role: identity.role });
  return NextResponse.json(result);
});
