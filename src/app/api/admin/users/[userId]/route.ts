// T-R56 (admin console — user_profile.manage, ADMIN-only per §16.6): GET /api/admin/users/[userId]
// — the user-detail read backing the admin console's detail panel. Session-gated via
// `withCapability` (never a client-forged `x-user-id`) — mirrors
// src/app/api/admin/users/route.ts's auth pattern exactly.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withCapability } from '@/lib/auth/with-role';
import { buildProductionUserManagementService } from '@/services/admin/production';
import { UserManagementNotFoundError } from '@/services/admin/user-management.service';

export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: { userId: string };
}

export const GET = withCapability('user_profile', 'manage', async (_req, ctx: RouteCtx) => {
  const service = buildProductionUserManagementService(prisma);
  try {
    const detail = await service.getUserDetail(ctx.params.userId);
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof UserManagementNotFoundError) {
      return NextResponse.json({ error: error.message, code: 'NOT_FOUND' }, { status: 404 });
    }
    throw error;
  }
});
