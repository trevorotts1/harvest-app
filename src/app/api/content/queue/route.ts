// T-41 (WP06 §11.5 "Unified Content Queue") — GET the rep's own queue, optionally filtered by state.
// Also surfaces the §11.5 "PUBLISHING PAUSED — COMPLIANCE OFFLINE" banner state so the Content Queue
// page (src/app/content/page.tsx) can render it without a separate round-trip.
//
// Session-gated (withOnboardingGate) — identity from the verified session; ownership is enforced by
// scoping every read to `identity.userId` inside ContentItemService (never a client-forged id).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { buildContentItemService, buildPublishingService } from '@/services/social-content/production-wiring';
import type { ContentQueueState } from '@prisma/client';

export const dynamic = 'force-dynamic';

const VALID_STATES: (ContentQueueState | 'ALL')[] = [
  'DRAFTING',
  'COMPLIANCE_CHECK',
  'READY_FOR_REVIEW',
  'SCHEDULED',
  'PUBLISHED',
  'BLOCKED',
  'ALL',
];

export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const { searchParams } = new URL(req.url);
  const stateParam = searchParams.get('state');
  const state = stateParam && (VALID_STATES as string[]).includes(stateParam) ? (stateParam as ContentQueueState | 'ALL') : undefined;

  const contentItemService = buildContentItemService(prisma);
  const publishingService = buildPublishingService(prisma);

  const items = await contentItemService.listQueue(identity.userId, state);
  const banner = publishingService.getBannerState();

  return NextResponse.json({ items, banner });
});
