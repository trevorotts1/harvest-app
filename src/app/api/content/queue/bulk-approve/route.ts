// T-41 (WP06 §11.8-4 "bulk-approve a week") — see content-item.service.ts's class header for why this
// is NOT the same anti-pattern as the Approval Inbox's forbidden "approve all": every id here already
// individually cleared doctrine + the CFE before it could reach READY_FOR_REVIEW; this only batches
// the SCHEDULING step across the given ids.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildContentItemService } from '@/services/social-content/production-wiring';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === 'string')) {
    return NextResponse.json({ error: '"ids" (a non-empty array of strings) is required.' }, { status: 400 });
  }
  const from = typeof body.from === 'string' ? new Date(body.from) : new Date();
  if (Number.isNaN(from.getTime())) {
    return NextResponse.json({ error: '"from" must be a valid ISO date string.' }, { status: 400 });
  }

  const service = buildContentItemService(prisma);
  const result = await service.bulkApprove(identity.userId, ids, from);
  return NextResponse.json(result);
});
