// WP10 — POST create a Stripe Checkout Session for the $297 individual plan (§15.5; uiux §5.8
// "Start" → Stripe Elements; AC-5.8-8 "checkout uses Stripe-hosted fields exclusively"). Also the
// sponsored-member CONVERT-to-$297 path (§15.3): the ONE case a sponsored member sees a card entry
// (uiux AC-5.8-2) — and only after explicitly choosing to convert.
//
// FAIL-CLOSED: the Stripe price id + secret key are read BY NAME at call time; if either is absent
// the route returns 503 (checkout unavailable) — it NEVER returns a fake checkout URL (invariant #2).
// Card fields live on Stripe's hosted page only; no PAN ever touches a Harvest surface (§15.7-10).
//
// Enterprise is NOT a checkout tier — it is an annual invoice / "Talk to us" contact flow (§15.1),
// so a checkout request for enterprise is rejected. Free never collects payment.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { markMemberConverted } from '@/services/payment/sponsor-cascade';
import { buildMemberTransitionStore } from '@/services/payment/production-wiring';
import { stripePriceEnvVarFor } from '@/services/payment/tiers';
import {
  StripeConfigError,
  createCheckoutSession,
  isStripeConfigured,
} from '@/services/payment/stripe-client';

export const dynamic = 'force-dynamic';

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: { tier?: string; cycle?: string; convert?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine — defaults below */
  }

  const tier = body.tier ?? 'individual';
  const cycle = body.cycle === 'annual' ? 'annual' : 'monthly';

  if (tier === 'enterprise') {
    return NextResponse.json(
      { error: 'Enterprise is an annual invoice — use the contact flow, not checkout (§15.1).', code: 'CONTACT_SALES' },
      { status: 400 }
    );
  }
  if (tier !== 'individual') {
    return NextResponse.json(
      { error: 'Only the individual ($297) plan is purchased via checkout.', code: 'UNSUPPORTED_TIER' },
      { status: 400 }
    );
  }

  // Fail-closed early if Stripe is not configured — do not mutate sponsorship state for a checkout
  // that cannot complete. `stripePriceEnvVarFor` (tiers.ts) is the single source of truth this route
  // shares with `subscription.service.ts`'s `changePlan` (T-R44) — 'individual' always has an entry.
  const priceEnvVar = stripePriceEnvVarFor('individual', cycle);
  const priceId = priceEnvVar ? process.env[priceEnvVar] : undefined;
  if (!isStripeConfigured() || !priceId) {
    return NextResponse.json(
      { error: 'Checkout is not configured in this environment.', code: 'CHECKOUT_UNAVAILABLE' },
      { status: 503 }
    );
  }

  // Sponsored-member convert (§15.3): flip their sponsorship to CONVERTED so entitlement stops
  // treating them as sponsored once the new paid subscription activates via the webhook.
  if (body.convert) {
    await markMemberConverted(buildMemberTransitionStore(), identity.userId);
  }

  const origin = req.headers.get('origin') ?? '';
  try {
    const session = await createCheckoutSession({
      userId: identity.userId,
      priceId,
      successUrl: `${origin}/me/subscription?checkout=success`,
      cancelUrl: `${origin}/me/subscription?checkout=canceled`,
      // Idempotent create: a double-submit for the same user+cycle reuses the same session (§15.5).
      idempotencyKey: `checkout:${identity.userId}:individual:${cycle}`,
    });
    return NextResponse.json({ url: session.url, id: session.id });
  } catch (error) {
    if (error instanceof StripeConfigError) {
      return NextResponse.json(
        { error: 'Checkout is not configured in this environment.', code: 'CHECKOUT_UNAVAILABLE' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: 'Could not start checkout.', code: 'CHECKOUT_ERROR' }, { status: 502 });
  }
});
