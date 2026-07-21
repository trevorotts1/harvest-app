// uiux §4.10 / §5.1 O-5 — the seven-seed onboarding progress stepper.
//
// Rendered as a list of seven seeds (never numbered — no digit is emitted anywhere in this
// component, which is part of how the Seven Whys UI keeps the resonance score invisible). A seed is
// FILLED once its level is answered-and-passed, PULSES during a caring re-prompt, and is otherwise
// pending. Level names (not indices) are the accessible labels.

import { SEVEN_WHYS_LEVELS, SevenWhysLevel } from '@/services/onboarding/wp01/seven-whys';

import styles from '../onboarding.module.css';
import { useT } from '@/app/locale-context';

// T-R32b — routed through catalog keys instead of hardcoded EN maps (same fix as AnchorHeader's
// momentum-band label / UplineTrack's license-state label): plain object lookups feeding a
// template-literal `aria-label`, never a JSX text/attribute STRING literal, so
// `guard-no-literals-in-components.mjs` cannot see either map — but the accessible name for every
// seed was still unconditionally English regardless of locale.
const LEVEL_LABEL_KEY: Record<SevenWhysLevel, string> = {
  [SevenWhysLevel.GOAL]: 'onboarding.sevenSeedStepper.levels.goal',
  [SevenWhysLevel.URGENCY]: 'onboarding.sevenSeedStepper.levels.urgency',
  [SevenWhysLevel.HISTORY]: 'onboarding.sevenSeedStepper.levels.history',
  [SevenWhysLevel.CHALLENGE]: 'onboarding.sevenSeedStepper.levels.challenge',
  [SevenWhysLevel.FEAR]: 'onboarding.sevenSeedStepper.levels.fear',
  [SevenWhysLevel.TRANSFORMATION]: 'onboarding.sevenSeedStepper.levels.transformation',
  [SevenWhysLevel.COMMITMENT]: 'onboarding.sevenSeedStepper.levels.commitment',
};

export interface SevenSeedStepperProps {
  filledLevels: SevenWhysLevel[];
  pulsingLevel: SevenWhysLevel | null;
}

export default function SevenSeedStepper({ filledLevels, pulsingLevel }: SevenSeedStepperProps) {
  const t = useT();
  const filled = new Set(filledLevels);
  return (
    <ol className={styles.seedRow} aria-label={t('onboarding.sevenSeedStepper.progressAriaLabel')} role="group">
      {SEVEN_WHYS_LEVELS.map((level) => {
        const isFilled = filled.has(level);
        const isPulsing = pulsingLevel === level;
        const state = isFilled
          ? t('onboarding.sevenSeedStepper.state.complete')
          : isPulsing
            ? t('onboarding.sevenSeedStepper.state.pulsing')
            : t('onboarding.sevenSeedStepper.state.notYet');
        const cls = [styles.seed, isFilled ? styles.seedFilled : '', isPulsing ? styles.seedPulse : '']
          .filter(Boolean)
          .join(' ');
        return (
          <li key={level} className={cls} aria-label={`${t(LEVEL_LABEL_KEY[level])}: ${state}`} />
        );
      })}
    </ol>
  );
}
