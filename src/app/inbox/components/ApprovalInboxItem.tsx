// T-33 — the Approval Inbox item (master-spec §9.2; uiux §4.3/§5.6). Anatomy: agent identity +
// contact + channel + drafted-at header; body preview; the CFE status chip (icon + label, never
// color alone, §6.1); footer — Approve / Edit / Decline. Editing ALWAYS re-enters the CFE
// (uiux AC-5.6-3): while the re-check is in flight, actions disable and the item shows "Re-checking"
// — the NEW band replaces the old the moment the response lands, never the stale one. A HELD/blocked
// item exposes only "Use compliant rewrite" (edit) / "Discard" (decline) — no Approve affordance
// exists in this component's rendering for that state, mirroring the server's own 403
// (AC-5.6-4 "cannot be approved by any UI path").
//
// NO BATCH APPROVE: this component's `onApprove`/`onDecline`/`onEdit` callbacks each take exactly
// the ONE item's id — there is no multi-select affordance anywhere in this file, by construction
// (uiux §5.6 "Batch operations do not exist by design").

'use client';

import { useState } from 'react';

import ContactControls from './ContactControls';
import styles from '../inbox.module.css';

export type CfeOutcome = 'PASS' | 'FLAG' | 'BLOCK' | 'RECORDED' | null;
export type ApprovalState = 'PENDING' | 'APPROVED' | 'DECLINED' | 'HELD';

export interface InboxItemData {
  id: string;
  contact_id: string;
  contact: { firstName: string; lastName: string } | null;
  channel: string;
  body: string;
  cfe_outcome: CfeOutcome;
  cfe_risk_score: number | null;
  approval_state: ApprovalState;
  created_at: string;
  agentsPaused?: boolean;
  doNotContact?: boolean;
}

const DECLINE_REASON_OPTIONS: { value: string; label: string }[] = [
  { value: 'not_my_voice', label: 'Not my voice' },
  { value: 'wrong_person', label: 'Wrong person' },
  { value: 'wrong_time', label: 'Wrong time' },
  { value: 'other', label: 'Other' },
];

function cfeChip(outcome: CfeOutcome, checking: boolean) {
  if (checking) {
    return { className: styles.cfeChipChecking, label: 'Re-checking' };
  }
  if (outcome === 'BLOCK') return { className: styles.cfeChipBlock, label: 'Blocked' };
  if (outcome === 'FLAG') return { className: styles.cfeChipFlag, label: 'Flagged' };
  return { className: styles.cfeChipPass, label: 'Pass' };
}

export interface ApprovalInboxItemProps {
  item: InboxItemData;
  onApprove: (draftId: string) => Promise<{ ok: boolean; error?: string }>;
  onDecline: (draftId: string, reason: string, note?: string) => Promise<{ ok: boolean; error?: string }>;
  onEdit: (draftId: string, body: string) => Promise<{ ok: boolean; item?: InboxItemData; error?: string }>;
}

export default function ApprovalInboxItem({ item, onApprove, onDecline, onEdit }: ApprovalInboxItemProps) {
  const [mode, setMode] = useState<'view' | 'editing' | 'declining'>('view');
  const [draftText, setDraftText] = useState(item.body);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(item);

  const contactName = current.contact ? `${current.contact.firstName} ${current.contact.lastName}` : 'this contact';
  const chip = cfeChip(current.cfe_outcome, checking);
  const isHeld = current.approval_state === 'HELD';
  const isTerminal = current.approval_state === 'APPROVED' || current.approval_state === 'DECLINED';

  async function handleApprove() {
    setBusy(true);
    setError(null);
    const result = await onApprove(current.id);
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'This draft could not be approved.');
  }

  async function handleSaveEdit() {
    setChecking(true);
    setError(null);
    const result = await onEdit(current.id, draftText);
    setChecking(false);
    if (!result.ok) {
      setError(result.error ?? 'Edit failed.');
      return;
    }
    if (result.item) setCurrent(result.item);
    setMode('view');
  }

  async function handleDecline() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    const result = await onDecline(current.id, reason, note || undefined);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Decline failed.');
      return;
    }
    setMode('view');
  }

  return (
    <article
      className={`${styles.item} ${isHeld ? styles.itemHeld : ''}`}
      aria-label={`Draft to ${contactName} via ${current.channel}`}
    >
      <div className={styles.itemHeader}>
        <div className={styles.itemHeaderMeta}>
          <span className={styles.agentChip}>Agent draft</span>
          <span>&middot;</span>
          <span>{contactName}</span>
          <span>&middot;</span>
          <span>{current.channel.replaceAll('_', ' ')}</span>
        </div>
        <span className={`${styles.cfeChip} ${chip.className}`} role="status">
          <span aria-hidden="true">&#9673;</span> {chip.label}
          {typeof current.cfe_risk_score === 'number' && !checking ? ` (${current.cfe_risk_score})` : ''}
        </span>
      </div>

      {isHeld && (
        <p className={styles.heldBanner} role="alert">
          Held for review — this draft cannot be approved as-is. Use the rewrite or discard it.
        </p>
      )}

      {mode === 'editing' ? (
        <textarea
          className={styles.editArea}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          aria-label="Edit draft text"
          disabled={checking}
        />
      ) : (
        <p className={styles.itemBody}>{current.body}</p>
      )}

      <p className={styles.itemMeta}>Drafted {new Date(current.created_at).toLocaleString()}</p>

      {error && (
        <p className={styles.errorState} role="alert">
          {error}
        </p>
      )}

      {mode === 'declining' && (
        <div className={styles.reasonRow} role="radiogroup" aria-label="Reason for declining">
          {DECLINE_REASON_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={reason === opt.value}
              className={`${styles.reasonChip} ${reason === opt.value ? styles.reasonChipSelected : ''}`}
              onClick={() => setReason(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          <input
            className={styles.noteInput}
            placeholder="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Optional note about why you're declining"
          />
        </div>
      )}

      {!isTerminal && (
        <div className={styles.itemFooter}>
          {mode === 'view' && !isHeld && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.approveButton}`}
              onClick={handleApprove}
              disabled={busy}
            >
              Approve
            </button>
          )}
          {mode === 'editing' ? (
            <>
              <button type="button" className={styles.actionButton} onClick={handleSaveEdit} disabled={checking}>
                {checking ? 'Re-checking…' : isHeld ? 'Use rewrite' : 'Save & re-check'}
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => {
                  setDraftText(current.body);
                  setMode('view');
                }}
                disabled={checking}
              >
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={styles.actionButton} onClick={() => setMode('editing')} disabled={busy}>
              Edit
            </button>
          )}
          {mode === 'declining' ? (
            <>
              <button
                type="button"
                className={`${styles.actionButton} ${styles.declineButton}`}
                onClick={handleDecline}
                disabled={busy || !reason}
              >
                {isHeld ? 'Discard' : 'Confirm decline'}
              </button>
              <button type="button" className={styles.actionButton} onClick={() => setMode('view')} disabled={busy}>
                Cancel
              </button>
            </>
          ) : (
            mode === 'view' && (
              <button
                type="button"
                className={`${styles.actionButton} ${styles.declineButton}`}
                onClick={() => setMode('declining')}
                disabled={busy}
              >
                {isHeld ? 'Discard' : 'Decline'}
              </button>
            )
          )}
        </div>
      )}

      <ContactControls
        contactId={current.contact_id}
        contactName={contactName}
        agentsPaused={current.agentsPaused ?? false}
        doNotContact={current.doNotContact ?? false}
      />
    </article>
  );
}
