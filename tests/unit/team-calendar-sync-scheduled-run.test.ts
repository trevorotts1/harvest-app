// T-45 (WP09 §14.1) — runCalendarSync: the package-free cron TICK handler body (mirrors
// sequence-scheduled-run.test.ts's convention for testing the Inngest-wrapped handler without an
// Inngest runtime). Proves the real production caller for the Google/CalDAV sync services exists
// and aggregates results correctly, and that one user's failure never blocks the rest of the tick.

import { runCalendarSync, type CalendarSyncStore, type CalendarSyncRunner } from '../../src/services/team-calendar/calendar-sync-scheduled-run';

describe('WP09 runCalendarSync (cron tick)', () => {
  it('dispatches each connected link to the correct provider runner and aggregates the tally', async () => {
    const store: CalendarSyncStore = {
      async listConnectedLinks() {
        return [
          { userId: 'rep-1', provider: 'google' },
          { userId: 'rep-2', provider: 'caldav_ios' },
        ];
      },
    };
    const googleSync: CalendarSyncRunner = { syncBusyBlocks: jest.fn(async () => ({ status: 'synced' })) };
    const caldavSync: CalendarSyncRunner = { syncBusyBlocks: jest.fn(async () => ({ status: 'synced' })) };

    const result = await runCalendarSync({ store, googleSync, caldavSync });

    expect(result).toEqual({ total: 2, synced: 2, errored: 0, skipped: 0 });
    expect(googleSync.syncBusyBlocks).toHaveBeenCalledWith('rep-1', expect.any(Date));
    expect(caldavSync.syncBusyBlocks).toHaveBeenCalledWith('rep-2', expect.any(Date));
  });

  it('one user\'s thrown error never blocks the rest of the tick (isolation)', async () => {
    const store: CalendarSyncStore = {
      async listConnectedLinks() {
        return [
          { userId: 'rep-broken', provider: 'google' },
          { userId: 'rep-fine', provider: 'google' },
        ];
      },
    };
    let call = 0;
    const googleSync: CalendarSyncRunner = {
      syncBusyBlocks: jest.fn(async () => {
        call += 1;
        if (call === 1) throw new Error('boom — simulated transient failure for rep-broken');
        return { status: 'synced' };
      }),
    };
    const caldavSync: CalendarSyncRunner = { syncBusyBlocks: jest.fn(async () => ({ status: 'synced' })) };

    const result = await runCalendarSync({ store, googleSync, caldavSync });
    expect(result.total).toBe(2);
    expect(result.errored).toBe(1);
    expect(result.synced).toBe(1);
  });

  it('counts non-synced/non-error statuses (e.g. not_connected/unconfigured) as skipped', async () => {
    const store: CalendarSyncStore = { async listConnectedLinks() { return [{ userId: 'rep-1', provider: 'google' }]; } };
    const googleSync: CalendarSyncRunner = { syncBusyBlocks: jest.fn(async () => ({ status: 'unconfigured' })) };
    const caldavSync: CalendarSyncRunner = { syncBusyBlocks: jest.fn(async () => ({ status: 'synced' })) };

    const result = await runCalendarSync({ store, googleSync, caldavSync });
    expect(result).toEqual({ total: 1, synced: 0, errored: 0, skipped: 1 });
  });

  it('an empty connected-link set is a no-op tick, never a crash', async () => {
    const store: CalendarSyncStore = { async listConnectedLinks() { return []; } };
    const googleSync: CalendarSyncRunner = { syncBusyBlocks: jest.fn() };
    const caldavSync: CalendarSyncRunner = { syncBusyBlocks: jest.fn() };
    const result = await runCalendarSync({ store, googleSync, caldavSync });
    expect(result).toEqual({ total: 0, synced: 0, errored: 0, skipped: 0 });
  });
});
