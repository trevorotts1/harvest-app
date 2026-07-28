// T-R56 (admin console — item 3, SIGNUPS dashboard, read-only, ADMIN-only): GET /api/admin/signups
// — recent User.created_at signups, org-wide. Gated on the §16.6 row-9 "cross_org" capability,
// which the matrix grants to ADMIN only (src/lib/auth/rbac-matrix.ts) — the exact "org-wide,
// cross-account visibility" shape this read is.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withCapability } from '@/lib/auth/with-role';
import { buildProductionUserManagementService } from '@/services/admin/production';

export const dynamic = 'force-dynamic';

export const GET = withCapability('cross_org', 'read', async (req) => {
  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limitParam !== null && !Number.isFinite(limit)) {
    return NextResponse.json({ error: '"limit" must be a number.' }, { status: 400 });
  }

  const service = buildProductionUserManagementService(prisma);
  const signups = await service.listRecentSignups(limit);
  return NextResponse.json({ signups });
});
