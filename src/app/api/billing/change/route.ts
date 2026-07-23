// WP10 — Mid-cycle tier change with proration (§15.4; qc-checklist WP10 checkpoint 11 / uiux
// AC-5.8-7). GET previews the EXACT proration amount BEFORE any confirm (no surprise charge / no
// dark pattern); POST applies the change. Own-scope, behind the onboarding gate.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import {
  SubscriptionNotFoundError,
  SubscriptionService,
  type SubscriptionServicePrisma,
} from '@/services/payment/subscription.service';
import { StripeConfigError } from '@/services/payment/stripe-client';
import type { BillingCycle, PlanTier } from '@/types/payment';

export const dynamic = 'force-dynamic';

function parseTierCycle(tier: string | null, cycle: string | null): { tier: PlanTier; cycle: BillingCycle } | null {
  if (tier !== 'individual' && tier !== 'enterprise' && tier !== 'free') return null;
  const c: BillingCycle = cycle === 'annual' ? 'annual' : 'monthly';
  return { tier, cycle: c };
}

/** GET /api/billing/change?tier=individual&cycle=monthly — proration PREVIEW (exact amount before confirm). */
export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const url = new URL(req.url);
  const parsed = parseTierCycle(url.searchParams.get('tier'), url.searchParams.get('cycle'));
  if (!parsed) {
    return NextResponse.json({ error: 'Unknown tier.', code: 'UNKNOWN_TIER' }, { status: 400 });
  }
  const service = new SubscriptionService(prisma as unknown as SubscriptionServicePrisma);
  try {
    const proration = await service.previewPlanChange(identity.userId, parsed.tier, parsed.cycle);
    return NextResponse.json({ proration });
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) {
      return NextResponse.json({ error: 'No subscription to change.', code: 'NO_SUBSCRIPTION' }, { status: 404 });
    }
    throw error;
  }
});

/**
 * POST /api/billing/change { tier, cycle } — apply the change. For a REAL Stripe subscription, this
 * now ACTUALLY updates the price at Stripe (proration_behavior=create_prorations, §15.4) before
 * persisting the new plan_tier/cycle (T-R44) — previously this recorded the plan locally only, and
 * Stripe never heard about the change (never a phantom "Stripe executes the charge").
 */
export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: { tier?: string; cycle?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* defaults below */
  }
  const parsed = parseTierCycle(body.tier ?? null, body.cycle ?? null);
  if (!parsed) {
    return NextResponse.json({ error: 'Unknown tier.', code: 'UNKNOWN_TIER' }, { status: 400 });
  }
  const service = new SubscriptionService(prisma as unknown as SubscriptionServicePrisma);
  try {
    const result = await service.changePlan(identity.userId, parsed.tier, parsed.cycle);
    return NextResponse.json({ changed: true, proration: result.proration });
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) {
      return NextResponse.json({ error: 'No subscription to change.', code: 'NO_SUBSCRIPTION' }, { status: 404 });
    }
    if (error instanceof StripeConfigError) {
      // FAIL-CLOSED (T-R44): a real Stripe subscription's price could not be confirmed changed —
      // the DB was NEVER mutated (subscription.service.ts's changePlan calls Stripe before
      // persisting). Never a fake success.
      return NextResponse.json(
        { error: 'Billing update is not available in this environment.', code: 'BILLING_UPDATE_UNAVAILABLE' },
        { status: 503 }
      );
    }
    // Any other failure (e.g. the real Stripe API call itself failed) — honest 502, no DB write.
    return NextResponse.json({ error: 'Could not apply the plan change.', code: 'CHANGE_FAILED' }, { status: 502 });
  }
});
