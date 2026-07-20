// WP10 — Stripe webhook endpoint (§15.5; qc-checklist WP10 checkpoints 7 & 8). The ONE place Stripe
// events enter the system. Machine-to-machine: authenticated by Stripe's SIGNATURE, not a user
// session — like src/app/api/inngest/route.ts and the opt-out inbound webhook, it reads NO
// `x-user-*` identity header (so scripts/verify-api-auth.mjs does not flag it) and its trust comes
// solely from `verifyStripeWebhook`.
//
// THREE fail-closed gates, in order (§15.5):
//   1. SIGNATURE — `verifyStripeWebhook` (lazy `STRIPE_WEBHOOK_SECRET` read). A missing secret →
//      500 (Stripe retries; we never process an unverified event). A bad/forged/replayed signature
//      → 400. Only a verified payload is parsed.
//   2. IDEMPOTENCY — `withIdempotency` keyed on the Stripe EVENT ID. A duplicate delivery is
//      skipped safely (200, no re-action) — a replay can't double-charge or double-provision.
//   3. DISPATCH — the §15.5 event map (`dispatchStripeEvent`) → the Prisma-backed handlers.
//
// Per-request only (reads the signing key at invocation, not at build) — never prerendered.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import {
  STRIPE_WEBHOOK_SOURCE,
  stripeEventIdempotencyKey,
  withIdempotency,
  type IdempotencyLogDelegate,
} from '@/services/payment/idempotency';
import {
  StripeConfigError,
  StripeSignatureError,
  verifyStripeWebhook,
} from '@/services/payment/stripe-client';
import { buildStripeWebhookHandlers } from '@/services/payment/production-wiring';
import { dispatchStripeEvent } from '@/services/payment/webhook-events';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // The RAW body is what Stripe signed — never re-serialize it.
  const payload = await req.text();
  const signatureHeader = req.headers.get('stripe-signature');

  // ── Gate 1: SIGNATURE (lazy, fail-closed). ──
  let event;
  try {
    event = verifyStripeWebhook({ payload, signatureHeader });
  } catch (error) {
    if (error instanceof StripeConfigError) {
      // No webhook secret configured — cannot verify, so we refuse to process. 500 → Stripe retries.
      return NextResponse.json(
        { error: 'Stripe webhook secret not configured; refusing to process (fail-closed).' },
        { status: 500 }
      );
    }
    if (error instanceof StripeSignatureError) {
      // Forged / unsigned / replayed-outside-window — reject. 400 so Stripe does not retry a forgery.
      return NextResponse.json({ error: 'Signature verification failed.' }, { status: 400 });
    }
    throw error;
  }

  if (!event?.id || !event?.type) {
    return NextResponse.json({ error: 'Malformed event.' }, { status: 400 });
  }

  // ── Gates 2 & 3: IDEMPOTENCY + DISPATCH. ──
  const handlers = buildStripeWebhookHandlers();
  const idempotencyLog = (prisma as unknown as { idempotencyLog: IdempotencyLogDelegate })
    .idempotencyLog;

  try {
    const outcome = await withIdempotency(
      idempotencyLog,
      stripeEventIdempotencyKey(event.id),
      STRIPE_WEBHOOK_SOURCE,
      () => dispatchStripeEvent(event, handlers)
    );

    if (outcome.deduplicated) {
      // Duplicate/replayed delivery — already processed. Acknowledge without re-acting (§15.7-7).
      return NextResponse.json({ received: true, deduplicated: true });
    }
    return NextResponse.json({ received: true, handled: outcome.result?.handled ?? false });
  } catch {
    // A handler failed — the idempotency claim was released (idempotency.ts), so return 500 and let
    // Stripe retry the event later.
    return NextResponse.json({ error: 'Event processing failed; will retry.' }, { status: 500 });
  }
}
