// uiux §5.3 — the explicit end state: "You're done for today." in vision voice, a settling
// `door-done` motif (the `.doneCard` settle animation, reduced-motion-safe), and a streak increment
// with a small Grove leaf mark. This state persists on Today for the rest of the day (AC-5.3-3) —
// ShiftView renders this whenever the server reports `phase === 'DONE'` for today's session, so a
// revisit later the same day lands here again, not back at Open.

import styles from '../shift.module.css';
import { recapLine } from './ClosePhase';
import { useT } from '@/app/locale-context';

export interface DoneScreenProps {
  streakCount: number;
  /** T-52 (WCAG 2.2 AA §17.4 / uiux §6.1 item 5) — the same recap ClosePhase showed just before
   *  this screen (`ShiftStateView.recap` stays populated for both CLOSE and DONE, see
   *  shift.service.ts's `toView`), so the "Shift close" narration script below can name it.
   *  Optional/nullable so existing callers/tests that predate this addition keep compiling and
   *  behaving identically — `recapLine`'s own honest fallback ("Nothing needed you today — your
   *  field is working.") covers the omitted case. */
  recap?: { approvals: number; confirmations: number; logs: number } | null;
  onBackToToday: () => void;
}

export default function DoneScreen({ streakCount, recap, onBackToToday }: DoneScreenProps) {
  const t = useT();
  // uiux §6.1 item 5 "The Shift close" narration script, verbatim: "You're done for today.
  // {recap line}. Your agents take it from here." `recapLine` (ClosePhase.tsx) already appends
  // "Your agents take it from here." itself, so no separate trailer is composed here.
  const srUtterance = `${t('shift.doneScreen.doneMessage')} ${recapLine(recap ?? null, t)}`;

  return (
    <div className={styles.doneCard} role="status">
      {/* Visible composition — decorative to screen readers; the single combined utterance below
          (same one-utterance pattern as HiddenEarningsReveal.tsx §6.1 O-8) is authoritative, so the
          streak/recap story is never announced twice. The button stays OUTSIDE this aria-hidden
          group — it must remain independently focusable/operable, never hidden from AT. */}
      <div aria-hidden="true">
        <span aria-hidden="true">🌿</span>
        <p className={styles.doneMessage}>{t('shift.doneScreen.doneMessage')}</p>
        <p className={styles.recapLine}>{t('shift.doneScreen.streakLine', { count: streakCount })}</p>
      </div>
      <p className={styles.srOnly}>{srUtterance}</p>
      <button type="button" className={styles.primaryButton} onClick={onBackToToday}>
        {t('shift.doneScreen.backToTodayCta')}
      </button>
    </div>
  );
}
