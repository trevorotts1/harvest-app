// T-43 (WP07 §12.5, §12.9-5) — the streak tracker's doctrine-critical properties: one grace day per
// week at Low intensity preserves a streak; a genuine break restarts with NO partial credit.

import { isoWeekKey, recomputeStreak, type StreakDb } from '../../src/services/gamification/streak.service';

function makeDb(opts: {
  intensity?: string;
  qualifyingDates?: string[]; // dates on which >=1 MomentumEvent exists
  state?: { current_streak_days: number; longest_streak_days: number; last_qualifying_date: string | null; grace_day_used_for_week: string | null } | null;
}): { db: StreakDb; upserts: unknown[] } {
  const upserts: unknown[] = [];
  let state = opts.state ?? null;
  const db: StreakDb = {
    momentumEvent: {
      findMany: async ({ where }) => {
        const dayKey = where.created_at.gte.toISOString().slice(0, 10);
        return (opts.qualifyingDates ?? []).includes(dayKey) ? [{ id: 'evt-1' }] : [];
      },
    },
    user: { findUnique: async () => ({ intensity_setting: opts.intensity ?? 'MEDIUM' }) },
    streakState: {
      findUnique: async () => state,
      upsert: async (args) => {
        upserts.push(args);
        state = args.update as never;
        return {};
      },
    },
  };
  return { db, upserts };
}

describe('recomputeStreak — consecutive days increment, idempotent same-day calls', () => {
  test('first-ever qualifying day sets streak to 1', async () => {
    const { db } = makeDb({ qualifyingDates: ['2026-07-15'] });
    const summary = await recomputeStreak(db, 'rep-1', new Date('2026-07-15T12:00:00.000Z'));
    expect(summary.currentStreakDays).toBe(1);
  });

  test('a consecutive qualifying day increments the streak', async () => {
    const { db } = makeDb({
      qualifyingDates: ['2026-07-16'],
      state: { current_streak_days: 5, longest_streak_days: 5, last_qualifying_date: '2026-07-15', grace_day_used_for_week: null },
    });
    const summary = await recomputeStreak(db, 'rep-1', new Date('2026-07-16T12:00:00.000Z'));
    expect(summary.currentStreakDays).toBe(6);
  });

  test('calling recomputeStreak twice for the SAME day is idempotent (no double-increment)', async () => {
    const state = { current_streak_days: 5, longest_streak_days: 5, last_qualifying_date: '2026-07-15', grace_day_used_for_week: null };
    const { db } = makeDb({ qualifyingDates: ['2026-07-15'], state });
    const first = await recomputeStreak(db, 'rep-1', new Date('2026-07-15T09:00:00.000Z'));
    const second = await recomputeStreak(db, 'rep-1', new Date('2026-07-15T18:00:00.000Z'));
    expect(first.currentStreakDays).toBe(5);
    expect(second.currentStreakDays).toBe(5);
  });
});

describe('recomputeStreak — one grace day/week at Low intensity preserves the streak (§12.9-5)', () => {
  test('a missed day is repaired by the grace day when intensity is LOW and the week\'s grace is unused', async () => {
    // Last qualifying day: July 14. July 15 missed entirely (no event, no recompute call — simulating
    // a day where the rep did nothing). Now July 16 qualifies again: exactly one day gap (the missed
    // 15th) should be covered by the grace day.
    const { db } = makeDb({
      intensity: 'LOW',
      qualifyingDates: ['2026-07-16'],
      state: { current_streak_days: 10, longest_streak_days: 10, last_qualifying_date: '2026-07-14', grace_day_used_for_week: null },
    });
    const summary = await recomputeStreak(db, 'rep-1', new Date('2026-07-16T12:00:00.000Z'));
    expect(summary.currentStreakDays).toBe(11); // preserved + incremented, no reset
    expect(summary.graceDayUsedThisWeek).toBe(true);
  });

  test('a SECOND missed day in the same week gets NO grace and restarts with no partial credit', async () => {
    const missedWeek = isoWeekKey('2026-07-15');
    const { db } = makeDb({
      intensity: 'LOW',
      qualifyingDates: ['2026-07-16'],
      state: { current_streak_days: 10, longest_streak_days: 10, last_qualifying_date: '2026-07-14', grace_day_used_for_week: missedWeek },
    });
    const summary = await recomputeStreak(db, 'rep-1', new Date('2026-07-16T12:00:00.000Z'));
    expect(summary.currentStreakDays).toBe(1); // restart — the week's ONE grace day is already spent
  });

  test('NOT at Low intensity → no grace day, a missed day restarts the streak', async () => {
    const { db } = makeDb({
      intensity: 'MEDIUM',
      qualifyingDates: ['2026-07-16'],
      state: { current_streak_days: 10, longest_streak_days: 10, last_qualifying_date: '2026-07-14', grace_day_used_for_week: null },
    });
    const summary = await recomputeStreak(db, 'rep-1', new Date('2026-07-16T12:00:00.000Z'));
    expect(summary.currentStreakDays).toBe(1);
  });
});

describe('recomputeStreak — a genuine break (>1 day missed) always restarts with NO partial credit', () => {
  test('a 5-day gap resets to 1 even at Low intensity (grace only covers exactly one missed day)', async () => {
    const { db } = makeDb({
      intensity: 'LOW',
      qualifyingDates: ['2026-07-20'],
      state: { current_streak_days: 20, longest_streak_days: 20, last_qualifying_date: '2026-07-14', grace_day_used_for_week: null },
    });
    const summary = await recomputeStreak(db, 'rep-1', new Date('2026-07-20T12:00:00.000Z'));
    expect(summary.currentStreakDays).toBe(1);
  });
});

describe('isoWeekKey', () => {
  test('produces a stable, sortable week key', () => {
    expect(isoWeekKey('2026-07-15')).toMatch(/^\d{4}-W\d{2}$/);
  });
});
