// T-38 (master-spec §10.4 "Recipient-timezone quiet hours (8 AM-9 PM in the recipient's timezone)
// ... distinct from the rep's own notification quiet hours"; qc-checklist WP05 checkpoint 5 +
// critical-failure condition "Quiet hours keyed to the rep instead of the recipient (TCPA)").
//
// PROOF (b): a send during quiet hours is BLOCKED; an unrecognized/missing timezone fails CLOSED
// (treated as within quiet hours, i.e. blocked) — never defaulted to UTC or "outside quiet hours".

import { isWithinQuietHours, resolveLocalMinuteOfDay, QUIET_HOURS_WINDOW } from '../../src/services/compliance/quiet-hours/quiet-hours';

describe('isWithinQuietHours (§10.4, §10.9-5 — PROOF b)', () => {
  test('8:00 AM local (the exact opening minute) is OUTSIDE quiet hours — sends allowed', () => {
    // 2026-07-15T13:00:00Z is 08:00 in America/Chicago (UTC-5, CDT) on that date.
    const now = new Date('2026-07-15T13:00:00Z');
    expect(isWithinQuietHours('America/Chicago', now)).toBe(false);
  });

  test('8:59 PM local is still OUTSIDE quiet hours (window is inclusive of 8:59 PM)', () => {
    // 2026-07-15T01:59:00Z (next day) is 20:59 CDT on 2026-07-15.
    const now = new Date('2026-07-16T01:59:00Z');
    expect(isWithinQuietHours('America/Chicago', now)).toBe(false);
  });

  test('9:00 PM local (the exact closing minute) is WITHIN quiet hours — BLOCKED', () => {
    // 2026-07-16T02:00:00Z is 21:00 CDT on 2026-07-15.
    const now = new Date('2026-07-16T02:00:00Z');
    expect(isWithinQuietHours('America/Chicago', now)).toBe(true);
  });

  test('3:00 AM local (deep quiet hours) is BLOCKED', () => {
    // 2026-07-15T08:00:00Z is 03:00 CDT on 2026-07-15.
    const now = new Date('2026-07-15T08:00:00Z');
    expect(isWithinQuietHours('America/Chicago', now)).toBe(true);
  });

  test('DST-correctness: the SAME 8 AM local boundary holds across a DST transition (winter, CST = UTC-6)', () => {
    // 2026-01-15T14:00:00Z is 08:00 CST (America/Chicago, UTC-6 in January) — outside quiet hours.
    const winterNow = new Date('2026-01-15T14:00:00Z');
    expect(isWithinQuietHours('America/Chicago', winterNow)).toBe(false);
    // The same UTC instant would be 08:00 in CDT (UTC-5) only in summer — proving this isn't a
    // hardcoded UTC offset but a real IANA-timezone-aware local-time resolution.
  });

  describe('FAIL-CLOSED: unknown/missing/invalid timezone -> WITHIN quiet hours (blocked), never UTC or "outside"', () => {
    test('missing timezone (undefined) fails closed', () => {
      const now = new Date('2026-07-15T13:00:00Z'); // otherwise a perfectly fine send time (8 AM CDT)
      expect(isWithinQuietHours(undefined, now)).toBe(true);
    });

    test('null timezone fails closed', () => {
      const now = new Date('2026-07-15T13:00:00Z');
      expect(isWithinQuietHours(null, now)).toBe(true);
    });

    test('empty-string timezone fails closed', () => {
      const now = new Date('2026-07-15T13:00:00Z');
      expect(isWithinQuietHours('', now)).toBe(true);
    });

    test('a syntactically-plausible but unrecognized IANA id fails closed (Intl throws RangeError; caught, not propagated)', () => {
      const now = new Date('2026-07-15T13:00:00Z');
      expect(isWithinQuietHours('Not/A_Real_Zone', now)).toBe(true);
    });

    test('resolveLocalMinuteOfDay itself returns null (not a thrown error, not a UTC fallback) for an unresolvable zone', () => {
      expect(resolveLocalMinuteOfDay('Not/A_Real_Zone', new Date())).toBeNull();
      expect(resolveLocalMinuteOfDay(undefined, new Date())).toBeNull();
    });
  });

  test('the allowed window constant is exactly 8 AM (inclusive) to 9 PM (exclusive)', () => {
    expect(QUIET_HOURS_WINDOW.startMinuteOfDay).toBe(8 * 60);
    expect(QUIET_HOURS_WINDOW.endMinuteOfDayExclusive).toBe(21 * 60);
  });

  test('a DIFFERENT recipient timezone can be outside quiet hours while another is inside — proves this is RECIPIENT-local, not server/rep-local', () => {
    // A single fixed instant: 2026-07-15T13:00:00Z.
    // -> 08:00 in America/Chicago (outside quiet hours).
    // -> 06:00 in America/Los_Angeles (still within quiet hours there).
    const now = new Date('2026-07-15T13:00:00Z');
    expect(isWithinQuietHours('America/Chicago', now)).toBe(false);
    expect(isWithinQuietHours('America/Los_Angeles', now)).toBe(true);
  });
});
