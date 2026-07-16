import {
  GDPR_NOTIFICATION_WINDOW_MS,
  computeGdprClock,
  isClockApplicable,
} from '../../src/services/security/incident/gdpr-clock';

/**
 * Proves build-brief PROVE item (b): "a personal-data-breach incident STARTS the 72h clock and
 * correctly computes deadline/over-deadline."
 */
describe('computeGdprClock — GDPR Art. 33 72-hour clock (PROVE item b)', () => {
  const START = '2026-07-16T00:00:00.000Z';

  test('NOT_PERSONAL_DATA is not clock-applicable at all', () => {
    const clock = computeGdprClock({ breachClass: 'NOT_PERSONAL_DATA', clockStartedAt: START });
    expect(clock.applicable).toBe(false);
    expect(clock.status).toBe('NOT_APPLICABLE');
    expect(clock.deadline).toBeNull();
    expect(clock.overDeadline).toBe(false);
  });

  test.each(['SUSPECTED_PERSONAL_DATA_BREACH', 'CONFIRMED_PERSONAL_DATA_BREACH', 'UNDETERMINED'] as const)(
    '%s starts the clock and computes an exact 72h deadline',
    (breachClass) => {
      const clock = computeGdprClock({ breachClass, clockStartedAt: START, now: new Date(START) });
      expect(clock.applicable).toBe(true);
      expect(clock.clockStartedAt).toBe(START);
      expect(clock.deadline).toBe(new Date(new Date(START).getTime() + GDPR_NOTIFICATION_WINDOW_MS).toISOString());
      expect(clock.status).toBe('OPEN');
      expect(clock.overDeadline).toBe(false);
    }
  );

  test('elapsed/remaining are computed correctly at the 24h mark (well within deadline)', () => {
    const now = new Date(new Date(START).getTime() + 24 * 60 * 60 * 1000);
    const clock = computeGdprClock({ breachClass: 'CONFIRMED_PERSONAL_DATA_BREACH', clockStartedAt: START, now });
    expect(clock.elapsedMs).toBe(24 * 60 * 60 * 1000);
    expect(clock.remainingMs).toBe(48 * 60 * 60 * 1000);
    expect(clock.overDeadline).toBe(false);
    expect(clock.approachingDeadline).toBe(false);
  });

  test('approachingDeadline flips true at the 48h mark (two-thirds of the window), still not overDeadline', () => {
    const now = new Date(new Date(START).getTime() + 48 * 60 * 60 * 1000);
    const clock = computeGdprClock({ breachClass: 'SUSPECTED_PERSONAL_DATA_BREACH', clockStartedAt: START, now });
    expect(clock.approachingDeadline).toBe(true);
    expect(clock.overDeadline).toBe(false);
    expect(clock.status).toBe('OPEN');
  });

  test('overDeadline flips true exactly past the 72h mark', () => {
    const justUnder = new Date(new Date(START).getTime() + GDPR_NOTIFICATION_WINDOW_MS - 1000);
    const justOver = new Date(new Date(START).getTime() + GDPR_NOTIFICATION_WINDOW_MS + 1000);

    expect(computeGdprClock({ breachClass: 'UNDETERMINED', clockStartedAt: START, now: justUnder }).overDeadline).toBe(false);
    const overClock = computeGdprClock({ breachClass: 'UNDETERMINED', clockStartedAt: START, now: justOver });
    expect(overClock.overDeadline).toBe(true);
    expect(overClock.approachingDeadline).toBe(false); // "over" supersedes "approaching"
    expect(overClock.status).toBe('OPEN'); // still open — nobody has notified yet
  });

  test('notifying BEFORE the deadline freezes overDeadline=false at the notification instant', () => {
    const notifiedAt = new Date(new Date(START).getTime() + 10 * 60 * 60 * 1000).toISOString(); // 10h in
    const wayLater = new Date(new Date(START).getTime() + 200 * 60 * 60 * 1000); // long after 72h, doesn't matter anymore
    const clock = computeGdprClock({
      breachClass: 'CONFIRMED_PERSONAL_DATA_BREACH',
      clockStartedAt: START,
      notifiedAt,
      now: wayLater,
    });
    expect(clock.status).toBe('NOTIFIED');
    expect(clock.overDeadline).toBe(false);
    expect(clock.elapsedMs).toBe(10 * 60 * 60 * 1000);
  });

  test('notifying AFTER the deadline records overDeadline=true permanently (a late notification stays late)', () => {
    const notifiedAt = new Date(new Date(START).getTime() + 80 * 60 * 60 * 1000).toISOString(); // 80h in, past 72h
    const clock = computeGdprClock({
      breachClass: 'CONFIRMED_PERSONAL_DATA_BREACH',
      clockStartedAt: START,
      notifiedAt,
    });
    expect(clock.status).toBe('NOTIFIED');
    expect(clock.overDeadline).toBe(true);
  });

  test('resolvedAt closes the clock (status CLOSED) once notified', () => {
    const notifiedAt = new Date(new Date(START).getTime() + 10 * 60 * 60 * 1000).toISOString();
    const resolvedAt = new Date(new Date(START).getTime() + 20 * 60 * 60 * 1000).toISOString();
    const clock = computeGdprClock({
      breachClass: 'CONFIRMED_PERSONAL_DATA_BREACH',
      clockStartedAt: START,
      notifiedAt,
      resolvedAt,
    });
    expect(clock.status).toBe('CLOSED');
  });

  test('a clock-applicable breach with a missing clockStartedAt fails SAFE (maximally urgent), never silently "no clock"', () => {
    const clock = computeGdprClock({ breachClass: 'SUSPECTED_PERSONAL_DATA_BREACH', clockStartedAt: null });
    expect(clock.applicable).toBe(true);
    expect(clock.overDeadline).toBe(true);
    expect(clock.approachingDeadline).toBe(true);
  });

  test('isClockApplicable is true for every BreachClass except NOT_PERSONAL_DATA', () => {
    expect(isClockApplicable('SUSPECTED_PERSONAL_DATA_BREACH')).toBe(true);
    expect(isClockApplicable('CONFIRMED_PERSONAL_DATA_BREACH')).toBe(true);
    expect(isClockApplicable('UNDETERMINED')).toBe(true);
    expect(isClockApplicable('NOT_PERSONAL_DATA')).toBe(false);
  });
});
