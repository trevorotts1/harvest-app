// uiux §4.10 / §5.1 O-5 — the seven-seed onboarding progress stepper.
//
// Rendered as a list of seven seeds (never numbered — no digit is emitted anywhere in this
// component, which is part of how the Seven Whys UI keeps the resonance score invisible). A seed is
// FILLED once its level is answered-and-passed, PULSES during a caring re-prompt, and is otherwise
// pending. Level names (not indices) are the accessible labels.

import { SEVEN_WHYS_LEVELS, SevenWhysLevel } from '@/services/onboarding/wp01/seven-whys';

import styles from '../onboarding.module.css';

const LEVEL_LABEL: Record<SevenWhysLevel, string> = {
  [SevenWhysLevel.GOAL]: 'Goal',
  [SevenWhysLevel.URGENCY]: 'Urgency',
  [SevenWhysLevel.HISTORY]: 'History',
  [SevenWhysLevel.CHALLENGE]: 'Challenge',
  [SevenWhysLevel.FEAR]: 'Fear',
  [SevenWhysLevel.TRANSFORMATION]: 'Transformation',
  [SevenWhysLevel.COMMITMENT]: 'Commitment',
};

export interface SevenSeedStepperProps {
  filledLevels: SevenWhysLevel[];
  pulsingLevel: SevenWhysLevel | null;
}

export default function SevenSeedStepper({ filledLevels, pulsingLevel }: SevenSeedStepperProps) {
  const filled = new Set(filledLevels);
  return (
    <ol className={styles.seedRow} aria-label="Your why — progress" role="group">
      {SEVEN_WHYS_LEVELS.map((level) => {
        const isFilled = filled.has(level);
        const isPulsing = pulsingLevel === level;
        const state = isFilled ? 'complete' : isPulsing ? 'staying here a little longer' : 'not yet';
        const cls = [styles.seed, isFilled ? styles.seedFilled : '', isPulsing ? styles.seedPulse : '']
          .filter(Boolean)
          .join(' ');
        return (
          <li key={level} className={cls} aria-label={`${LEVEL_LABEL[level]}: ${state}`} />
        );
      })}
    </ol>
  );
}
