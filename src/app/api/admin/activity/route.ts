// T-R56 (admin console — item 3, ACTIVITY dashboard, read-only, ADMIN-only): GET
// /api/admin/activity — the org-wide activity view the existing /api/activity-ledger cannot serve
// (that route is deliberately self-scoped, see its own header). Reuses
// `ActivityLedgerService.listVisibleActivity` (src/services/compliance/audit/activity-ledger.ts) —
// for an ADMIN caller it returns the FULL store (§16.6 row 4 "admin = full"), no new read path.
// Gated on `cross_org`/`read` (ADMIN-only per the matrix), same rationale as /api/admin/signups.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withCapability } from '@/lib/auth/with-role';
import { buildProductionActivityLedgerService } from '@/services/admin/production';

export const dynamic = 'force-dynamic';

export const GET = withCapability('cross_org', 'read', async (req, _ctx, session) => {
  const params = req.nextUrl.searchParams;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;

  const service = buildProductionActivityLedgerService(prisma);
  const entries = await service.listVisibleActivity(
    { id: session.user.id, role: session.user.role },
    { from, to }
  );

  return NextResponse.json({ count: entries.length, entries });
});
