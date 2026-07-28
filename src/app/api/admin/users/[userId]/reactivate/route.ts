// T-R56 (admin console — user_profile.manage, ADMIN-only per §16.6): POST /api/admin/users/
// [userId]/reactivate — lifts a prior suspend hold. Session-gated via `withCapability` (never a
// client-forged `x-user-id`). Writes exactly one hash-chained `AuditEntry`.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withCapability } from '@/lib/auth/with-role';
import { buildProductionUserManagementService } from '@/services/admin/production';
import { UserManagementNotFoundError } from '@/services/admin/user-management.service';

export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: { userId: string };
}

export const POST = withCapability('user_profile', 'manage', async (_req, ctx: RouteCtx, session) => {
  const service = buildProductionUserManagementService(prisma);
  try {
    const detail = await service.reactivateUser(session.user.id, session.user.role, ctx.params.userId);
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof UserManagementNotFoundError) {
      return NextResponse.json({ error: error.message, code: 'NOT_FOUND' }, { status: 404 });
    }
    throw error;
  }
});
