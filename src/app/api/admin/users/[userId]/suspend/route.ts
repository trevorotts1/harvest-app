// T-R56 (admin console — user_profile.manage, ADMIN-only per §16.6): POST /api/admin/users/
// [userId]/suspend — a SAFE, reversible account hold (never a destructive delete). Session-gated
// via `withCapability` (never a client-forged `x-user-id`); the acting admin's identity comes only
// from the verified session (`session.user.id`/`role`), never the request body. Writes exactly one
// hash-chained `AuditEntry` (via `UserManagementService.suspendUser` -> `AuditService`).

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withCapability } from '@/lib/auth/with-role';
import { buildProductionUserManagementService } from '@/services/admin/production';
import {
  SelfTargetNotAllowedError,
  UserManagementNotFoundError,
} from '@/services/admin/user-management.service';

export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: { userId: string };
}

interface SuspendBody {
  reason?: string;
}

export const POST = withCapability('user_profile', 'manage', async (req, ctx: RouteCtx, session) => {
  let body: SuspendBody = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as SuspendBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;

  const service = buildProductionUserManagementService(prisma);
  try {
    const detail = await service.suspendUser(session.user.id, session.user.role, ctx.params.userId, reason);
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof UserManagementNotFoundError) {
      return NextResponse.json({ error: error.message, code: 'NOT_FOUND' }, { status: 404 });
    }
    if (error instanceof SelfTargetNotAllowedError) {
      return NextResponse.json({ error: error.message, code: 'NOT_PERMITTED' }, { status: 400 });
    }
    throw error;
  }
});
