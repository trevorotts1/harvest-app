import { prisma } from '@/lib/prisma';

import { isStepUpFresh } from './session-security';

/**
 * Server-side, single-use step-up proof (T-12 CRITICAL fix, master-spec §16.4).
 *
 * THE BUG THIS CLOSES: the jwt `update` callback (src/lib/auth/options.ts) used to copy
 * `mfaVerifiedAt` straight out of the client `useSession().update()` payload into the session JWT.
 * That let any authenticated — or stolen — session self-certify a fresh step-up for one of the five
 * §16.4 sensitive actions (billing change, data export/delete, RBAC change, org switch) WITHOUT
 * ever entering a TOTP/recovery code. The freshness signal must instead originate only from a
 * server-verified challenge.
 *
 * THE MECHANISM (approach (a) from the fix brief — additive `User.mfa_stepped_up_at` column):
 *   1. POST /api/auth/mfa/step-up verifies a real TOTP/recovery code, then calls
 *      `recordStepUpProof`, which stamps `User.mfa_stepped_up_at` with the SERVER clock.
 *   2. The jwt `update` path calls `consumeStepUpProof`, which reads that column, atomically clears
 *      it (single-use — a compare-and-swap `updateMany` so a replay or a concurrent second session
 *      cannot consume the same proof twice), and returns the server timestamp ONLY if it is still
 *      fresh. It then stamps the token's `mfaVerifiedAt` from that server value.
 *   3. A forged `useSession().update({ mfaVerifiedAt })` with no outstanding server proof reads
 *      NULL here, so the token's `mfaVerifiedAt` is never set and `requireStepUp` (mfa.ts) keeps
 *      throwing.
 *
 * Deliberately the only module in the auth layer that reads/writes this column, so the single-use
 * invariant lives in exactly one place; mfa.ts stays pure/prisma-free (its documented design).
 */

/**
 * Records a fresh server-side step-up proof for `userId` after a real MFA challenge has verified.
 * Returns the ISO timestamp stamped, for the caller to echo back to the client (cosmetic — the
 * authoritative copy is the DB column this writes).
 */
export async function recordStepUpProof(userId: string, at: Date = new Date()): Promise<string> {
  await prisma.user.update({
    where: { id: userId },
    data: { mfa_stepped_up_at: at },
  });
  return at.toISOString();
}

/**
 * Reads and CONSUMES (single-use) the outstanding step-up proof for `userId`. Returns the server
 * timestamp (ISO) iff a proof existed, was consumed by THIS call, and is still fresh
 * (`isStepUpFresh`); otherwise null. Always clears the column when a proof is present — a stale
 * proof is spent, not left lying around to be consumed later.
 */
export async function consumeStepUpProof(
  userId: string,
  now: number = Date.now()
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfa_stepped_up_at: true },
  });
  const proof = user?.mfa_stepped_up_at ?? null;
  if (!proof) return null;

  // Compare-and-swap: clear the column only if it still holds the exact value we just read. If a
  // concurrent update (or a replay of the same client round-trip) already consumed it, `count` is
  // 0 and we return null — the proof is single-use, first consumer wins.
  const consumed = await prisma.user.updateMany({
    where: { id: userId, mfa_stepped_up_at: proof },
    data: { mfa_stepped_up_at: null },
  });
  if (consumed.count === 0) return null;

  const iso = proof.toISOString();
  return isStepUpFresh(iso, now) ? iso : null;
}
