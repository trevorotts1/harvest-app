import { Role } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { verifyMfaCode, type MfaMethodRecord } from '@/lib/auth/mfa';
import { withRole } from '@/lib/auth/with-role';
import { getMfaVerifyRateLimiter } from '@/services/security/rate-limiter';
import { emitSecurityEvent } from '@/services/security/security-event';

const ANY_AUTHENTICATED_ROLE = Object.values(Role);

/**
 * Completes TOTP MFA enrollment (T-12, §16.4). The client submits the first code its authenticator
 * app generated after scanning the `POST /api/auth/mfa/enroll` response; a correct code proves the
 * secret was captured correctly and flips `User.mfa_enrolled` to `true`.
 *
 * Rate-limited per-account (§16.4 "per-IP and per-account rate limits on auth endpoints ...MFA
 * challenge") — a 6-digit TOTP code is only 10^6 possibilities, so this endpoint is exactly the
 * kind of guessable-secret surface §16.4 calls out by name. FAILS CLOSED on a rate-limiter store
 * error (deny, not allow-through) — see `RateLimiter.check`.
 */
export const POST = withRole(ANY_AUTHENTICATED_ROLE, async (req: NextRequest, _ctx, session) => {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';

  const rateLimiter = getMfaVerifyRateLimiter();
  const key = `mfa_verify:account:${session.user.id}`;
  const limit = await rateLimiter.check(key);
  if (!limit.allowed) {
    await emitSecurityEvent({ userId: session.user.id, type: 'rate_limited', severity: 'WARNING' });
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  const methods = (user?.mfa_methods as unknown as MfaMethodRecord[] | null) ?? [];

  const result = await verifyMfaCode(methods, token);
  if (!result.valid) {
    await emitSecurityEvent({ userId: session.user.id, type: 'mfa_verify_failed', severity: 'WARNING' });
    return NextResponse.json({ error: 'Invalid or expired code.' }, { status: 400 });
  }

  await rateLimiter.reset(key);

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      mfa_enrolled: true,
      ...(result.method === 'recovery_code' ? { mfa_methods: result.updatedMethods as unknown as object } : {}),
    },
  });

  await emitSecurityEvent({ userId: session.user.id, type: 'mfa_enrolled', severity: 'INFO' });

  return NextResponse.json({ enrolled: true }, { status: 200 });
});
