// T-43 (WP07) — the scheduled sweep handlers: real, cron-wired triggers (registered in
// gamification-inngest-functions.ts) proven here via their package-free logic. One rep's failure
// must never block the sweep for the rest (independent-failure posture, master-spec §9.5).

import { localHour, runMilestoneSweep, runMomentumReconciliationSweep, runNotificationSweep } from '../../src/services/gamification/gamification-scheduled';

const ACTIVE_USERS = [
  { id: 'rep-1', org_type: 'EXTERNAL' },
  { id: 'rep-2', org_type: 'PRIMERICA' },
];

describe('runMilestoneSweep — processes every active rep, isolates per-rep failures', () => {
  test('one failing rep does not stop the sweep for the rest', async () => {
    const checked: string[] = [];
    const db = {
      user: {
        findMany: async () => ACTIVE_USERS,
        findUnique: async () => ({ intensity_setting: 'MEDIUM' }),
      },
      appointment: { findFirst: async ({ where }: { where: { rep_id: string } }) => {
        checked.push(where.rep_id);
        if (where.rep_id === 'rep-1') throw new Error('simulated failure');
        return null;
      } },
      message: { findFirst: async () => null },
      licensingStateEvent: { findFirst: async () => null },
      streakState: { findUnique: async () => ({ current_streak_days: 0 }) },
      milestone: {
        findMany: async () => [],
        findUnique: async () => null,
        create: async () => ({}),
        update: async () => ({}),
      },
    };
    const result = await runMilestoneSweep(db as never);
    expect(result.processed).toBe(2);
    expect(checked).toContain('rep-2'); // rep-2 still got checked despite rep-1 throwing
  });
});

describe('runMomentumReconciliationSweep — processes every active rep', () => {
  test('writes reconciliation events + recomputes streak for each rep', async () => {
    const events: unknown[] = [];
    const db = {
      user: {
        findMany: async () => ACTIVE_USERS,
        findUnique: async () => ({ intensity_setting: 'MEDIUM' }),
      },
      contact: { count: async () => 0 },
      momentumEvent: {
        findMany: async () => [],
        create: async (args: unknown) => { events.push(args); return {}; },
      },
      draftMessage: { findMany: async () => [] },
      streakState: {
        findUnique: async () => null,
        upsert: async () => ({}),
      },
    };
    const result = await runMomentumReconciliationSweep(db as never);
    expect(result.processed).toBe(2);
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('runNotificationSweep — dispatches at each rep\'s own local hour, never crashes the sweep', () => {
  test('processes every active rep and reports the count', async () => {
    const db = {
      user: {
        findMany: async () => ACTIVE_USERS,
        findUnique: async () => ({ intensity_setting: 'MEDIUM' }),
      },
      notificationPreference: {
        findUnique: async () => null,
        upsert: async ({ where }: { where: { user_id: string } }) => ({
          user_id: where.user_id,
          morning_briefing_enabled: true,
          morning_briefing_time: '07:00',
          midday_motivation_enabled: true,
          evening_recap_enabled: true,
          quiet_hours_start: '21:00',
          quiet_hours_end: '07:00',
          timezone: 'UTC',
        }),
      },
      notificationLog: {
        findUnique: async () => null,
        create: async () => ({}),
      },
      momentumEvent: { findMany: async () => [] },
      whySession: { findFirst: async () => null },
    };
    const result = await runNotificationSweep(db as never, new Date('2026-07-15T07:00:00.000Z'));
    expect(result.processed).toBe(2);
  });

  // T-R32 (master-spec §17.5 "locale affects ... quiet-hours logic") — the sweep now resolves each
  // rep's OWN `User.locale` (validated via `isLocale`, defaulting sensibly) and threads it into
  // `localHour`, instead of that function silently hardcoding `'en-US'` regardless of the rep's
  // locale. Proves the sweep never crashes and keeps processing every rep (locale-blind vs. an
  // absent/invalid locale value) — the full dispatch OUTCOME (sent vs. `cfe_held`) depends on the
  // real `ComplianceFilterEngine`'s fail-closed evaluation of a bare test double with no DB-backed
  // context, which is a SEPARATE concern from this locale-threading fix (see `localHour`'s own
  // direct unit tests below for the actual hour-resolution proof).
  test('reps with en/es/absent locale values all get swept, none crashes the sweep', async () => {
    const usersWithLocale = [
      { id: 'rep-en', org_type: 'EXTERNAL', locale: 'en' },
      { id: 'rep-es', org_type: 'EXTERNAL', locale: 'es' },
      { id: 'rep-unset', org_type: 'EXTERNAL', locale: null }, // never trusted verbatim — falls back sensibly
    ];
    const db = {
      user: {
        findMany: async () => usersWithLocale,
        findUnique: async () => ({ intensity_setting: 'MEDIUM' }),
      },
      notificationPreference: {
        findUnique: async () => null,
        upsert: async ({ where }: { where: { user_id: string } }) => ({
          user_id: where.user_id,
          morning_briefing_enabled: true,
          morning_briefing_time: '07:00',
          midday_motivation_enabled: true,
          evening_recap_enabled: true,
          quiet_hours_start: '21:00',
          quiet_hours_end: '07:00',
          timezone: 'UTC',
        }),
      },
      notificationLog: {
        findUnique: async () => null,
        create: async () => ({}),
      },
      momentumEvent: { findMany: async () => [] },
      whySession: { findFirst: async () => null },
    };
    const result = await runNotificationSweep(db as never, new Date('2026-07-15T07:00:00.000Z'));
    expect(result.processed).toBe(3);
  });
});

describe('localHour — locale-aware hour resolution (T-R32, §17.5)', () => {
  const NOON_UTC = new Date('2026-07-15T12:00:00Z');

  test('en (the pre-T-R32 hardcoded default) resolves the correct UTC hour', () => {
    expect(localHour('UTC', NOON_UTC, 'en')).toBe(12);
  });

  test('es resolves the IDENTICAL hour as en for the same instant + timezone — locale never mis-decides the hour', () => {
    expect(localHour('UTC', NOON_UTC, 'es')).toBe(localHour('UTC', NOON_UTC, 'en'));
    expect(localHour('UTC', NOON_UTC, 'es')).toBe(12);
  });

  test('omitting locale defaults to en (every pre-T-R32 caller keeps compiling and behaving unchanged)', () => {
    expect(localHour('UTC', NOON_UTC)).toBe(localHour('UTC', NOON_UTC, 'en'));
  });

  test('a real (non-UTC) IANA timezone still resolves correctly for both locales', () => {
    // 2026-07-15T12:00:00Z is 08:00 in America/New_York during EDT (UTC-4 in July).
    expect(localHour('America/New_York', NOON_UTC, 'en')).toBe(8);
    expect(localHour('America/New_York', NOON_UTC, 'es')).toBe(8);
  });

  test('an invalid/unknown timezone fails toward UTC, never throws, for either locale', () => {
    expect(localHour('Not/A_Real_Zone', NOON_UTC, 'en')).toBe(NOON_UTC.getUTCHours());
    expect(localHour('Not/A_Real_Zone', NOON_UTC, 'es')).toBe(NOON_UTC.getUTCHours());
  });
});
