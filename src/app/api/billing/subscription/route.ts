// WP10 — GET the caller's OWN billing state (§15.1 / §15.6; uiux §5.8). Behind the real onboarding
// gate (§15.2 — no billing surface before onboarding completes) and scoped to the verified session
// identity: a caller only ever sees their OWN billing (billing RBAC row 5 "Billing (own)" — every
// role manages their own; the ownership scope is `identity.userId`, never a client-supplied id).
//
// Returns the honest `BillingStateView` (tier, phase, sponsor info, payment method as brand+last4
// only — never a PAN, §15.7-10) PLUS the three locked tier cards for the UI, and whether Stripe
// checkout is configured (so the UI can degrade honestly rather than open a dead checkout).

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { isStripeConfigured } from '@/services/payment/stripe-client';
import {
  SubscriptionService,
  listLockedTiers,
  type SubscriptionServicePrisma,
} from '@/services/payment/subscription.service';

export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const service = new SubscriptionService(prisma as unknown as SubscriptionServicePrisma);
  const state = await service.getBillingState(identity.userId);

  return NextResponse.json({
    state,
    tiers: listLockedTiers(),
    checkoutAvailable: isStripeConfigured(),
    _meta: { demo: false },
  });
});
