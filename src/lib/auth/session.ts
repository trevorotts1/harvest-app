import { getServerSession } from 'next-auth';

import { assertAuthSecretConfigured } from './env';
import { authOptions } from './options';

/**
 * Server-side session accessor for route handlers, server actions, and server components — a
 * thin, single-import wrapper around `getServerSession(authOptions)` so call-sites don't each
 * re-import `authOptions` directly.
 *
 * Calls `assertAuthSecretConfigured()` first (T-04 QC fix, defect 2) so every real call-site of
 * this function — including `withRole`/`requireRole` (src/lib/auth/with-role.ts) and the new
 * `/api/session/whoami` route — fails loudly in production if `NEXTAUTH_SECRET`/`AUTH_SECRET` is
 * missing, instead of quietly returning a session built against an unconfigured/ephemeral secret.
 */
export function getCurrentSession() {
  assertAuthSecretConfigured();
  return getServerSession(authOptions);
}
