import { Role } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { verifyMfaCode, type MfaMethodRecord } from '@/lib/auth/mfa';
import { withRole } from '@/lib/auth/with-role';
import { getMfaVerifyRateLimiter } from '@/services/security/rate-limiter';
import { emitSecurityEvent } from '@/services/security/security-event';

const ANY_AUTHENTICATED_ROLE = Object.values(Role);

/**
 * Clears a step-up MFA challenge for the current session (T-12, §16.4's five sensitive actions:
 * billing change, data export/delete, RBAC change, org switch). The client submits a TOTP or
 * recovery code; on success this returns `{ mfaVerifiedAt }`, which the client feeds into
 * NextAuth's `useSession().update({ mfaVerifiedAt })` — that round-trip is what actually threads
 * the fresh timestamp into the JWT (`src/lib/auth/options.ts`'s `jwt` callback, `trigger ===
 * 'update'`), which is what `requireStepUp` (mfa.ts) and `withStepUp` (with-role.ts) read.
 *
 * Rate-limited per-account, same rationale as `/api/auth/mfa/verify` (a 6-digit code is a
 * brute-forceable secret) — FAILS CLOSED on a limiter store error.
 */
export const POST = withRole(ANY_AUTHENTICATED_ROLE, async (req: NextRequest, _ctx, session) => {
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

  const mfaVerifiedAt = new Date().toISOString();
  await emitSecurityEvent({ userId: session.user.id, type: 'mfa_challenge', severity: 'INFO' });

  return NextResponse.json({ mfaVerifiedAt }, { status: 200 });
});
