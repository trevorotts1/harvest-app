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
import styles from './subscription.module.css';
import BillingBanner from './components/BillingBanner';
import TierCard, { type TierCardData } from './components/TierCard';
import type { BillingStateView } from '@/types/payment';
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
    if (tier.plan_tier === state.plan_tier && !isSponsored) return null; // current self-serve plan
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
                {cancelFlow.alternatives.map((alt) => (
                  <button
                    key={alt}
                    type="button"
                    className={alt === 'cancel' ? styles.secondaryBtn : styles.actionBtn}
                    onClick={alt === 'cancel' ? () => void confirmCancel() : () => setCancelFlow(null)}
                  >
                    {alt === 'pause'
                      ? t('billing.manage.pauseOption')
                      : alt === 'downgrade'
                        ? t('billing.manage.downgradeOption')
                        : cancelFlow.finalActionLabel}
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
    </main>
  );
}
