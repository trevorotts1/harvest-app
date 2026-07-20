// T-45 (WP09, §14.1) — the Google Calendar DUAL SYNC orchestration: read half (ingest busy blocks
// into `CalendarBusyBlock`) + write half (push a Harvest-booked event to Google "instantly").
//
// LAZY, FAIL-CLOSED (§0.4 / Reachability Mandate): every dependency (the Google client, the token
// vault) is resolved lazily, per call, and a missing platform credential, missing per-user token, or
// an expired/revoked OAuth grant all resolve to an honest, typed non-'synced'/'pushed' status —
// never a thrown crash, never a fabricated sync. An expired/revoked grant additionally flips the
// `CalendarLink.status` to `EXPIRED`, which is what the booking engine (booking.service.ts) reads to
// decide "propose-only, never book blind" (§14.3/§18.4).

import {
  createGoogleCalendarClient,
  GoogleAuthExpiredError,
  type GoogleCalendarClient,
  type GoogleEventInput,
} from './google-calendar-client';
import { decryptCalendarToken, type CalendarCredential } from './token-vault';

export interface CalendarLinkRow {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  token_ref: string | null;
}

export interface CalendarBusyBlockPrismaClient {
  calendarLink: {
    findFirst(args: { where: Record<string, unknown> }): Promise<CalendarLinkRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  calendarBusyBlock: {
    upsert(args: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
  };
}

/** Shared across sync/push: connection-resolution can only ever fail one of these three ways. */
export type GoogleConnectionStatus = 'unconfigured' | 'not_connected' | 'expired';
export type GoogleSyncStatus = 'synced' | GoogleConnectionStatus | 'error';
export type GooglePushStatus = 'pushed' | GoogleConnectionStatus | 'error';

const SYNC_WINDOW_DAYS = 60; // covers the 14-day booking horizon plus margin

export class GoogleCalendarSyncService {
  constructor(
    private readonly prisma: CalendarBusyBlockPrismaClient,
    private readonly buildClient: () => GoogleCalendarClient | null = createGoogleCalendarClient,
    private readonly decryptToken: (ref: string | null | undefined) => CalendarCredential | null = decryptCalendarToken
  ) {}

  private async resolveConnected(userId: string): Promise<{ link: CalendarLinkRow; client: GoogleCalendarClient; credential: CalendarCredential } | { status: GoogleConnectionStatus }> {
    const link = await this.prisma.calendarLink.findFirst({ where: { user_id: userId, provider: 'google', status: 'CONNECTED' } });
    if (!link) return { status: 'not_connected' };

    const client = this.buildClient();
    if (!client) return { status: 'unconfigured' }; // platform Google app creds absent

    const credential = this.decryptToken(link.token_ref);
    if (!credential || !credential.accessToken) return { status: 'unconfigured' }; // vault/token unavailable

    return { link, client, credential };
  }

  /** Ingests busy/blocking windows for the read half of the dual sync (§14.1). */
  async syncBusyBlocks(userId: string, now: Date = new Date()): Promise<{ status: GoogleSyncStatus; blocksIngested?: number }> {
    const resolved = await this.resolveConnected(userId);
    if ('status' in resolved) return resolved;
    const { link, client, credential } = resolved;

    try {
      const windowEnd = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const blocks = await client.listBusyBlocks(credential.accessToken as string, now, windowEnd);
      for (const block of blocks) {
        await this.prisma.calendarBusyBlock.upsert({
          where: { user_id_provider_external_ref: { user_id: userId, provider: 'google', external_ref: block.externalRef } },
          create: { user_id: userId, provider: 'google', external_ref: block.externalRef, starts_at: block.startsAt, ends_at: block.endsAt },
          update: { starts_at: block.startsAt, ends_at: block.endsAt },
        });
      }
      return { status: 'synced', blocksIngested: blocks.length };
    } catch (err) {
      if (err instanceof GoogleAuthExpiredError) {
        // §14.3/§18.4: "OAuth token expired/revoked → propose-only mode with an explicit 'calendar
        // disconnected' surface; never book blind." Persist the degrade so every reader sees it.
        await this.prisma.calendarLink.update({ where: { id: link.id }, data: { status: 'EXPIRED' } });
        return { status: 'expired' };
      }
      return { status: 'error' };
    }
  }

  /** Pushes a Harvest-created event to Google "instantly" — the write half of the dual sync (§14.1). */
  async pushEvent(userId: string, event: GoogleEventInput): Promise<{ status: GooglePushStatus; externalRef?: string }> {
    const resolved = await this.resolveConnected(userId);
    if ('status' in resolved) return resolved;
    const { link, client, credential } = resolved;

    try {
      const { externalRef } = await client.createEvent(credential.accessToken as string, event);
      return { status: 'pushed', externalRef };
    } catch (err) {
      if (err instanceof GoogleAuthExpiredError) {
        await this.prisma.calendarLink.update({ where: { id: link.id }, data: { status: 'EXPIRED' } });
        return { status: 'expired' };
      }
      return { status: 'error' };
    }
  }
}
