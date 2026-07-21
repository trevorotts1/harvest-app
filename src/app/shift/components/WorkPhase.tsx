// uiux §5.3 — Work (card stack): the action queue in focus mode, ONE CARD AT A TIME (AC-5.3-1);
// approve-with-inline-edit / respond-to-flagged / confirm-appointment-windows / log-introductions /
// mark-attendance card types; skip moves an item to the end of the stack once, twice-skipped items
// leave the Shift (handled server-side, ShiftService.buildCandidateStack). The shift timer counts
// UP (mm:ss, tabular, quiet soil color) and NEVER renders an alarm/red/overtime state (AC-5.3-2) —
// this component contains no conditional styling keyed off `elapsedSeconds` at all, by design.
//
// T-R13: APPROVE_DRAFT / RESPOND_FLAGGED cards now embed T-33's real Approval Inbox Item component
// (`DraftApprovalCard`) in place of the old deep-link-to-`/inbox` stopgap — a rep can approve, edit
// (re-entering the CFE), or decline right here, full-width, per uiux §5.3's own
// "approve-with-inline-edit ... embedded full-width" language. The fail-closed guarantee this
// replaces (a non-PASS draft is never one-tap-approvable from the Shift) is preserved UNCHANGED at
// the service layer — see `ShiftApprovalRequiresReviewError`'s doc comment in shift.service.ts —
// not re-implemented here. "Later today" (skip) remains a plain Work-phase action alongside the
// embedded card, since skip is not something `ApprovalInboxItem` itself knows about.

import { Fragment } from 'react';

import type { ShiftCardAction, ShiftQueueCard } from '@/types/learning-state';
import DraftApprovalCard from './DraftApprovalCard';
import styles from '../shift.module.css';
import { useT } from '@/app/locale-context';
import type { TVars } from '@/lib/i18n/catalog';

export interface WorkPhaseProps {
  stack: ShiftQueueCard[];
  elapsedSeconds: number;
  onAction: (cardId: string, action: ShiftCardAction) => Promise<void> | undefined;
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

/** True for a card backed by a real DraftMessage (APPROVE_DRAFT / RESPOND_FLAGGED) — these embed
 * `DraftApprovalCard` instead of the generic title/detail/action-bar rendering below. */
function isDraftCard(card: ShiftQueueCard): boolean {
  return card.type === 'APPROVE_DRAFT' || card.type === 'RESPOND_FLAGGED';
}

function actionsFor(card: ShiftQueueCard, t: (key: string, vars?: TVars) => string): { label: string; action: ShiftCardAction; primary?: boolean }[] {
  switch (card.type) {
    case 'CONFIRM_APPOINTMENT':
      return [
        { label: t('today.actionQueue.kind.confirm'), action: 'CONFIRM', primary: true },
        { label: t('shift.workPhase.laterTodayCta'), action: 'SKIP' },
      ];
    case 'LOG_INTRODUCTION':
    case 'MARK_ATTENDANCE':
    default:
      return [
        { label: t('shift.workPhase.logItCta'), action: 'LOG', primary: true },
        { label: t('shift.workPhase.laterTodayCta'), action: 'SKIP' },
      ];
  }
}

export default function WorkPhase({ stack, elapsedSeconds, onAction, onSaveAndLeave }: WorkPhaseProps) {
  const t = useT();
  const current = stack[0];

  return (
    <Fragment>
      <div className={styles.topBar}>
        <button type="button" className={styles.saveLeave} onClick={onSaveAndLeave}>
          {t('shift.workPhase.saveLeaveCta')}
        </button>
        <span className={styles.timer} aria-label={t('shift.workPhase.timeElapsedAria')} data-testid="shift-timer">
          {formatElapsed(elapsedSeconds)}
        </span>
      </div>

      <div className={styles.progressDots} role="list" aria-label={t('shift.workPhase.queuePositionAria')}>
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
          {isDraftCard(current) ? (
            <Fragment>
              <DraftApprovalCard card={current} onAction={onAction} />
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => onAction(current.id, 'SKIP')}
                >
                  {t('shift.workPhase.laterTodayCta')}
                </button>
              </div>
            </Fragment>
          ) : (
            <Fragment>
              <h2 className={styles.cardTitle}>{current.title}</h2>
              <p className={styles.cardDetail}>{current.detail}</p>
              <div className={styles.cardActions}>
                {actionsFor(current, t).map((a) => (
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
            </Fragment>
          )}
        </div>
      ) : null}
    </Fragment>
  );
}
