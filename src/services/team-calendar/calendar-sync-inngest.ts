// T-45 (WP09, §14.1) — the calendar dual-sync Inngest cron registration, the WP09 analog of
// `src/services/messaging/inngest/messaging-inngest-functions.ts` (T-40R). Imports the `inngest`
// package, so — same convention as that file — it is NOT reachable from the Jest suite (tests
// exercise the package-free `runCalendarSync` handler directly, see
// calendar-sync-scheduled-run.test.ts). The serve route (src/app/api/inngest/route.ts) registers
// `teamCalendarInngestFunctions` alongside the existing agent-runtime/messaging cron functions on
// Vercel — this is the REAL PRODUCTION CALLER for the Google/CalDAV sync services (Reachability
// Mandate: no dead scaffold).
//
// BUILD-SAFETY: every service is constructed LAZILY, inside the `step.run` callback — never at
// module scope. A key-less/credential-less build registers the function's config (including its
// `cron` trigger) without constructing a single client or reading a secret.

import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';

import {
  runCalendarSync,
  CALENDAR_SYNC_FUNCTION_ID,
  CALENDAR_SYNC_CRON,
  type CalendarSyncDueLink,
  type CalendarSyncStore,
} from './calendar-sync-scheduled-run';
import { GoogleCalendarSyncService, type CalendarBusyBlockPrismaClient } from './google-sync.service';
import { CalDavSyncService } from './caldav-sync.service';

class PrismaCalendarSyncStore implements CalendarSyncStore {
  async listConnectedLinks(): Promise<CalendarSyncDueLink[]> {
    const rows = await prisma.calendarLink.findMany({
      where: { status: 'CONNECTED' },
      select: { user_id: true, provider: true },
    });
    return rows
      .filter((r) => r.provider === 'google' || r.provider === 'caldav_ios')
      .map((r) => ({ userId: r.user_id, provider: r.provider as 'google' | 'caldav_ios' }));
  }
}

export const calendarSyncFunction = inngest.createFunction(
  { id: CALENDAR_SYNC_FUNCTION_ID, name: 'Calendar dual-sync tick (WP09 §14.1, T-45)' },
  { cron: CALENDAR_SYNC_CRON },
  async ({ step }) =>
    step.run('calendar-sync-tick', () =>
      runCalendarSync({
        store: new PrismaCalendarSyncStore(),
        googleSync: new GoogleCalendarSyncService(prisma as unknown as CalendarBusyBlockPrismaClient),
        caldavSync: new CalDavSyncService(prisma as unknown as CalendarBusyBlockPrismaClient),
      })
    )
);

export const teamCalendarInngestFunctions = [calendarSyncFunction];
