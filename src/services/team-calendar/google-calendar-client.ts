// T-45 (WP09, §14.1 "Google Calendar (OAuth 2.0): primary dual sync for rep + trainer; events
// created in Harvest push to Google instantly; two-way sync with slot locking") — the Google
// Calendar API v3 client boundary. Mirrors the exact lazy-factory convention already established by
// `src/services/deliverability/twilio-client.ts` (T-36): a narrow, DI-mockable interface; nothing
// outside this file ever reaches for `fetch`/the `googleapis` SDK directly; the factory reads
// credentials BY NAME ONLY, lazily (never at module scope), and returns `null` when unconfigured.
//
// STATED DEVIATION (Reachability Mandate): this build environment has no real
// GOOGLE_CALENDAR_CLIENT_ID/SECRET and no live per-user OAuth tokens (§0.4 — no credential is ever
// fabricated). `createGoogleCalendarClient()` therefore returns `null` in this environment, and
// every caller (google-sync.service.ts) resolves that to the propose-only / "calendar disconnected"
// degrade path §14.3/§18.4 mandates for a missing/expired token — never a fabricated sync, never a
// non-Google fallback. The sync/merge LOGIC itself is real and is unit-tested against
// `InMemoryGoogleCalendarClient` (a deterministic in-memory double, no network).
//
// No `googleapis` npm dependency is added on purpose — same rationale as twilio-client.ts: the
// handful of REST calls this needs (free/busy query + events insert/patch/delete) are simple JSON
// HTTP requests the runtime's built-in `fetch` already covers, keeping the audit surface small.

export const GOOGLE_CALENDAR_CLIENT_ID_ENV_VAR = 'GOOGLE_CALENDAR_CLIENT_ID';
export const GOOGLE_CALENDAR_CLIENT_SECRET_ENV_VAR = 'GOOGLE_CALENDAR_CLIENT_SECRET';

export interface GoogleBusyBlock {
  externalRef: string;
  startsAt: Date;
  endsAt: Date;
}

export interface GoogleEventInput {
  externalRef?: string; // set on update; absent on create
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
}

/** Thrown when the access token is expired/revoked — callers degrade to propose-only (§14.3/§18.4). */
export class GoogleAuthExpiredError extends Error {
  constructor() {
    super('Google Calendar OAuth token expired or revoked.');
    this.name = 'GoogleAuthExpiredError';
  }
}

export interface GoogleCalendarClient {
  /** Read half of the dual sync — busy/blocking windows only, never event content (§14.1). */
  listBusyBlocks(accessToken: string, timeMin: Date, timeMax: Date): Promise<GoogleBusyBlock[]>;
  /** Write half — a Harvest-created event pushed to Google "instantly" (§14.1). */
  createEvent(accessToken: string, event: GoogleEventInput): Promise<{ externalRef: string }>;
  updateEvent(accessToken: string, event: GoogleEventInput): Promise<void>;
  deleteEvent(accessToken: string, externalRef: string): Promise<void>;
}

/** True iff both platform Google OAuth app credentials are configured. Read at call time only. */
export function isGoogleCalendarConfigured(): boolean {
  return Boolean(
    process.env[GOOGLE_CALENDAR_CLIENT_ID_ENV_VAR] && process.env[GOOGLE_CALENDAR_CLIENT_SECRET_ENV_VAR]
  );
}

const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3';

/** The real Google Calendar REST client. Constructed only after the platform app credentials are
 *  confirmed present (see `createGoogleCalendarClient`) — the per-user `accessToken` is supplied
 *  per call, never held by this class. */
export class LiveGoogleCalendarClient implements GoogleCalendarClient {
  private async request<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${GOOGLE_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 401) throw new GoogleAuthExpiredError();
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Calendar API error (${res.status}): ${text || res.statusText}`);
    }
    return (await res.json()) as T;
  }

  async listBusyBlocks(accessToken: string, timeMin: Date, timeMax: Date): Promise<GoogleBusyBlock[]> {
    const result = await this.request<{ items: { id: string; start: { dateTime?: string }; end: { dateTime?: string } }[] }>(
      accessToken,
      `/calendars/primary/events?timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}&singleEvents=true`
    );
    return (result.items ?? [])
      .filter((e) => e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({ externalRef: e.id, startsAt: new Date(e.start.dateTime as string), endsAt: new Date(e.end.dateTime as string) }));
  }

  async createEvent(accessToken: string, event: GoogleEventInput): Promise<{ externalRef: string }> {
    const result = await this.request<{ id: string }>(accessToken, '/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify({
        summary: event.title,
        start: { dateTime: event.startsAt.toISOString(), timeZone: event.timezone },
        end: { dateTime: event.endsAt.toISOString(), timeZone: event.timezone },
      }),
    });
    return { externalRef: result.id };
  }

  async updateEvent(accessToken: string, event: GoogleEventInput): Promise<void> {
    if (!event.externalRef) throw new Error('updateEvent requires externalRef.');
    await this.request(accessToken, `/calendars/primary/events/${encodeURIComponent(event.externalRef)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        summary: event.title,
        start: { dateTime: event.startsAt.toISOString(), timeZone: event.timezone },
        end: { dateTime: event.endsAt.toISOString(), timeZone: event.timezone },
      }),
    });
  }

  async deleteEvent(accessToken: string, externalRef: string): Promise<void> {
    await this.request(accessToken, `/calendars/primary/events/${encodeURIComponent(externalRef)}`, { method: 'DELETE' });
  }
}

/**
 * The fail-safe factory: a real client when both platform app credentials are present, `null`
 * otherwise. NEVER throws for a missing credential.
 */
export function createGoogleCalendarClient(): GoogleCalendarClient | null {
  if (!isGoogleCalendarConfigured()) return null;
  return new LiveGoogleCalendarClient();
}

/** Deterministic in-memory double for tests/dev — no network, no credentials. */
export class InMemoryGoogleCalendarClient implements GoogleCalendarClient {
  private counter = 0;
  private events = new Map<string, GoogleEventInput & { externalRef: string }>();
  /** Test hook: force the next call to behave as an expired/revoked token. */
  forceAuthExpired = false;

  async listBusyBlocks(_accessToken: string, timeMin: Date, timeMax: Date): Promise<GoogleBusyBlock[]> {
    if (this.forceAuthExpired) throw new GoogleAuthExpiredError();
    return Array.from(this.events.values())
      .filter((e) => e.startsAt < timeMax && e.endsAt > timeMin)
      .map((e) => ({ externalRef: e.externalRef, startsAt: e.startsAt, endsAt: e.endsAt }));
  }

  async createEvent(_accessToken: string, event: GoogleEventInput): Promise<{ externalRef: string }> {
    if (this.forceAuthExpired) throw new GoogleAuthExpiredError();
    const externalRef = `evt_mock_${++this.counter}`;
    this.events.set(externalRef, { ...event, externalRef });
    return { externalRef };
  }

  async updateEvent(_accessToken: string, event: GoogleEventInput): Promise<void> {
    if (this.forceAuthExpired) throw new GoogleAuthExpiredError();
    if (!event.externalRef) throw new Error('updateEvent requires externalRef.');
    this.events.set(event.externalRef, { ...event, externalRef: event.externalRef });
  }

  async deleteEvent(_accessToken: string, externalRef: string): Promise<void> {
    if (this.forceAuthExpired) throw new GoogleAuthExpiredError();
    this.events.delete(externalRef);
  }

  /** Test helper: seed a busy block directly (simulates an event that already exists on Google). */
  seedBusyBlock(startsAt: Date, endsAt: Date): string {
    const externalRef = `evt_mock_${++this.counter}`;
    this.events.set(externalRef, { externalRef, title: 'Busy', startsAt, endsAt, timezone: 'UTC' });
    return externalRef;
  }
}
