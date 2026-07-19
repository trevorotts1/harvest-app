// uiux §5.3 — Work (card stack): the action queue in focus mode, ONE CARD AT A TIME (AC-5.3-1);
// approve-with-inline-edit / respond-to-flagged / confirm-appointment-windows / log-introductions /
// mark-attendance card types; skip moves an item to the end of the stack once, twice-skipped items
// leave the Shift (handled server-side, ShiftService.buildCandidateStack). The shift timer counts
// UP (mm:ss, tabular, quiet soil color) and NEVER renders an alarm/red/overtime state (AC-5.3-2) —
// this component contains no conditional styling keyed off `elapsedSeconds` at all, by design.

import { Fragment } from 'react';

import type { ShiftCardAction, ShiftQueueCard } from '@/types/learning-state';
import styles from '../shift.module.css';

export interface WorkPhaseProps {
  stack: ShiftQueueCard[];
  elapsedSeconds: number;
  onAction: (cardId: string, action: ShiftCardAction) => void;
  onSaveAndLeave: () => void;
}

/** mm:ss, always — this is the ONLY place elapsed seconds are formatted, and it never branches on
 * how large the value is (no alarm state past any threshold, per AC-5.3-2). */
export function formatElapsed(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function actionsFor(card: ShiftQueueCard): { label: string; action: ShiftCardAction; primary?: boolean }[] {
  switch (card.type) {
    case 'APPROVE_DRAFT':
    case 'RESPOND_FLAGGED':
      return [
        { label: 'Approve', action: 'APPROVE', primary: true },
        { label: 'Decline', action: 'DECLINE' },
        { label: 'Later today', action: 'SKIP' },
      ];
    case 'CONFIRM_APPOINTMENT':
      return [
        { label: 'Confirm', action: 'CONFIRM', primary: true },
        { label: 'Later today', action: 'SKIP' },
      ];
    case 'LOG_INTRODUCTION':
    case 'MARK_ATTENDANCE':
    default:
      return [
        { label: 'Log it', action: 'LOG', primary: true },
        { label: 'Later today', action: 'SKIP' },
      ];
  }
}

export default function WorkPhase({ stack, elapsedSeconds, onAction, onSaveAndLeave }: WorkPhaseProps) {
  const current = stack[0];

  return (
    <Fragment>
      <div className={styles.topBar}>
        <button type="button" className={styles.saveLeave} onClick={onSaveAndLeave}>
          Save & leave
        </button>
        <span className={styles.timer} aria-label="Shift time elapsed" data-testid="shift-timer">
          {formatElapsed(elapsedSeconds)}
        </span>
      </div>

      <div className={styles.progressDots} role="list" aria-label="Queue position">
        {stack.map((c, i) => (
          <span
            key={c.id}
            role="listitem"
            className={i === 0 ? `${styles.dot} ${styles.dotActive}` : styles.dot}
          />
        ))}
      </div>

      {current ? (
        <div className={styles.workCard} key={current.id}>
          <h2 className={styles.cardTitle}>{current.title}</h2>
          <p className={styles.cardDetail}>{current.detail}</p>
          <div className={styles.cardActions}>
            {actionsFor(current).map((a) => (
              <button
                key={a.action}
                type="button"
                className={a.primary ? styles.primaryButton : styles.secondaryButton}
                onClick={() => onAction(current.id, a.action)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Fragment>
  );
}
