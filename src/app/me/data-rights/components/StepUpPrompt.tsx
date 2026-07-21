// T-R29 — the shared enroll/verify/step-up UI stages driven by `useStepUpAction`. Renders nothing
// in the 'idle'/'busy' stages that the caller doesn't already show its own button/status for.

import styles from '../data-rights.module.css';
import type { StepUpStage } from './useStepUpAction';
import { useT } from '@/app/locale-context';

export interface StepUpPromptProps {
  stage: StepUpStage;
  code: string;
  setCode: (code: string) => void;
  otpauthUri: string | null;
  onStartEnroll: () => void;
  onSubmitVerify: () => void;
  onSubmitStepUp: () => void;
  idPrefix: string;
}

export default function StepUpPrompt({
  stage,
  code,
  setCode,
  otpauthUri,
  onStartEnroll,
  onSubmitVerify,
  onSubmitStepUp,
  idPrefix,
}: StepUpPromptProps) {
  const t = useT();
  if (stage === 'need_enroll') {
    return (
      <div className={styles.btnRow}>
        <p className={styles.body}>{t('dataRights.stepUp.needEnrollNotice')}</p>
        <button type="button" className={styles.secondaryBtn} onClick={onStartEnroll}>
          {t('grow.orgSwitch.startEnrollCta')}
        </button>
      </div>
    );
  }

  if (stage === 'need_verify' || stage === 'need_step_up') {
    const inputId = `${idPrefix}-mfa-code`;
    return (
      <div className={styles.btnRow} style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {otpauthUri && stage === 'need_verify' && (
          <p className={styles.meta}>{t('grow.orgSwitch.scanAuthenticatorPrefix')} {otpauthUri}</p>
        )}
        <label className={styles.fieldLabel} htmlFor={inputId}>
          {t('grow.orgSwitch.codeLabel')}
        </label>
        <input
          id={inputId}
          className={styles.codeInput}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          maxLength={6}
        />
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={stage === 'need_verify' ? onSubmitVerify : onSubmitStepUp}
          >
            {t('grow.orgSwitch.confirmCta')}
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'busy') {
    return <p role="status" className={styles.meta}>{t('grow.orgSwitch.workingStatus')}</p>;
  }

  return null;
}
