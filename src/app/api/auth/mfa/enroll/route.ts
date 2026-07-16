import { Role } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { startMfaEnrollment, type MfaMethodRecord } from '@/lib/auth/mfa';
import { withRole } from '@/lib/auth/with-role';

const ANY_AUTHENTICATED_ROLE = Object.values(Role);

/**
 * Starts TOTP MFA enrollment (T-12, §16.4 "MFA ... offered to rep", required for upline/rvp/
 * admin/dual). Any authenticated role may enroll — REP is not required to, but §16.6 gates its own
 * data-rights export/delete behind step-up MFA, so a REP will need to enroll the first time it
 * hits one of those.
 *
 * Returns the plaintext secret + `otpauth://` URI + recovery codes exactly once — nothing here is
 * ever returned again after this call. The encrypted secret + hashed recovery codes are persisted
 * to `User.mfa_methods` immediately, but `User.mfa_enrolled` stays `false` until
 * `POST /api/auth/mfa/verify` confirms the user actually captured a working code (standard
 * scan-then-confirm TOTP enrollment UX) — an enrollment nobody ever finished must not silently
 * count as "this account has MFA".
 */
export const POST = withRole(ANY_AUTHENTICATED_ROLE, async (_req: NextRequest, _ctx, session) => {
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
});
