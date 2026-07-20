// T-38 (master-spec §10.4 "Recipient-timezone quiet hours (8 AM–9 PM in the recipient's timezone)
// enforced in the send scheduler, distinct from the rep's own notification quiet hours"; QC
// checklist WP05 block, checkpoint 5: "quiet hours keyed to the rep instead of the recipient
// (TCPA)" is a named critical-failure condition).
//
// Pure, dependency-free (no Prisma, no I/O) — deliberately: this module is a set of pure functions
// over a timezone id + a Date, safely importable by any layer (route handler, queue worker,
// scheduled job) without dragging in a database client. No third-party timezone library is used;
// Node's built-in `Intl.DateTimeFormat` with a `timeZone` option resolves the full IANA tz
// database, including DST transitions, correctly — the same primitive `Intl`-based DST-correctness
// this codebase already relies on elsewhere (see the Appointment Setting Agent's
// "DST-correct prospect-timezone proposals" requirement, §14.3/§18.4, a sibling problem).
//
// FAIL-CLOSED (this build's brief, verbatim): "handle unknown-timezone fail-closed — if you can't
// determine it's OUTSIDE quiet hours, treat as within = do not send." `isWithinQuietHours` returns
// `true` (blocked) for: a missing timezone, an empty string, and a syntactically-plausible-but-
// unrecognized IANA id (`Intl.DateTimeFormat` throws a `RangeError` for those, which this module
// catches and treats as "cannot determine — assume within quiet hours").

/** §10.4: the recipient-local allowed-send window. Quiet hours = everything OUTSIDE this window. */
export const QUIET_HOURS_WINDOW = {
  /** 8:00 AM local time — sends are allowed starting at this minute-of-day (inclusive). */
  startMinuteOfDay: 8 * 60,
  /** 9:00 PM local time — sends are NOT allowed at or after this minute-of-day (exclusive). */
  endMinuteOfDayExclusive: 21 * 60,
} as const;

/**
 * Resolves the recipient-local minute-of-day (0–1439) for `now` in IANA timezone `timezone`,
 * DST-correct via `Intl.DateTimeFormat`. Returns `null` if `timezone` is missing/empty/unrecognized
 * — the caller (`isWithinQuietHours`) treats `null` as fail-closed (within quiet hours).
 */
export function resolveLocalMinuteOfDay(timezone: string | null | undefined, now: Date): number | null {
  if (!timezone || timezone.trim() === '') return null;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour')?.value;
    const minutePart = parts.find((p) => p.type === 'minute')?.value;
    if (hourPart === undefined || minutePart === undefined) return null;

    // Intl's 'hour12: false' formats local midnight as "24" in some environments/locales rather
    // than "00" — normalize so the minute-of-day arithmetic below is never off by a full day.
    const hour = parseInt(hourPart, 10) % 24;
    const minute = parseInt(minutePart, 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    return hour * 60 + minute;
  } catch {
    // Intl.DateTimeFormat throws RangeError for an unrecognized timeZone id — cannot determine the
    // recipient's local time, so this resolves to null (fail-closed at the caller).
    return null;
  }
}

/**
 * §10.4 quiet-hours gate: `true` means "do not send right now."
 *
 * FAIL-CLOSED: a `null`/unresolvable local time (missing or invalid `timezone`) returns `true`
 * (within quiet hours / blocked) — this is the ONLY correct behavior per this build's brief; it is
 * never treated as "outside quiet hours" or defaulted to UTC / the rep's own zone.
 */
export function isWithinQuietHours(timezone: string | null | undefined, now: Date = new Date()): boolean {
  const minuteOfDay = resolveLocalMinuteOfDay(timezone, now);
  if (minuteOfDay === null) return true; // fail-closed: unknown local time => treat as quiet hours

  const { startMinuteOfDay, endMinuteOfDayExclusive } = QUIET_HOURS_WINDOW;
  const isWithinAllowedWindow = minuteOfDay >= startMinuteOfDay && minuteOfDay < endMinuteOfDayExclusive;
  return !isWithinAllowedWindow;
}
