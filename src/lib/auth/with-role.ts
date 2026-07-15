import { Role } from '@prisma/client';
import type { Session } from 'next-auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getCurrentSession } from './session';
import { RBACError, requireRole, type RoleCheckOptions, type SessionUser } from './rbac';

type AuthedRouteHandler<Ctx> = (
  req: NextRequest,
  ctx: Ctx,
  session: Session & { user: SessionUser }
) => Promise<NextResponse> | NextResponse;

/**
 * App Router route-handler wrapper around `requireRole` (src/lib/auth/rbac.ts) — the "and/or
 * middleware" half of the T-04 brief for API routes specifically (root `middleware.ts` covers
 * page-level gating; this covers a single `route.ts` handler that needs a *specific* allow-list,
 * which a single path-matcher in `middleware.ts` can't express per-route).
 *
 * Usage:
 *   export const POST = withRole([Role.UPLINE, Role.RVP], async (req, ctx, session) => {
 *     // session.user.role is narrowed to satisfy the allow-list here
 *     return NextResponse.json({ ok: true });
 *   });
 */
export function withRole<Ctx = unknown>(
  allowedRoles: readonly Role[],
  handler: AuthedRouteHandler<Ctx>,
  options?: RoleCheckOptions
) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    const session = await getCurrentSession();

    try {
      requireRole(session, allowedRoles, options);
    } catch (error) {
      if (error instanceof RBACError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    return handler(req, ctx, session);
  };
}
