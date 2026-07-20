// T-37 (WP05 §10.1 automated-cadence path) — the Twilio Programmable-Messaging SEND boundary for
// the Harvest PLATFORM number. This is a DISTINCT client from T-36's A2P-registration client
// (src/services/deliverability/twilio-client.ts, which submits Brand/Campaign registrations and
// polls their status) — that one PROVISIONS the number; this one SENDS a message through the
// already-provisioned, A2P-APPROVED number. Both share the same fail-safe posture and the same two
// env-var NAMES (§0.4): read lazily, by name only, never at module scope, never logged/returned.
//
// BUILD-SAFETY (hard-won, T-37 brief): `createTwilioMessagingClient()` reads TWILIO_ACCOUNT_SID /
// TWILIO_AUTH_TOKEN at CALL time (once per request, from inside the service/route method — never at
// import time) and returns `null` when either is unset. Every caller (PlatformSmsSendService)
// treats a `null` client as "Twilio is UNCONFIGURED" and HOLDS the send (`TWILIO_UNCONFIGURED`) —
// no send, no crash, no fabricated "delivered" (deny-by-default). A key-less build/test never
// touches a credential because nothing here runs at module scope.

import {
  TWILIO_ACCOUNT_SID_ENV_VAR,
  TWILIO_AUTH_TOKEN_ENV_VAR,
} from '../../deliverability/twilio-client';

/** What the platform send path hands Twilio. `from` is the org's A2P-APPROVED platform number
 *  (resolved from T-36 provisioning state — never a rep's own number); `to` is the recipient's
 *  E.164 number; `body` is the CFE-cleared, human-approved draft text. */
export interface TwilioSendInput {
  to: string;
  from: string;
  body: string;
}

/** Twilio's acknowledgement of an accepted send. `status` mirrors Twilio's own message status
 *  vocabulary (`queued` / `accepted` / `sending` / `sent`, ...) — the platform path records it on
 *  `Message.delivery_status` verbatim rather than inventing a "delivered" it cannot yet know. */
export interface TwilioSendResult {
  sid: string;
  status: string;
}

/** The narrow surface PlatformSmsSendService needs — a single idempotent Messages-API POST. */
export interface TwilioMessagingClient {
  sendSms(input: TwilioSendInput): Promise<TwilioSendResult>;
}

/** True iff both TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set. Read at call time, never cached
 *  at module scope — a build/typecheck run with no env never touches these. */
export function isTwilioMessagingConfigured(): boolean {
  return Boolean(process.env[TWILIO_ACCOUNT_SID_ENV_VAR] && process.env[TWILIO_AUTH_TOKEN_ENV_VAR]);
}

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/**
 * The real Twilio Programmable-Messaging client. Constructed ONLY by `createTwilioMessagingClient()`
 * below, and only after it has confirmed both env vars are present — so this class itself never
 * guards a missing credential; that guard lives at the factory boundary. Uses the runtime's
 * built-in `fetch` (no `twilio` SDK dependency — same rationale as T-36's twilio-client.ts).
 */
export class LiveTwilioMessagingClient implements TwilioMessagingClient {
  constructor(private readonly accountSid: string, private readonly authToken: string) {}

  private authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
  }

  async sendSms(input: TwilioSendInput): Promise<TwilioSendResult> {
    const res = await fetch(
      `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: input.to, From: input.from, Body: input.body }).toString(),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Twilio send failed (${res.status}): ${text || res.statusText}`);
    }
    const json = (await res.json()) as { sid: string; status?: string };
    return { sid: json.sid, status: json.status ?? 'queued' };
  }
}

/**
 * The fail-safe factory: a real, usable client when BOTH env vars are present, or `null` when
 * either is missing. NEVER throws for a missing credential — PlatformSmsSendService treats `null`
 * as UNCONFIGURED and holds the send rather than attempting a credential-less network call.
 */
export function createTwilioMessagingClient(): TwilioMessagingClient | null {
  const accountSid = process.env[TWILIO_ACCOUNT_SID_ENV_VAR];
  const authToken = process.env[TWILIO_AUTH_TOKEN_ENV_VAR];
  if (!accountSid || !authToken) {
    return null;
  }
  return new LiveTwilioMessagingClient(accountSid, authToken);
}

/**
 * Deterministic in-memory client for tests/dev — no network, no credentials. Records every send so
 * a test can assert exactly what was (or was NOT) dispatched; `failNext` forces the next `sendSms`
 * to throw, to exercise the platform path's send-failure handling.
 */
export class InMemoryTwilioMessagingClient implements TwilioMessagingClient {
  public readonly sent: TwilioSendInput[] = [];
  private counter = 0;
  /** Test hook: when true, the next `sendSms` throws (a transient Twilio/network failure). */
  public failNext = false;

  async sendSms(input: TwilioSendInput): Promise<TwilioSendResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Simulated Twilio send failure');
    }
    this.sent.push(input);
    return { sid: `SM_MOCK_${++this.counter}`, status: 'queued' };
  }
}
