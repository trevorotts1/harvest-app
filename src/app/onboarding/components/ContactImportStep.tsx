// uiux §5.1 O-7 — Contact import with progressive permission. THREE beats BEFORE any OS dialog
// (AC-5.1-7): (1) value, (2) outcome preview, (3) then the OS request. Denial is graceful:
// CSV / manual add, never a dead end, and a later re-ask is registered.

import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

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
  const t = useT();

  if (beat === 'value') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.contactImport.value.headline')}</h1>
        <p className={styles.lede}>{t('onboarding.contactImport.value.lede')}</p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onAdvance}>
            {t('onboarding.continueCta')}
          </button>
        </div>
      </div>
    );
  }

  if (beat === 'preview') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.contactImport.preview.headline')}</h1>
        <div className={styles.card} aria-hidden="true">
          <p className={styles.lede}>
            {t('onboarding.contactImport.preview.lede')}
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onRequestPermission}>
            {t('onboarding.contactImport.preview.connectCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onDeny}>
            {t('onboarding.contactImport.preview.notNowCta')}
          </button>
        </div>
      </div>
    );
  }

  if (beat === 'denied') {
    return (
      <div className={styles.stepInner}>
        <h1 className={styles.headline}>{t('onboarding.contactImport.denied.headline')}</h1>
        <p className={styles.lede}>{t('onboarding.contactImport.denied.lede')}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={onUseCsv}
            disabled={csvImporting}
          >
            {csvImporting ? t('onboarding.contactImport.denied.importingCta') : t('onboarding.contactImport.denied.importCsvCta')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onAddManually}>
            {t('onboarding.contactImport.denied.addManuallyCta')}
          </button>
        </div>
        {csvError && <p role="alert">{csvError}</p>}
      </div>
    );
  }

  // 'permission' — the OS dialog moment (native); on web, the CSV/Google path is offered.
  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>{t('onboarding.contactImport.permission.headline')}</h1>
      <p className={styles.lede} aria-live="polite">
        {t('onboarding.contactImport.permission.lede')}
      </p>
      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onAdvance}>
          {t('onboarding.continueCta')}
        </button>
      </div>
    </div>
  );
}
