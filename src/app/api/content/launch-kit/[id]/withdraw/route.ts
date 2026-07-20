// T-41 (WP06 §11.4 "if the new member withdraws, materials move to drafts").

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildLaunchKitService } from '@/services/social-content/production-wiring';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate<{ params: { id: string } }>(async (_req, ctx, _session, identity) => {
  const id = ctx?.params?.id;
  if (!id) return NextResponse.json({ error: '"id" is required.' }, { status: 400 });

  const service = buildLaunchKitService(prisma);
  const result = await service.withdrawKit(identity.userId, id);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
  return NextResponse.json({ kit: result.kit });
});
