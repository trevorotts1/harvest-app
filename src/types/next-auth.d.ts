// T-04 — Auth.js (NextAuth) module augmentation.
//
// Extends the library's own `Session`/`User`/`JWT` interfaces (declaration merging) so every
// server component, route handler, and the RBAC guard (src/lib/auth/rbac.ts) gets a typed session
// carrying the five-role enum + org context, instead of `next-auth`'s untyped default `Session`.
// This file has no runtime output — it is types only, loaded automatically because it matches
// tsconfig's `**/*.ts` include and lives in a module-augmentation position (a top-level `declare
// module` file, not imported anywhere).

import type { AccessTier, OnboardingStatus, OrgType, Role } from '@prisma/client';
import type { DefaultSession, DefaultUser } from 'next-auth';
import type { DefaultJWT } from 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      /** One of the five roles (§3.1): REP | UPLINE | RVP | ADMIN | DUAL. */
      role: Role;
      orgType: OrgType;
      organizationId: string | null;
      accessTier: AccessTier;
      /**
       * `User.onboarding_status` (§1.4/§6.10-1) — the §6.10-1 hard-gate claim. Stamped at sign-in and
       * refreshed on a client `useSession().update()` (jwt callback, options.ts), so `src/middleware.ts`
       * can gate downstream PAGE routes off it on the Edge runtime without a DB read. The DB is still
       * the authoritative source for the API-layer `withOnboardingGate` (onboarding-gate.ts).
       */
      onboardingStatus: OnboardingStatus;
      /** `User.mfa_enrolled` (§3.2) — whether the account has any second factor enrolled. */
      mfaEnrolled: boolean;
      /**
       * MFA step-up state (§16.4, T-12): ISO timestamp of the last cleared step-up challenge, or
       * null if none has cleared yet this session. Checked against
       * `session-security.ts`'s `STEP_UP_REVALIDATION_WINDOW_MS` by `requireStepUp` (mfa.ts).
       */
      mfaVerifiedAt: string | null;
      /**
       * Session-hijack binding (§16.4/§18.10, T-12): the device-fingerprint hash captured at
       * sign-in (`computeDeviceFingerprint`, session-security.ts) and the `User.security_version`
       * snapshot taken at the same time. `withSessionSecurity` (with-role.ts) recomputes the
       * current fingerprint and re-reads the live `security_version` on each check and compares.
       */
      deviceFingerprintHash: string;
      securityVersionAtIssue: number;
      /** Sign-in time (ms epoch), immutable for the JWT's life — the absolute-expiry input and the
       *  activity-bucket key (`session-security.ts` `sessionActivityKey`). Idle-timeout's
       *  "last activity" is tracked externally (`SessionActivityStore`), not in the token. */
      boundAt: number;
    } & DefaultSession['user'];
  }

  interface User extends DefaultUser {
    role: Role;
    orgType: OrgType;
    organizationId: string | null;
    accessTier: AccessTier;
    onboardingStatus: OnboardingStatus;
    mfaEnrolled: boolean;
    deviceFingerprintHash: string;
    securityVersionAtIssue: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    role: Role;
    orgType: OrgType;
    organizationId: string | null;
    accessTier: AccessTier;
    onboardingStatus: OnboardingStatus;
    mfaEnrolled: boolean;
    mfaVerifiedAt: string | null;
    deviceFingerprintHash: string;
    securityVersionAtIssue: number;
    boundAt: number;
  }
}
