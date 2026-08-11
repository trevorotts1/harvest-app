// uiux §4.9 / §5.1 O-4 — the Intensity Dial. Three positions (Low/Medium/High), each with a
// plain-language consequence panel; requires an EXPLICIT selection (no default pre-selected — an
// intentional commitment act, AC-5.1-3); radiogroup semantics with arrow-key stepping.
//
// R-10 (master-spec §6 O-4 Flow A (4)) — the spec's O-4 step also defines three goal fields the
// dial used to lack (income goal, weekly time commitment, promotion target); they now render via
// `GoalsFields` ABOVE the dial, on the SAME step, purely additively. The dial's own values/logic
// (R-06 copy included) are untouched; the goal fields are optional and ride the INTENSITY step's
// existing payload/persistence path (see GoalsFields.tsx).

import { IntensitySetting } from '@prisma/client';

import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';
import GoalsFields, { type GoalsFieldsValue } from './GoalsFields';

interface Position {
  value: IntensitySetting;
  labelKey: string;
  /** R-06 — the pre-selection "what each level does" line, visible BEFORE any level is picked. */
  whatKey: string;
  consequenceKey: string;
}

// T-R32b — labels/consequences now route through the catalog (`onboarding.intensityDial.positions.*`)
// instead of a hardcoded EN string per position; `INTENSITY_POSITIONS` itself stays exported (its
// `value` ordering/identity is the load-bearing part — the arrow-key stepping and the
// Medium-focus-first default both index into this array) so no external shape changes.
export const INTENSITY_POSITIONS: Position[] = [
  { value: IntensitySetting.LOW, labelKey: 'onboarding.intensityDial.positions.low.label', whatKey: 'onboarding.intensityDial.positions.low.what', consequenceKey: 'onboarding.intensityDial.positions.low.consequence' },
  { value: IntensitySetting.MEDIUM, labelKey: 'onboarding.intensityDial.positions.medium.label', whatKey: 'onboarding.intensityDial.positions.medium.what', consequenceKey: 'onboarding.intensityDial.positions.medium.consequence' },
  { value: IntensitySetting.HIGH, labelKey: 'onboarding.intensityDial.positions.high.label', whatKey: 'onboarding.intensityDial.positions.high.what', consequenceKey: 'onboarding.intensityDial.positions.high.consequence' },
];

export interface IntensityDialProps {
  value: IntensitySetting | null;
  onChange?: (value: IntensitySetting) => void;
  onContinue?: () => void;
  /** R-10 — the O-4 step's three goal fields (income goal / weekly time / promotion target),
   *  optional; `undefined` renders the step without them (every existing caller and test is
   *  unaffected). */
  goals?: GoalsFieldsValue;
  onGoalsChange?: (value: GoalsFieldsValue) => void;
}

export default function IntensityDial({ value, onChange, onContinue, goals, onGoalsChange }: IntensityDialProps) {
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

      {/* R-10 — the O-4 goal fields render only when the caller supplies them (pure addition to
          the step; the dial below is behaviorally untouched). */}
      {goals && onGoalsChange ? (
        <GoalsFields value={goals} onChange={onGoalsChange} />
      ) : null}

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

      {/* R-06 — every position's description is visible BEFORE selection: the three "what each
          level does" lines render up front; picking a level still adds the full post-pick detail
          panel (the consequence) — the pick-a-level prompt is kept so the unselected state never
          looks like an error. */}
      <ul className={styles.dialWhat}>
        {INTENSITY_POSITIONS.map((p) => (
          <li key={p.value} className={`${styles.dialWhatItem} ${value === p.value ? styles.dialWhatItemSelected : ''}`}>
            <span className={styles.dialWhatLabel}>{t(p.labelKey)}</span>
            <span>{t(p.whatKey)}</span>
          </li>
        ))}
      </ul>

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
