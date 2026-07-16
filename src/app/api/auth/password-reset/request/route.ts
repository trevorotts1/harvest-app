import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { hmacForMatch } from '@/services/compliance/encryption/encryption';
import { issuePasswordResetToken, PrismaVerificationTokenStore } from '@/services/security/password-reset';
import { getPasswordResetRateLimiter } from '@/services/security/rate-limiter';
import { emitSecurityEvent } from '@/services/security/security-event';

/**
 * Requests a password-reset token (T-12, §16.4/§18.10). Unauthenticated by design (the caller has,
 * by definition, no working credential yet). Always responds with the same generic message and
 * status regardless of whether the email is registered — §16.4 "generic auth-failure messaging
 * (never reveal whether an email exists)" applies to this endpoint exactly as it does to login.
 *
 * Rate-limited per submitted-email + per-IP (keyed the same non-enumerating way login is — by the
 * raw submitted identifier, not "does this account exist" — see src/lib/auth/options.ts for the
 * fuller rationale). FAILS CLOSED on a limiter store error.
 *
 * Token delivery (email) is WP05's messaging-provider territory and out of scope here — the raw
 * token is intentionally never included in this response (see password-reset.ts's doc comment);
 * this unit's tests exercise `issuePasswordResetToken`/`consumePasswordResetToken` directly.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';

  const GENERIC_RESPONSE = NextResponse.json(
    { message: 'If an account exists for that email, reset instructions have been sent.' },
    { status: 200 }
  );

  if (!email) return GENERIC_RESPONSE;

  const rateLimiter = getPasswordResetRateLimiter();
  const emailKey = `password_reset:account:${hmacForMatch(email.toLowerCase())}`;
  const ipHash = hmacForMatch(request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown');
  const ipKey = `password_reset:ip:${ipHash}`;

  const [accountLimit, ipLimit] = await Promise.all([rateLimiter.check(emailKey), rateLimiter.check(ipKey)]);
  if (!accountLimit.allowed || !ipLimit.allowed) {
    await emitSecurityEvent({ type: 'rate_limited', ipHash, severity: 'WARNING' });
    return GENERIC_RESPONSE; // still generic — a distinguishable "you're rate-limited" reply would itself enumerate
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const store = new PrismaVerificationTokenStore(prisma);
    await issuePasswordResetToken(store, email);
    await emitSecurityEvent({ userId: user.id, type: 'password_reset', severity: 'INFO' });
    // TODO(WP05): hand the raw token to the email-delivery provider here. Never log/return it.
  }

  return GENERIC_RESPONSE;
}
