// uiux §5.1 O-6 — Sponsor. Consumes the wp01 `matchSponsor` outcome (sponsor-matching.ts), which is
// TOTAL: every outcome is either 'linked' or 'waitlisted', and the waitlist ALWAYS carries the $297
// path — never a dead end (AC-5.1-6). "No upline yet" is a first-class completion, not an error.

import type { SponsorMatchOutcome } from '@/services/onboarding/wp01/sponsor-matching';

import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

export interface SponsorStepProps {
  outcome: SponsorMatchOutcome;
  /** Resolve the linked sponsor's display name (kept out of the pure matcher). */
  sponsorName?: string;
  onAccept?: () => void;
  onJoinWaitlist?: () => void;
  onStartPaid?: () => void;
  onNoUplineYet?: () => void;
}

export default function SponsorStep({
  outcome,
  sponsorName,
  onAccept,
  onJoinWaitlist,
  onStartPaid,
  onNoUplineYet,
}: SponsorStepProps) {
  const t = useT();

  if (outcome.kind === 'linked') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.sponsor.linkedHeadline')}</h1>
        <div className={styles.sponsorCard}>
          <p className={styles.label}>{sponsorName ?? t('onboarding.sponsor.fallbackName')}</p>
          <p className={styles.sponsorCovers}>{t('onboarding.sponsor.coversFirstYear')}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onAccept}>
            {t('onboarding.sponsor.acceptCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onNoUplineYet}>
            {t('onboarding.sponsor.noUplineYetCta')}
          </button>
        </div>
      </div>
    );
  }

  // Waitlisted — honest, designed, never a dead end: two equal-weight paths.
  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>{t('onboarding.sponsor.waitlistedHeadline')}</h1>
      <p className={styles.lede}>
        {t('onboarding.sponsor.waitlistedLede')}
      </p>
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onJoinWaitlist}>
          {t('onboarding.sponsor.joinWaitlistCta')}
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onStartPaid}>
          {t('onboarding.sponsor.startPaidCta')}
        </button>
      </div>
      <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onNoUplineYet}>
        {t('onboarding.sponsor.noUplineYetContinueCta')}
      </button>
    </div>
  );
}
