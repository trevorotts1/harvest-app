// uiux §5.3 — Work (card stack): the action queue in focus mode, ONE CARD AT A TIME (AC-5.3-1);
// approve-with-inline-edit / respond-to-flagged / confirm-appointment-windows / log-introductions /
// mark-attendance card types; skip moves an item to the end of the stack once, twice-skipped items
// leave the Shift (handled server-side, ShiftService.buildCandidateStack). The shift timer counts
// UP (mm:ss, tabular, quiet soil color) and NEVER renders an alarm/red/overtime state (AC-5.3-2) —
// this component contains no conditional styling keyed off `elapsedSeconds` at all, by design.
//
// T-34 QC fix (D2, fail-closed — mirrors T-32's Mission Control fail-closed-queue-approve fix): a
// draft whose CFE outcome is not PASS (FLAG or BLOCK) NEVER gets a one-tap Approve button here —
// only Decline + a plain deep-link to the real Approval Inbox (`/inbox`, T-33). This is UI-layer
// convenience only; ShiftService.actionCard / POST /api/shift/action refuse the mutation
// server-side regardless of what this component renders (defense in depth — see
// ShiftApprovalRequiresReviewError's doc comment in shift.service.ts). Full inline-edit-in-Shift
// (embedding T-33's Approval Inbox Item component directly in this Work phase, per uiux §5.3's
// "approve-with-inline-edit ... embedded full-width") is DEFERRED to a post-merge integration
// tracked as T-R13 — this fix closes the compliance concern only, with a plain `<a href>` (no
// import of T-33 code, which does not exist on this branch's history).

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

/** T-34 QC fix (D2): true for a draft-backed card that is NOT a clean PASS. Checked against
 * `cfeOutcome` directly rather than `card.type` alone — `type` is already set correctly by
 * ShiftService.buildCandidateStack (RESPOND_FLAGGED for FLAG/BLOCK), but gating the ACTUAL
 * fail-closed behavior on the CFE outcome value itself, not a derived label, is one more layer of
 * defense in depth against a stale/mismatched card (e.g. `type` and `cfeOutcome` disagreeing).
 * Cards with no CFE outcome at all (`undefined`/`null` — CONFIRM_APPOINTMENT / LOG_INTRODUCTION /
 * MARK_ATTENDANCE) are never draft approvals in the first place, so this only ever matters for
 * APPROVE_DRAFT / RESPOND_FLAGGED — see the one call site below. */
function isNonPassDraft(card: ShiftQueueCard): boolean {
  return card.type === 'RESPOND_FLAGGED' || card.cfeOutcome === 'FLAG' || card.cfeOutcome === 'BLOCK';
}

/** The compliance band label + style variant for a flagged/blocked card (T-34 QC fix D2). BLOCK is
 * the harder-stop verdict and gets the reserved "blocked" token pairing; anything else non-PASS
 * (FLAG, or an unexpected/missing outcome on a RESPOND_FLAGGED card) gets the softer "caution"
 * pairing — never silently rendered with no band at all, since the whole point is that this is
 * NOT a plain "Approve a draft" card. */
function cfeBand(card: ShiftQueueCard): { label: string; className: string } {
  if (card.cfeOutcome === 'BLOCK') {
    return { label: 'Blocked by compliance review', className: `${styles.cfeBand} ${styles.cfeBandBlock}` };
  }
  return { label: 'Flagged by compliance review', className: `${styles.cfeBand} ${styles.cfeBandFlag}` };
}

function actionsFor(card: ShiftQueueCard): { label: string; action: ShiftCardAction; primary?: boolean }[] {
  switch (card.type) {
    case 'APPROVE_DRAFT':
    case 'RESPOND_FLAGGED':
      // T-34 QC fix (D2): a non-PASS draft gets NO Approve action at all here — see the CFE band +
      // "Review in Approval Inbox" deep-link rendered below instead. Declining is never gated
      // (rejecting risky content is always safe).
      return isNonPassDraft(card)
        ? [
            { label: 'Decline', action: 'DECLINE' },
            { label: 'Later today', action: 'SKIP' },
          ]
        : [
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
  const flagged = current && isNonPassDraft(current) ? cfeBand(current) : null;

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
          {flagged ? (
            <span className={flagged.className} data-testid="cfe-band">
              {flagged.label}
            </span>
          ) : null}
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
            {flagged ? (
              // T-34 QC fix (D2): plain href, not a router Link and not any T-33 component import —
              // that page lives on a different branch's history (build/T-33-approval-inbox) at this
              // point in the tree; a real, dynamic import would fail to resolve until merge. A plain
              // anchor works today and keeps working unchanged after merge.
              <a href="/inbox" className={styles.inboxLink}>
                Review in Approval Inbox
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </Fragment>
  );
}
