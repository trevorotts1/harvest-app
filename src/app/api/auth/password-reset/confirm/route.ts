import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { hmacForMatch } from '@/services/compliance/encryption/encryption';
import { getBreachedPasswordChecker } from '@/services/security/credential-stuffing';
import { consumePasswordResetToken, PrismaVerificationTokenStore } from '@/services/security/password-reset';
import { getPasswordResetRateLimiter } from '@/services/security/rate-limiter';
import { emitSecurityEvent } from '@/services/security/security-event';

const BCRYPT_ROUNDS = 12; // matches src/app/api/auth/register/route.ts

/**
 * Confirms a password reset (T-12, §16.4/§18.10): consumes the single-use token from
 * `POST /api/auth/password-reset/request`, screens the new password against known-breached
 * passwords (§18.10 "set/reset screens screen against known-breached passwords"), and — because a
 * password reset is exactly the kind of trust-boundary event "sign out everywhere" exists for —
 * bumps `User.security_version` so every previously issued session is invalidated the moment the
 * password changes (src/lib/auth/session-security.ts `evaluateSessionSecurity`'s revocation
 * check). Rate-limited per-account; FAILS CLOSED on a limiter store error.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email : '';
  const token = typeof body?.token === 'string' ? body.token : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  if (!email || !token || !newPassword) {
    return NextResponse.json({ error: 'email, token, and newPassword are required' }, { status: 400 });
  }

  const rateLimiter = getPasswordResetRateLimiter();
  const emailKey = `password_reset_confirm:account:${hmacForMatch(email.toLowerCase())}`;
  const limit = await rateLimiter.check(emailKey);
  if (!limit.allowed) {
    await emitSecurityEvent({ type: 'rate_limited', severity: 'WARNING' });
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  const isBreached = await getBreachedPasswordChecker().isBreached(newPassword);
  if (isBreached) {
    return NextResponse.json(
      { error: 'That password appears in known data breaches. Please choose a different one.' },
      { status: 400 }
    );
  }

  const store = new PrismaVerificationTokenStore(prisma);
  const valid = await consumePasswordResetToken(store, email, token);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid or expired reset link.' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Token was valid but the account no longer exists — treat identically to "invalid link"
    // rather than confirming account non-existence.
    return NextResponse.json({ error: 'Invalid or expired reset link.' }, { status: 400 });
  }

  await rateLimiter.reset(emailKey);

  const password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: { password_hash, security_version: { increment: 1 } },
  });

  await emitSecurityEvent({ userId: user.id, type: 'password_reset', severity: 'INFO' });
  await emitSecurityEvent({ userId: user.id, type: 'session_revoked', severity: 'INFO' });

  return NextResponse.json({ reset: true }, { status: 200 });
}
