'use client';

// WP10 (T-47) — the Subscription surface (uiux §5.8), Me → Subscription. Mounted at /me/subscription,
// which the existing middleware already auth-gates AND onboarding-gates (src/middleware.ts matcher
// `/me/:path*`; §6.10-1 + §15.2 "no billing before onboarding completes"). Renders the three locked
// tiers honestly, the sponsored-member states as first-class, the lifecycle banners, and a
// no-dark-pattern cancellation flow. All data comes from /api/billing/* — no price string is
// hardcoded here (the cards render the server's locked-tier list).

import { useCallback, useEffect, useState } from 'react';

import { useLocale } from '@/app/locale-context';
import { formatDate } from '@/lib/i18n/format';
import { StatusMessage } from '@/components/StatusMessage';
import styles from './subscription.module.css';
import BillingBanner from './components/BillingBanner';
import TierCard, { type TierCardData } from './components/TierCard';
import type { BillingCycle, BillingStateView, PlanTier } from '@/types/payment';
import type { Locale } from '@/lib/i18n/locale';

interface SubscriptionResponse {
  state: BillingStateView;
  tiers: TierCardData[];
  checkoutAvailable: boolean;
}

interface CancelFlow {
  alternatives: string[];
  finalActionLabel: string;
  accessUntilIso: string | null;
  reactivationWindowDays: number;
  requiresSupportContact: boolean;
}

// T-R41 — the GET /api/billing/change proration preview, held client-side between "preview" and
// "confirm" (§15.4 "the exact amount before confirm"). Only `summary` (the server's already-
// localized, human-readable sentence — proration.ts's `computeProration`) is rendered; the route's
// full ProrationPreview shape carries other numeric fields this surface doesn't need to duplicate.
interface ChangePreview {
  tier: PlanTier;
  cycle: BillingCycle;
  summary: string;
  /** True when this preview came from the cancel-flow's "Downgrade" alternative, so confirming it
   *  also closes that dialog instead of leaving it open behind the change panel. */
  fromCancelFlow: boolean;
}

type Load = 'loading' | 'ready' | 'failed';

// T-R32 (§17.5 locale-aware date formatting) — was `toLocaleDateString('en-US', ...)`, hardcoded
// regardless of the rep's chosen locale. Routes through the shared `formatDate` helper now;
// EN output is byte-identical to before.
function fmt(locale: Locale, iso: string | null): string {
  return formatDate(locale, iso);
}

export default function SubscriptionPage() {
  const { locale, t } = useLocale();
  const [load, setLoad] = useState<Load>('loading');
  const [data, setData] = useState<SubscriptionResponse | null>(null);
  const [justPaid, setJustPaid] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelFlow, setCancelFlow] = useState<CancelFlow | null>(null);
  const [changePreview, setChangePreview] = useState<ChangePreview | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);

  const fetchState = useCallback(async () => {
    setLoad('loading');
    try {
      const res = await fetch('/api/billing/subscription');
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as SubscriptionResponse);
      setLoad('ready');
    } catch {
      setLoad('failed');
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('checkout=success')) {
      setJustPaid(true);
    }
    void fetchState();
  }, [fetchState]);

  const startCheckout = useCallback(async (convert: boolean) => {
    setNotice(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'individual', cycle: 'monthly', convert }),
      });
      if (res.status === 503) {
        setNotice(t('billing.checkoutUnavailable'));
        return;
      }
      if (!res.ok) {
        setNotice(t('billing.checkoutFailed'));
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (body.url) window.location.href = body.url; // Stripe-hosted fields only (SAQ-A).
    } catch {
      setNotice(t('billing.checkoutFailed'));
    }
  }, [t]);

  const openCancelFlow = useCallback(async () => {
    const res = await fetch('/api/billing/cancel');
    if (res.ok) {
      const body = (await res.json()) as { flow: CancelFlow };
      setCancelFlow(body.flow);
    }
  }, []);

  const confirmCancel = useCallback(async () => {
    const res = await fetch('/api/billing/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'end_of_period' }),
    });
    if (res.ok) {
      setCancelFlow(null);
      await fetchState();
    }
  }, [fetchState]);

  // T-R41 — mid-cycle plan/cycle change. GET the exact proration BEFORE any confirm (§15.4 /
  // AC-5.8-7 — no surprise charge, no dark pattern), then POST only once the rep explicitly
  // confirms. `fromCancelFlow` lets the cancel dialog's "Downgrade" alternative reuse this SAME
  // preview→confirm flow instead of a second, parallel one.
  const previewChange = useCallback(
    async (tier: PlanTier, cycle: BillingCycle, fromCancelFlow: boolean) => {
      setChangeError(null);
      setChangeBusy(true);
      try {
        const res = await fetch(`/api/billing/change?tier=${tier}&cycle=${cycle}`);
        if (!res.ok) {
          setChangeError(t('billing.change.previewFailed'));
          return;
        }
        const body = (await res.json()) as { proration: { summary: string } };
        setChangePreview({ tier, cycle, summary: body.proration.summary, fromCancelFlow });
      } catch {
        setChangeError(t('billing.change.previewFailed'));
      } finally {
        setChangeBusy(false);
      }
    },
    [t]
  );

  const dismissChange = useCallback(() => {
    setChangePreview(null);
    setChangeError(null);
  }, []);

  // FAIL-CLOSED (T-R41): a non-OK response surfaces the honest error and leaves the preview open
  // for retry/dismiss — it NEVER closes the panel or refetches as if the change had applied. Only
  // a real 2xx triggers `fetchState()`, so the rendered plan/cycle always reflects what actually
  // persisted, never an optimistic guess.
  const confirmChange = useCallback(async () => {
    if (!changePreview) return;
    setChangeBusy(true);
    setChangeError(null);
    try {
      const res = await fetch('/api/billing/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: changePreview.tier, cycle: changePreview.cycle }),
      });
      if (!res.ok) {
        setChangeError(t('billing.change.applyFailed'));
        return;
      }
      const cameFromCancelFlow = changePreview.fromCancelFlow;
      setChangePreview(null);
      if (cameFromCancelFlow) setCancelFlow(null);
      await fetchState(); // reflect the REAL persisted plan/cycle — never an optimistic update.
    } catch {
      setChangeError(t('billing.change.applyFailed'));
    } finally {
      setChangeBusy(false);
    }
  }, [changePreview, fetchState, t]);

  if (load === 'loading') {
    return (
      <main className={styles.page}>
        <p className={styles.loading}>{t('billing.loading')}</p>
      </main>
    );
  }

  if (load === 'failed' || !data) {
    // Never guess a state (uiux §5.8 error state) — the plan is unaffected.
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>{t('billing.heading')}</h1>
        <div className={`${styles.banner} ${styles.bannerQuiet}`} role="status">
          <p className={styles.bannerTitle}>{t('billing.unreachable')}</p>
          <p className={styles.bannerBody}>{t('billing.planUnaffected')}</p>
          <div className={styles.btnRow}>
            <button type="button" className={styles.secondaryBtn} onClick={() => void fetchState()}>
              {t('billing.retry')}
            </button>
          </div>
        </div>
      </main>
    );
  }

  const { state, tiers } = data;
  const isSponsored = state.plan_tier === 'free' || !!state.sponsorship_state;
  const isAnniversary = state.sponsorship_state === 'ANNIVERSARY_PENDING';

  // CTA per card, keyed off the current plan + phase (sponsored members never see card entry except
  // an explicit convert — AC-5.8-2).
  const ctaFor = (tier: TierCardData): { label: string; onClick: () => void } | null => {
    if (tier.plan_tier === state.plan_tier && !isSponsored) {
      // T-R41 — the one real affordance on the CURRENT self-serve plan's own card: switch billing
      // cycle via the real GET-preview/POST-apply change flow. Individual is the only tier that
      // ever has two cycles to switch between (tiers.ts: enterprise is annual-only, free never
      // collects payment) — so this never renders for those cards.
      if (tier.plan_tier === 'individual' && state.billing_cycle) {
        const nextCycle: BillingCycle = state.billing_cycle === 'monthly' ? 'annual' : 'monthly';
        const label = nextCycle === 'annual' ? t('billing.switchToAnnual') : t('billing.switchToMonthly');
        return { label, onClick: () => void previewChange('individual', nextCycle, false) };
      }
      return null; // current self-serve plan, nothing else to change here
    }
    if (tier.plan_tier === 'free') {
      return isSponsored ? null : { label: t('billing.findASponsor'), onClick: () => (window.location.href = '/onboarding/resume') };
    }
    if (tier.plan_tier === 'individual') {
      return { label: isSponsored ? t('billing.continueAt297') : t('billing.start'), onClick: () => void startCheckout(isSponsored) };
    }
    // enterprise → contact flow (annual invoice), never checkout (§15.1).
    return { label: t('billing.talkToUs'), onClick: () => (window.location.href = 'mailto:support@theharvest.app?subject=Enterprise') };
  };

  return (
    <main className={styles.page}>
      <header>
        <h1 className={styles.heading}>{t('billing.heading')}</h1>
        <p className={styles.subhead}>{t('billing.subhead')}</p>
      </header>

      <BillingBanner state={state} justPaid={justPaid} />

      {notice && (
        <div className={`${styles.banner} ${styles.bannerQuiet}`} role="status">
          <p className={styles.bannerBody}>{notice}</p>
        </div>
      )}

      {/* Sponsored active state card (uiux §5.8) — sponsor identity, covered-through, NO card entry. */}
      {isSponsored && state.sponsorship_state === 'ACTIVE' && (
        <section className={styles.stateCard}>
          <h2 className={styles.sectionTitle}>{t('billing.sponsoredHeading')}</h2>
          <p className={styles.tierBody}>
            {state.sponsor_user_id
              ? t('billing.sponsored.coveredThroughWithSponsor', { date: fmt(locale, state.sponsorship_term_end) })
              : t('billing.sponsored.coveredThroughNoSponsor', { date: fmt(locale, state.sponsorship_term_end) })}
            {' '}
            {t('billing.sponsored.everythingIncluded')}
          </p>
        </section>
      )}

      {/* Anniversary approach (§15.3) — three explicit paths. */}
      {isAnniversary && (
        <section className={`${styles.banner} ${styles.bannerCaution}`} role="status">
          <p className={styles.bannerTitle}>
            {t('billing.anniversary.endsOn', { date: fmt(locale, state.sponsorship_term_end) })}
          </p>
          <p className={styles.bannerBody}>{t('billing.anniversary.body')}</p>
          <div className={styles.btnRow}>
            <button type="button" className={styles.actionBtn} onClick={() => void startCheckout(true)}>
              {t('billing.anniversary.convertCta')}
            </button>
          </div>
        </section>
      )}

      {/* The three locked tiers, equal visual weight. */}
      <section className={styles.tierGrid}>
        {tiers.map((tier) => (
          <TierCard
            key={tier.plan_tier}
            tier={tier}
            isCurrent={tier.plan_tier === state.plan_tier}
            cta={ctaFor(tier)}
          />
        ))}
      </section>

      {/* No-dark-pattern cancellation (AC-5.8-6): only for a self-serve paying subscriber. */}
      {!isSponsored && (state.plan_tier === 'individual' || state.plan_tier === 'enterprise') && (
        <section className={styles.stateCard}>
          <h2 className={styles.sectionTitle}>{t('billing.manage.heading')}</h2>
          {!cancelFlow ? (
            <div className={styles.btnRow}>
              <button type="button" className={styles.secondaryBtn} onClick={() => void openCancelFlow()}>
                {t('billing.cancelSubscription')}
              </button>
            </div>
          ) : (
            <div>
              <p className={styles.tierBody}>{t('billing.cancelIntro')}</p>
              <div className={styles.btnRow}>
                {/* T-R41 — "pause" is REMOVED from the rendered alternatives here (not just left as
                    an inert click-through). SubscriptionService/the Subscription/Sponsorship Prisma
                    models have no pause capability at all — no PAUSED status, no pause method
                    (confirmed against prisma/schema.prisma's SubscriptionStatus enum and
                    subscription.service.ts) — so a clickable "Pause" button would be a dark
                    pattern: offering a retention alternative that cannot actually be honored.
                    `cancellation.ts`'s `buildCancellationFlow` still returns 'pause' in
                    `alternatives` (kept — tests/unit/payment-lifecycle.test.ts and the
                    `billing.manage.pauseOption` catalog key/i18n test both assert on it, and the
                    ticket says never weaken an existing test), so this filters it out at the ONE
                    place it would otherwise render as a button. "downgrade" now wires to the SAME
                    real preview→confirm change flow the plan cards use (below), instead of just
                    closing the dialog. */}
                {cancelFlow.alternatives
                  .filter((alt) => alt !== 'pause')
                  .map((alt) => (
                    <button
                      key={alt}
                      type="button"
                      className={alt === 'cancel' ? styles.secondaryBtn : styles.actionBtn}
                      onClick={
                        alt === 'cancel'
                          ? () => void confirmCancel()
                          : alt === 'downgrade'
                            ? () => void previewChange('individual', 'monthly', true)
                            : () => setCancelFlow(null)
                      }
                    >
                      {alt === 'downgrade' ? t('billing.manage.downgradeOption') : cancelFlow.finalActionLabel}
                    </button>
                  ))}
              </div>
              <p className={styles.meta}>
                {t('billing.manage.accessUntil', {
                  date: fmt(locale, cancelFlow.accessUntilIso),
                  days: cancelFlow.reactivationWindowDays,
                })}
              </p>
            </div>
          )}
        </section>
      )}

      {/* T-R41 — the change/downgrade preview→confirm panel. Shared by the plan-card cycle-switch
          CTA and the cancel-flow's "Downgrade" alternative. The exact proration amount is shown
          BEFORE confirm (§15.4 / AC-5.8-7); a failed apply surfaces honestly via StatusMessage and
          leaves the preview open — never a fake success, never an optimistic plan swap. */}
      {(changePreview || changeError) && (
        <section className={styles.stateCard}>
          <h2 className={styles.sectionTitle}>{t('billing.change.heading')}</h2>
          {/* The preview may be absent when the INITIAL GET itself failed (e.g. a network error) —
              there is then nothing to confirm, only the honest error + a way to dismiss it. */}
          {changePreview && <p className={styles.tierBody}>{changePreview.summary}</p>}
          {changeError && <StatusMessage className={styles.meta}>{changeError}</StatusMessage>}
          <div className={styles.btnRow}>
            {changePreview && (
              <button type="button" className={styles.actionBtn} onClick={() => void confirmChange()} disabled={changeBusy}>
                {changeBusy ? t('billing.change.workingStatus') : t('billing.change.confirmCta')}
              </button>
            )}
            <button type="button" className={styles.secondaryBtn} onClick={dismissChange} disabled={changeBusy}>
              {t('billing.change.notNowCta')}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
