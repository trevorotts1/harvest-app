// T-45 (WP09, §14.1 "iOS CalDAV (read-only): personal availability ingested as blocking
// availability only — never displayed in upline dashboards") — the CalDAV read-only sync
// orchestration. Structurally read-only: this service has no write/push method (mirrors
// `CalDavClient` having no write method at all, caldav-client.ts).
//
// PRIVACY INVARIANT this module upholds: every row it writes to `CalendarBusyBlock` carries
// `provider: 'caldav_ios'` and ONLY a start/end window — the same schema as a Google-sourced block,
// with no title/content column to leak in the first place. The upline-facing aggregate
// (dashboard.service.ts `getTeamAvailabilityAggregate`) only ever reads coarse busy/free buckets
// computed FROM this table, never an individual `CalendarBusyBlock` row — so a CalDAV block can
// never surface to an upline as a discrete, individually-inspectable item.

import { createCalDavClient, type CalDavClient, type CalDavCredential } from './caldav-client';
import { decryptCalendarToken, type CalendarCredential } from './token-vault';
import type { CalendarLinkRow, CalendarBusyBlockPrismaClient } from './google-sync.service';

export type CalDavSyncStatus = 'synced' | 'unconfigured' | 'not_connected' | 'error';

const SYNC_WINDOW_DAYS = 60;

export class CalDavSyncService {
  constructor(
    private readonly prisma: CalendarBusyBlockPrismaClient,
    private readonly buildClient: (credential: CalDavCredential | null) => CalDavClient | null = createCalDavClient,
    private readonly decryptToken: (ref: string | null | undefined) => CalendarCredential | null = decryptCalendarToken
  ) {}

  async syncBusyBlocks(userId: string, now: Date = new Date()): Promise<{ status: CalDavSyncStatus; blocksIngested?: number }> {
    const link: CalendarLinkRow | null = await this.prisma.calendarLink.findFirst({
      where: { user_id: userId, provider: 'caldav_ios', status: 'CONNECTED' },
    });
    if (!link) return { status: 'not_connected' };

    const decrypted = this.decryptToken(link.token_ref);
    const credential: CalDavCredential | null =
      decrypted?.appPassword && decrypted.refreshToken /* serverUrl stashed here */
        ? { serverUrl: decrypted.refreshToken, username: decrypted.accessToken ?? '', appPassword: decrypted.appPassword }
        : null;

    const client = this.buildClient(credential);
    if (!client || !credential) return { status: 'unconfigured' };

    try {
      const windowEnd = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const blocks = await client.listBusyBlocks(credential, now, windowEnd);
      let i = 0;
      for (const block of blocks) {
        // CalDAV free-busy periods carry no stable id — synthesize one from the window itself so
        // re-syncs upsert idempotently instead of duplicating rows.
        const externalRef = `${block.startsAt.toISOString()}_${block.endsAt.toISOString()}_${i++}`;
        await this.prisma.calendarBusyBlock.upsert({
          where: { user_id_provider_external_ref: { user_id: userId, provider: 'caldav_ios', external_ref: externalRef } },
          create: { user_id: userId, provider: 'caldav_ios', external_ref: externalRef, starts_at: block.startsAt, ends_at: block.endsAt },
          update: { starts_at: block.startsAt, ends_at: block.endsAt },
        });
      }
      return { status: 'synced', blocksIngested: blocks.length };
    } catch {
      // A CalDAV read failure must never be interpreted as "no busy time" — fail closed by
      // reporting an error and leaving existing CalendarBusyBlock rows untouched (stale-but-safe).
      return { status: 'error' };
    }
  }
}
