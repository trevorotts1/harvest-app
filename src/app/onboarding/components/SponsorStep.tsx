// uiux §5.1 O-6 — Sponsor. Consumes the wp01 `matchSponsor` outcome (sponsor-matching.ts), which is
// TOTAL: every outcome is either 'linked' or 'waitlisted', and the waitlist ALWAYS carries the $297
// path — never a dead end (AC-5.1-6). "No upline yet" is a first-class completion, not an error.

import type { SponsorMatchOutcome } from '@/services/onboarding/wp01/sponsor-matching';

import styles from '../onboarding.module.css';

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
  if (outcome.kind === 'linked') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>We found your Downline Sponsor</h1>
        <div className={styles.sponsorCard}>
          <p className={styles.label}>{sponsorName ?? 'Your sponsor'}</p>
          <p className={styles.sponsorCovers}>Covers your first year — $0 to you.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onAccept}>
            Accept
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onNoUplineYet}>
            No upline yet
          </button>
        </div>
      </div>
    );
  }

  // Waitlisted — honest, designed, never a dead end: two equal-weight paths.
  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>No sponsor is available for your organization right now</h1>
      <p className={styles.lede}>
        Join the waitlist and we&rsquo;ll match you the moment a sponsor opens up — or start today.
      </p>
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onJoinWaitlist}>
          Join the waitlist
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onStartPaid}>
          Start today for $297/month
        </button>
      </div>
      <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onNoUplineYet}>
        No upline yet — continue
      </button>
    </div>
  );
}
