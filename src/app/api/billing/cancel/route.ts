// WP10 — Cancellation flow, NO DARK PATTERNS (§15.4; qc-checklist WP10 checkpoint 11 / uiux
// AC-5.8-6). GET returns the flow data (equal-weight alternatives, access-until date, reactivation
// window — Cancel never hidden, never requires contacting support); POST applies the cancellation
// (default end-of-period, honoring the paid-through date). Own-scope, behind the onboarding gate.

import { NextResponse } from 'next/server';

import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import { prisma } from '@/lib/prisma';
import { buildCancellationFlow, type CancellationMode } from '@/services/payment/cancellation';
import {
  SubscriptionNotFoundError,
  SubscriptionService,
  type SubscriptionServicePrisma,
} from '@/services/payment/subscription.service';
import { StripeConfigError } from '@/services/payment/stripe-client';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locale';

export const dynamic = 'force-dynamic';

/** T-57 RG8 (i18n) — same fail-soft, duck-typed shape this codebase's other units use
 *  (`today.service.ts`'s `resolveRepLocale` / the milestones-share route's own copy): never
 *  throws — a locale-lookup hiccup degrades to English, it must never block cancellation. */
async function resolveRepLocale(userId: string): Promise<Locale> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
    return isLocale(user?.locale) ? user.locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** GET — the no-dark-pattern cancellation flow data for the confirm screen. */
export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const service = new SubscriptionService(prisma as unknown as SubscriptionServicePrisma);
  const [state, locale] = await Promise.all([
    service.getBillingState(identity.userId),
    resolveRepLocale(identity.userId),
  ]);

  const flow = buildCancellationFlow({
    // The honest "state of the field" count is informational; 0 when unknown (never blocks cancel).
    openConversations: 0,
    // Downgrade path applies from enterprise → individual (§15.4 "downgrade path where applicable").
    downgradeAvailable: state.plan_tier === 'enterprise',
    currentPeriodEndMs: state.current_period_end ? new Date(state.current_period_end).getTime() : null,
    locale,
  });
  return NextResponse.json({ flow, currentTier: state.plan_tier });
});

/**
 * POST { mode } — apply cancellation. For a REAL Stripe subscription, this now ACTUALLY cancels it
 * at Stripe (`cancel_at_period_end=true` for `end_of_period`; a real `DELETE` for `immediate`)
 * before persisting CANCELED locally (T-R44) — previously this wrote CANCELED to the DB
 * unconditionally while Stripe kept auto-renewing/billing the member. Returns the access-until +
 * reactivation-window dates stated before confirm.
 */
export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: { mode?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* default below */
  }
  const mode: CancellationMode = body.mode === 'immediate' ? 'immediate' : 'end_of_period';

  const service = new SubscriptionService(prisma as unknown as SubscriptionServicePrisma);
  try {
    const outcome = await service.cancel(identity.userId, mode);
    return NextResponse.json({ canceled: true, ...outcome });
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) {
      return NextResponse.json({ error: 'No subscription to cancel.', code: 'NO_SUBSCRIPTION' }, { status: 404 });
    }
    if (error instanceof StripeConfigError) {
      // FAIL-CLOSED (T-R44): a real Stripe subscription could not be confirmed canceled at Stripe —
      // the DB was NEVER mutated (subscription.service.ts's cancel calls Stripe before persisting).
      // Never a fake "canceled: true" while Stripe keeps billing.
      return NextResponse.json(
        { error: 'Cancellation is not available in this environment.', code: 'CANCEL_UNAVAILABLE' },
        { status: 503 }
      );
    }
    // Any other failure (e.g. the real Stripe API call itself failed) — honest 502, no DB write.
    return NextResponse.json({ error: 'Could not cancel the subscription.', code: 'CANCEL_FAILED' }, { status: 502 });
  }
});
