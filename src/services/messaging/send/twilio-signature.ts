// T-R23 (WP05 §10.8 LAUNCH-GATE closure) — Twilio inbound-webhook REQUEST-SIGNATURE verification
// (`X-Twilio-Signature`). No prior unit in this codebase built this: T-36's client
// (../../deliverability/twilio-client.ts) submits A2P registrations and T-37's client
// (./twilio-messaging-client.ts) SENDS platform messages, but neither RECEIVES one, and
// ../../deliverability/gate.ts says so explicitly in its own doc comment — "no inbound-webhook
// signature-verification pattern exists anywhere yet in this codebase". This is that pattern, built
// the same LAZY / FAIL-CLOSED / NO-SDK way as every other Twilio/Stripe boundary here (mirrors
// `verifyStripeWebhook`, ../../payment/stripe-client.ts, almost line for line): `TWILIO_AUTH_TOKEN`
// (the SAME env-var name T-36/T-37 already read — `TWILIO_AUTH_TOKEN_ENV_VAR`, re-exported below) is
// read BY NAME, at call time, never at module scope, and this throws — never silently passes —
// when it is absent or when the signature does not match.
//
// ALGORITHM (Twilio's own documented request-validation scheme, reimplemented by hand with Node's
// built-in `crypto` — no `twilio` npm SDK dependency, same "no SDK" convention twilio-client.ts /
// stripe-client.ts both establish):
//   1. Take the exact URL Twilio POSTed the request to (protocol + host + path [+ query string],
//      byte-for-byte what is configured in the Twilio console).
//   2. Sort the POST body's parameter keys alphabetically and append each key+value directly
//      (undelimited) onto that URL string.
//   3. HMAC-SHA1 the result, keyed by the Auth Token; base64-encode the digest.
//   4. Compare (constant-time) to the `X-Twilio-Signature` request header.
//
// FAIL-CLOSED:
//   • `TWILIO_AUTH_TOKEN` unset -> `TwilioSignatureConfigError` (never a silent pass — a request
//     can never be "verified" against a credential that doesn't exist).
//   • header missing, or present but not a byte-for-byte HMAC match -> `TwilioSignatureError`.
// Only a request that passes `verifyTwilioRequestSignature` without throwing may reach the inbound
// route's business logic — see ../../../app/api/messaging/inbound/route.ts.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { TWILIO_AUTH_TOKEN_ENV_VAR } from '../../deliverability/twilio-client';

export { TWILIO_AUTH_TOKEN_ENV_VAR };

/** The header Twilio attaches to every webhook request it signs. */
export const TWILIO_SIGNATURE_HEADER = 'x-twilio-signature';

/** Thrown when `TWILIO_AUTH_TOKEN` is absent — the fail-closed signal (never a silent stub). */
export class TwilioSignatureConfigError extends Error {
  constructor() {
    super(
      `Twilio is not configured: ${TWILIO_AUTH_TOKEN_ENV_VAR} is not set. The inbound webhook fails ` +
        'closed rather than processing a request it cannot verify.'
    );
    this.name = 'TwilioSignatureConfigError';
  }
}

/** Thrown when a webhook signature fails verification — the request must be rejected (401/403). */
export class TwilioSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TwilioSignatureError';
  }
}

/** Constant-time compare; a length mismatch is an immediate (safe) `false`, never a thrown crash. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface VerifyTwilioSignatureOptions {
  /** The exact URL Twilio POSTed to (as configured in the Twilio console) — must match byte-for-
   *  byte what Twilio signed. */
  url: string;
  /** The `X-Twilio-Signature` request header value. */
  signatureHeader: string | null | undefined;
  /** The form-encoded POST body's parameters, already parsed/decoded (key -> string value). */
  params: Record<string, string>;
  /** Injectable env (tests). Defaults to `process.env`, read lazily — never at module scope. */
  env?: Record<string, string | undefined>;
}

/**
 * Verify an inbound Twilio webhook's `X-Twilio-Signature`. FAIL-CLOSED, THROWS on any failure — the
 * caller (the inbound route) must treat any thrown error as "reject the request", never catch-and-
 * continue past it. Returns nothing on success (there is no signed payload to parse and hand back,
 * unlike `verifyStripeWebhook` — Twilio's webhook is a set of form params the caller already has).
 */
export function verifyTwilioRequestSignature(options: VerifyTwilioSignatureOptions): void {
  const { url, signatureHeader, params, env = process.env } = options;

  // Lazy, by-name token read — fail-closed if absent.
  const authToken = env[TWILIO_AUTH_TOKEN_ENV_VAR];
  if (!authToken) {
    throw new TwilioSignatureConfigError();
  }

  if (!signatureHeader) {
    throw new TwilioSignatureError('Missing X-Twilio-Signature header.');
  }

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64');

  if (!safeEqual(expected, signatureHeader)) {
    throw new TwilioSignatureError('X-Twilio-Signature verification failed.');
  }
}
