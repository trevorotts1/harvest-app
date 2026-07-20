// T-43 (WP07) — the scheduled sweep handlers: real, cron-wired triggers (registered in
// gamification-inngest-functions.ts) proven here via their package-free logic. One rep's failure
// must never block the sweep for the rest (independent-failure posture, master-spec §9.5).

import { runMilestoneSweep, runMomentumReconciliationSweep, runNotificationSweep } from '../../src/services/gamification/gamification-scheduled';

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
});
