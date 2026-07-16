import { Role } from '@prisma/client';
import type { Session } from 'next-auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { emitSecurityEvent } from '@/services/security/security-event';

import { MfaEnrollmentRequiredError, requireStepUp, StepUpRequiredError, type SensitiveAction } from './mfa';
import { getCurrentSession } from './session';
import {
  RBACError,
  requireCapability,
  requireRole,
  type RoleCheckOptions,
  type SessionUser,
} from './rbac';
import type { Action, Resource } from './rbac-matrix';
import {
  computeDeviceFingerprint,
  evaluateSessionSecurity,
  extractClientIp,
  getSessionActivityStore,
  sessionActivityKey,
} from './session-security';

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
 * T-12 addition (§18.10 "any request for a capability above the caller's role is denied
 * deny-by-default at the gateway, returns 403, and logs a SecurityEvent"): a FORBIDDEN denial now
 * emits a `privilege_escalation_denied` SecurityEvent. UNAUTHENTICATED (no session at all) does
 * not — that is just "not signed in", not evidence of a privilege-escalation attempt.
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
        if (error.code === 'FORBIDDEN') {
          await emitSecurityEvent({
            userId: session?.user?.id ?? null,
            type: 'privilege_escalation_denied',
            severity: 'WARNING',
          });
        }
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    return handler(req, ctx, session);
  };
}

/**
 * App-Router route-handler wrapper around `requireCapability` (T-14) — the §16.6 matrix-backed
 * counterpart to `withRole` above. Instead of a hand-written allow-list, the handler is gated by
 * a `(resource, action)` pair looked up against the authoritative matrix in `./rbac-matrix.ts`.
 *
 * Usage:
 *   export const POST = withCapability('data_rights', 'export', async (req, ctx, session) => {
 *     return NextResponse.json({ ok: true });
 *   });
 *
 * Same deferred call-site wiring caveat as `withRole` applies (see the note above): wiring this
 * into an existing `x-user-id`-header route is out of scope here — T-14 owns the matrix and the
 * enforcement primitive, not migrating every pre-existing route to use it. Same T-12
 * `privilege_escalation_denied` SecurityEvent addition as `withRole` on a FORBIDDEN denial.
 */
export function withCapability<Ctx = unknown>(
  resource: Resource,
  action: Action,
  handler: AuthedRouteHandler<Ctx>
) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    const session = await getCurrentSession();

    try {
      requireCapability(session, resource, action);
    } catch (error) {
      if (error instanceof RBACError) {
        if (error.code === 'FORBIDDEN') {
          await emitSecurityEvent({
            userId: session?.user?.id ?? null,
            type: 'privilege_escalation_denied',
            severity: 'WARNING',
          });
        }
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    return handler(req, ctx, session);
  };
}

/**
 * App-Router route-handler wrapper enforcing §16.4's step-up MFA gate (T-12) in front of one of
 * the five sensitive actions (`src/lib/auth/mfa.ts` `SENSITIVE_ACTIONS`). Requires an
 * authenticated session (any role — step-up applies universally, e.g. §16.6's "Data-rights (own
 * export/delete) | yes (step-up MFA)" note applies even to REP, who is not otherwise required to
 * enroll MFA at all); compose with `withRole`/`withCapability` for the role/capability check
 * itself.
 *
 * Usage:
 *   export const POST = withStepUp('data_export', async (req, ctx, session) => { ... });
 *
 * Distinguishes the two `requireStepUp` failure modes with different HTTP bodies (both 403) so a
 * client can route the user correctly: no factor enrolled at all → `MFA_ENROLLMENT_REQUIRED`;
 * enrolled but no fresh step-up on this session → `STEP_UP_REQUIRED`. Each blocked attempt emits
 * an `mfa_challenge` SecurityEvent (§16.4 "every auth/session event written to SecurityEvent").
 */
export function withStepUp<Ctx = unknown>(action: SensitiveAction, handler: AuthedRouteHandler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'No session — sign-in required.' }, { status: 401 });
    }

    try {
      requireStepUp(
        { mfaEnrolled: session.user.mfaEnrolled, mfaVerifiedAt: session.user.mfaVerifiedAt },
        action
      );
    } catch (error) {
      if (error instanceof MfaEnrollmentRequiredError) {
        await emitSecurityEvent({
          userId: session.user.id,
          type: 'mfa_challenge',
          severity: 'WARNING',
        });
        return NextResponse.json(
          { error: error.message, code: 'MFA_ENROLLMENT_REQUIRED', action },
          { status: 403 }
        );
      }
      if (error instanceof StepUpRequiredError) {
        await emitSecurityEvent({
          userId: session.user.id,
          type: 'mfa_challenge',
          severity: 'INFO',
        });
        return NextResponse.json(
          { error: error.message, code: 'STEP_UP_REQUIRED', action },
          { status: 403 }
        );
      }
      throw error;
    }

    return handler(req, ctx, session);
  };
}

/**
 * App-Router route-handler wrapper enforcing §16.4/§18.10's session-hijack protections (T-12):
 * device-fingerprint binding, "sign out everywhere" / privilege-rotation revocation (via
 * `User.security_version`), and idle/absolute expiry (`session-security.ts`
 * `evaluateSessionSecurity`). A route that wraps sensitive, session-bound work — the new
 * `/api/auth/mfa/*` and `/api/auth/session/*` handlers this unit adds — should be wrapped in this
 * (compose with `withRole`/`withCapability`/`withStepUp` as needed).
 *
 * A fingerprint mismatch is the strongest signal (an active hijack indicator) and emits
 * `suspected_takeover` at CRITICAL severity; idle/absolute expiry and version-based revocation
 * emit `session_revoked` at WARNING. Either way the request is denied (401) — session security
 * never "warns and continues".
 */
export function withSessionSecurity<Ctx = unknown>(handler: AuthedRouteHandler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'No session — sign-in required.' }, { status: 401 });
    }

    const currentFingerprintHash = computeDeviceFingerprint({
      userAgent: req.headers.get('user-agent'),
      ip: extractClientIp(req.headers),
      acceptLanguage: req.headers.get('accept-language'),
    });

    const dbUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { security_version: true },
    });
    // Fail-closed: a user row that no longer exists (deleted) must never be treated as "matches
    // the token's snapshot" — force a version mismatch (→ 'revoked') instead of silently trusting
    // the token alone.
    const currentSecurityVersion = dbUser
      ? dbUser.security_version
      : session.user.securityVersionAtIssue + 1;

    const activityKey = sessionActivityKey(session.user.id, session.user.boundAt);
    const activityStore = getSessionActivityStore();
    const lastActivityAt = (await activityStore.get(activityKey)) ?? session.user.boundAt;

    const status = evaluateSessionSecurity(
      {
        fingerprintHash: session.user.deviceFingerprintHash,
        boundAt: session.user.boundAt,
        securityVersionAtIssue: session.user.securityVersionAtIssue,
      },
      {
        currentFingerprintHash,
        now: Date.now(),
        currentSecurityVersion,
        lastActivityAt,
      }
    );

    if (!status.valid) {
      const isHijackSignal = status.reason === 'fingerprint_mismatch';
      await emitSecurityEvent({
        userId: session.user.id,
        type: isHijackSignal ? 'suspected_takeover' : 'session_revoked',
        deviceFingerprintHash: currentFingerprintHash,
        severity: isHijackSignal ? 'CRITICAL' : 'WARNING',
      });
      return NextResponse.json(
        { error: `Session invalid (${status.reason}) — sign in again.`, code: 'SESSION_INVALID', reason: status.reason },
        { status: 401 }
      );
    }

    await activityStore.touch(activityKey, Date.now());
    return handler(req, ctx, session);
  };
}
