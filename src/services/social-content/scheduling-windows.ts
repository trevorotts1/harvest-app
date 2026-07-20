// T-41 (WP06 §11.5 "time-of-day windows configurable") — a small, pure scheduling-window utility
// used by ContentItemService.bulkApprove and the publishing tick. Default cadence per §11.1 is
// 3-5 posts/wk/platform; the windows below are a sensible, documented default and are configurable
// per call (a caller may pass its own `TimeWindow[]`).

export interface TimeWindow {
  /** 0-23, inclusive start hour, in the rep's own local time semantics (UTC here for determinism;
   *  a future rep-timezone-aware scheduler can wrap this with a zone conversion). */
  startHour: number;
  /** 0-23, exclusive end hour. */
  endHour: number;
}

/** Morning / midday / early-evening — spread across the day rather than batching everything at once. */
export const DEFAULT_TIME_WINDOWS: TimeWindow[] = [
  { startHour: 8, endHour: 10 },
  { startHour: 12, endHour: 14 },
  { startHour: 17, endHour: 20 },
];

/**
 * Deterministically assigns the Nth (0-indexed) item in a bulk-approve batch to a window slot,
 * spreading across days once a day's windows are exhausted (index 0..windows.length-1 -> day 0's
 * windows in order, index windows.length..2*windows.length-1 -> day 1, etc.).
 */
export function nextAvailableWindowSlot(from: Date, index: number, windows: TimeWindow[] = DEFAULT_TIME_WINDOWS): Date {
  const dayOffset = Math.floor(index / windows.length);
  const window = windows[index % windows.length];
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(window.startHour, 0, 0, 0);
  return d;
}

/** Whether `when` falls inside one of `windows` (UTC hour comparison). */
export function isWithinAWindow(when: Date, windows: TimeWindow[] = DEFAULT_TIME_WINDOWS): boolean {
  const hour = when.getUTCHours();
  return windows.some((w) => hour >= w.startHour && hour < w.endHour);
}
