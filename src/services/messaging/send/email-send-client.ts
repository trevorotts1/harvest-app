// T-39 (WP05 §10.5 email campaign builder / §10.7 email path; §0.4 build-safety) — the transactional
// EMAIL send boundary, the email analog of T-37's Twilio messaging client. A DISTINCT client from
// T-36's EmailDeliverabilityService (which VERIFIES SPF/DKIM/DMARC + runs the warm-up ramp) — that
// one PROVES the domain is sendable; this one SENDS a message through the already-authenticated
// domain (Resend/SendGrid-class provider, master-spec §2.1).
//
// BUILD-SAFETY (identical posture to twilio-messaging-client.ts): `createEmailSendClient()` reads
// RESEND_API_KEY at CALL time (inside the service/route method — never at import time) and returns
// `null` when it is unset. EmailSendService treats a `null` client as UNCONFIGURED and HOLDS the send
// (`EMAIL_UNCONFIGURED`) — no send, no crash, no fabricated "delivered" (deny-by-default). A key-less
// build/test never touches the credential because nothing here runs at module scope.

/** Env-var NAME of the transactional-email provider credential (Resend-class). Referenced by name
 *  only — never printed, never returned, never read at module scope. */
export const EMAIL_SEND_API_KEY_ENV_VAR = 'RESEND_API_KEY';
/** Optional override for the authenticated From address; defaults to `no-reply@{sendingDomain}`. */
export const EMAIL_SEND_FROM_ENV_VAR = 'EMAIL_SEND_FROM';

/** What the email path hands the provider. `from` is on the org's SPF/DKIM/DMARC-VERIFIED sending
 *  domain (T-36); `to` is the recipient's decrypted address; CAN-SPAM headers (unsubscribe +
 *  physical address) are assembled by EmailSendService and passed through here (§10.5). */
export interface EmailSendInput {
  to: string;
  from: string;
  subject: string;
  /** The CFE-cleared, human-approved draft body. */
  body: string;
  /** CAN-SPAM: a functional unsubscribe URL, present on EVERY email (§10.5/§10.9-6). */
  unsubscribeUrl: string;
  /** CAN-SPAM: the sender's physical postal address, present on every email (§10.5). */
  physicalAddress: string;
}

/** The provider's acknowledgement of an accepted send. `status` mirrors the provider's own vocabulary
 *  (e.g. `queued`/`sent`); the email path records it on `Message.delivery_status` verbatim rather than
 *  inventing a "delivered" it cannot yet know (uiux §5.7 honesty rule). */
export interface EmailSendResult {
  id: string;
  status: string;
}

/** The narrow surface EmailSendService needs — a single idempotent send. */
export interface EmailSendClient {
  sendEmail(input: EmailSendInput): Promise<EmailSendResult>;
}

/** True iff RESEND_API_KEY is set. Read at call time, never cached at module scope. */
export function isEmailSendConfigured(): boolean {
  return Boolean(process.env[EMAIL_SEND_API_KEY_ENV_VAR]);
}

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * The real Resend-class client. Constructed ONLY by `createEmailSendClient()` below, and only after
 * it has confirmed the key is present — so this class never guards a missing credential; that guard
 * lives at the factory boundary. Uses the runtime's built-in `fetch` (no provider SDK dependency —
 * same rationale as T-36/T-37's clients).
 */
export class LiveEmailSendClient implements EmailSendClient {
  constructor(private readonly apiKey: string) {}

  async sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
    // CAN-SPAM (§10.5): the unsubscribe link + physical business address are appended to the body as
    // a plain footer, so every email carries both regardless of the draft content.
    const html =
      `${input.body}\n\n---\n${input.physicalAddress}\n` +
      `Unsubscribe: ${input.unsubscribeUrl}`;
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: html,
        headers: { 'List-Unsubscribe': `<${input.unsubscribeUrl}>` },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Email send failed (${res.status}): ${text || res.statusText}`);
    }
    const json = (await res.json()) as { id?: string };
    return { id: json.id ?? `email_${Date.now()}`, status: 'queued' };
  }
}

/**
 * The fail-safe factory: a real, usable client when RESEND_API_KEY is present, or `null` when it is
 * missing. NEVER throws for a missing credential — EmailSendService treats `null` as UNCONFIGURED
 * and holds the send rather than attempting a credential-less network call.
 */
export function createEmailSendClient(): EmailSendClient | null {
  const apiKey = process.env[EMAIL_SEND_API_KEY_ENV_VAR];
  if (!apiKey) return null;
  return new LiveEmailSendClient(apiKey);
}

/** Resolve the authenticated From address for a sending domain — env override, else `no-reply@domain`.
 *  Lazy (call-time env read), never at module scope. */
export function resolveEmailFrom(sendingDomain: string): string {
  return process.env[EMAIL_SEND_FROM_ENV_VAR] || `no-reply@${sendingDomain}`;
}

/**
 * Deterministic in-memory client for tests/dev — no network, no credentials. Records every send so a
 * test can assert exactly what was (or was NOT) dispatched; `failNext` forces the next `sendEmail` to
 * throw, to exercise the email path's send-failure handling.
 */
export class InMemoryEmailSendClient implements EmailSendClient {
  public readonly sent: EmailSendInput[] = [];
  private counter = 0;
  public failNext = false;

  async sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Simulated email send failure');
    }
    this.sent.push(input);
    return { id: `EMAIL_MOCK_${++this.counter}`, status: 'queued' };
  }
}
