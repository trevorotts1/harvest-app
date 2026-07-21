'use client';

// WP10 (T-47) — the Subscription surface (uiux §5.8), Me → Subscription. Mounted at /me/subscription,
// which the existing middleware already auth-gates AND onboarding-gates (src/middleware.ts matcher
// `/me/:path*`; §6.10-1 + §15.2 "no billing before onboarding completes"). Renders the three locked
// tiers honestly, the sponsored-member states as first-class, the lifecycle banners, and a
// no-dark-pattern cancellation flow. All data comes from /api/billing/* — no price string is
// hardcoded here (the cards render the server's locked-tier list).

import { useCallback, useEffect, useState } from 'react';

import { useT } from '@/app/locale-context';
import styles from './subscription.module.css';
import BillingBanner from './components/BillingBanner';
import TierCard, { type TierCardData } from './components/TierCard';
import type { BillingStateView } from '@/types/payment';

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

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function SubscriptionPage() {
  const t = useT();
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
        setNotice('Checkout isn’t available right now. Your plan is unaffected — please try again later.');
        return;
      }
      if (!res.ok) {
        setNotice('We couldn’t start checkout. Your plan is unaffected.');
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (body.url) window.location.href = body.url; // Stripe-hosted fields only (SAQ-A).
    } catch {
      setNotice('We couldn’t start checkout. Your plan is unaffected.');
    }
  }, []);

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
      return isSponsored ? null : { label: 'Find a sponsor', onClick: () => (window.location.href = '/onboarding/resume') };
    }
    if (tier.plan_tier === 'individual') {
      return { label: isSponsored ? 'Continue at $297' : 'Start', onClick: () => void startCheckout(isSponsored) };
    }
    // enterprise → contact flow (annual invoice), never checkout (§15.1).
    return { label: 'Talk to us', onClick: () => (window.location.href = 'mailto:support@theharvest.app?subject=Enterprise') };
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
          <h2 className={styles.sectionTitle}>You’re sponsored</h2>
          <p className={styles.tierBody}>
            Covered through {fmt(state.sponsorship_term_end)}
            {state.sponsor_user_id ? ' by your Downline Sponsor.' : '.'} Everything’s included — no
            card on file, nothing to pay.
          </p>
        </section>
      )}

      {/* Anniversary approach (§15.3) — three explicit paths. */}
      {isAnniversary && (
        <section className={`${styles.banner} ${styles.bannerCaution}`} role="status">
          <p className={styles.bannerTitle}>Your sponsored year ends {fmt(state.sponsorship_term_end)}.</p>
          <p className={styles.bannerBody}>Continue under sponsorship if it renews, convert to $297/month, or let it lapse.</p>
          <div className={styles.btnRow}>
            <button type="button" className={styles.actionBtn} onClick={() => void startCheckout(true)}>
              Convert to $297/month
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
          <h2 className={styles.sectionTitle}>Manage plan</h2>
          {!cancelFlow ? (
            <div className={styles.btnRow}>
              <button type="button" className={styles.secondaryBtn} onClick={() => void openCancelFlow()}>
                Cancel subscription
              </button>
            </div>
          ) : (
            <div>
              <p className={styles.tierBody}>Before you go — a few options, all equal:</p>
              <div className={styles.btnRow}>
                {cancelFlow.alternatives.map((alt) => (
                  <button
                    key={alt}
                    type="button"
                    className={alt === 'cancel' ? styles.secondaryBtn : styles.actionBtn}
                    onClick={alt === 'cancel' ? () => void confirmCancel() : () => setCancelFlow(null)}
                  >
                    {alt === 'pause' ? 'Pause (agents rest, data kept)' : alt === 'downgrade' ? 'Downgrade' : cancelFlow.finalActionLabel}
                  </button>
                ))}
              </div>
              <p className={styles.meta}>
                If you cancel, you keep full access until {fmt(cancelFlow.accessUntilIso)}, and you can
                reactivate within {cancelFlow.reactivationWindowDays} days. No need to contact support.
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
