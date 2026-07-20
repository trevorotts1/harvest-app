// T-41 (WP06 §11.5/§11.8-5 "no post-and-forget") — GET the rep's open 48h engagement-follow-up tasks.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildEngagementFollowUpService } from '@/services/social-content/production-wiring';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const service = buildEngagementFollowUpService(prisma);
  const tasks = await service.listOpen(identity.userId);
  return NextResponse.json({ tasks });
});
