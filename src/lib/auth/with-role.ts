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
 * middleware" half of the T-04 brief for API routes specifically (`src/middleware.ts` covers
 * page-level gating; this covers a single `route.ts` handler that needs a *specific* allow-list,
 * which a single path-matcher in `middleware.ts` can't express per-route).
 *
 * Usage:
 *   export const POST = withRole([Role.UPLINE, Role.RVP], async (req, ctx, session) => {
 *     // session.user.role is narrowed to satisfy the allow-list here
 *     return NextResponse.json({ ok: true });
 *   });
 *
 * DEFERRED CALL-SITE WIRING (T-04 fix, not yet done as of this commit): every existing route under
 * `src/app/api/**` (contacts/pipeline, contacts/import, mission-control/briefing, onboarding/*,
 * harvest-method/*, agents, social, demo/seed) still uses the interim `x-user-id` request-header
 * pattern from earlier build units, not a real Auth.js session — see the header check at the top of
 * each of those `route.ts` files. Wiring `withRole` into any of them now would silently break that
 * still-in-progress, session-less demo contract (other in-flight build units, e.g. the
 * frontend-demo-ui and demo-api-bridge work, depend on it) without actually completing real
 * per-route auth for that surface — exactly the risk the comment in `src/middleware.ts` already
 * calls out for why those routes are left ungated at the middleware layer too. Per the T-04 QC
 * brief, wiring one real call-site was only in scope "if low-risk"; here it is not, so this module
 * is proven only by its unit tests (`tests/unit/auth-rbac.test.ts`) for now. T-14 owns migrating
 * these routes to real sessions and wiring the full §16.6 per-resource capability matrix (each
 * route's actual allow-list) on top of this primitive.
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
