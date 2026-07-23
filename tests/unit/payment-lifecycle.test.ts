// WP10 (T-47) — billing lifecycle state machine + graceful-suspension contract + proration +
// no-dark-pattern cancellation (§15.4; qc-checklist WP10 checkpoints 6 & 11 / uiux AC-5.8-6/7).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { SubscriptionStatus } from '@prisma/client';

import { nextSubscriptionStatus, suspensionAgentEffect } from '@/services/payment/billing-lifecycle';
import { computeProration } from '@/services/payment/proration';
import {
  REACTIVATION_WINDOW_DAYS,
  buildCancellationFlow,
  resolveCancellationOutcome,
} from '@/services/payment/cancellation';

const DAY = 24 * 60 * 60 * 1000;

describe('nextSubscriptionStatus (§15.4 transitions)', () => {
  test('active ↔ past_due; past_due → expired; instant restoration', () => {
    expect(nextSubscriptionStatus(SubscriptionStatus.ACTIVE, 'payment_failed')).toBe(SubscriptionStatus.PAST_DUE);
    expect(nextSubscriptionStatus(SubscriptionStatus.PAST_DUE, 'grace_window_elapsed')).toBe(SubscriptionStatus.EXPIRED);
    expect(nextSubscriptionStatus(SubscriptionStatus.PAST_DUE, 'payment_succeeded')).toBe(SubscriptionStatus.ACTIVE);
    expect(nextSubscriptionStatus(SubscriptionStatus.EXPIRED, 'payment_succeeded')).toBe(SubscriptionStatus.ACTIVE);
  });
  test('dispute overrides to DISPUTED and is not cleared by a payment', () => {
    expect(nextSubscriptionStatus(SubscriptionStatus.ACTIVE, 'dispute_opened')).toBe(SubscriptionStatus.DISPUTED);
    expect(nextSubscriptionStatus(SubscriptionStatus.DISPUTED, 'payment_succeeded')).toBeNull();
    expect(nextSubscriptionStatus(SubscriptionStatus.DISPUTED, 'dispute_resolved')).toBe(SubscriptionStatus.ACTIVE);
  });
  test('cancel + reactivate within the retention window', () => {
    expect(nextSubscriptionStatus(SubscriptionStatus.ACTIVE, 'canceled')).toBe(SubscriptionStatus.CANCELED);
    expect(nextSubscriptionStatus(SubscriptionStatus.CANCELED, 'reactivated')).toBe(SubscriptionStatus.ACTIVE);
  });
  test('inapplicable events are no-ops (never a silent downgrade)', () => {
    expect(nextSubscriptionStatus(SubscriptionStatus.ACTIVE, 'payment_succeeded')).toBeNull();
    expect(nextSubscriptionStatus(SubscriptionStatus.EXPIRED, 'payment_failed')).toBeNull();
  });
});

describe('suspensionAgentEffect (§15.7-6 — no mid-thread ghosting, data intact)', () => {
  test('soft suspension: no new outbound, but in-flight threads WRAP UP; read-only; data intact', () => {
    expect(suspensionAgentEffect('soft_suspended')).toEqual({
      allowNewOutbound: false,
      allowInFlightWrapUp: true,
      readOnly: true,
      dataIntact: true,
    });
  });
  test('disputed: outbound off but in-flight wraps up; not read-only; data intact', () => {
    expect(suspensionAgentEffect('disputed')).toMatchObject({ allowNewOutbound: false, allowInFlightWrapUp: true });
  });
  test('grace & member_grace: full function', () => {
    expect(suspensionAgentEffect('grace').allowNewOutbound).toBe(true);
    expect(suspensionAgentEffect('member_grace').allowNewOutbound).toBe(true);
  });
  test('data is intact in EVERY phase (never destroyed — §15.4)', () => {
    for (const p of ['active', 'grace', 'soft_suspended', 'expired', 'disputed', 'member_grace', 'member_active', 'canceled_active_until'] as const) {
      expect(suspensionAgentEffect(p).dataIntact).toBe(true);
    }
  });
});

describe('computeProration (§15.4 — annual prorated daily; exact amount before confirm)', () => {
  const periodStartMs = 0;
  const periodEndMs = 30 * DAY;

  test('upgrade mid-cycle charges the prorated difference for the remaining days', () => {
    // halfway through a 30-day period, upgrade from $297 to a hypothetical higher plan.
    const p = computeProration({ fromCents: 29_700, toCents: 59_400, periodStartMs, periodEndMs, changeMs: 15 * DAY });
    expect(p.daysInPeriod).toBe(30);
    expect(p.daysRemaining).toBe(15);
    expect(p.netCents).toBe(Math.round(59_400 * 0.5) - Math.round(29_700 * 0.5));
    expect(p.summary).toMatch(/due today/);
  });
  test('downgrade yields a credit summary', () => {
    const p = computeProration({ fromCents: 59_400, toCents: 29_700, periodStartMs, periodEndMs, changeMs: 15 * DAY });
    expect(p.netCents).toBeLessThan(0);
    expect(p.summary).toMatch(/credit/);
  });
});

describe('cancellation flow — NO DARK PATTERNS (AC-5.8-6)', () => {
  const NOW = 1_000_000_000_000;
  test('alternatives are equal-weight; final label is plain; no support contact required', () => {
    const flow = buildCancellationFlow({ openConversations: 3, downgradeAvailable: true, currentPeriodEndMs: NOW + 10 * DAY });
    expect(flow.alternatives).toEqual(['downgrade', 'cancel']);
    expect(flow.finalActionLabel).toBe('Cancel subscription');
    expect(flow.requiresSupportContact).toBe(false);
    expect(flow.reactivationWindowDays).toBe(REACTIVATION_WINDOW_DAYS);
    expect(flow.accessUntilIso).toBe(new Date(NOW + 10 * DAY).toISOString());
  });
  test('no downgrade path when not applicable → cancel only', () => {
    const flow = buildCancellationFlow({ openConversations: 0, downgradeAvailable: false, currentPeriodEndMs: null });
    expect(flow.alternatives).toEqual(['cancel']);
  });

  // T-R42 (P2 cleanup, integration-reachability audit): 'pause' is NO LONGER an offered alternative,
  // in ANY configuration — no pause capability exists anywhere in this codebase (no `PAUSED` in
  // `SubscriptionStatus`, no pause method on `SubscriptionService`), so offering it would be the
  // exact dark pattern this describe block's own header guards against (a retention alternative
  // that cannot actually be honored). This REPLACES the old assertions (above) that 'pause' WAS
  // present — the correct new intent is that it is absent, not merely untested.
  test('T-R42: "pause" is never offered — not with downgrade available, not without', () => {
    const withDowngrade = buildCancellationFlow({ openConversations: 3, downgradeAvailable: true, currentPeriodEndMs: NOW + 10 * DAY });
    const withoutDowngrade = buildCancellationFlow({ openConversations: 0, downgradeAvailable: false, currentPeriodEndMs: null });
    expect(withDowngrade.alternatives).not.toContain('pause');
    expect(withoutDowngrade.alternatives).not.toContain('pause');
  });

  // T-R42 — render-level teeth (repo precedent: tests/unit/composer-handoff-wiring.test.ts's
  // source-scan proof for a page that fetches its own data in `useEffect`, which never runs in this
  // repo's node/no-jsdom test render). `me/subscription/page.tsx` is exactly that shape, so a
  // structural scan of its real source is the deterministic way to prove the cancel dialog can never
  // render a pause affordance: (a) the old `.filter((alt) => alt !== 'pause')` dark-pattern
  // workaround is gone (nothing left to filter), and (b) the button list is rendered directly off
  // `cancelFlow.alternatives` with no other, separate hardcoded "pause"/"Pause" button anywhere in
  // the file — combined with `buildCancellationFlow` (the ONLY source of that array, confirmed by
  // grep — no other consumer of its `alternatives` renders anything) never including 'pause' (proven
  // above), the rendered dialog genuinely cannot show a pause affordance.
  test('T-R42: the cancel dialog\'s real source has no pause affordance left to render', () => {
    const src = readFileSync(path.join(__dirname, '..', '..', 'src', 'app', 'me', 'subscription', 'page.tsx'), 'utf8');

    // The old workaround filter is gone — the data layer itself no longer offers 'pause'.
    expect(src).not.toMatch(/filter\(\(alt\) => alt !== 'pause'\)/);
    // No stray hardcoded pause button/label/catalog-key reference anywhere in the file.
    expect(src).not.toMatch(/'pause'/);
    expect(src).not.toMatch(/pauseOption/);
    expect(src.toLowerCase()).not.toMatch(/>\s*pause\b/);
    // The button list still renders directly off the real flow data (not some other hardcoded list).
    expect(src).toMatch(/cancelFlow\.alternatives\.map\(/);
  });
  test('end-of-period cancel HONORS the paid-through date; immediate ends now', () => {
    const end = NOW + 12 * DAY;
    expect(resolveCancellationOutcome('end_of_period', end, NOW).accessUntilIso).toBe(new Date(end).toISOString());
    expect(resolveCancellationOutcome('immediate', end, NOW).accessUntilIso).toBe(new Date(NOW).toISOString());
    // reactivation window stated
    expect(resolveCancellationOutcome('end_of_period', end, NOW).reactivateUntilIso).toBe(
      new Date(end + REACTIVATION_WINDOW_DAYS * DAY).toISOString()
    );
  });

  // T-57 RG8 (i18n; server-i18n-leak) — `finalActionLabel` used to be the hardcoded English
  // literal-type `'Cancel subscription'` with no path to Spanish. It's now resolved via the SAME
  // catalog key (`billing.cancelSubscription`) the trigger button already uses, so a Spanish rep
  // sees the identical, plainly-labeled, non-euphemistic Spanish text for both.
  test('T-57 RG8 — finalActionLabel renders real Spanish, identical to the catalog\'s billing.cancelSubscription key', () => {
    const en = buildCancellationFlow({ openConversations: 0, downgradeAvailable: false, currentPeriodEndMs: null, locale: 'en' });
    const es = buildCancellationFlow({ openConversations: 0, downgradeAvailable: false, currentPeriodEndMs: null, locale: 'es' });
    expect(en.finalActionLabel).toBe('Cancel subscription');
    expect(es.finalActionLabel).toBe('Cancelar suscripción');
    expect(es.finalActionLabel).not.toBe(en.finalActionLabel);
  });

  test('T-57 RG8 — defaults to English (byte-identical to the pre-fix behavior) when locale is omitted', () => {
    const flow = buildCancellationFlow({ openConversations: 0, downgradeAvailable: false, currentPeriodEndMs: null });
    expect(flow.finalActionLabel).toBe('Cancel subscription');
  });
});
