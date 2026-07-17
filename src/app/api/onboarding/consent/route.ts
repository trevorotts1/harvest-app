// WP01 §6.10-10 (T-21R) — `POST`/`DELETE /api/onboarding/consent`: the live GDPR consent
// grant/revoke endpoint. `POST` records an explicit, affirmative GDPR consent grant (the O-screen
// caller — `OnboardingFlow.tsx`'s new `consent` step — is responsible for only calling this from a
// real user act on a NOT-pre-checked toggle, never automatically); `DELETE` is the revoke path
// (§6.10-10 "revocable"), reachable once a Settings/Me surface exists to call it.
//
// Deliberately built on `withRole` (the REAL Auth.js session, `getCurrentSession` under the hood) —
// NOT `withOnboardingGate`. `withOnboardingGate` requires `onboarding_status === GATED_COMPLETE`,
// which would make this route unreachable DURING onboarding — exactly the moment consent needs to be
// captured. The only authorization question here is "is there a valid, authenticated session at all"
// (the same posture `/api/session/whoami` already established as this codebase's pattern for a
// session-gated-but-not-onboarding-gated route) — every role may grant/revoke their OWN consent, so
// the allow-list is intentionally every role in the enum.
//
// This route neither reads nor trusts any `x-user-*` header — the caller's id comes only from the
// verified session (`session.user.id`), so `scripts/verify-api-auth.mjs`'s guard is moot here by
// construction (no forged-header trust exists to combine with the real-datastore import it flags).

import { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { withRole } from '@/lib/auth/with-role';
import { grantGdprConsent, revokeGdprConsent } from '@/lib/onboarding/gdpr-consent';
import { extractClientIp } from '@/lib/auth/session-security';

const ALL_ROLES = Object.values(Role);

// Force per-request (dynamic) rendering — same rationale as `/api/session/whoami`: this reads the
// live session and must never be statically optimized/cached across users, and `next build`'s
// static-optimization pass would otherwise invoke the handler with a synthetic, cookie-less request.
export const dynamic = 'force-dynamic';

export const POST = withRole(ALL_ROLES, async (req: NextRequest, _ctx, session) => {
  const result = await grantGdprConsent(session.user.id, {
    source: 'onboarding',
    ipAddress: extractClientIp(req.headers) ?? undefined,
  });

  return NextResponse.json({
    granted: true,
    consentType: result.complianceConsent.consent_type,
    version: result.record.version,
    timestamp: result.record.timestamp,
  });
});

export const DELETE = withRole(ALL_ROLES, async (_req: NextRequest, _ctx, session) => {
  const result = await revokeGdprConsent(session.user.id, { source: 'settings' });

  return NextResponse.json({
    granted: false,
    consentType: result.complianceConsent.consent_type,
    version: result.record.version,
    timestamp: result.record.timestamp,
  });
});
