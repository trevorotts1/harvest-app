// R-10 (refinements catalog 2026-07-28; master-spec §6 O-4 Flow A (4)) — the three goal fields the
// spec's O-4 "Goals & intensity" step defines alongside the intensity dial, which are NEW in this
// build: (1) income goal — a monthly target in whole USD; (2) weekly time commitment — the hours
// per week the rep will give the business (the spec's baseline is 30 min/day = 3.5 hrs/week); (3)
// promotion target — the level they are working toward, from the canonical role/level vocabulary
// (`PROMOTION_TARGET_LEVELS`, the SAME ladder the O-1 registration wizard offers — see
// src/types/onboarding.ts). All three are OPTIONAL (a rep may leave any or all unset), and this
// component is a pure controlled UI surface: it never validates (the server's `validateStep`
// R-10 branch owns the fail-closed format gates) and never persists (the values ride the existing
// INTENSITY step payload — `buildIntensityDataPayload` in onboarding-step-client.ts — into the
// session's `intensity_data` JSON, exactly like the dial's own selection).
//
// All copy routes through the i18n catalog (`onboarding.intensityDial.goalsField.*`) — including
// the promotion-level labels, which are the O-1 auth wizard's own ladder strings
// (`auth.primerica.level.*` labels, mirrored here) so a universal (non-Primerica) rep sees the
// same level names with ZERO Primerica strings on this universal step (org-gate/leak law). The
// intensity dial itself (R-06 copy) is untouched — this component only ADDS to the step.

import { PROMOTION_TARGET_LEVELS, type PromotionTargetLevel } from '@/types/onboarding';

import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

export interface GoalsFieldsValue {
  /** Monthly income goal in whole USD; `null` = not set. */
  monthlyIncomeGoal: number | null;
  /** Weekly time commitment in hours; `null` = not set. */
  weeklyTimeCommitment: number | null;
  /** Promotion/level target from `PROMOTION_TARGET_LEVELS`; `null` = not set. */
  promotionTarget: PromotionTargetLevel | null;
}

export const EMPTY_GOALS_FIELDS: GoalsFieldsValue = {
  monthlyIncomeGoal: null,
  weeklyTimeCommitment: null,
  promotionTarget: null,
};

export interface GoalsFieldsProps {
  value: GoalsFieldsValue;
  onChange: (value: GoalsFieldsValue) => void;
}

export default function GoalsFields({ value, onChange }: GoalsFieldsProps) {
  const t = useT();

  const setIncome = (raw: string) =>
    onChange({ ...value, monthlyIncomeGoal: raw.trim() === '' ? null : Number(raw) });

  const setTime = (raw: string) =>
    onChange({ ...value, weeklyTimeCommitment: raw.trim() === '' ? null : Number(raw) });

  const setTarget = (raw: string) =>
    onChange({ ...value, promotionTarget: raw === '' ? null : (raw as PromotionTargetLevel) });

  return (
    <section className={styles.goalsField} aria-label={t('onboarding.intensityDial.goalsField.heading')}>
      <h2 className={styles.goalsFieldHeading}>{t('onboarding.intensityDial.goalsField.heading')}</h2>
      <p className={styles.goalsFieldHint}>{t('onboarding.intensityDial.goalsField.headingHint')}</p>

      <div className={styles.goalsRow}>
        <label className={styles.goalsInputWrap}>
          <span>{t('onboarding.intensityDial.goalsField.incomeLabel')}</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="1000000"
            step="1"
            value={value.monthlyIncomeGoal === null ? '' : value.monthlyIncomeGoal}
            onChange={(e) => setIncome(e.target.value)}
            placeholder={t('onboarding.intensityDial.goalsField.incomePlaceholder')}
            aria-describedby="goals-income-suffix"
          />
          <span id="goals-income-suffix">{t('onboarding.intensityDial.goalsField.incomeSuffix')}</span>
        </label>

        <label className={styles.goalsInputWrap}>
          <span>{t('onboarding.intensityDial.goalsField.timeLabel')}</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="168"
            step="0.5"
            value={value.weeklyTimeCommitment === null ? '' : value.weeklyTimeCommitment}
            onChange={(e) => setTime(e.target.value)}
            placeholder={t('onboarding.intensityDial.goalsField.timePlaceholder')}
            aria-describedby="goals-time-suffix"
          />
          <span id="goals-time-suffix">{t('onboarding.intensityDial.goalsField.timeSuffix')}</span>
        </label>

        <label className={styles.goalsInputWrap}>
          <span>{t('onboarding.intensityDial.goalsField.promotionLabel')}</span>
          <select
            className={styles.goalsSelect}
            value={value.promotionTarget ?? ''}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">{t('onboarding.intensityDial.goalsField.promotionDefault')}</option>
            {PROMOTION_TARGET_LEVELS.map((level) => (
              <option key={level} value={level}>
                {t(`onboarding.intensityDial.goalsField.promotionOptions.${level}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
