import { Role } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { startMfaEnrollment, type MfaMethodRecord } from '@/lib/auth/mfa';
import { isStepUpFresh } from '@/lib/auth/session-security';
import { withRole, withSessionSecurity } from '@/lib/auth/with-role';
import { emitSecurityEvent } from '@/services/security/security-event';

const ANY_AUTHENTICATED_ROLE = Object.values(Role);

/**
 * Starts TOTP MFA enrollment (T-12, §16.4 "MFA ... offered to rep", required for upline/rvp/
 * admin/dual). Any authenticated role may enroll — REP is not required to, but §16.6 gates its own
 * data-rights export/delete behind step-up MFA, so a REP will need to enroll the first time it
 * hits one of those.
 *
 * Wrapped in `withSessionSecurity` (composed under `withRole`) so revocation, device-fingerprint,
 * and idle/absolute-lifetime checks reach this MFA-management route (T-12 HIGH fix).
 *
 * RE-ENROLLMENT GUARD (T-12 HIGH fix): overwriting an account that ALREADY has a factor enrolled is
 * itself a sensitive account-security change — an attacker on a hijacked live session must not be
 * able to silently swap in their own TOTP secret and lock the true owner out. So if a factor is
 * already enrolled, a FRESH step-up (a re-verification of the current factor via
 * POST /api/auth/mfa/step-up) is required before this overwrites `mfa_methods`. First-time
 * enrollment (no existing factor) needs no step-up — there is nothing to prove ownership of yet,
 * and demanding one would be an impossible chicken-and-egg.
 *
 * Returns the plaintext secret + `otpauth://` URI + recovery codes exactly once — nothing here is
 * ever returned again after this call. The encrypted secret + hashed recovery codes are persisted
 * to `User.mfa_methods` immediately, but `User.mfa_enrolled` stays `false` until
 * `POST /api/auth/mfa/verify` confirms the user actually captured a working code (standard
 * scan-then-confirm TOTP enrollment UX) — an enrollment nobody ever finished must not silently
 * count as "this account has MFA".
 */
export const POST = withRole(
  ANY_AUTHENTICATED_ROLE,
  withSessionSecurity(async (_req: NextRequest, _ctx, session) => {
    const existing = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mfa_enrolled: true },
    });

    // A factor is already enrolled → this is a re-enrollment (overwrite). Require a fresh step-up.
    if (existing?.mfa_enrolled && !isStepUpFresh(session.user.mfaVerifiedAt)) {
      await emitSecurityEvent({ userId: session.user.id, type: 'mfa_challenge', severity: 'WARNING' });
      return NextResponse.json(
        {
          error:
            'This account already has MFA enrolled. Re-verify your current factor via ' +
            'POST /api/auth/mfa/step-up (a fresh step-up), then retry enrollment.',
          code: 'STEP_UP_REQUIRED',
        },
        { status: 403 }
      );
    }

    const enrollment = startMfaEnrollment(session.user.email ?? session.user.id);
    const methodsToStore: MfaMethodRecord[] = await enrollment.methodsToStore;

    await prisma.user.update({
      where: { id: session.user.id },
      data: { mfa_methods: methodsToStore as unknown as object },
    });

    return NextResponse.json(
      {
        otpauthUri: enrollment.otpauthUri,
        secret: enrollment.secret,
        recoveryCodes: enrollment.recoveryCodes,
      },
      { status: 200 }
    );
  })
);
