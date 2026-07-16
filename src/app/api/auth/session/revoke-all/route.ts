import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withRole, withSessionSecurity } from '@/lib/auth/with-role';
import { emitSecurityEvent } from '@/services/security/security-event';

const ANY_AUTHENTICATED_ROLE = Object.values(Role);

/**
 * "Sign out everywhere" (T-12, §16.4 "a session-revocation control ('sign out everywhere') on the
 * Me surface"). Bumps `User.security_version`, which invalidates every previously issued JWT at
 * once — any session (this one included) whose token snapshot no longer matches the live value is
 * treated as revoked by `evaluateSessionSecurity` (session-security.ts), enforced at the API layer
 * by `withSessionSecurity` (with-role.ts). This same mechanism is what "rotation on privilege
 * change" (§16.4) would call on a role-change admin action, whenever that lands.
 *
 * Wrapped in `withSessionSecurity` (composed under `withRole`) so this session-management route is
 * itself subject to revocation / device-fingerprint / idle checks before it runs (T-12 HIGH fix).
 * The current request's own session is still valid at check time (its version still matches); the
 * bump below takes effect for every subsequent request.
 *
 * Requires re-confirming the current password rather than a fresh step-up MFA challenge — "sign
 * out everywhere" is exactly the tool a user reaches for when they suspect their session (not
 * necessarily their password) is compromised, so gating it behind the same session's own MFA
 * state would be circular; a password re-confirmation is the standard, independent proof of intent
 * most products use for this action.
 */
export const POST = withRole(
  ANY_AUTHENTICATED_ROLE,
  withSessionSecurity(async (req: NextRequest, _ctx, session) => {
    const body = await req.json().catch(() => null);
    const password = typeof body?.password === 'string' ? body.password : '';

    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    }

    const passwordValid = password ? await bcrypt.compare(password, user.password_hash) : false;
    if (!passwordValid) {
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { security_version: { increment: 1 } },
    });

    await emitSecurityEvent({ userId: user.id, type: 'session_revoked', severity: 'INFO' });

    return NextResponse.json({ revoked: true }, { status: 200 });
  })
);
