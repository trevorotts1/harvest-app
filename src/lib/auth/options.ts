import { PrismaAdapter } from '@next-auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

import { prisma } from '@/lib/prisma';
import { hmacForMatch } from '@/services/compliance/encryption/encryption';
import {
  getLoginHistoryStore,
  scoreLoginAttempt,
} from '@/services/security/credential-stuffing';
import { getLoginRateLimiter } from '@/services/security/rate-limiter';
import { emitSecurityEvent } from '@/services/security/security-event';

import {
  ABSOLUTE_SESSION_LIFETIME_MS,
  computeDeviceFingerprint,
  extractClientIp,
  extractHeader,
  hashIp,
  type HeaderSource,
} from './session-security';
import { consumeStepUpProof } from './step-up-proof';

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
 * Auth.js (NextAuth v4.24, D-2 operator-confirmed) configuration — T-04 scaffold, completed by
 * T-12 (master-spec §16.4/§18.10: rate limiting, credential-stuffing defense, session-hijack
 * binding, MFA state carried on the session).
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
    // §16.4 "idle timeout (30 min) and absolute session lifetime" — T-04 enforced a flat
    // 30-minute JWT lifetime as a stand-in for that pair; T-12 splits it for real: the JWT's own
    // hard ceiling is now the ABSOLUTE lifetime (defense in depth even if every app-level check
    // below were bypassed), while the 30-minute IDLE timeout is enforced separately, at the API
    // layer, against `SessionActivityStore` (session-security.ts `evaluateSessionSecurity`,
    // `with-role.ts` `withSessionSecurity`) — NextAuth's own JWT expiry can't express two
    // different timeouts, and re-stamping "now" into the token on every silent decode (which is
    // all NextAuth's `jwt` callback can see) would make an idle timeout unreachable if it lived
    // in the token itself.
    maxAge: ABSOLUTE_SESSION_LIFETIME_MS / 1000,
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
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const headers = req?.headers as HeaderSource;
        const ip = extractClientIp(headers);
        const ipHash = hashIp(ip);
        const fingerprintHash = computeDeviceFingerprint({
          userAgent: extractHeader(headers, 'user-agent'),
          ip,
          acceptLanguage: extractHeader(headers, 'accept-language'),
        });

        // §16.4 "per-IP and per-account rate limits on auth endpoints (login...)". Keyed by the
        // *submitted* email (hashed, never plaintext-logged) rather than "does this account
        // exist" so a non-existent email gets rate-limited identically to a real one — otherwise
        // a distinguishable lockout-vs-not response would itself be an enumeration side-channel
        // (§16.4 "never reveal whether an email exists"). Checked, and FAILS CLOSED, before any
        // DB lookup or password compare.
        const loginRateLimiter = getLoginRateLimiter();
        const emailKey = `login:account:${hmacForMatch(credentials.email.toLowerCase())}`;
        const ipKey = `login:ip:${ipHash}`;
        const [accountLimit, ipLimit] = await Promise.all([
          loginRateLimiter.check(emailKey),
          loginRateLimiter.check(ipKey),
        ]);

        if (!accountLimit.allowed || !ipLimit.allowed) {
          await emitSecurityEvent({
            type: 'rate_limited',
            ipHash,
            deviceFingerprintHash: fingerprintHash,
            severity: 'WARNING',
          });
          // Same generic null return as every other failure branch below — NextAuth's
          // CredentialsProvider funnels every authorize() failure (null or thrown) into the same
          // opaque "CredentialsSignin" client error regardless of cause, which is what makes the
          // non-enumerating posture hold across rate-limited / wrong-password / no-such-user.
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email: credentials.email } });

        // Generic failure for both "no such user" and "wrong password" (§16.4 "generic
        // auth-failure messaging (never reveal whether an email exists)"). The dummy compare on
        // the "no such user" branch keeps this path's timing indistinguishable from the
        // wrong-password branch below, so a timing side-channel can't leak whether the email
        // exists (§16.4 "never reveal whether an email exists").
        if (!user) {
          await bcrypt.compare(credentials.password, DUMMY_PASSWORD_HASH);
          await emitSecurityEvent({
            type: 'login_failure',
            ipHash,
            deviceFingerprintHash: fingerprintHash,
          });
          // Timing equalization (§16.4 "never reveal whether an email exists"): the wrong-password
          // branch below does an extra `LoginHistoryStore.record` the dummy bcrypt.compare above
          // doesn't account for — so the "no such user" path must pay the same write, or the delta
          // between the two failure branches becomes an enumeration side-channel. Keyed by a stable
          // hashed sentinel (`no-such-user:<hmac(email)>`, never a real UUID user id, never a
          // plaintext email) so it equalizes cost without colliding with any real user's history —
          // and, as a bonus, still tracks velocity of probing against non-existent accounts.
          await getLoginHistoryStore().record(`no-such-user:${hmacForMatch(credentials.email.toLowerCase())}`, {
            deviceFingerprintHash: fingerprintHash,
            ipHash,
            at: Date.now(),
            outcome: 'failure',
          });
          return null;
        }

        const passwordValid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!passwordValid) {
          await emitSecurityEvent({
            userId: user.id,
            type: 'login_failure',
            ipHash,
            deviceFingerprintHash: fingerprintHash,
          });
          await getLoginHistoryStore().record(user.id, {
            deviceFingerprintHash: fingerprintHash,
            ipHash,
            at: Date.now(),
            outcome: 'failure',
          });
          return null;
        }

        // T-R56 (admin console — user_profile.manage): a suspended account's credentials may be
        // perfectly valid — this is checked AFTER the bcrypt compare above (same cost as a normal
        // sign-in attempt) specifically so blocking a suspended account never becomes a timing
        // side-channel distinguishing "suspended" from "wrong password"/"no such user" (mirrors
        // this function's existing non-enumeration discipline). Suspension is a reversible admin
        // hold (never a delete), so the account can sign in again the moment it's reactivated.
        if (user.is_suspended) {
          await emitSecurityEvent({
            userId: user.id,
            type: 'account_suspended',
            ipHash,
            deviceFingerprintHash: fingerprintHash,
            severity: 'WARNING',
          });
          await getLoginHistoryStore().record(user.id, {
            deviceFingerprintHash: fingerprintHash,
            ipHash,
            at: Date.now(),
            outcome: 'failure',
          });
          return null;
        }

        // Credentials valid past this point — clear the failure counters (a legitimate sign-in
        // resets progressive backoff) and score the login for credential-stuffing / takeover
        // anomaly signals (§16.4 "anomaly scoring on login (new device/geo/velocity...)").
        await Promise.all([loginRateLimiter.reset(emailKey), loginRateLimiter.reset(ipKey)]);

        const anomaly = await scoreLoginAttempt({
          userId: user.id,
          deviceFingerprintHash: fingerprintHash,
          ipHash,
        });
        await getLoginHistoryStore().record(user.id, {
          deviceFingerprintHash: fingerprintHash,
          ipHash,
          at: Date.now(),
          outcome: 'success',
        });

        await emitSecurityEvent({
          userId: user.id,
          type: 'login_success',
          ipHash,
          deviceFingerprintHash: fingerprintHash,
          severity: anomaly.requiresChallenge ? 'WARNING' : 'INFO',
        });

        if (anomaly.requiresChallenge) {
          // §16.4/§18.10 "anomalous logins (new device/geo/velocity) trigger step-up MFA or a
          // challenge" + "a suspected-takeover event escalates to the incident-response lifecycle
          // (§16.7)". This build has no separate pre-session challenge screen to redirect through
          // (no CAPTCHA/challenge UI exists yet in this backend-only unit), so an anomalous-but-
          // password-valid login still completes rather than dead-ending the user with no
          // recovery surface; the safety net is that `mfaVerifiedAt` starts null on every fresh
          // session regardless (jwt callback below), so any §16.4 sensitive action still demands
          // a fresh step-up (src/lib/auth/mfa.ts `requireStepUp`). The `SecurityEvent` below is
          // what feeds T-15's incident-response triage for this signal.
          await emitSecurityEvent({
            userId: user.id,
            type: 'suspected_takeover',
            ipHash,
            deviceFingerprintHash: fingerprintHash,
            severity: 'WARNING',
          });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgType: user.org_type,
          organizationId: user.organization_id,
          accessTier: user.access_tier,
          onboardingStatus: user.onboarding_status,
          mfaEnrolled: user.mfa_enrolled,
          deviceFingerprintHash: fingerprintHash,
          securityVersionAtIssue: user.security_version,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // `user` is only defined on the initial sign-in call; subsequent calls just carry `token`
      // forward, so the five-role/org context set here persists for the life of the JWT.
      if (user) {
        token.role = user.role;
        token.orgType = user.orgType;
        token.organizationId = user.organizationId;
        token.accessTier = user.accessTier;
        token.onboardingStatus = user.onboardingStatus;
        token.mfaEnrolled = user.mfaEnrolled;
        // Re-nulled on every fresh sign-in (§16.4 "anomaly scoring on login ... step-up MFA or
        // challenge") — a brand-new session never inherits a previous session's cleared step-up.
        token.mfaVerifiedAt = null;
        // Session-hijack binding (§16.4/§18.10, T-12): fixed at sign-in, never mutated again for
        // this token's life — `withSessionSecurity` (with-role.ts) compares these against a
        // freshly computed fingerprint / freshly read `security_version` on each check.
        token.deviceFingerprintHash = user.deviceFingerprintHash;
        token.securityVersionAtIssue = user.securityVersionAtIssue;
        token.boundAt = Date.now();
      } else if (trigger === 'update' && session) {
        // T-12 CRITICAL FIX (§16.4). A client-driven `useSession().update({ mfaVerifiedAt })` used
        // to write its OWN timestamp straight into the token here — which let any authenticated (or
        // stolen) session self-certify a fresh step-up for a §16.4 sensitive action
        // (billing/export/delete/RBAC/org-switch) WITHOUT ever entering a TOTP/recovery code. The
        // client payload (`session.mfaVerifiedAt`) is now DELIBERATELY IGNORED as a freshness
        // source. The ONLY thing that can promote this session to "freshly stepped up" is a
        // server-side, single-use proof (`User.mfa_stepped_up_at`) that POST /api/auth/mfa/step-up
        // wrote after it verified a real code. `consumeStepUpProof` reads that proof, atomically
        // clears it (single-use — a replay or a second session can't consume it twice), and returns
        // the SERVER-clock timestamp only if it is still fresh. No valid unconsumed proof →
        // `mfaVerifiedAt` is left untouched (stays null on a fresh session), so `requireStepUp`
        // (mfa.ts) still throws. `mfaVerifiedAt` remains the ONLY step-up field an update touches —
        // role/org/security-version/fingerprint are never client-settable.
        const userId = typeof token.sub === 'string' ? token.sub : null;
        if (userId) {
          const serverProof = await consumeStepUpProof(userId);
          if (serverProof) {
            token.mfaVerifiedAt = serverProof;
          }
          // T-20 §6.10-1: refresh the onboarding-gate claim from the DB on an explicit
          // `useSession().update()`. This is what lets a rep who just reached GATED_COMPLETE (O-9)
          // clear the middleware page-gate without re-authenticating — the claim is server-sourced,
          // never client-settable (the client cannot forge completion, exactly like role/org/
          // security-version above), and any DB read failure leaves the prior (fail-closed) claim
          // in place rather than promoting the token.
          const fresh = await prisma.user.findUnique({
            where: { id: userId },
            select: { onboarding_status: true },
          });
          if (fresh) {
            token.onboardingStatus = fresh.onboarding_status;
          }
        }
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
        session.user.onboardingStatus = token.onboardingStatus;
        session.user.mfaEnrolled = token.mfaEnrolled;
        session.user.mfaVerifiedAt = token.mfaVerifiedAt;
        session.user.deviceFingerprintHash = token.deviceFingerprintHash;
        session.user.securityVersionAtIssue = token.securityVersionAtIssue;
        session.user.boundAt = token.boundAt;
      }
      return session;
    },
  },
};
