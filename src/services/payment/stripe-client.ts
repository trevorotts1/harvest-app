// WP10 — Stripe client (§15.5). LAZY, FAIL-CLOSED, no SDK.
//
// ██ PLATFORM INVARIANT #2 — LAZY INSTANTIATION (CRITICAL FOR STRIPE) ██
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are NEVER read at module scope and no client is
// constructed at import time. CI builds run with a clean env (no keys); a module-scope read would
// be a build-breaking false-red AND a prod hazard. Every function here reads the key it needs BY
// NAME at call time (§0.4) and FAILS CLOSED (throws `StripeConfigError`) when the key is absent —
// never a stub that fakes a charge or a signature pass (the deleted stripe.service.ts stub did
// exactly that; it is gone).
//
// NO `stripe` npm PACKAGE. The `stripe` SDK is not a dependency of this repo, and adding one is out
// of scope for a merge-ready build (lockfile churn / clean-env CI). Instead:
//   • Webhook signature verification — the ONE security-critical operation — is implemented against
//     Stripe's documented `stripe-signature` scheme with Node's built-in `crypto` (HMAC-SHA256 over
//     `${t}.${payload}`, constant-time compare, replay-tolerance window). This is exactly what the
//     SDK's `webhooks.constructEvent` does; doing it by hand keeps the dependency footprint at zero
//     and keeps every key read lazy.
//   • Outbound Stripe API calls (checkout session create) go through `fetch` to the Stripe REST API
//     with the secret key read lazily; if the key is absent the call throws (fail-closed).
//
// DEVIATION (stated per the build brief): with no live Stripe creds in this environment, the
// charge path (createCheckoutSession) and the webhook-verify path both FAIL CLOSED. The idempotency,
// tier-provisioning, lapse-cascade, and event-map logic are all exercised by the unit suite with
// mocks (payment-*.test.ts) — the fail-closed behavior itself is asserted too.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const STRIPE_SECRET_KEY_ENV_VAR = 'STRIPE_SECRET_KEY';
export const STRIPE_WEBHOOK_SECRET_ENV_VAR = 'STRIPE_WEBHOOK_SECRET';

/** Default replay-tolerance window (seconds) for the webhook timestamp, matching Stripe's default. */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/** Thrown when a required Stripe secret is absent — the fail-closed signal (never a silent stub). */
export class StripeConfigError extends Error {
  constructor(envVar: string) {
    super(
      `Stripe is not configured: ${envVar} is not set. The charge/webhook path fails closed rather ` +
        `than faking a result (§15.5 / invariant #2).`
    );
    this.name = 'StripeConfigError';
  }
}

/** Thrown when a webhook signature fails verification — the request must be rejected (401/400). */
export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeSignatureError';
  }
}

/** Reads a secret by name at CALL time. Fail-closed: absent/blank → throw, never a default value. */
export function readStripeSecret(envVar: string, env: Record<string, string | undefined> = process.env): string {
  const value = env[envVar];
  if (!value || value.trim() === '') {
    throw new StripeConfigError(envVar);
  }
  return value;
}

/** True iff the given secret is present — for a UI/route to decide "checkout available?" without throwing. */
export function isStripeConfigured(
  envVar: string = STRIPE_SECRET_KEY_ENV_VAR,
  env: Record<string, string | undefined> = process.env
): boolean {
  const value = env[envVar];
  return !!value && value.trim() !== '';
}

/**
 * Parse a Stripe `stripe-signature` header into its `t` (timestamp) and `v1` (signature) parts.
 * Header form: `t=1234567890,v1=abc...,v0=...`. Multiple `v1` entries are allowed (key rotation).
 */
function parseSignatureHeader(header: string): { timestamp: number; v1: string[] } {
  const parts = header.split(',').map((p) => p.trim());
  let timestamp = NaN;
  const v1: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1') v1.push(value);
  }
  return { timestamp, v1 };
}

function safeHexEqual(a: string, b: string): boolean {
  // Constant-time compare on the raw bytes; length mismatch is an immediate (safe) false.
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface VerifyWebhookOptions {
  /** The RAW request body string (must be the exact bytes Stripe signed — never re-serialized JSON). */
  payload: string;
  /** The value of the `stripe-signature` request header. */
  signatureHeader: string | null | undefined;
  /** Injectable env (tests). Defaults to `process.env`, read lazily here — never at module scope. */
  env?: Record<string, string | undefined>;
  /** Injectable clock (tests). Seconds since epoch. */
  nowSeconds?: number;
  toleranceSeconds?: number;
}

/**
 * Verify a Stripe webhook signature and return the parsed event (§15.5 "mandatory `stripe-signature`
 * verification"). MANDATORY and FAIL-CLOSED:
 *   • no `STRIPE_WEBHOOK_SECRET` → throws `StripeConfigError` (the route returns 500/400; it never
 *     processes an unverified event);
 *   • missing/malformed header, stale timestamp (replay outside the tolerance window), or no
 *     matching `v1` signature → throws `StripeSignatureError` (the route returns 400).
 * Only a fully-verified payload is JSON-parsed and returned. An attacker's forged/unsigned webhook
 * never reaches the event dispatcher.
 */
export function verifyStripeWebhook(options: VerifyWebhookOptions): StripeEvent {
  const {
    payload,
    signatureHeader,
    env = process.env,
    nowSeconds = Math.floor(Date.now() / 1000),
    toleranceSeconds = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  } = options;

  // Lazy, by-name secret read — fail-closed if absent.
  const secret = readStripeSecret(STRIPE_WEBHOOK_SECRET_ENV_VAR, env);

  if (!signatureHeader) {
    throw new StripeSignatureError('Missing stripe-signature header.');
  }

  const { timestamp, v1 } = parseSignatureHeader(signatureHeader);
  if (!Number.isFinite(timestamp) || v1.length === 0) {
    throw new StripeSignatureError('Malformed stripe-signature header.');
  }

  // Replay protection: reject a timestamp outside the tolerance window in EITHER direction.
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new StripeSignatureError('Timestamp outside the tolerance window (possible replay).');
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  const matches = v1.some((candidate) => safeHexEqual(candidate, expected));
  if (!matches) {
    throw new StripeSignatureError('No matching v1 signature — signature verification failed.');
  }

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    throw new StripeSignatureError('Verified signature but payload is not valid JSON.');
  }
  return event as StripeEvent;
}

/** The minimal shape of a Stripe event the WP10 event map reads (`webhook-events.ts`). */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface CreateCheckoutSessionInput {
  /** Our internal user id — echoed back on `checkout.session.completed` via `client_reference_id`. */
  userId: string;
  /** Stripe Price id for the locked tier/cycle being purchased. Read from env by NAME at call time. */
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  /** An idempotency key so a retried create cannot open two checkout sessions (§15.5). */
  idempotencyKey: string;
  env?: Record<string, string | undefined>;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface CheckoutSessionResult {
  id: string;
  url: string;
}

/**
 * Create a Stripe Checkout Session (§15.5: "Checkout via Stripe Elements → backend creates the
 * subscription"). LAZY + FAIL-CLOSED: reads `STRIPE_SECRET_KEY` by name at call time and throws
 * `StripeConfigError` if absent — it NEVER returns a fake `checkout.stripe.com/...` URL (the deleted
 * stub did that). Card fields are collected on Stripe's hosted checkout only — no PAN ever touches
 * a Harvest surface (§15.7-10 / SAQ-A). The `idempotency-key` header makes a retried create safe.
 */
export async function createCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<CheckoutSessionResult> {
  const { userId, priceId, successUrl, cancelUrl, idempotencyKey, env = process.env } = input;
  const secret = readStripeSecret(STRIPE_SECRET_KEY_ENV_VAR, env);
  const doFetch = input.fetchImpl ?? fetch;

  const body = new URLSearchParams();
  body.set('mode', 'subscription');
  body.set('client_reference_id', userId);
  body.set('success_url', successUrl);
  body.set('cancel_url', cancelUrl);
  body.set('line_items[0][price]', priceId);
  body.set('line_items[0][quantity]', '1');

  const res = await doFetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Stripe idempotency: a retried create with the same key returns the SAME session (§15.5).
      'Idempotency-Key': idempotencyKey,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Stripe checkout session create failed (${res.status}): ${detail.slice(0, 500)}`);
  }
  const json = (await res.json()) as { id?: string; url?: string };
  if (!json.id || !json.url) {
    throw new Error('Stripe checkout session response missing id/url.');
  }
  return { id: json.id, url: json.url };
}
