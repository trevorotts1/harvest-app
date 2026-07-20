// T-39 (uiux §5.7 "Three-way handoff"; master-spec §10.6) — the timeline handoff card. Renders the
// upline-join lifecycle honestly: invited → joined → returned. While JOINED, both humans carry
// identity chips (the community member's side stays one natural thread). On the 24h no-join return,
// the card flips to "returned to you" with a labeled, coaching next step (Sonnet 5 in production;
// here the copy is passed in). Tokens only, icon + text (never color alone).

import styles from '../conversation.module.css';

export type HandoffState = 'INVITED' | 'JOINED' | 'RETURNED';

export interface ThreeWayHandoffCardProps {
  repName: string;
  uplineName: string;
  state: HandoffState;
  coachedNextStep?: string | null;
}

export default function ThreeWayHandoffCard({ repName, uplineName, state, coachedNextStep }: ThreeWayHandoffCardProps) {
  return (
    <article className={styles.handoffCard} role="group" aria-label={`Three-way handoff with ${uplineName}`}>
      {state === 'INVITED' && (
        <p className={styles.handoffLine} role="status">
          <span className={styles.handoffIcon} aria-hidden="true">→</span>
          {uplineName} has been invited into this conversation.
        </p>
      )}

      {state === 'JOINED' && (
        <>
          <p className={styles.handoffLine} role="status">
            <span className={styles.handoffIcon} aria-hidden="true">✓</span>
            {uplineName} joined the conversation.
          </p>
          <div className={styles.chipRow}>
            <span className={styles.identityChip}>{repName}</span>
            <span className={styles.identityChip}>{uplineName}</span>
          </div>
        </>
      )}

      {state === 'RETURNED' && (
        <>
          <p className={styles.handoffLine} role="status">
            <span className={styles.handoffIcon} aria-hidden="true">↩</span>
            Returned to you — {uplineName} could not join in time.
          </p>
          {coachedNextStep && (
            <p className={styles.coachedStep}>
              <span className={styles.coachLabel}>Coaching</span> {coachedNextStep}
            </p>
          )}
        </>
      )}
    </article>
  );
}
