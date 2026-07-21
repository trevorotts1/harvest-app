// uiux §5.1 O-7 — Contact import with progressive permission. THREE beats BEFORE any OS dialog
// (AC-5.1-7): (1) value, (2) outcome preview, (3) then the OS request. Denial is graceful:
// CSV / manual add, never a dead end, and a later re-ask is registered.

import styles from '../onboarding.module.css';

export type ImportBeat = 'value' | 'preview' | 'permission' | 'denied';

export interface ContactImportStepProps {
  beat: ImportBeat;
  onAdvance?: () => void;
  onRequestPermission?: () => void;
  onDeny?: () => void;
  onUseCsv?: () => void;
  onAddManually?: () => void;
  /** T-R30 (parity GAP 1): true while a real CSV import (file picker → Vault ingestion) is
   *  in flight — relabels the CSV button and disables it against a double-submit. */
  csvImporting?: boolean;
  /** T-R30 (parity GAP 1): a real import failure (oversized file, network error, etc.) — surfaced
   *  as an alert rather than silently faking success. */
  csvError?: string | null;
}

export default function ContactImportStep({
  beat,
  onAdvance,
  onRequestPermission,
  onDeny,
  onUseCsv,
  onAddManually,
  csvImporting = false,
  csvError = null,
}: ContactImportStepProps) {
  if (beat === 'value') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>Your community is your field</h1>
        <p className={styles.lede}>The Harvest works from the people who already know you.</p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onAdvance}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (beat === 'preview') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>Here&rsquo;s what we&rsquo;ll do</h1>
        <div className={styles.card} aria-hidden="true">
          <p className={styles.lede}>
            We&rsquo;ll organize them into plots and show you what your field could yield.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onRequestPermission}>
            Connect my contacts
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onDeny}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  if (beat === 'denied') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>No problem.</h1>
        <p className={styles.lede}>Add people by CSV or one at a time — we&rsquo;ll ask again later.</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={onUseCsv}
            disabled={csvImporting}
          >
            {csvImporting ? 'Importing…' : 'Import a CSV'}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onAddManually}>
            Add one at a time
          </button>
        </div>
        {csvError && <p role="alert">{csvError}</p>}
      </div>
    );
  }

  // 'permission' — the OS dialog moment (native); on web, the CSV/Google path is offered.
  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>Bringing in your community…</h1>
      <p className={styles.lede} aria-live="polite">
        Allow access and we&rsquo;ll organize everyone into plots.
      </p>
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onAdvance}>
          Continue
        </button>
      </div>
    </div>
  );
}
