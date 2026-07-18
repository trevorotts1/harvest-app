// T-33 — GET /api/activity-ledger: the read-only, ownership-scoped Agent Activity Ledger
// (master-spec §9.3, "derived from AgentRun.reasoning_log"). Session-gated (withOnboardingGate,
// never x-user-id); `AgentActivityLedgerService.listForUser` filters by the session-derived user id
// at the query — there is no parameter on this route that lets a caller name another rep's id.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import {
  AgentActivityLedgerService,
  type ActivityLedgerPrismaClient,
} from '@/services/approval-inbox/activity-ledger.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const limitParam = req.nextUrl.searchParams.get('limit');
  const requestedLimit = limitParam === null ? undefined : Number(limitParam);
  if (limitParam !== null && !Number.isFinite(requestedLimit)) {
    return NextResponse.json({ error: '"limit" must be a number.' }, { status: 400 });
  }

  const service = new AgentActivityLedgerService(prisma as unknown as ActivityLedgerPrismaClient);
  const entries = await service.listForUser(identity.userId, { limit: requestedLimit });

  return NextResponse.json({ count: entries.length, entries });
});
