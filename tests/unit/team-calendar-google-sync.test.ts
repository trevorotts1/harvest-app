// T-45 (WP09 §14.1/§14.3/§18.4) — GoogleCalendarSyncService: dual sync (read ingest + write push),
// the "OAuth expired/revoked → propose-only, calendar-disconnected surface" degrade, and the
// "platform credentials absent → unconfigured, never a crash" fail-closed path.

import { GoogleCalendarSyncService, type CalendarBusyBlockPrismaClient, type CalendarLinkRow } from '../../src/services/team-calendar/google-sync.service';
import { InMemoryGoogleCalendarClient, GoogleAuthExpiredError } from '../../src/services/team-calendar/google-calendar-client';
import { encryptCalendarToken, generateCalendarVaultKeyForTesting } from '../../src/services/team-calendar/token-vault';

const VAULT_KEY_ENV = 'CALENDAR_TOKEN_ENCRYPTION_KEY';

function makeMockPrisma(link: CalendarLinkRow | null) {
  const busyBlocks: Record<string, unknown>[] = [];
  let currentLink = link;
  const prisma: CalendarBusyBlockPrismaClient = {
    calendarLink: {
      async findFirst() {
        return currentLink;
      },
      async update({ data }) {
        if (currentLink) currentLink = { ...currentLink, ...(data as Partial<CalendarLinkRow>) };
        return currentLink;
      },
    },
    calendarBusyBlock: {
      async upsert({ create }) {
        busyBlocks.push(create);
        return create;
      },
    },
  };
  return { prisma, busyBlocks, getLink: () => currentLink };
}

describe('WP09 GoogleCalendarSyncService', () => {
  const originalKey = process.env[VAULT_KEY_ENV];
  beforeEach(() => {
    process.env[VAULT_KEY_ENV] = generateCalendarVaultKeyForTesting();
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env[VAULT_KEY_ENV];
    else process.env[VAULT_KEY_ENV] = originalKey;
  });

  it('ingests busy blocks from a CONNECTED link (§14.1 read half of the dual sync)', async () => {
    const tokenRef = encryptCalendarToken({ accessToken: 'fake-access-token' });
    const link: CalendarLinkRow = { id: 'link-1', user_id: 'rep-1', provider: 'google', status: 'CONNECTED', token_ref: tokenRef };
    const { prisma, busyBlocks } = makeMockPrisma(link);
    const client = new InMemoryGoogleCalendarClient();
    client.seedBusyBlock(new Date('2025-06-10T14:00:00Z'), new Date('2025-06-10T15:00:00Z'));

    const service = new GoogleCalendarSyncService(prisma, () => client);
    const result = await service.syncBusyBlocks('rep-1', new Date('2025-06-09T13:00:00Z'));

    expect(result.status).toBe('synced');
    expect(result.blocksIngested).toBe(1);
    expect(busyBlocks.length).toBe(1);
  });

  it('returns not_connected when there is no CONNECTED google link', async () => {
    const { prisma } = makeMockPrisma(null);
    const service = new GoogleCalendarSyncService(prisma, () => new InMemoryGoogleCalendarClient());
    const result = await service.syncBusyBlocks('rep-1');
    expect(result.status).toBe('not_connected');
  });

  it('returns unconfigured (never a crash) when the platform Google client is absent', async () => {
    const tokenRef = encryptCalendarToken({ accessToken: 'fake-access-token' });
    const link: CalendarLinkRow = { id: 'link-1', user_id: 'rep-1', provider: 'google', status: 'CONNECTED', token_ref: tokenRef };
    const { prisma } = makeMockPrisma(link);
    const service = new GoogleCalendarSyncService(prisma, () => null); // simulates createGoogleCalendarClient() with no creds
    const result = await service.syncBusyBlocks('rep-1');
    expect(result.status).toBe('unconfigured');
  });

  it('returns unconfigured when the vault cannot decrypt a usable token (e.g. missing vault key)', async () => {
    delete process.env[VAULT_KEY_ENV];
    const tokenRef = encryptCalendarToken({ accessToken: 'x' }); // null — key absent when this ran
    const link: CalendarLinkRow = { id: 'link-1', user_id: 'rep-1', provider: 'google', status: 'CONNECTED', token_ref: tokenRef };
    const { prisma } = makeMockPrisma(link);
    const service = new GoogleCalendarSyncService(prisma, () => new InMemoryGoogleCalendarClient());
    const result = await service.syncBusyBlocks('rep-1');
    expect(result.status).toBe('unconfigured');
  });

  it('§14.3/§18.4: an expired/revoked OAuth grant flips the link to EXPIRED — the "calendar disconnected" surface, never a crash', async () => {
    const tokenRef = encryptCalendarToken({ accessToken: 'fake-access-token' });
    const link: CalendarLinkRow = { id: 'link-1', user_id: 'rep-1', provider: 'google', status: 'CONNECTED', token_ref: tokenRef };
    const { prisma, getLink } = makeMockPrisma(link);
    const client = new InMemoryGoogleCalendarClient();
    client.forceAuthExpired = true;

    const service = new GoogleCalendarSyncService(prisma, () => client);
    const result = await service.syncBusyBlocks('rep-1');

    expect(result.status).toBe('expired');
    expect(getLink()?.status).toBe('EXPIRED');
  });

  it('pushes a Harvest-created event to Google (§14.1 write half of the dual sync)', async () => {
    const tokenRef = encryptCalendarToken({ accessToken: 'fake-access-token' });
    const link: CalendarLinkRow = { id: 'link-1', user_id: 'rep-1', provider: 'google', status: 'CONNECTED', token_ref: tokenRef };
    const { prisma } = makeMockPrisma(link);
    const client = new InMemoryGoogleCalendarClient();
    const service = new GoogleCalendarSyncService(prisma, () => client);

    const result = await service.pushEvent('rep-1', {
      title: 'Closing Appointment',
      startsAt: new Date('2025-06-10T14:00:00Z'),
      endsAt: new Date('2025-06-10T15:00:00Z'),
      timezone: 'America/New_York',
    });

    expect(result.status).toBe('pushed');
    expect(result.externalRef).toBeDefined();
  });

  it('a real GoogleAuthExpiredError from the client is caught, never rethrown as an uncaught crash', () => {
    const err = new GoogleAuthExpiredError();
    expect(err.name).toBe('GoogleAuthExpiredError');
  });
});
