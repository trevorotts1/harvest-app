// uiux §4.2 Action Queue Item / §5.2 zone 3 — header shows the total minute cost (AC-5.2-3), items
// capped at 5 visually with a "show all (N)" count (the API returns the top 5 by priority plus the
// real total; a full paginated queue view is the Approval Inbox's job — T-33). Empty queue renders
// the earned-calm done-state, not emptiness.

import styles from '../today.module.css';
import type { ActionQueueZoneData, QueueItem, ZoneResult } from '@/services/mission-control/types';

export interface ActionQueueProps {
  result: ZoneResult<ActionQueueZoneData>;
  onAction: (item: QueueItem, action: 'approve' | 'decline' | 'confirm') => void | Promise<void>;
}

const KIND_LABEL: Record<QueueItem['kind'], string> = {
  approve_draft: 'Approve',
  review_flagged: 'Review',
  confirm_appointment: 'Confirm',
};

export default function ActionQueue({ result, onAction }: ActionQueueProps) {
  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="action-queue">
        <span className={styles.zoneBadge}>Today</span>
        <p className={styles.zoneErrorText}>{result.message}</p>
      </section>
    );
  }

  const { totalMinutes, items, totalCount } = result.data;

  if (totalCount === 0) {
    return (
      <section className={styles.zoneCard} data-zone="action-queue">
        <span className={styles.zoneBadge}>Today: 0 minutes</span>
        <p className={styles.narrativeLine}>Nothing needs you. Your agents take it from here.</p>
      </section>
    );
  }

  return (
    <section className={styles.zoneCard} data-zone="action-queue">
      <div className={styles.zoneHeaderRow}>
        <span className={styles.zoneBadge}>Today: {totalMinutes} minutes</span>
      </div>
      <ul className={styles.queueList}>
        {items.map((item) => (
          <li key={item.id} className={styles.queueRow}>
            <div className={styles.queueRowMain}>
              <strong>{item.title}</strong>
              <span className={styles.queueWhy}>{item.why}</span>
              {item.kind === 'review_flagged' && item.cfeBand && (
                // T-32 QC fix: the band/classifier summary was captured on every item but never
                // shown — the rep now sees WHY this draft can't be one-tap approved (uiux §5.2
                // "never sendable" / master-spec §18.6 no fabricated content, shown honestly here).
                <span className={styles.queueCfeBand}>
                  {item.cfeBand === 'BLOCK' ? 'Blocked by compliance review' : 'Flagged by compliance review'} (CFE: {item.cfeBand})
                </span>
              )}
              <span className={styles.queueMeta}>
                {item.contactLabel ? `${item.contactLabel} · ` : ''}
                {`~${item.minutes} min`}
              </span>
            </div>
            <div className={styles.queueActions}>
              {item.kind === 'confirm_appointment' ? (
                <button type="button" className={styles.queueActionButton} onClick={() => onAction(item, 'confirm')}>
                  {KIND_LABEL[item.kind]}
                </button>
              ) : item.kind === 'review_flagged' ? (
                // T-32 QC fix: a FLAG/BLOCK-banded draft is NEVER one-tap-approvable from Today —
                // the fix is fail-closed at the endpoint (today.service.ts's actOnQueueDraft), and
                // this affordance is removed here too so the rep is never shown a button that looks
                // like it would work. Real adjudication (re-checked CFE, classifier drawer) is the
                // Approval Inbox's job (T-33) — this is a plain navigation link, not T-33 code.
                <>
                  <a href="/inbox" className={styles.queueReviewLink}>
                    Review in Approval Inbox
                  </a>
                  <button type="button" className={styles.queueActionButtonSecondary} onClick={() => onAction(item, 'decline')}>
                    Decline
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className={styles.queueActionButton} onClick={() => onAction(item, 'approve')}>
                    {KIND_LABEL[item.kind]}
                  </button>
                  <button type="button" className={styles.queueActionButtonSecondary} onClick={() => onAction(item, 'decline')}>
                    Decline
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {totalCount > items.length && (
        <p className={styles.showAllNote}>show all ({totalCount})</p>
      )}
    </section>
  );
}
