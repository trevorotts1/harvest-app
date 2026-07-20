// WP10 (T-47) — Stripe webhook signature verification (§15.5; qc-checklist WP10 checkpoint 7 /
// break-it: "send an unsigned/forged webhook and confirm rejection"). Also proves the fail-closed
// behavior when the webhook secret is absent (invariant #2 / stated deviation).

import { createHmac } from 'node:crypto';

import {
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  STRIPE_WEBHOOK_SECRET_ENV_VAR,
  StripeConfigError,
  StripeSignatureError,
  isStripeConfigured,
  verifyStripeWebhook,
} from '@/services/payment/stripe-client';

const SECRET = 'whsec_test_secret_value';

function signed(payload: string, t: number, secret = SECRET): string {
  const sig = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v1=${sig}`;
}

const NOW = 1_700_000_000;
const env: Record<string, string | undefined> = { [STRIPE_WEBHOOK_SECRET_ENV_VAR]: SECRET };

describe('verifyStripeWebhook', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });

  test('accepts a correctly-signed, in-window event and returns the parsed event', () => {
    const event = verifyStripeWebhook({
      payload,
      signatureHeader: signed(payload, NOW),
      env,
      nowSeconds: NOW,
    });
    expect(event.id).toBe('evt_1');
    expect(event.type).toBe('checkout.session.completed');
  });

  test('REJECTS a forged signature (wrong secret) — StripeSignatureError', () => {
    expect(() =>
      verifyStripeWebhook({
        payload,
        signatureHeader: signed(payload, NOW, 'whsec_attacker_guess'),
        env,
        nowSeconds: NOW,
      })
    ).toThrow(StripeSignatureError);
  });

  test('REJECTS a tampered payload (signature no longer matches the body)', () => {
    const header = signed(payload, NOW);
    const tampered = JSON.stringify({ id: 'evt_1', type: 'invoice.payment_succeeded', data: { object: {} } });
    expect(() =>
      verifyStripeWebhook({ payload: tampered, signatureHeader: header, env, nowSeconds: NOW })
    ).toThrow(StripeSignatureError);
  });

  test('REJECTS a missing signature header', () => {
    expect(() =>
      verifyStripeWebhook({ payload, signatureHeader: null, env, nowSeconds: NOW })
    ).toThrow(StripeSignatureError);
  });

  test('REJECTS a malformed signature header', () => {
    expect(() =>
      verifyStripeWebhook({ payload, signatureHeader: 'not-a-real-header', env, nowSeconds: NOW })
    ).toThrow(StripeSignatureError);
  });

  test('REJECTS a replayed/stale timestamp outside the tolerance window', () => {
    const staleT = NOW - (DEFAULT_SIGNATURE_TOLERANCE_SECONDS + 60);
    expect(() =>
      verifyStripeWebhook({ payload, signatureHeader: signed(payload, staleT), env, nowSeconds: NOW })
    ).toThrow(StripeSignatureError);
  });

  test('FAILS CLOSED when STRIPE_WEBHOOK_SECRET is absent — StripeConfigError, never a pass', () => {
    expect(() =>
      verifyStripeWebhook({
        payload,
        signatureHeader: signed(payload, NOW),
        env: {},
        nowSeconds: NOW,
      })
    ).toThrow(StripeConfigError);
  });

  test('isStripeConfigured reflects presence of the key by name only', () => {
    expect(isStripeConfigured('STRIPE_SECRET_KEY', { STRIPE_SECRET_KEY: 'sk_x' })).toBe(true);
    expect(isStripeConfigured('STRIPE_SECRET_KEY', {})).toBe(false);
    expect(isStripeConfigured('STRIPE_SECRET_KEY', { STRIPE_SECRET_KEY: '  ' })).toBe(false);
  });
});
