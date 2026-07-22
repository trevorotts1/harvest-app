// uiux §5.1 O-9 — the First 48 handoff. `gated_complete` fires the 48-hour countdown; the Grove
// plants its seed on-screen; one button lands on Today's First-48 state (AC-5.1-10).
//
// T-R37 — this is the FINAL CTA: `onShowToday` now fires `POST /api/onboarding/complete` (the call
// that actually flips `User.onboarding_status` to `GATED_COMPLETE` and publishes
// `user.onboarding_completed` -> WP10 provisioning) before the caller navigates to `/today`. A failed
// completion must never navigate — the rep would just bounce straight back off the onboarding gate —
// so `submitting`/`error` mirror the exact contract `GdprConsentStep` already established: Continue
// disables while in flight, and a failure renders as an announced (`StatusMessage`) alert with the
// button left enabled again for a retry.

import StatusMessage from '@/components/StatusMessage';
import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

export interface First48HandoffProps {
  onShowToday?: () => void;
  /** True while `POST /api/onboarding/complete` is in flight — disables the CTA against a
   *  double-submit. */
  submitting?: boolean;
  /** A failed completion attempt — surfaced honestly rather than silently navigating anyway. */
  error?: string | null;
}

export default function First48Handoff({ onShowToday, submitting = false, error = null }: First48HandoffProps) {
  const t = useT();
  return (
    <section className={styles.step} aria-labelledby="first48-title">
      <div className={styles.stepInner}>
        <div className={styles.mound} aria-hidden="true" />
        <h1 id="first48-title" className={styles.headline}>
          {t('onboarding.first48Handoff.headline')}
        </h1>
        <p className={styles.lede}>
          {t('onboarding.first48Handoff.lede')}
        </p>
        {error ? <StatusMessage>{error}</StatusMessage> : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnHarvest}`}
            onClick={onShowToday}
            disabled={submitting}
          >
            {t('onboarding.first48Handoff.showTodayCta')}
          </button>
        </div>
      </div>
    </section>
  );
}
