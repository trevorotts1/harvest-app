// T-41 (WP06 §11.5/§11.8-5) — mark ONE engagement-follow-up task complete. Ownership-scoped.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildEngagementFollowUpService } from '@/services/social-content/production-wiring';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate<{ params: { id: string } }>(async (_req, ctx, _session, identity) => {
  const id = ctx?.params?.id;
  if (!id) return NextResponse.json({ error: '"id" is required.' }, { status: 400 });

  const service = buildEngagementFollowUpService(prisma);
  const task = await service.complete(identity.userId, id);
  if (!task) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ task });
});
