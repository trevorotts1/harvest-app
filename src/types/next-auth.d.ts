// T-04 — Auth.js (NextAuth) module augmentation.
//
// Extends the library's own `Session`/`User`/`JWT` interfaces (declaration merging) so every
// server component, route handler, and the RBAC guard (src/lib/auth/rbac.ts) gets a typed session
// carrying the five-role enum + org context, instead of `next-auth`'s untyped default `Session`.
// This file has no runtime output — it is types only, loaded automatically because it matches
// tsconfig's `**/*.ts` include and lives in a module-augmentation position (a top-level `declare
// module` file, not imported anywhere).

import type { AccessTier, OrgType, Role } from '@prisma/client';
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
      /** `User.mfa_enrolled` (§3.2) — whether the account has any second factor enrolled. */
      mfaEnrolled: boolean;
      /**
       * MFA-capable session hook point (§16.4, T-12): null until a step-up challenge clears this
       * session. Always null in T-04 — no TOTP/passkey/SMS verification flow exists yet. See
       * src/lib/auth/mfa.ts.
       */
      mfaVerifiedAt: string | null;
    } & DefaultSession['user'];
  }

  interface User extends DefaultUser {
    role: Role;
    orgType: OrgType;
    organizationId: string | null;
    accessTier: AccessTier;
    mfaEnrolled: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    role: Role;
    orgType: OrgType;
    organizationId: string | null;
    accessTier: AccessTier;
    mfaEnrolled: boolean;
    mfaVerifiedAt: string | null;
  }
}
