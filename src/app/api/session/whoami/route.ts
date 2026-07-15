import { Role } from '@prisma/client';
import { NextResponse } from 'next/server';

import { withRole } from '@/lib/auth/with-role';

/**
 * `GET /api/session/whoami` — the first live call-site of `withRole`/`requireRole`
 * (src/lib/auth/with-role.ts, src/lib/auth/rbac.ts) on a real Auth.js session (T-04 QC fix,
 * defect 3). Every route under `src/app/api/**` up to this point either used the pre-auth
 * `x-user-id` demo-header pattern or had no gate at all — the RBAC guard existed only as a unit-
 * tested primitive with zero production call-sites (see the "DEFERRED CALL-SITE WIRING" note in
 * with-role.ts). This route deliberately does not touch or migrate any of that existing demo
 * surface (contacts/*, harvest-method/*, mission-control/briefing, onboarding/*, demo/seed — T-14
 * owns that migration); it's a new, minimal, additive endpoint that proves the primitive works
 * end-to-end against a real session with no other route's behavior at risk.
 *
 * Allow-list is intentionally every role in the enum: "whoami" has no role-specific business
 * logic to gate — its only authorization question is "is there a valid, authenticated session at
 * all", which `requireRole` already answers as its first check (401 `UNAUTHENTICATED` before the
 * allow-list is even consulted). Listing every role here (rather than inventing a role-agnostic
 * bypass) keeps this call-site exercising the exact same `withRole`/`requireRole` path every other
 * gated route will use.
 */
const ALL_ROLES = Object.values(Role);

/**
 * Force dynamic (request-time) rendering. Without this, `next build`'s static-optimization pass
 * invokes this route's GET handler with a synthetic, cookie-less request to see whether its
 * response can be cached as static — which would both (a) be wrong for a per-session "whoami"
 * response, which must never be statically cached across users, and (b) trip
 * `assertAuthSecretConfigured()` (src/lib/auth/env.ts, called via `getCurrentSession()`) during the
 * build itself, since `next build` runs with `NODE_ENV=production` and (correctly) no
 * `NEXTAUTH_SECRET` is required just to build. `force-dynamic` tells Next.js to skip that
 * build-time invocation entirely and always render this route per-request.
 */
export const dynamic = 'force-dynamic';

export const GET = withRole(ALL_ROLES, async (_req, _ctx, session) => {
  return NextResponse.json({
    id: session.user.id,
    role: session.user.role,
    orgType: session.user.orgType,
    organizationId: session.user.organizationId,
  });
});
