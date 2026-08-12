import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { hmacForMatch } from '@/services/compliance/encryption/encryption';
import { createEmailSendClient } from '@/services/messaging/send/email-send-client';
import { issuePasswordResetToken, PrismaVerificationTokenStore, revokePasswordResetToken } from '@/services/security/password-reset';
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
 *
 * R-18 (T-59/W1, admin-mediated recovery): the ADMIN console path — POST
 * /api/admin/users/[userId]/reset-password — issues the same kind of token and returns the raw
 * value to the ADMIN session for out-of-band handoff (chat/phone). The confirm route below
 * consumes either route's token identically.
 *
 * T-R76: token delivery is now wired end-to-end through the existing WP05 transactional-email
 * client (`createEmailSendClient`, RESEND_API_KEY). FAIL-CLOSED: when the client is unconfigured
 * (no key), the route still answers the same generic 200 and issues nothing — the reset simply
 * never lands; the admin console remains the fallback channel. When configured, the reset link is
 * emailed to the account address and the raw token is never logged, returned, or persisted.
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
    const rawToken = await issuePasswordResetToken(store, email);
    await emitSecurityEvent({ userId: user.id, type: 'password_reset', severity: 'INFO' });

    // T-R76 — delivery through the WP05 transactional-email seam. FAIL-CLOSED at every level:
    // unconfigured client → no send; a SEND FAILURE must never surface as a 500 (a 500-vs-200
    // distinction would reveal whether the address is registered — account enumeration on every
    // provider outage). The send is wrapped so ANY failure falls through to the same generic
    // response, and the just-issued single-use token is revoked so a link that never left this
    // machine cannot be redeemed later. The raw token goes ONLY into the emailed link — never
    // logged, never returned in this response.
    const emailClient = createEmailSendClient();
    if (emailClient) {
      try {
        const appUrl = process.env.NEXTAUTH_URL ?? 'https://harvest-app-self.vercel.app';
        const from = process.env.EMAIL_SEND_FROM ?? 'no-reply@harvestapp.email';
        await emailClient.sendEmail({
          to: email,
          from,
          subject: 'Reset your Harvest password',
          body:
            'Someone requested a password reset for this account. If that was you, open the link ' +
            'below to choose a new password (valid for 30 minutes):\n\n' +
            `${appUrl}/auth/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(rawToken)}\n\n` +
            'If you did not request this, you can ignore this email — your password is unchanged.',
          unsubscribeUrl: `${appUrl}/auth`,
          physicalAddress: 'The Harvest — BlackCEO',
        });
      } catch {
        // Send failed (provider outage/4xx) — FAIL CLOSED: revoke the unreachable token, record the
        // event, and fall through to the SAME generic response. No 500, no enumeration.
        await revokePasswordResetToken(store, email, rawToken);
        await emitSecurityEvent({ userId: user.id, type: 'password_reset_delivery_failed', severity: 'WARNING' });
      }
    }
  }

  return GENERIC_RESPONSE;
}
