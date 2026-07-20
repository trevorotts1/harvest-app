// T-41 (WP06 §11.5) — approve ONE content item: schedule it for a specific time. Only a
// READY_FOR_REVIEW item (already CFE-cleared + doctrine-clean) is approvable.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildContentItemService } from '@/services/social-content/production-wiring';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate<{ params: { id: string } }>(async (req, ctx, _session, identity) => {
  const id = ctx?.params?.id;
  if (!id) return NextResponse.json({ error: '"id" is required.' }, { status: 400 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // scheduledFor is optional (defaults to now); an empty body is valid.
  }
  const scheduledFor = typeof body.scheduledFor === 'string' ? new Date(body.scheduledFor) : new Date();
  if (Number.isNaN(scheduledFor.getTime())) {
    return NextResponse.json({ error: '"scheduledFor" must be a valid ISO date string.' }, { status: 400 });
  }

  const service = buildContentItemService(prisma);
  const result = await service.approveAndSchedule(identity.userId, id, scheduledFor);

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ item: result.item });
});
