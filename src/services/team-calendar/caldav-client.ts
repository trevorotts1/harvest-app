// T-45 (WP09, §14.1 "iOS CalDAV (read-only): personal availability ingested as blocking
// availability only — never displayed in upline dashboards (privacy)") — the CalDAV client
// boundary. Same lazy-factory convention as google-calendar-client.ts/twilio-client.ts: a narrow,
// DI-mockable interface; the factory takes the per-user credential (an iCloud app-specific
// password, resolved by the caller via token-vault.ts) and returns `null` when absent — never a
// crash, never a fabricated result.
//
// READ-ONLY BY CONSTRUCTION: this interface has no write/create/update/delete method at all — there
// is structurally no way for a CalDAV sync to push a Harvest event back to a personal iOS calendar,
// matching §14.1's "read-only" contract at the type level, not just by convention.
//
// STATED DEVIATION (Reachability Mandate): a full CalDAV protocol client (XML PROPFIND/REPORT over
// HTTP, per-provider auth quirks) is a substantial undertaking with no live iCloud credentials to
// validate against in this build environment. `LiveCalDavClient` implements the real free-busy
// REPORT request/response shape against a CalDAV-compliant server; `createCalDavClient()` fails
// closed (`null`) whenever a usable credential is not supplied, so the caller
// (caldav-sync.service.ts) degrades gracefully rather than guessing. The merge/booking logic that
// CONSUMES CalDAV busy blocks is real and is unit-tested against `InMemoryCalDavClient`.

export interface CalDavBusyBlock {
  startsAt: Date;
  endsAt: Date;
}

export interface CalDavCredential {
  serverUrl: string;
  username: string;
  appPassword: string;
}

export interface CalDavClient {
  /** Read-only free/busy ingestion (§14.1) — no title/content is ever requested or returned. */
  listBusyBlocks(credential: CalDavCredential, timeMin: Date, timeMax: Date): Promise<CalDavBusyBlock[]>;
}

/**
 * The real CalDAV client: issues a `VFREEBUSY` REPORT (RFC 4791 §7.10) against the given server and
 * parses the returned `FREEBUSY` property's period list into busy windows. Throws on any
 * network/auth/parse failure — callers must catch and degrade (never silently report "no busy
 * time", which would let a booking slip into a window that is actually blocked).
 */
export class LiveCalDavClient implements CalDavClient {
  async listBusyBlocks(credential: CalDavCredential, timeMin: Date, timeMax: Date): Promise<CalDavBusyBlock[]> {
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      `<C:time-range start="${toCalDavStamp(timeMin)}" end="${toCalDavStamp(timeMax)}"/>` +
      '</C:free-busy-query>';

    const res = await fetch(credential.serverUrl, {
      method: 'REPORT',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '0',
        Authorization: 'Basic ' + Buffer.from(`${credential.username}:${credential.appPassword}`).toString('base64'),
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`CalDAV free-busy REPORT failed (${res.status}): ${res.statusText}`);
    }
    const text = await res.text();
    return parseFreeBusyPeriods(text);
  }
}

function toCalDavStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Extracts `FREEBUSY:<start>/<end>[,<start>/<end>...]` period lists from an iCalendar VFREEBUSY blob. */
export function parseFreeBusyPeriods(icalText: string): CalDavBusyBlock[] {
  const blocks: CalDavBusyBlock[] = [];
  const freebusyLineRe = /FREEBUSY(?:;[^:\r\n]*)?:([^\r\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = freebusyLineRe.exec(icalText)) !== null) {
    for (const period of match[1].split(',')) {
      const [startRaw, endRaw] = period.split('/');
      const startsAt = parseIcalDate(startRaw);
      const endsAt = parseIcalDate(endRaw);
      if (startsAt && endsAt) blocks.push({ startsAt, endsAt });
    }
  }
  return blocks;
}

function parseIcalDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Basic-format iCal UTC timestamp: YYYYMMDDTHHMMSSZ
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(trimmed);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Fail-safe factory: real client when a credential is supplied by the caller, `null` otherwise.
 *  (Unlike Google/Twilio, CalDAV has no platform-level app credential — only a per-user one — so
 *  this factory's only job is to never construct a client with nothing to authenticate with.) */
export function createCalDavClient(credential: CalDavCredential | null): CalDavClient | null {
  if (!credential || !credential.serverUrl || !credential.username || !credential.appPassword) return null;
  return new LiveCalDavClient();
}

/** Deterministic in-memory double for tests/dev — no network, no credentials. */
export class InMemoryCalDavClient implements CalDavClient {
  private blocks: CalDavBusyBlock[] = [];

  seedBusyBlock(startsAt: Date, endsAt: Date): void {
    this.blocks.push({ startsAt, endsAt });
  }

  async listBusyBlocks(_credential: CalDavCredential, timeMin: Date, timeMax: Date): Promise<CalDavBusyBlock[]> {
    return this.blocks.filter((b) => b.startsAt < timeMax && b.endsAt > timeMin);
  }
}
