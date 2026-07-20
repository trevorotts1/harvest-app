// T-R22 — one pending bridge request awaiting THIS upline (master-spec §10.6). Presentational; the
// page owns the fetch. Deliberately shows only the inviting rep's name, why they're asking, and the
// 24h return-deadline countdown context — NEVER contact identity or conversation content, which
// (per §2.5, and this surface's own read route) only ever surfaces to the upline once they've
// actually joined via POST /api/messaging/handoff/join.

'use client';

import { useState } from 'react';

import styles from '../team.module.css';

export interface PendingBridgeData {
  id: string;
  repName: string;
  triggerReason: string;
  invitedAt: string;
  returnDeadlineAt: string;
}

const REASON_LABELS: Record<string, string> = {
  BUYING_SIGNAL: "They're showing real interest",
  HARD_QUESTION: "A question they couldn't answer well",
  MANUAL: 'They just wanted the introduction',
};

export interface PendingBridgeItemProps {
  item: PendingBridgeData;
  onJoin: (handoffId: string) => Promise<{ ok: boolean; error?: string }>;
}

export default function PendingBridgeItem({ item, onJoin }: PendingBridgeItemProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  async function handleJoin() {
    setBusy(true);
    setError(null);
    const result = await onJoin(item.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not join this conversation. Try again.');
      return;
    }
    setJoined(true);
  }

  const reasonLabel = REASON_LABELS[item.triggerReason] ?? 'Wants to bring you into a conversation';

  return (
    <article className={styles.item} aria-label={`Bridge request from ${item.repName}`}>
      <div className={styles.itemHeader}>
        <div className={styles.itemHeaderMeta}>
          <span className={styles.repChip}>{item.repName}</span>
          <span>&middot;</span>
          <span>{reasonLabel}</span>
        </div>
      </div>

      <p className={styles.itemMeta}>
        Invited {new Date(item.invitedAt).toLocaleString()} &middot; returns to them at{' '}
        {new Date(item.returnDeadlineAt).toLocaleString()} if you don&apos;t join
      </p>

      {error && (
        <p className={styles.errorState} role="alert">
          {error}
        </p>
      )}

      {joined ? (
        <p className={styles.itemStatus} role="status">
          You joined this conversation.
        </p>
      ) : (
        <div className={styles.itemFooter}>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.joinButton}`}
            onClick={handleJoin}
            disabled={busy}
          >
            {busy ? 'Joining…' : 'Join conversation'}
          </button>
        </div>
      )}
    </article>
  );
}
