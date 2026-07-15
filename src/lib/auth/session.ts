import { getServerSession } from 'next-auth';

import { authOptions } from './options';

/**
 * Server-side session accessor for route handlers, server actions, and server components — a
 * thin, single-import wrapper around `getServerSession(authOptions)` so call-sites don't each
 * re-import `authOptions` directly.
 */
export function getCurrentSession() {
  return getServerSession(authOptions);
}
