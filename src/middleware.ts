import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

/**
 * Gateway-level authentication check (T-04; §16.4 "RBAC enforcement: every gated API checks role +
 * entitlement at the gateway middleware before the handler; cross-team/cross-rep access is denied
 * by default (deny-by-default authorization)").
 *
 * IMPORTANT — this file MUST live at `src/middleware.ts`, not the repo root. This project's app
 * code lives under `src/` (see `src/app`), and Next.js only auto-registers `middleware.ts` from
 * the same directory as the app root it's configured with — a root-level `middleware.ts` next to a
 * `src/` directory is silently never picked up (no build error, no lint error; the file typechecks
 * fine and `next build` succeeds, but `.next/server/middleware-manifest.json`'s `middleware` object
 * comes out empty). That was T-04's original CRITICAL QC finding: with the file at the repo root,
 * an unauthenticated `GET /dashboard` returned `200 OK` instead of redirecting to `/auth` — the
 * auth gate below never ran at all. `scripts/verify-middleware.mjs` (wired as `postbuild`) now
 * fails the build if this regresses.
 *
 * This middleware enforces only *authentication* (a valid session) for the matched paths.
 * Fine-grained *role* checks stay in `requireRole`/`withRole` (src/lib/auth/rbac.ts,
 * src/lib/auth/with-role.ts) at the individual route/handler level, since different routes under
 * `/dashboard` need different allow-lists that a single path-matcher can't express — §16.6's full
 * per-resource capability matrix is layered on top of this in T-14.
 *
 * Scope is deliberately minimal in this scaffold: only `/dashboard`, the authenticated-only
 * surface, is gated. `/onboarding` is NOT gated here — per §6.1/§6.3, identity capture
 * (registration/sign-in) is itself a *step inside* the onboarding flow, so a session cannot be a
 * precondition for reaching it. `/api/*` demo routes from other build units are left ungated for
 * now to avoid breaking their still-in-progress, session-less demo wiring; each WP opts its own
 * gated surfaces into this matcher (or its own `withRole`-wrapped handlers) as it adopts real auth.
 */
export default withAuth(
  function middleware() {
    return NextResponse.next();
  },
  {
    secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/auth',
    },
  }
);

export const config = {
  matcher: ['/dashboard/:path*'],
};
