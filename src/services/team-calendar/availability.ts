// T-45 (WP09 — master-spec §14.1-§14.3/§18.4; uiux §5.9) — the dual-calendar booking-engine core.
//
// Pure, dependency-free (no Prisma, no I/O, no Claude) — deliberately, the same convention
// `quiet-hours.ts` (T-38) establishes for the sibling "DST-correct timezone math" problem this file
// itself is called out by (see that file's header). No third-party timezone library: Node's
// built-in `Intl.DateTimeFormat` resolves the full IANA tz database, DST transitions included,
// which is what makes `isWithinWorkingHours` correct across a DST boundary without extra deps.
//
// What this module guarantees (QC checkpoints 1, 3, 4, 12):
//   - A booking is only proposed into a window where EVERY party (rep, trainer, and — for working
//     hours — the governing timezone) is free (§14.2 "only possible when both the trainer and the
//     rep are confirmed available for the full duration").
//   - The governing timezone (the contact's, §14.3) decides which local wall-clock hours count as
//     "working hours" — DST-correct via Intl, never a naive UTC-offset calculation that would drift
//     across a DST transition.
//   - No free window in the search horizon (14 days, §14.3/§18.4) → the top-THREE near-miss windows
//     (least-conflicted candidates), never a silent failure.

export interface BusyWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface TimeWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface WorkingHours {
  /** Local minute-of-day working hours BEGIN (inclusive), in the governing timezone. */
  startMinuteOfDay: number;
  /** Local minute-of-day working hours END (exclusive), in the governing timezone. */
  endMinuteOfDayExclusive: number;
}

/** §14.2's "working-hours/time-blocking respected absolutely" default window: 9 AM-6 PM local. */
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  startMinuteOfDay: 9 * 60,
  endMinuteOfDayExclusive: 18 * 60,
};

/** The candidate-slot search step. Coarse enough to bound the 14-day search cheaply. */
export const SLOT_GRANULARITY_MINUTES = 30;

/** §14.3/§18.4: "no overlapping availability in 14 days" is the near-miss trigger threshold. */
export const SEARCH_HORIZON_DAYS = 14;

/** §14.3/§18.4: "propose the top-three near-miss windows." */
export const NEAR_MISS_PROPOSAL_COUNT = 3;

/**
 * Resolves the local minute-of-day (0-1439) for `at` in IANA timezone `timezone`, DST-correct via
 * `Intl.DateTimeFormat`. Returns `null` for a missing/unrecognized timezone — callers fail closed
 * (never propose into a window whose working-hours legality cannot be determined).
 *
 * T-57 BLOCKER-B8 DECISION (documented, not routed through the locale layer) — the `'en-US'` below
 * is NEVER rendered to a rep or contact; it is purely an internal computation this function uses to
 * pull numeric hour/minute PARTS out of `Intl.DateTimeFormat`'s `formatToParts`, which are then
 * `parseInt`'d back into plain numbers a few lines down. Any locale that renders `hour12: false`
 * numerals in a `parseInt`-safe form would produce the identical `number` result — this is a
 * technical extraction, not user-facing date/time formatting (contrast `src/lib/i18n/format.ts`,
 * which exists precisely for the latter). Routing this through the rep's locale would add a
 * dependency for zero behavioral or user-visible benefit, so it stays fixed.
 */
export function resolveLocalMinuteOfDay(timezone: string | null | undefined, at: Date): number | null {
  if (!timezone || timezone.trim() === '') return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(at);
    const hourPart = parts.find((p) => p.type === 'hour')?.value;
    const minutePart = parts.find((p) => p.type === 'minute')?.value;
    if (hourPart === undefined || minutePart === undefined) return null;
    const hour = parseInt(hourPart, 10) % 24; // Intl formats local midnight as "24" in some locales
    const minute = parseInt(minutePart, 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null; // RangeError for an unrecognized IANA id — cannot determine, fail closed.
  }
}

/**
 * A window is "within working hours" only if BOTH its start and end resolve to the same local
 * calendar day's working window in `timezone` — a candidate that would start in-hours but run past
 * the end of the working day is rejected, not silently allowed (§14.2 "never books appointments
 * they cannot honor"). Fail-closed: an unresolvable timezone is never within working hours.
 */
export function isWithinWorkingHours(
  timezone: string | null | undefined,
  window: TimeWindow,
  workingHours: WorkingHours = DEFAULT_WORKING_HOURS
): boolean {
  const startMinute = resolveLocalMinuteOfDay(timezone, window.startsAt);
  const endMinute = resolveLocalMinuteOfDay(timezone, window.endsAt);
  if (startMinute === null || endMinute === null) return false;
  if (startMinute < workingHours.startMinuteOfDay) return false;
  if (endMinute > workingHours.endMinuteOfDayExclusive) return false;
  // A window whose end-of-day minute is strictly less than its start (e.g. duration crossed
  // midnight in local time) never counts as "same working day" — reject rather than mis-propose.
  if (endMinute < startMinute) return false;
  return true;
}

/** Standard half-open interval overlap test. */
export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && a.endsAt.getTime() > b.startsAt.getTime();
}

/** True iff `candidate` conflicts with none of `busy`. */
export function isFreeOf(busy: readonly BusyWindow[], candidate: TimeWindow): boolean {
  return busy.every((b) => !windowsOverlap(b, candidate));
}

/** Minutes of overlap between a candidate and every busy window that conflicts with it (for ranking near-misses). */
export function overlapMinutes(busy: readonly BusyWindow[], candidate: TimeWindow): number {
  let total = 0;
  for (const b of busy) {
    if (!windowsOverlap(b, candidate)) continue;
    const start = Math.max(b.startsAt.getTime(), candidate.startsAt.getTime());
    const end = Math.min(b.endsAt.getTime(), candidate.endsAt.getTime());
    total += Math.max(0, end - start) / 60000;
  }
  return total;
}

/** Every candidate slot start, stepped `SLOT_GRANULARITY_MINUTES` apart, over the search horizon. */
function* candidateStarts(searchStart: Date, horizonDays: number): Generator<Date> {
  const stepMs = SLOT_GRANULARITY_MINUTES * 60 * 1000;
  const endMs = searchStart.getTime() + horizonDays * 24 * 60 * 60 * 1000;
  for (let t = searchStart.getTime(); t < endMs; t += stepMs) {
    yield new Date(t);
  }
}

export interface FindFreeWindowInput {
  /** Every party's busy blocks, ALREADY MERGED (§14.2 "queries both calendars"). */
  mergedBusy: readonly BusyWindow[];
  durationMinutes: number;
  searchStart: Date;
  /** The governing timezone (the contact's, §14.3) — decides working-hours legality. */
  governingTimezone: string | null | undefined;
  workingHours?: WorkingHours;
  horizonDays?: number;
}

/**
 * The first fully-free, in-working-hours window, or `null` if none exists in the search horizon
 * (§14.3/§18.4 "no overlapping availability in 14 days"). Deterministic (no randomness) so a
 * retried search after a lost slot-lock race resumes from the exact next candidate.
 */
export function findFreeWindow(input: FindFreeWindowInput): TimeWindow | null {
  const { mergedBusy, durationMinutes, searchStart, governingTimezone } = input;
  const workingHours = input.workingHours ?? DEFAULT_WORKING_HOURS;
  const horizonDays = input.horizonDays ?? SEARCH_HORIZON_DAYS;
  const durationMs = durationMinutes * 60 * 1000;

  for (const start of candidateStarts(searchStart, horizonDays)) {
    const candidate: TimeWindow = { startsAt: start, endsAt: new Date(start.getTime() + durationMs) };
    if (!isWithinWorkingHours(governingTimezone, candidate, workingHours)) continue;
    if (!isFreeOf(mergedBusy, candidate)) continue;
    return candidate;
  }
  return null;
}

export interface NearMissWindow extends TimeWindow {
  conflictMinutes: number;
}

/**
 * §14.3/§18.4: when no fully-free window exists in the horizon, "propose the top-three near-miss
 * windows to both humans rather than fail silently." Ranks every in-working-hours candidate by
 * least total conflict, deduplicating overlapping candidates so the three results are genuinely
 * distinct options (not the same conflict shifted by one slot).
 */
export function findNearMissWindows(input: FindFreeWindowInput): NearMissWindow[] {
  const { mergedBusy, durationMinutes, searchStart, governingTimezone } = input;
  const workingHours = input.workingHours ?? DEFAULT_WORKING_HOURS;
  const horizonDays = input.horizonDays ?? SEARCH_HORIZON_DAYS;
  const count = NEAR_MISS_PROPOSAL_COUNT;
  const durationMs = durationMinutes * 60 * 1000;

  const scored: NearMissWindow[] = [];
  for (const start of candidateStarts(searchStart, horizonDays)) {
    const candidate: TimeWindow = { startsAt: start, endsAt: new Date(start.getTime() + durationMs) };
    if (!isWithinWorkingHours(governingTimezone, candidate, workingHours)) continue;
    const conflict = overlapMinutes(mergedBusy, candidate);
    if (conflict <= 0) continue; // a truly free window belongs in findFreeWindow, not here
    scored.push({ ...candidate, conflictMinutes: conflict });
  }

  scored.sort((a, b) => a.conflictMinutes - b.conflictMinutes);

  const distinct: NearMissWindow[] = [];
  for (const candidate of scored) {
    const tooClose = distinct.some((d) => Math.abs(d.startsAt.getTime() - candidate.startsAt.getTime()) < durationMs);
    if (tooClose) continue;
    distinct.push(candidate);
    if (distinct.length === count) break;
  }
  return distinct;
}
