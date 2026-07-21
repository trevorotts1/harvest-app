// uiux §5.3 — Open (one screen): briefing recap (3 lines max), streak status, one anchor-tied
// motivational line, the two ratio cards (§9.5 item 5), grace-day repair surfaced automatically
// (AC-5.3-6), and "Begin."

import type { LearningStateView, ShiftMode } from '@/types/learning-state';
import RatioCard from './RatioCard';
import styles from '../shift.module.css';
import { useT } from '@/app/locale-context';

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
  const t = useT();
  return (
    <div className={styles.card}>
      {briefingLines.slice(0, 3).map((line, i) => (
        <p key={i} className={styles.briefingLine}>
          {line}
        </p>
      ))}

      <div className={styles.streakRow}>
        <span className={styles.streakBadge}>{t('shift.openPhase.streakBadge', { count: streakCount })}</span>
        {mode === 'SHORT' ? <span className={styles.streakBadge}>{t('shift.openPhase.shortModeBadge')}</span> : null}
      </div>

      {graceDayOffer ? (
        <p className={styles.graceDayBanner}>
          {t('shift.openPhase.graceDayBanner')}
        </p>
      ) : null}

      <p className={styles.motivationalLine}>{motivationalLine}</p>

      {learningState ? (
        <div className={styles.ratioGrid}>
          <RatioCard title={t('today.ratioCards.agentRatioTitle')} view={learningState.agentRatio} />
          <RatioCard title={t('today.ratioCards.fieldTrainerRatioTitle')} view={learningState.fieldTrainerRatio} />
        </div>
      ) : null}

      <button type="button" className={styles.primaryButton} onClick={onBegin}>
        {t('shift.openPhase.beginCta')}
      </button>
    </div>
  );
}
