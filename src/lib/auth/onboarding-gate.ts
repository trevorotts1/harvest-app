// WP01 §6.10-1 — the REAL, end-to-end onboarding gate enforcement (T-20).
//
// The pure gate (`evaluateOnboardingGate`) and the identity gate (`resolveIdentity` /
// `requireCurrentIdentity`) already existed and were unit-tested — but nothing in the running app
// consumed them, so the §6.10-1 "hard gate" ("nothing downstream of onboarding is reachable until
// GATED_COMPLETE") was, in practice, only enforced in the pure functions and in the UI. A deep link
// or a direct API call to a WP02–WP10 surface bypassed onboarding entirely. This module is the wire
// that makes the gate real at the route/middleware layer:
//
//   • `withOnboardingGate` — an App-Router route-handler wrapper (composes with `withRole` /
//     `withSessionSecurity` in with-role.ts). It resolves the caller's identity from the live
//     Auth.js session, reads their AUTHORITATIVE, live `onboarding_status` from the database (never
//     the possibly-stale token), and refuses — deny-by-default — any caller who is not
//     GATED_COMPLETE, mirroring the pure gate's resume-redirect target in the 403 body.
//   • `shouldRedirectToOnboarding` — the pure decision `src/middleware.ts` uses to gate downstream
//     PAGE routes off the JWT's `onboardingStatus` claim (Edge runtime; no DB access there).
//
// The two layers are complementary: middleware catches page navigations early off the token claim;
// the route wrapper is the authoritative, DB-backed enforcement for the API surface (and for the
// window where a just-completed user's token claim is briefly stale — the DB read always wins).

import { OnboardingStatus } from '@prisma/client';
import type { Session } from 'next-auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

import { GATED_COMPLETE_VALUE } from './onboarding-gate-edge';
import type { SessionUser } from './rbac';
import { getCurrentSession } from './session';
import {
  evaluateOnboardingGate,
  IdentityGateError,
  resolveIdentity,
  type IdentityContext,
} from '@/services/onboarding/wp01/identity-gate';

/**
 * The narrow Prisma shape this module reads — same DI-mockable delegate convention used across the
 * codebase (data-rights.ts, seven-whys/persistence.ts, with-role.ts's `security_version` read). Tests
 * `jest.mock('@/lib/prisma')` to supply it; nothing here needs the full client.
 */
export interface OnboardingGatePrismaClient {
  user: {
    findUnique(args: {
      where: { id: string };
      select: {
        onboarding_status: true;
        onboarding_sessions: {
          select: { current_step: true };
          orderBy: { created_at: 'desc' };
          take: 1;
        };
      };
    }): Promise<{
      onboarding_status: OnboardingStatus;
      onboarding_sessions: { current_step: string }[];
    } | null>;
  };
}

export interface OnboardingState {
  onboardingStatus: OnboardingStatus | null;
  /** The last step the user reached, for the `/onboarding/resume?step=` deep-link (§6.10-1). */
  lastIncompleteStep: string;
}

/**
 * Read a user's AUTHORITATIVE onboarding state from the database. Fail-closed: a user row that no
 * longer exists (deleted) resolves to `onboardingStatus: null` — which `evaluateOnboardingGate`
 * treats as not-complete — rather than being trusted as complete.
 */
export async function getOnboardingState(
  userId: string,
  client: OnboardingGatePrismaClient = prisma as unknown as OnboardingGatePrismaClient
): Promise<OnboardingState> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      onboarding_status: true,
      onboarding_sessions: {
        select: { current_step: true },
        orderBy: { created_at: 'desc' },
        take: 1,
      },
    },
  });
  return {
    onboardingStatus: user?.onboarding_status ?? null,
    lastIncompleteStep: user?.onboarding_sessions?.[0]?.current_step ?? 'REGISTER',
  };
}

type GatedRouteHandler<Ctx> = (
  req: NextRequest,
  ctx: Ctx,
  session: Session & { user: SessionUser },
  identity: IdentityContext
) => Promise<NextResponse> | NextResponse;

/**
 * App-Router route-handler wrapper enforcing the §6.10-1 hard onboarding gate on a downstream
 * (WP02–WP10) API route. Deny-by-default, in three fail-closed stages:
 *
 *   1. No / malformed session → 401 (UNAUTHENTICATED) or 403 (INCOMPLETE_IDENTITY), via the same
 *      `resolveIdentity` the pure identity gate uses — a forged or drifted token never proceeds.
 *   2. Authenticated but `onboarding_status !== GATED_COMPLETE` (read LIVE from the DB) → 403 with
 *      `code: 'ONBOARDING_INCOMPLETE'` and the `redirectTo` resume path — the API mirror of the
 *      page-level `/onboarding/resume` redirect (§6.10-1, uiux AC-2-5). A 403 (not a 200 with a
 *      redirect body) so a non-browser API client cannot mistake it for success.
 *   3. GATED_COMPLETE → the wrapped handler runs, receiving the validated session + identity.
 *
 * Compose with `withRole`/`withCapability`/`withSessionSecurity` (with-role.ts) for the role/security
 * checks a specific route also needs — this wrapper only owns the onboarding-completeness gate.
 */
export function withOnboardingGate<Ctx = unknown>(
  handler: GatedRouteHandler<Ctx>,
  client: OnboardingGatePrismaClient = prisma as unknown as OnboardingGatePrismaClient
) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    const session = await getCurrentSession();
    const result = resolveIdentity(session);
    if (!result.ok) {
      const error = new IdentityGateError(result.reason);
      return NextResponse.json({ error: error.message, code: result.reason }, { status: error.status });
    }

    const { onboardingStatus, lastIncompleteStep } = await getOnboardingState(result.identity.userId, client);
    const outcome = evaluateOnboardingGate(onboardingStatus, lastIncompleteStep);
    if (!outcome.allowed) {
      return NextResponse.json(
        {
          error: 'Finish setting up your business before opening this — resuming where you left off.',
          code: 'ONBOARDING_INCOMPLETE',
          redirectTo: outcome.redirectTo,
        },
        { status: 403 }
      );
    }

    return handler(req, ctx, session as Session & { user: SessionUser }, result.identity);
  };
}

// ─── Middleware page-gate decision (pure, Edge-safe — defined in onboarding-gate-edge.ts) ────────
// Re-exported here so server call-sites have a single import surface; `src/middleware.ts` imports
// the pure helpers directly from the Edge-safe module (never from THIS file, which pulls in Prisma).
export {
  GATED_DOWNSTREAM_PAGE_PREFIXES,
  isGatedDownstreamPage,
  shouldRedirectToOnboarding,
  ONBOARDING_RESUME_REDIRECT,
} from './onboarding-gate-edge';

// Compile-time lockstep guard: the Edge module inlines 'GATED_COMPLETE' as a string literal (so it
// imports nothing from @prisma/client). This assertion — in a file that DOES import the real Prisma
// enum — fails typecheck if that member is ever renamed, so the inlined literal can never silently
// drift from the schema.
const _gatedCompleteInSync: typeof GATED_COMPLETE_VALUE extends `${OnboardingStatus}` ? true : never = true;
void _gatedCompleteInSync;
