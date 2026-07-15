import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

import { prisma } from '@/lib/prisma';

/**
 * Fixed dummy bcrypt hash (cost 12, matching `BCRYPT_ROUNDS` in
 * src/app/api/auth/register/route.ts) used only to burn a comparable amount of CPU time on the
 * "no such user" path in `authorize()` below — it is never a real credential and nothing is ever
 * compared against it that could succeed. Without this, a request for a non-existent email returns
 * near-instantly while a request for a real email with a wrong password pays the full bcrypt.compare
 * cost, letting an attacker time responses to enumerate valid emails — exactly what §16.4 "never
 * reveal whether an email exists" forbids.
 */
const DUMMY_PASSWORD_HASH = '$2b$12$MEVZM7ykDz6jQqYFKMsBAOKe7pkfl/di9K.DgFws3GBt/jllkVou.';

/**
 * Auth.js (NextAuth v4.24, D-2 operator-confirmed) configuration — T-04 scaffold.
 *
 * Provider choice: `next-auth@4.24.x` (the `latest` dist-tag) rather than the `next-auth@5.x` /
 * `@auth/core` rewrite, which is still in beta (5.0.0-beta.31 at build time) — "choose a
 * stable-enough version" per the build brief. v4's App Router support (a catch-all route handler
 * + `getServerSession`) is fully documented and production-proven; migrating to v5 later is a
 * config-shape change, not an architecture change, so nothing here forecloses it.
 *
 * Session strategy: JWT, not the adapter's database-session tables. NextAuth v4 *requires* this —
 * pairing a `CredentialsProvider` with the default `"database"` session strategy throws at runtime
 * ("session strategy has to be 'jwt' when using CredentialsProvider"). JWT sessions also fit
 * §16.4's session-security posture ("short-lived access tokens with rotating refresh tokens")
 * better than server-persisted session rows.
 *
 * Prisma adapter: wired per the build brief even though the Credentials + JWT flow above never
 * calls into it (CredentialsProvider's `authorize()` fully owns user lookup; JWT sessions never
 * call `createSession`/`getSessionAndUser`). It is here so (a) `PrismaAdapter(prisma)` type-checks
 * against this schema today, keeping the schema/adapter pairing real rather than aspirational, and
 * (b) adding an OAuth provider later (§6.3 Flow A: "auth: email/password or OAuth") is a config
 * change, not a further migration — the Account/Session/VerificationToken tables already exist
 * (prisma/schema.prisma, migration 20260715130000_add_nextauth_tables).
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),

  session: {
    strategy: 'jwt',
    // §16.4 "idle timeout (30 min) and absolute session lifetime" — this scaffold enforces a flat
    // 30-minute JWT lifetime as a stand-in for that pair; T-12/T-15 split it into true idle-vs-
    // absolute tracking plus the rotating-refresh-token mechanics §16.4 also calls for.
    maxAge: 30 * 60,
  },

  // Auth.js v4 reads `NEXTAUTH_SECRET` by default; `AUTH_SECRET` is accepted too (the v5/Auth.js-
  // core env-var name) so this config keeps working unmodified if the project migrates off v4
  // later. Referenced by name only (§0.4) — see .env.example.
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,

  pages: {
    signIn: '/auth',
  },

  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({ where: { email: credentials.email } });

        // Generic failure for both "no such user" and "wrong password" (§16.4 "generic
        // auth-failure messaging (never reveal whether an email exists)"). The dummy compare on
        // the "no such user" branch keeps this path's timing indistinguishable from the
        // wrong-password branch below, so a timing side-channel can't leak whether the email
        // exists (§16.4 "never reveal whether an email exists").
        if (!user) {
          await bcrypt.compare(credentials.password, DUMMY_PASSWORD_HASH);
          return null;
        }
        const passwordValid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!passwordValid) return null;

        // HOOK POINT (T-12, §16.4): MFA is required for UPLINE/RVP/ADMIN/DUAL and offered to REP
        // (src/lib/auth/mfa.ts `isMfaRequiredForRole`). Once T-12 implements the real TOTP/
        // passkey/SMS-fallback challenge, this is where a password-valid-but-not-yet-stepped-up
        // sign-in gets redirected into that challenge instead of completing here — e.g. by
        // returning a sentinel user shape the `jwt` callback below recognizes as "pending step-up"
        // until the second factor clears. Not implemented in T-04; `authorize()` always completes
        // sign-in on a valid password today, same as before this unit.

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgType: user.org_type,
          organizationId: user.organization_id,
          accessTier: user.access_tier,
          mfaEnrolled: user.mfa_enrolled,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // `user` is only defined on the initial sign-in call; subsequent calls just carry `token`
      // forward, so the five-role/org context set here persists for the life of the JWT.
      if (user) {
        token.role = user.role;
        token.orgType = user.orgType;
        token.organizationId = user.organizationId;
        token.accessTier = user.accessTier;
        token.mfaEnrolled = user.mfaEnrolled;
        // HOOK POINT (T-12): initialize as null on every fresh sign-in. T-12 sets this once a
        // step-up challenge clears for this session, and re-nulls it on re-authentication or a
        // detected anomaly (§16.4 "anomaly scoring on login ... step-up MFA or challenge").
        token.mfaVerifiedAt = null;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role;
        session.user.orgType = token.orgType;
        session.user.organizationId = token.organizationId;
        session.user.accessTier = token.accessTier;
        session.user.mfaEnrolled = token.mfaEnrolled;
        session.user.mfaVerifiedAt = token.mfaVerifiedAt;
      }
      return session;
    },
  },
};
