import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

// Edge-safe import ONLY (no Prisma / Auth.js server chain) — see onboarding-gate-edge.ts.
import {
  ONBOARDING_RESUME_REDIRECT,
  shouldRedirectToOnboarding,
} from '@/lib/auth/onboarding-gate-edge';

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
 * `/onboarding` is NOT gated here — per §6.1/§6.3, identity capture (registration/sign-in) is
 * itself a *step inside* the onboarding flow, so a session cannot be a precondition for reaching it,
 * and the onboarding/resume surface is exactly where a not-complete user must be able to land.
 * `/api/*` demo routes from other build units are left ungated at this layer (their onboarding
 * gate, where wired, is the DB-backed `withOnboardingGate` route wrapper — onboarding-gate.ts).
 *
 * T-20 (§6.10-1): this middleware now enforces TWO things for the matched downstream PAGE routes:
 *   1. AUTHENTICATION — a valid session (unchanged; `authorized` callback below).
 *   2. THE HARD ONBOARDING GATE — an authenticated user whose JWT `onboardingStatus` claim is not
 *      GATED_COMPLETE is redirected to `/onboarding/resume` before the page renders (the pure
 *      decision lives in `shouldRedirectToOnboarding`, onboarding-gate.ts). This is the page-level
 *      half of the §6.10-1 gate; the API-level half is `withOnboardingGate`. Fine-grained *role*
 *      checks stay in `requireRole`/`withRole` at the route/handler level.
 */
export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth;
    // `authorized` (below) has already guaranteed a token here. Redirect a not-yet-complete user
    // off any gated downstream page into the resume flow (§6.10-1 / uiux AC-2-5).
    if (shouldRedirectToOnboarding(req.nextUrl.pathname, token?.onboardingStatus)) {
      const url = req.nextUrl.clone();
      url.pathname = ONBOARDING_RESUME_REDIRECT;
      // T-57 R3c-1 (MINOR-m1): this used to be `url.search = ''` unconditionally — wiping ANY
      // query string the original request carried, including a `?step=` a caller may have already
      // attached to a gated deep link (mirroring `/onboarding/resume?step=`'s own contract, see
      // `onboarding/resume/page.tsx` + the API-layer `withOnboardingGate` 403 `redirectTo`, which
      // DOES carry a real, DB-derived step). This Edge-runtime middleware has no Prisma access (see
      // onboarding-gate-edge.ts's header) and the JWT carries no per-step claim today (only
      // `onboardingStatus`) — so it cannot ITSELF derive the authoritative last-incomplete step the
      // way the DB-backed API layer can. What it CAN do, and previously didn't, is stop discarding
      // one that already exists on the inbound URL: PRESERVE a genuine `?step=` param from the
      // request being redirected, and drop only the rest of the query string (never carry through
      // unrelated params onto the onboarding surface). A request with no `step` param behaves
      // exactly as before (falls back to the resume page's own first-screen default).
      const step = req.nextUrl.searchParams.get('step');
      url.search = step ? `?step=${encodeURIComponent(step)}` : '';
      return NextResponse.redirect(url);
    }
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

// `/dashboard` stays first so verify-middleware.mjs (the T-04 manifest guard) keeps passing. The
// added prefixes are the WP02–WP10 destinations (uiux §2.4 route map) the §6.10-1 gate protects;
// each matches its subtree. Kept in sync with `GATED_DOWNSTREAM_PAGE_PREFIXES` (onboarding-gate.ts).
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/today/:path*',
    '/shift/:path*',
    '/inbox/:path*',
    '/community/:path*',
    '/grow/:path*',
    '/learn/:path*',
    '/me/:path*',
    '/team/:path*',
    '/ritual/:path*',
    // T-41 (WP06) — kept in sync with GATED_DOWNSTREAM_PAGE_PREFIXES (onboarding-gate-edge.ts).
    '/content/:path*',
    // T-R56 (admin console) — kept in sync with GATED_DOWNSTREAM_PAGE_PREFIXES
    // (onboarding-gate-edge.ts). Role enforcement (ADMIN-only) happens server-side per route/
    // layout, not here — this middleware only ever checks authentication + onboarding-completeness.
    '/admin/:path*',
  ],
};
