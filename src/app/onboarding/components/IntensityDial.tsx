// uiux §4.9 / §5.1 O-4 — the Intensity Dial. Three positions (Low/Medium/High), each with a
// plain-language consequence panel; requires an EXPLICIT selection (no default pre-selected — an
// intentional commitment act, AC-5.1-3); radiogroup semantics with arrow-key stepping.

import { IntensitySetting } from '@prisma/client';

import styles from '../onboarding.module.css';

interface Position {
  value: IntensitySetting;
  label: string;
  consequence: string;
}

export const INTENSITY_POSITIONS: Position[] = [
  {
    value: IntensitySetting.LOW,
    label: 'Low',
    consequence: 'Your agents draft a little and keep a calm cadence — quiet support in the background.',
  },
  {
    value: IntensitySetting.MEDIUM,
    label: 'Medium',
    consequence: 'A steady daily rhythm: a morning briefing, a focused queue, and gentle follow-ups.',
  },
  {
    value: IntensitySetting.HIGH,
    label: 'High',
    consequence: 'Your agents work harder and faster — more drafts a day, quicker follow-through.',
  },
];

export interface IntensityDialProps {
  value: IntensitySetting | null;
  onChange?: (value: IntensitySetting) => void;
  onContinue?: () => void;
}

export default function IntensityDial({ value, onChange, onContinue }: IntensityDialProps) {
  const selected = INTENSITY_POSITIONS.find((p) => p.value === value) ?? null;

  function step(direction: 1 | -1) {
    const idx = value ? INTENSITY_POSITIONS.findIndex((p) => p.value === value) : 1; // focus Medium first
    const next = Math.min(INTENSITY_POSITIONS.length - 1, Math.max(0, idx + direction));
    onChange?.(INTENSITY_POSITIONS[next].value);
  }

  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>How hard should your agents work while you live your life?</h1>
      <p className={styles.lede}>You can change this any time.</p>

      <div
        className={styles.dial}
        role="radiogroup"
        aria-label="Intensity"
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
              {p.label}
            </button>
          );
        })}
      </div>

      <p className={styles.consequence} aria-live="polite">
        {selected ? selected.consequence : 'Pick a level to see what your agents will and won’t do.'}
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onContinue}
          disabled={!value}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
