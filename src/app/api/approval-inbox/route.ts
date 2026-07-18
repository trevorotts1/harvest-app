// T-33 — GET /api/approval-inbox: the Approval Inbox list (master-spec §9.2; uiux §5.6). Session-
// gated (`withOnboardingGate`, never `x-user-id`); every row returned is scoped to the session
// user's OWN drafts (`ApprovalInboxService.listInbox` filters by `user_id` at the query, not after
// the fact). Default view = the "awaiting attention" states (PENDING + HELD); `?state=` narrows to
// exactly one state, `?state=ALL` returns full history.
//
// Lazy: the service is constructed per-request, INSIDE the handler — never at module scope — so
// `next build`'s page-data collection (which imports every route module with no request in flight)
// never risks a module-scope construction throwing (same convention as every sibling route:
// contacts/flags, harvest-method/action-complete, ...).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { ApprovalInboxService, type ApprovalInboxPrismaClient } from '@/services/approval-inbox/approval-inbox.service';

export const dynamic = 'force-dynamic';

const VALID_STATES = new Set(['PENDING', 'APPROVED', 'DECLINED', 'HELD', 'ALL']);

export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const stateParam = req.nextUrl.searchParams.get('state');
  if (stateParam && !VALID_STATES.has(stateParam)) {
    return NextResponse.json(
      { error: `"state" must be one of PENDING/APPROVED/DECLINED/HELD/ALL (got "${stateParam}").` },
      { status: 400 }
    );
  }

  const service = new ApprovalInboxService(prisma as unknown as ApprovalInboxPrismaClient);
  const items = await service.listInbox(identity.userId, {
    state: (stateParam as 'PENDING' | 'APPROVED' | 'DECLINED' | 'HELD' | 'ALL' | null) ?? undefined,
  });

  return NextResponse.json({ count: items.length, items });
});
