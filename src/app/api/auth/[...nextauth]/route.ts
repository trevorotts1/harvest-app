import NextAuth from 'next-auth';

import { assertAuthSecretConfigured } from '@/lib/auth/env';
import { authOptions } from '@/lib/auth/options';

// Auth.js (NextAuth v4) App Router catch-all handler (T-04, D-2 confirmed). Handles sign-in,
// sign-out, session, CSRF, and the Credentials provider's callback under /api/auth/*. Real
// business logic (password verification, five-role/org context, MFA hook points) lives in
// src/lib/auth/options.ts — this file is intentionally just the framework wiring.
const handler = NextAuth(authOptions);

/**
 * `assertAuthSecretConfigured()` runs per-request, inside this wrapper — never at module scope —
 * so it never fires during `next build`'s route collection (which imports this module without
 * invoking GET/POST) and can't break an env-less build. It's the request-time gate that turns a
 * missing production secret into a loud, descriptive failure instead of every sign-in silently
 * bouncing to `/api/auth/error?error=Configuration` (T-04 QC fix, defect 2).
 */
function withSecretGuard(nextAuthHandler: typeof handler): typeof handler {
  return (async (...args: Parameters<typeof handler>) => {
    assertAuthSecretConfigured();
    return nextAuthHandler(...args);
  }) as typeof handler;
}

const guardedHandler = withSecretGuard(handler);

export { guardedHandler as GET, guardedHandler as POST };
