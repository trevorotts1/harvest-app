// uiux §4.9 / §5.1 O-4 — the Intensity Dial. Three positions (Low/Medium/High), each with a
// plain-language consequence panel; requires an EXPLICIT selection (no default pre-selected — an
// intentional commitment act, AC-5.1-3); radiogroup semantics with arrow-key stepping.

import { IntensitySetting } from '@prisma/client';

import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

interface Position {
  value: IntensitySetting;
  labelKey: string;
  consequenceKey: string;
}

// T-R32b — labels/consequences now route through the catalog (`onboarding.intensityDial.positions.*`)
// instead of a hardcoded EN string per position; `INTENSITY_POSITIONS` itself stays exported (its
// `value` ordering/identity is the load-bearing part — the arrow-key stepping and the
// Medium-focus-first default both index into this array) so no external shape changes.
export const INTENSITY_POSITIONS: Position[] = [
  { value: IntensitySetting.LOW, labelKey: 'onboarding.intensityDial.positions.low.label', consequenceKey: 'onboarding.intensityDial.positions.low.consequence' },
  { value: IntensitySetting.MEDIUM, labelKey: 'onboarding.intensityDial.positions.medium.label', consequenceKey: 'onboarding.intensityDial.positions.medium.consequence' },
  { value: IntensitySetting.HIGH, labelKey: 'onboarding.intensityDial.positions.high.label', consequenceKey: 'onboarding.intensityDial.positions.high.consequence' },
];

export interface IntensityDialProps {
  value: IntensitySetting | null;
  onChange?: (value: IntensitySetting) => void;
  onContinue?: () => void;
}

export default function IntensityDial({ value, onChange, onContinue }: IntensityDialProps) {
  const t = useT();
  const selected = INTENSITY_POSITIONS.find((p) => p.value === value) ?? null;

  function step(direction: 1 | -1) {
    const idx = value ? INTENSITY_POSITIONS.findIndex((p) => p.value === value) : 1; // focus Medium first
    const next = Math.min(INTENSITY_POSITIONS.length - 1, Math.max(0, idx + direction));
    onChange?.(INTENSITY_POSITIONS[next].value);
  }

  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>{t('onboarding.intensityDial.headline')}</h1>
      <p className={styles.lede}>{t('onboarding.intensityDial.caption')}</p>

      <div
        className={styles.dial}
        role="radiogroup"
        aria-label={t('onboarding.intensityDial.ariaLabel')}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            step(1);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            step(-1);
          }
        }}
      >
        {INTENSITY_POSITIONS.map((p) => {
          const isSel = value === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={isSel}
              tabIndex={isSel || (!value && p.value === IntensitySetting.MEDIUM) ? 0 : -1}
              className={`${styles.dialPos} ${isSel ? styles.dialPosSelected : ''}`}
              onClick={() => onChange?.(p.value)}
            >
              {t(p.labelKey)}
            </button>
          );
        })}
      </div>

      <p className={styles.consequence} aria-live="polite">
        {selected ? t(selected.consequenceKey) : t('onboarding.intensityDial.pickAPrompt')}
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onContinue}
          disabled={!value}
        >
          {t('onboarding.continueCta')}
        </button>
      </div>
    </div>
  );
}
