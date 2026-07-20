// T-41 (WP06 §11.8-4 "inline edits preserved in the audit trail") — inline edit ONE content item.
// Re-enters BOTH the doctrine vocabulary scan and the CFE before the new text can be released
// (content-item.service.ts's editItem is the single place this happens).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildContentItemService } from '@/services/social-content/production-wiring';

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
  const newBody = body.body;
  if (typeof newBody !== 'string') {
    return NextResponse.json({ error: '"body" (string) is required.' }, { status: 400 });
  }
  const newHeadline = typeof body.headline === 'string' ? body.headline : undefined;

  const service = buildContentItemService(prisma);
  const result = await service.editItem(identity.userId, id, newBody, newHeadline);

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : result.reason === 'empty_body' ? 400 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ item: result.item, cfeBand: result.verdict.band, held: result.verdict.held });
});
