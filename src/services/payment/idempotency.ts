// WP10 — Idempotency (§15.5 / §3.4). Keyed on the Stripe EVENT ID so a duplicate/replayed webhook
// delivery can never double-charge or double-provision (§15.7-7; qc-checklist WP10 checkpoint 7 —
// "replay a duplicate Stripe webhook and confirm the idempotency key prevents a double action").
//
// Backed by the existing `IdempotencyLog` model (prisma/schema.prisma — `key` is UNIQUE). This
// module is pure/DI-mockable: it depends only on a narrow Prisma delegate, so the suite proves the
// dedup + concurrency + failure-rollback semantics with an in-memory fake.

/** The Stripe event id namespaced by source, so a webhook key can't collide with an agent-dispatch key. */
export function stripeEventIdempotencyKey(eventId: string): string {
  return `stripe_webhook:${eventId}`;
}

export const STRIPE_WEBHOOK_SOURCE = 'stripe_webhook';

/** A Prisma unique-constraint violation surfaces as code `P2002`; we treat it as "already claimed". */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

/** The narrow slice of `prisma.idempotencyLog` this module needs — DI-mockable in tests. */
export interface IdempotencyLogDelegate {
  create(args: { data: { key: string; source: string } }): Promise<unknown>;
  findUnique(args: { where: { key: string } }): Promise<{ key: string } | null>;
  delete(args: { where: { key: string } }): Promise<unknown>;
}

export type IdempotencyOutcome<T> =
  | { deduplicated: false; result: T }
  | { deduplicated: true; result: null };

/**
 * Run `fn` exactly once for a given `key`, safe against duplicate/concurrent/replayed deliveries.
 *
 * CLAIM-FIRST with ROLLBACK-ON-FAILURE:
 *   1. Atomically CLAIM the key by inserting the log row. The `key` UNIQUE constraint means only
 *      ONE of any number of concurrent duplicate deliveries wins the insert — every other insert
 *      fails with P2002 and is reported `deduplicated: true` (skipped safely), so the side effect
 *      runs at most once even under a race.
 *   2. If the claim succeeded, run `fn` (the real side effect: provision, charge-state mutation…).
 *   3. If `fn` THROWS, RELEASE the claim (delete the row) and rethrow — so a legitimate Stripe
 *      RETRY of a genuinely-failed event can re-attempt it, rather than being silently swallowed as
 *      "already processed". On success the row stays, permanently deduplicating future replays.
 */
export async function withIdempotency<T>(
  log: IdempotencyLogDelegate,
  key: string,
  source: string,
  fn: () => Promise<T>
): Promise<IdempotencyOutcome<T>> {
  try {
    await log.create({ data: { key, source } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A prior (or concurrent) delivery already claimed this key — skip safely.
      return { deduplicated: true, result: null };
    }
    throw error;
  }

  try {
    const result = await fn();
    return { deduplicated: false, result };
  } catch (error) {
    // The side effect failed — release the claim so a Stripe retry can re-run it.
    try {
      await log.delete({ where: { key } });
    } catch {
      // Best-effort release; if it fails, the event is at worst stuck (never double-applied).
    }
    throw error;
  }
}
