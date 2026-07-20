// T-45 (WP09 §14.2/§14.3/§18.4) — the dual-calendar booking-engine core. Pure/dependency-free, so
// these tests exercise it directly with no mocks. Covers the QC "break-it" load-bearing cases:
// DST-boundary correctness, working-hours legality, no-overlap-in-14-days → near-miss windows.

import {
  DEFAULT_WORKING_HOURS,
  findFreeWindow,
  findNearMissWindows,
  isWithinWorkingHours,
  resolveLocalMinuteOfDay,
  windowsOverlap,
  isFreeOf,
  NEAR_MISS_PROPOSAL_COUNT,
} from '../../src/services/team-calendar/availability';

describe('WP09 availability engine', () => {
  describe('resolveLocalMinuteOfDay / DST correctness', () => {
    it('resolves the correct local minute-of-day in a named IANA timezone', () => {
      // The US spring-forward for 2025 is March 9 at 2 AM local (clocks jump to 3 AM EDT).
      // 2025-03-08T10:00:00Z (the day BEFORE) is still EST (UTC-5) → 05:00 local.
      const beforeSpringForward = new Date('2025-03-08T10:00:00Z');
      expect(resolveLocalMinuteOfDay('America/New_York', beforeSpringForward)).toBe(5 * 60);

      // 2025-03-10T10:00:00Z (the day AFTER) is already EDT (UTC-4) → 06:00 local — the same
      // UTC-hour offset as the line above would be WRONG (05:00) if DST were not honored; the
      // correct EDT-adjusted answer is 06:00. This is exactly the DST-boundary case §14.3 names.
      const afterSpringForward = new Date('2025-03-10T10:00:00Z');
      expect(resolveLocalMinuteOfDay('America/New_York', afterSpringForward)).toBe(6 * 60);
    });

    it('fails closed (null) for an unrecognized timezone id', () => {
      expect(resolveLocalMinuteOfDay('Not/A_Real_Zone', new Date())).toBeNull();
    });

    it('fails closed (null) for a missing timezone', () => {
      expect(resolveLocalMinuteOfDay(null, new Date())).toBeNull();
      expect(resolveLocalMinuteOfDay(undefined, new Date())).toBeNull();
      expect(resolveLocalMinuteOfDay('', new Date())).toBeNull();
    });
  });

  describe('isWithinWorkingHours', () => {
    it('accepts a window inside 9 AM-6 PM local time', () => {
      // 2025-06-10T14:00:00Z = 10:00 EDT (America/New_York) — within 9-6.
      const window = { startsAt: new Date('2025-06-10T14:00:00Z'), endsAt: new Date('2025-06-10T15:00:00Z') };
      expect(isWithinWorkingHours('America/New_York', window)).toBe(true);
    });

    it('rejects a window outside working hours', () => {
      // 2025-06-10T02:00:00Z = 22:00 EDT the prior evening — well outside 9-6.
      const window = { startsAt: new Date('2025-06-10T02:00:00Z'), endsAt: new Date('2025-06-10T03:00:00Z') };
      expect(isWithinWorkingHours('America/New_York', window)).toBe(false);
    });

    it('rejects a window whose END falls after the working day closes, even if the start is fine', () => {
      // Starts at 17:45 EDT, a 1-hour meeting ends at 18:45 — past the 18:00 close.
      const window = { startsAt: new Date('2025-06-10T21:45:00Z'), endsAt: new Date('2025-06-10T22:45:00Z') };
      expect(isWithinWorkingHours('America/New_York', window, DEFAULT_WORKING_HOURS)).toBe(false);
    });

    it('fails closed for an unresolvable timezone — never "within hours" by default', () => {
      const window = { startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000) };
      expect(isWithinWorkingHours(null, window)).toBe(false);
      expect(isWithinWorkingHours('Bogus/Zone', window)).toBe(false);
    });
  });

  describe('windowsOverlap / isFreeOf', () => {
    it('detects overlap and non-overlap correctly (half-open interval semantics)', () => {
      const a = { startsAt: new Date('2025-01-01T10:00:00Z'), endsAt: new Date('2025-01-01T11:00:00Z') };
      const overlapping = { startsAt: new Date('2025-01-01T10:30:00Z'), endsAt: new Date('2025-01-01T11:30:00Z') };
      const adjacent = { startsAt: new Date('2025-01-01T11:00:00Z'), endsAt: new Date('2025-01-01T12:00:00Z') };
      const disjoint = { startsAt: new Date('2025-01-01T12:00:00Z'), endsAt: new Date('2025-01-01T13:00:00Z') };

      expect(windowsOverlap(a, overlapping)).toBe(true);
      expect(windowsOverlap(a, adjacent)).toBe(false); // touching boundaries never count as a conflict
      expect(windowsOverlap(a, disjoint)).toBe(false);

      expect(isFreeOf([a], overlapping)).toBe(false);
      expect(isFreeOf([a], adjacent)).toBe(true);
    });
  });

  describe('findFreeWindow', () => {
    it('finds a genuinely free, in-working-hours window when both calendars have room', () => {
      const searchStart = new Date('2025-06-09T13:00:00Z'); // Monday 09:00 EDT
      const result = findFreeWindow({
        mergedBusy: [],
        durationMinutes: 30,
        searchStart,
        governingTimezone: 'America/New_York',
      });
      expect(result).not.toBeNull();
      expect(isWithinWorkingHours('America/New_York', result!)).toBe(true);
    });

    it('never proposes into a window either party has busy-blocked (§14.2 "both fully available")', () => {
      const searchStart = new Date('2025-06-09T13:00:00Z');
      const busy = [{ startsAt: new Date('2025-06-09T13:00:00Z'), endsAt: new Date('2025-06-09T17:00:00Z') }];
      const result = findFreeWindow({ mergedBusy: busy, durationMinutes: 30, searchStart, governingTimezone: 'America/New_York' });
      expect(result).not.toBeNull();
      expect(windowsOverlap(busy[0], result!)).toBe(false);
    });

    it('returns null when every working-hours slot in the horizon is busy (triggers near-miss)', () => {
      const searchStart = new Date('2025-06-09T13:00:00Z');
      // Block every working hour for the entire 14-day horizon.
      const busy = [{ startsAt: searchStart, endsAt: new Date(searchStart.getTime() + 15 * 24 * 60 * 60 * 1000) }];
      const result = findFreeWindow({ mergedBusy: busy, durationMinutes: 30, searchStart, governingTimezone: 'America/New_York' });
      expect(result).toBeNull();
    });
  });

  describe('findNearMissWindows — §14.3/§18.4 "no overlap in 14 days → propose the top-three near-miss windows"', () => {
    it('returns up to three DISTINCT, least-conflicted candidate windows when nothing is fully free', () => {
      const searchStart = new Date('2025-06-09T13:00:00Z');
      const busy = [{ startsAt: searchStart, endsAt: new Date(searchStart.getTime() + 15 * 24 * 60 * 60 * 1000) }];
      const nearMiss = findNearMissWindows({ mergedBusy: busy, durationMinutes: 30, searchStart, governingTimezone: 'America/New_York' });
      expect(nearMiss.length).toBeGreaterThan(0);
      expect(nearMiss.length).toBeLessThanOrEqual(NEAR_MISS_PROPOSAL_COUNT);
      // Every returned window is genuinely distinct (no duplicate/overlapping proposals).
      for (let i = 0; i < nearMiss.length; i++) {
        for (let j = i + 1; j < nearMiss.length; j++) {
          expect(windowsOverlap(nearMiss[i], nearMiss[j])).toBe(false);
        }
      }
      // Ranked by ascending conflict (least conflict first).
      for (let i = 1; i < nearMiss.length; i++) {
        expect(nearMiss[i].conflictMinutes).toBeGreaterThanOrEqual(nearMiss[i - 1].conflictMinutes);
      }
    });

    it('respects the governing (contact) timezone, not a fixed UTC offset, across the DST boundary', () => {
      // Search window straddles the US spring-forward (2025-03-09). A naive fixed-UTC-offset
      // implementation would silently misplace working hours for dates after the transition.
      const searchStart = new Date('2025-03-08T00:00:00Z');
      const busy = [{ startsAt: searchStart, endsAt: new Date(searchStart.getTime() + 15 * 24 * 60 * 60 * 1000) }];
      const nearMiss = findNearMissWindows({ mergedBusy: busy, durationMinutes: 30, searchStart, governingTimezone: 'America/New_York' });
      for (const w of nearMiss) {
        expect(isWithinWorkingHours('America/New_York', w)).toBe(true);
      }
    });
  });
});
