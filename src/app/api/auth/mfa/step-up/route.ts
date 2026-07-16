import { Role } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { verifyMfaCode, type MfaMethodRecord } from '@/lib/auth/mfa';
import { recordStepUpProof } from '@/lib/auth/step-up-proof';
import { withRole, withSessionSecurity } from '@/lib/auth/with-role';
import { getMfaVerifyRateLimiter } from '@/services/security/rate-limiter';
import { emitSecurityEvent } from '@/services/security/security-event';

const ANY_AUTHENTICATED_ROLE = Object.values(Role);

/**
 * Clears a step-up MFA challenge for the current session (T-12, §16.4's five sensitive actions:
 * billing change, data export/delete, RBAC change, org switch). The client submits a TOTP or
 * recovery code; on success this writes a single-use SERVER proof (`User.mfa_stepped_up_at`, via
 * `recordStepUpProof`) and returns `{ mfaVerifiedAt }`, then the client calls NextAuth's
 * `useSession().update({ mfaVerifiedAt })`. That round-trip is what threads the fresh timestamp
 * into the JWT — but the jwt callback (`src/lib/auth/options.ts`, `trigger === 'update'`) now
 * IGNORES the client's payload value and instead consumes the server proof this route wrote, so
 * only a real, server-verified challenge can mark the session freshly stepped up (which is what
 * `requireStepUp` (mfa.ts) and `withStepUp` (with-role.ts) read).
 *
 * Wrapped in `withSessionSecurity` (composed under `withRole`) so revocation ("sign out
 * everywhere"), device-fingerprint-mismatch, and idle/absolute-lifetime checks all reach this
 * MFA-management route, not just the role gate (T-12 HIGH fix).
 *
 * Rate-limited per-account, same rationale as `/api/auth/mfa/verify` (a 6-digit code is a
 * brute-forceable secret) — FAILS CLOSED on a limiter store error.
 */
export const POST = withRole(
  ANY_AUTHENTICATED_ROLE,
  withSessionSecurity(async (req: NextRequest, _ctx, session) => {
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === 'string' ? body.token : '';

    const rateLimiter = getMfaVerifyRateLimiter();
    const key = `mfa_step_up:account:${session.user.id}`;
    const limit = await rateLimiter.check(key);
    if (!limit.allowed) {
      await emitSecurityEvent({ userId: session.user.id, type: 'rate_limited', severity: 'WARNING' });
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user?.mfa_enrolled) {
      return NextResponse.json({ error: 'MFA is not enrolled on this account.' }, { status: 400 });
    }
    const methods = (user.mfa_methods as unknown as MfaMethodRecord[] | null) ?? [];

    const result = await verifyMfaCode(methods, token);
    if (!result.valid) {
      await emitSecurityEvent({ userId: session.user.id, type: 'mfa_verify_failed', severity: 'WARNING' });
      return NextResponse.json({ error: 'Invalid or expired code.' }, { status: 400 });
    }

    await rateLimiter.reset(key);

    if (result.method === 'recovery_code') {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { mfa_methods: result.updatedMethods as unknown as object },
      });
    }

    // Record the single-use SERVER proof (server clock) that a real challenge just cleared. This —
    // not the value returned below — is what the jwt `update` callback consumes to mark the session
    // freshly stepped up; the returned `mfaVerifiedAt` is only the client's cue to fire
    // `useSession().update()`.
    const mfaVerifiedAt = await recordStepUpProof(session.user.id);
    await emitSecurityEvent({ userId: session.user.id, type: 'mfa_challenge', severity: 'INFO' });

    return NextResponse.json({ mfaVerifiedAt }, { status: 200 });
  })
);
