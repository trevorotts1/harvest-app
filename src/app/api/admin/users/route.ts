// T-R56 (admin console — user_profile.manage, ADMIN-only per §16.6): GET /api/admin/users — list +
// search + paginate. Session-gated via `withCapability` (never a client-forged `x-user-id`).

import { NextResponse } from 'next/server';
import { Role } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { withCapability } from '@/lib/auth/with-role';
import { buildProductionUserManagementService } from '@/services/admin/production';

export const dynamic = 'force-dynamic';

export const GET = withCapability('user_profile', 'manage', async (req) => {
  const params = req.nextUrl.searchParams;
  const search = params.get('search') ?? undefined;
  const roleParam = params.get('role');
  if (roleParam && !Object.values(Role).includes(roleParam as Role)) {
    return NextResponse.json(
      { error: `"role" must be one of: ${Object.values(Role).join(', ')}.`, code: 'INVALID_ROLE' },
      { status: 400 }
    );
  }
  const pageParam = params.get('page');
  const pageSizeParam = params.get('pageSize');

  const service = buildProductionUserManagementService(prisma);
  const result = await service.listUsers({
    search,
    role: roleParam ? (roleParam as Role) : undefined,
    page: pageParam ? Number(pageParam) : undefined,
    pageSize: pageSizeParam ? Number(pageSizeParam) : undefined,
  });

  return NextResponse.json(result);
});
