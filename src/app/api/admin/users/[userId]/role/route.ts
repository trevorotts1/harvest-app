// T-R56 (admin console — user_profile.manage, ADMIN-only per §16.6): POST /api/admin/users/
// [userId]/role — changes a user's role. Session-gated via `withCapability` (never a client-forged
// `x-user-id`); `UserManagementService.changeRole` fails closed on any value that isn't a real
// `Role` enum member and rejects an admin targeting their own account (self-demotion/lockout
// safety, `SelfTargetNotAllowedError`). Writes exactly one hash-chained `AuditEntry`.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withCapability } from '@/lib/auth/with-role';
import { buildProductionUserManagementService } from '@/services/admin/production';
import {
  InvalidRoleError,
  SelfTargetNotAllowedError,
  UserManagementNotFoundError,
} from '@/services/admin/user-management.service';

export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: { userId: string };
}

interface RoleBody {
  role?: string;
}

export const POST = withCapability('user_profile', 'manage', async (req, ctx: RouteCtx, session) => {
  let body: RoleBody;
  try {
    body = (await req.json()) as RoleBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' }, { status: 400 });
  }
  if (typeof body.role !== 'string' || body.role.length === 0) {
    return NextResponse.json({ error: '"role" (string) is required.', code: 'INVALID_ROLE' }, { status: 400 });
  }

  const service = buildProductionUserManagementService(prisma);
  try {
    const detail = await service.changeRole(session.user.id, session.user.role, ctx.params.userId, body.role);
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof UserManagementNotFoundError) {
      return NextResponse.json({ error: error.message, code: 'NOT_FOUND' }, { status: 404 });
    }
    if (error instanceof InvalidRoleError) {
      return NextResponse.json({ error: error.message, code: 'INVALID_ROLE' }, { status: 400 });
    }
    if (error instanceof SelfTargetNotAllowedError) {
      return NextResponse.json({ error: error.message, code: 'NOT_PERMITTED' }, { status: 400 });
    }
    throw error;
  }
});
