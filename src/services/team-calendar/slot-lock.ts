// T-45 (WP09, §14.3/§18.4 "double-booking race → atomic slot-lock confirm; loser auto-proposes the
// next window") — the atomic booking primitive shared by Appointment (Closing Appointment) and
// CoachingSession bookings.
//
// THE MECHANISM: `slot_lock_id` is a DETERMINISTIC string derived from the trainer/upline id + the
// exact proposed window. Two concurrent booking attempts for the SAME trainer + SAME window compute
// the IDENTICAL slot_lock_id, so when both attempt an INSERT, Postgres's unique index on
// `slot_lock_id` lets exactly one `create()` succeed — the database itself decides the winner, not
// application-layer "check then write" logic (which would still race). The loser's `create()`
// throws a P2002 unique-constraint violation (Prisma's standard code, the same convention this
// codebase already uses in messaging-consent-ledger.ts/store.ts) — `isSlotTakenError` recognizes it
// so the caller (booking.service.ts) can auto-propose the next window instead of surfacing a raw DB
// error.

export function deterministicSlotLockId(trainerId: string, window: { startsAt: Date; endsAt: Date }): string {
  return `${trainerId}:${window.startsAt.toISOString()}:${window.endsAt.toISOString()}`;
}

/** Prisma's unique-constraint-violation error code — same recognition convention as
 *  `messaging-consent-ledger.ts`'s `isUniqueConstraintViolation` / `store.ts`'s `err?.code`. */
export function isSlotTakenError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}
