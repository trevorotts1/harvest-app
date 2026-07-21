'use client';

// WP10 (T-47) — the honest lifecycle banner (uiux §5.8 / §4.11). One voice for bad news: the copy
// says whose issue it is without blame theater, promises data safety in suspension, and NEVER
// celebrates a billing event (AC-5.8-9 — payment success is a QUIET confirmation, not a full-bloom).
// role="status" for a11y (uiux §5.8).

import { useLocale } from '@/app/locale-context';
import { formatDate } from '@/lib/i18n/format';
import styles from '../subscription.module.css';
import type { BillingStateView } from '@/types/payment';
import type { Locale } from '@/lib/i18n/locale';

interface BillingBannerProps {
  state: BillingStateView;
  /** Set right after a successful checkout return (quiet confirmation). */
  justPaid: boolean;
}

// T-R32 (§17.5 locale-aware date formatting) — was `toLocaleDateString('en-US', ...)`, hardcoded
// regardless of the rep's chosen locale. Now routes through the shared `formatDate` helper, keyed
// to `LOCALE_BCP47[locale]`; EN output is byte-identical to before.
function fmt(locale: Locale, iso: string | null): string {
  if (!iso) return 'soon';
  return formatDate(locale, iso);
}

export default function BillingBanner({ state, justPaid }: BillingBannerProps) {
  const { locale, t } = useLocale();

  // Quiet payment-success confirmation — deliberately NOT a celebration (AC-5.8-9).
  if (justPaid) {
    return (
      <div className={`${styles.banner} ${styles.bannerQuiet}`} role="status">
        <p className={styles.bannerTitle}>{t('billing.banner.paymentReceivedTitle')}</p>
        <p className={styles.bannerBody}>{t('billing.banner.paymentReceivedBody')}</p>
      </div>
    );
  }

  switch (state.phase) {
    case 'member_grace':
      // Sponsor-lapse cascade (§15.3): the 30-day protection promise, no blame, no instant lock.
      return (
        <div className={`${styles.banner} ${styles.bannerCaution}`} role="status">
          <p className={styles.bannerTitle}>{t('billing.banner.memberGraceTitle')}</p>
          <p className={styles.bannerBody}>{t('billing.banner.memberGraceBody')}</p>
        </div>
      );
    case 'grace':
      return (
        <div className={`${styles.banner} ${styles.bannerCaution}`} role="status">
          <p className={styles.bannerTitle}>{t('billing.banner.graceTitle')}</p>
          <p className={styles.bannerBody}>{t('billing.banner.graceBody')}</p>
        </div>
      );
    case 'soft_suspended':
      return (
        <div className={`${styles.banner} ${styles.bannerBlocked}`} role="status">
          <p className={styles.bannerTitle}>{t('billing.banner.softSuspendedTitle')}</p>
          <p className={styles.bannerBody}>{t('billing.banner.softSuspendedBody')}</p>
        </div>
      );
    case 'disputed':
      return (
        <div className={`${styles.banner} ${styles.bannerBlocked}`} role="status">
          <p className={styles.bannerTitle}>{t('billing.banner.disputedTitle')}</p>
          <p className={styles.bannerBody}>{t('billing.banner.disputedBody')}</p>
        </div>
      );
    case 'canceled_active_until':
      return (
        <div className={`${styles.banner} ${styles.bannerQuiet}`} role="status">
          <p className={styles.bannerTitle}>{t('billing.banner.canceledActiveTitle')}</p>
          <p className={styles.bannerBody}>
            {t('billing.banner.canceledActiveBody', { date: fmt(locale, state.current_period_end) })}
          </p>
        </div>
      );
    default:
      return null;
  }
}
