// WP01 §6.1 — the Auth.js binding for the master identity gate.
//
// This is the concrete server wire between the T-04 Auth.js session (src/lib/auth/*) and the pure,
// unit-tested gate in ./identity-gate. It is kept in a SEPARATE file from the pure gate so that
// unit tests (and any pure consumer) can exercise `resolveIdentity`/`requireIdentity` without pulling
// the full `next-auth` / Prisma-adapter chain in — only a real server call-site imports this.
//
// `getCurrentSession()` (src/lib/auth/session.ts) runs `assertAuthSecretConfigured()` first, so a
// route wired through here fails loudly in production if the auth secret is missing (referenced by
// NAME only, §0.4) rather than silently trusting an unconfigured session.

import { getCurrentSession } from '@/lib/auth/session';

import {
  IdentityGateError,
  resolveIdentity,
  type IdentityContext,
  type IdentityResult,
} from './identity-gate';

/** Resolve the current request's identity from the live Auth.js session (non-throwing). */
export async function resolveCurrentIdentity(): Promise<IdentityResult> {
  const session = await getCurrentSession();
  return resolveIdentity(session);
}

/**
 * The throwing server guard a gated route/server-action uses: returns the validated
 * `IdentityContext` from the live Auth.js session or throws `IdentityGateError` (401/403). This is
 * the master gate's runtime entry point — deny-by-default, no default identity is ever inferred.
 */
export async function requireCurrentIdentity(): Promise<IdentityContext> {
  const result = await resolveCurrentIdentity();
  if (!result.ok) {
    throw new IdentityGateError(result.reason);
  }
  return result.identity;
}
