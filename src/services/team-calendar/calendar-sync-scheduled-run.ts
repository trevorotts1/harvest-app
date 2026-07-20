// T-45 (WP09, §14.1 dual/read-only sync) — the calendar-sync cron TICK handler body, extracted as a
// plain async function so it is unit-testable with NO Inngest runtime and NO external infra — the
// same separation-of-concerns convention `sequence-scheduled-run.ts`/`handoff-return-sweep.ts` (T-40R)
// already establish for this codebase's other cron lanes. The Inngest wrapper
// (calendar-sync-inngest.ts) is a thin `step.run(...)` shell around this.

export interface CalendarSyncDueLink {
  userId: string;
  provider: 'google' | 'caldav_ios';
}

export interface CalendarSyncStore {
  /** Every currently-CONNECTED CalendarLink, across both providers. */
  listConnectedLinks(): Promise<CalendarSyncDueLink[]>;
}

export interface CalendarSyncRunner {
  syncBusyBlocks(userId: string, now?: Date): Promise<{ status: string }>;
}

export interface CalendarSyncDeps {
  store: CalendarSyncStore;
  googleSync: CalendarSyncRunner;
  caldavSync: CalendarSyncRunner;
}

export interface CalendarSyncTickResult {
  total: number;
  synced: number;
  errored: number;
  skipped: number;
}

/** Runs one dual-sync tick over every connected link. Never throws for a single user's failure —
 *  one rep's expired token must never block every other rep's sync in the same tick. */
export async function runCalendarSync(deps: CalendarSyncDeps, now: Date = new Date()): Promise<CalendarSyncTickResult> {
  const links = await deps.store.listConnectedLinks();
  let synced = 0;
  let errored = 0;
  let skipped = 0;

  for (const link of links) {
    try {
      const runner = link.provider === 'google' ? deps.googleSync : deps.caldavSync;
      const result = await runner.syncBusyBlocks(link.userId, now);
      if (result.status === 'synced') synced += 1;
      else if (result.status === 'error') errored += 1;
      else skipped += 1;
    } catch {
      errored += 1;
    }
  }

  return { total: links.length, synced, errored, skipped };
}

export const CALENDAR_SYNC_FUNCTION_ID = 'wp09-calendar-sync-tick';
/** Every 15 minutes — frequent enough that a booking attempt's availability data is never stale by
 *  more than that window, cheap enough not to hammer the Google/CalDAV APIs. */
export const CALENDAR_SYNC_CRON = '*/15 * * * *';
