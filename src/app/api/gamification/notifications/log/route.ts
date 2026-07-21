// T-57 R3b (MAJOR-D3, master-spec §12.6, uiux §6.5/§6.6) — GET-only, read-your-own-log companion to
// `../preferences/route.ts`. `NotificationLog` (prisma/schema.prisma) is the real, already-shipped
// append-only record of every notification actually dispatched (T-43); nothing in the app ever read
// it back for the rep before this — the Me → Notifications page (§6.6 "notifications center → 'quiet
// so far'") had no data source to render an activity feed against, so it would otherwise have had to
// fake the "quiet so far" empty state as a permanent, un-backed placeholder. This route makes that
// state real: an empty result IS "quiet so far"; a non-empty result is genuine dispatch history.
//
// Own-data-only (own `session.user.id`, never a query-param user id) — mirrors every other /me/*
// read route's ownership convention (data-rights, notifications/preferences). No step-up MFA: reading
// your own notification history carries no §16.4 sensitive-action weight.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const RECENT_LOG_LIMIT = 20;

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const items = await prisma.notificationLog.findMany({
    where: { user_id: identity.userId },
    orderBy: { created_at: 'desc' },
    take: RECENT_LOG_LIMIT,
    select: { type: true, deep_link: true, unmutable: true, created_at: true },
  });
  return NextResponse.json({ items });
});
