// T-41 (WP06 §11.5) — decline ONE content item (always exactly one — never a batch, mirroring
// approval-inbox.service.ts's single-id decline convention).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildContentItemService } from '@/services/social-content/production-wiring';
import { DECLINE_REASONS } from '@/services/social-content/content-item.service';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate<{ params: { id: string } }>(async (req, ctx, _session, identity) => {
  const id = ctx?.params?.id;
  if (!id) return NextResponse.json({ error: '"id" is required.' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const reason = body.reason;
  if (typeof reason !== 'string' || !DECLINE_REASONS.includes(reason as (typeof DECLINE_REASONS)[number])) {
    return NextResponse.json({ error: `"reason" must be one of ${DECLINE_REASONS.join(', ')}` }, { status: 400 });
  }

  const service = buildContentItemService(prisma);
  const result = await service.declineItem(identity.userId, id, reason);

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : result.reason === 'invalid_reason' ? 400 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ item: result.item });
});
