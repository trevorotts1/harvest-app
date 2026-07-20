// T-45 (WP09 §14.1/§14.6-2, critical-failure condition "iOS CalDAV personal events surfaced to the
// upline") — CalDavSyncService: read-only ingestion, structurally incapable of writing back, and
// never carrying event content (title/description) into `CalendarBusyBlock`.

import { CalDavSyncService } from '../../src/services/team-calendar/caldav-sync.service';
import type { CalendarBusyBlockPrismaClient, CalendarLinkRow } from '../../src/services/team-calendar/google-sync.service';
import { InMemoryCalDavClient, LiveCalDavClient, parseFreeBusyPeriods, type CalDavClient } from '../../src/services/team-calendar/caldav-client';
import { encryptCalendarToken, generateCalendarVaultKeyForTesting } from '../../src/services/team-calendar/token-vault';

const VAULT_KEY_ENV = 'CALENDAR_TOKEN_ENCRYPTION_KEY';

function makeMockPrisma(link: CalendarLinkRow | null) {
  const busyBlocks: Record<string, unknown>[] = [];
  const prisma: CalendarBusyBlockPrismaClient = {
    calendarLink: {
      async findFirst() {
        return link;
      },
      async update() {
        return link;
      },
    },
    calendarBusyBlock: {
      async upsert({ create }) {
        busyBlocks.push(create);
        return create;
      },
    },
  };
  return { prisma, busyBlocks };
}

describe('WP09 CalDavSyncService — read-only, privacy-preserving', () => {
  const originalKey = process.env[VAULT_KEY_ENV];
  beforeEach(() => {
    process.env[VAULT_KEY_ENV] = generateCalendarVaultKeyForTesting();
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env[VAULT_KEY_ENV];
    else process.env[VAULT_KEY_ENV] = originalKey;
  });

  it('CalDavClient has no write/create/update/delete method — read-only BY THE TYPE, not just convention', () => {
    const client: CalDavClient = new LiveCalDavClient();
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(client)).filter((n) => n !== 'constructor');
    expect(methodNames).toEqual(['listBusyBlocks']); // the ENTIRE surface is this one read method
    expect(methodNames).not.toEqual(expect.arrayContaining(['createEvent', 'updateEvent', 'deleteEvent', 'pushEvent']));
  });

  it('ingests busy blocks with NO title/content field — the row shape itself cannot leak event content', async () => {
    const tokenRef = encryptCalendarToken({ accessToken: 'unused', refreshToken: 'https://caldav.icloud.com/', appPassword: 'app-specific-pw' });
    const link: CalendarLinkRow = { id: 'link-1', user_id: 'rep-1', provider: 'caldav_ios', status: 'CONNECTED', token_ref: tokenRef };
    const { prisma, busyBlocks } = makeMockPrisma(link);

    const fakeClient: CalDavClient = new InMemoryCalDavClient();
    (fakeClient as InMemoryCalDavClient).seedBusyBlock(new Date('2025-06-10T14:00:00Z'), new Date('2025-06-10T15:00:00Z'));

    const service = new CalDavSyncService(prisma, () => fakeClient);
    const result = await service.syncBusyBlocks('rep-1', new Date('2025-06-09T00:00:00Z'));

    expect(result.status).toBe('synced');
    expect(busyBlocks.length).toBe(1);
    const row = busyBlocks[0] as Record<string, unknown>;
    expect(row.provider).toBe('caldav_ios');
    expect(Object.keys(row)).not.toContain('title');
    expect(Object.keys(row)).not.toContain('content');
    expect(Object.keys(row)).not.toContain('description');
  });

  it('returns not_connected / unconfigured honestly rather than fabricating a sync', async () => {
    const { prisma } = makeMockPrisma(null);
    const service = new CalDavSyncService(prisma);
    const result = await service.syncBusyBlocks('rep-1');
    expect(result.status).toBe('not_connected');
  });

  it('parseFreeBusyPeriods extracts start/end windows only from a VFREEBUSY blob (no summary/description parsing exists)', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'BEGIN:VFREEBUSY',
      'FREEBUSY:20250610T140000Z/20250610T150000Z,20250611T160000Z/20250611T170000Z',
      'END:VFREEBUSY',
      'END:VCALENDAR',
    ].join('\r\n');
    const blocks = parseFreeBusyPeriods(ical);
    expect(blocks.length).toBe(2);
    expect(blocks[0].startsAt.toISOString()).toBe('2025-06-10T14:00:00.000Z');
    expect(blocks[0].endsAt.toISOString()).toBe('2025-06-10T15:00:00.000Z');
  });
});
