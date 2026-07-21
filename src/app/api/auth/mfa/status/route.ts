// T-57 R3b (E-M10, master-spec §16.4) — GET-only companion to `../enroll` / `../verify` /
// `../step-up`. None of those three routes exposes a plain "is MFA enrolled right now" read, and
// the session's own `mfaEnrolled` JWT claim is set once at sign-in and is NOT refreshed by the
// `trigger === 'update'` branch of the `jwt` callback (src/lib/auth/options.ts only refreshes
// `mfaVerifiedAt` and `onboardingStatus` there) — so a rep who enrolls mid-session would see a
// stale "not enrolled" if a UI trusted the session claim for its own display. This route always
// reads the live DB value instead, so Me -> Security can show the true current state immediately
// after a successful enrollment, without waiting for a full re-login to refresh the JWT.
//
// Own-data-only (the caller's own session id); no step-up required to read your own enrollment
// status (§16.4's step-up list gates sensitive ACTIONS — billing/export/delete/RBAC/org-switch —
// not a read of your own already-authenticated account state).

import { NextResponse } from 'next/server';
import { Role } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { withRole } from '@/lib/auth/with-role';

const ANY_AUTHENTICATED_ROLE = Object.values(Role);

export const dynamic = 'force-dynamic';

export const GET = withRole(ANY_AUTHENTICATED_ROLE, async (_req, _ctx, session) => {
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfa_enrolled: true },
  });
  return NextResponse.json({ enrolled: user?.mfa_enrolled ?? false });
});
