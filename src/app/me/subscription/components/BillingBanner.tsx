'use client';

// WP10 (T-47) — the honest lifecycle banner (uiux §5.8 / §4.11). One voice for bad news: the copy
// says whose issue it is without blame theater, promises data safety in suspension, and NEVER
// celebrates a billing event (AC-5.8-9 — payment success is a QUIET confirmation, not a full-bloom).
// role="status" for a11y (uiux §5.8).

import styles from '../subscription.module.css';
import type { BillingStateView } from '@/types/payment';

interface BillingBannerProps {
  state: BillingStateView;
  /** Set right after a successful checkout return (quiet confirmation). */
  justPaid: boolean;
}

function fmt(iso: string | null): string {
  if (!iso) return 'soon';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function BillingBanner({ state, justPaid }: BillingBannerProps) {
  // Quiet payment-success confirmation — deliberately NOT a celebration (AC-5.8-9).
  if (justPaid) {
    return (
      <div className={`${styles.banner} ${styles.bannerQuiet}`} role="status">
        <p className={styles.bannerTitle}>Payment received</p>
        <p className={styles.bannerBody}>Your plan is active. Thanks — back to the field.</p>
      </div>
    );
  }

  switch (state.phase) {
    case 'member_grace':
      // Sponsor-lapse cascade (§15.3): the 30-day protection promise, no blame, no instant lock.
      return (
        <div className={`${styles.banner} ${styles.bannerCaution}`} role="status">
          <p className={styles.bannerTitle}>Your sponsor&apos;s payment needs attention.</p>
          <p className={styles.bannerBody}>
            Nothing changes for you for 30 days. We&apos;ve let them and your RVP know. You can
            continue at $297/month or find a new sponsor whenever you&apos;re ready.
          </p>
        </div>
      );
    case 'grace':
      return (
        <div className={`${styles.banner} ${styles.bannerCaution}`} role="status">
          <p className={styles.bannerTitle}>Your payment didn&apos;t go through.</p>
          <p className={styles.bannerBody}>
            Everything still works. Update your payment method to keep your plan active.
          </p>
        </div>
      );
    case 'soft_suspended':
      return (
        <div className={`${styles.banner} ${styles.bannerBlocked}`} role="status">
          <p className={styles.bannerTitle}>Your agents are resting until billing is settled.</p>
          <p className={styles.bannerBody}>
            They finished their open conversations. Your data is exactly as you left it. Update your
            payment and everything comes right back.
          </p>
        </div>
      );
    case 'disputed':
      return (
        <div className={`${styles.banner} ${styles.bannerBlocked}`} role="status">
          <p className={styles.bannerTitle}>A payment dispute paused outbound messaging.</p>
          <p className={styles.bannerBody}>Reading and exporting still work while we sort it out.</p>
        </div>
      );
    case 'canceled_active_until':
      return (
        <div className={`${styles.banner} ${styles.bannerQuiet}`} role="status">
          <p className={styles.bannerTitle}>Your plan is set to end.</p>
          <p className={styles.bannerBody}>
            You have full access until {fmt(state.current_period_end)}. You can reactivate any time
            before then.
          </p>
        </div>
      );
    default:
      return null;
  }
}
