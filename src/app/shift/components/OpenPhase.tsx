// uiux §5.3 — Open (one screen): briefing recap (3 lines max), streak status, one anchor-tied
// motivational line, the two ratio cards (§9.5 item 5), grace-day repair surfaced automatically
// (AC-5.3-6), and "Begin."

import type { LearningStateView, ShiftMode } from '@/types/learning-state';
import RatioCard from './RatioCard';
import styles from '../shift.module.css';

export interface OpenPhaseProps {
  briefingLines: string[];
  motivationalLine: string;
  streakCount: number;
  graceDayOffer: boolean;
  mode: ShiftMode;
  learningState: LearningStateView | null;
  onBegin: () => void;
}

export default function OpenPhase({
  briefingLines,
  motivationalLine,
  streakCount,
  graceDayOffer,
  mode,
  learningState,
  onBegin,
}: OpenPhaseProps) {
  return (
    <div className={styles.card}>
      {briefingLines.slice(0, 3).map((line, i) => (
        <p key={i} className={styles.briefingLine}>
          {line}
        </p>
      ))}

      <div className={styles.streakRow}>
        <span className={styles.streakBadge}>{streakCount}-day streak</span>
        {mode === 'SHORT' ? <span className={styles.streakBadge}>10 focused minutes</span> : null}
      </div>

      {graceDayOffer ? (
        <p className={styles.graceDayBanner}>
          Life happened. Your streak is safe — one grace day used.
        </p>
      ) : null}

      <p className={styles.motivationalLine}>{motivationalLine}</p>

      {learningState ? (
        <div className={styles.ratioGrid}>
          <RatioCard title="Agent's Ratio" view={learningState.agentRatio} />
          <RatioCard title="Field Trainer's Ratio" view={learningState.fieldTrainerRatio} />
        </div>
      ) : null}

      <button type="button" className={styles.primaryButton} onClick={onBegin}>
        Begin
      </button>
    </div>
  );
}
