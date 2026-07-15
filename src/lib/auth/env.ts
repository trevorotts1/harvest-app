/**
 * Runtime (request-time), fail-loud guard for the secret Auth.js/NextAuth needs to sign and verify
 * session JWTs and CSRF tokens (T-04 QC fix, defect 2).
 *
 * The defect this closes: `authOptions.secret` (src/lib/auth/options.ts) and `src/middleware.ts`
 * both read `process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET` and pass whatever comes back
 * — including `undefined` — straight into NextAuth. NextAuth v4 tolerates a missing secret in
 * non-production (it fabricates a temporary one with a console warning, which is fine for local
 * dev/CI where no real session ever needs to survive a restart), but in production a missing
 * secret degrades *silently* to an opaque `/api/auth/error?error=Configuration` page — every
 * sign-in attempt just bounces there with no indication of *why*, which is a terrible failure mode
 * for something this security-critical to get misconfigured in a real deployment.
 *
 * This guard is called at request-handling time (inside `getCurrentSession()` and the
 * `/api/auth/[...nextauth]` handler), never at module import/build time — see the callers for why
 * that split matters. Calling it from module scope would run during `next build`'s route
 * collection (which imports every route module without ever invoking a handler) and would break
 * `npm run build` for any environment that doesn't happen to have the secret set, including CI
 * runs that only need typecheck/build/test to pass, not a live auth flow. Gating on
 * `NODE_ENV === 'production'` mirrors NextAuth's own dev-vs-prod behavior above, so this only ever
 * fires in the exact case that used to fail silently.
 *
 * Referenced by name only (§0.4) — this never reads, logs, or returns the secret's value, only
 * whether one is present.
 */
export function assertAuthSecretConfigured(): void {
  if (process.env.NODE_ENV !== 'production') {
    // Local dev/test/CI: NextAuth's own temporary-secret fallback is an accepted, well-known
    // tradeoff here — no real session needs to outlive the process, and requiring a real secret
    // for `npm run build`/`npm test` would fail every env-less CI run for no security benefit.
    return;
  }

  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (secret) return;

  const message =
    'FATAL: NEXTAUTH_SECRET (or AUTH_SECRET) is not set in production. Auth.js/NextAuth cannot ' +
    'sign or verify session JWTs/CSRF tokens without it — refusing to serve this request rather ' +
    "than degrade to NextAuth's opaque /api/auth/error?error=Configuration page. Set " +
    'NEXTAUTH_SECRET (generate with: openssl rand -base64 32) in the production environment. See ' +
    '.env.example.';

  // Logged before throwing so this is visible in server logs even if the thrown error is
  // swallowed somewhere upstream of where it's ultimately surfaced.
  console.error(message);
  throw new Error(message);
}
