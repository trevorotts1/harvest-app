// T-41 (WP06 §11.4) — GET one launch kit + its pieces. Ownership-scoped (404 on mismatch/nonexistent).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildLaunchKitService } from '@/services/social-content/production-wiring';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate<{ params: { id: string } }>(async (_req, ctx, _session, identity) => {
  const id = ctx?.params?.id;
  if (!id) return NextResponse.json({ error: '"id" is required.' }, { status: 400 });

  const service = buildLaunchKitService(prisma);
  const result = await service.getKit(identity.userId, id);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
});
