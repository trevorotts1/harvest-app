// uiux §5.3 — the explicit end state: "You're done for today." in vision voice, a settling
// `door-done` motif (the `.doneCard` settle animation, reduced-motion-safe), and a streak increment
// with a small Grove leaf mark. This state persists on Today for the rest of the day (AC-5.3-3) —
// ShiftView renders this whenever the server reports `phase === 'DONE'` for today's session, so a
// revisit later the same day lands here again, not back at Open.

import styles from '../shift.module.css';

export interface DoneScreenProps {
  streakCount: number;
  onBackToToday: () => void;
}

export default function DoneScreen({ streakCount, onBackToToday }: DoneScreenProps) {
  return (
    <div className={styles.doneCard} role="status">
      <span aria-hidden="true">🌿</span>
      <p className={styles.doneMessage}>You&rsquo;re done for today.</p>
      <p className={styles.recapLine}>{streakCount}-day streak.</p>
      <button type="button" className={styles.primaryButton} onClick={onBackToToday}>
        Back to your day
      </button>
    </div>
  );
}
