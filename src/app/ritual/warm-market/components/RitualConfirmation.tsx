// uiux §5.4 confirmation screen — "Here are the community members we'll introduce your business to
// first — on your behalf." Consumes ONLY `PublicQueueItem` (T-26's score-invisible projection —
// structurally has no numeric score field, AC-5.4-4) and never renders a number for readiness,
// only the plain-language tier `label`. Excluded-tier items are rendered in a SEPARATE
// acknowledgment section and are never mixed into the actionable top-match cards (master spec §8.2
// "excluded contacts must not appear as actionable").
//
// T-29R2: the same "never actionable" rule now also applies to the distinct NEEDS_JURISDICTION tier
// (§7.6 needs-info mirrored for §8.2) — a contact whose jurisdiction is unknown can't be drafted
// compliant outreach for any more than an excluded one can, so it is held out of the actionable
// grid too. It gets its OWN section (never merged into the "excluded, needs acknowledgment" copy,
// which would misrepresent a remediable data gap as a confirmed exclusion) using the item's own
// `label` (already the correct plain-language text for either state) rather than a hardcoded string.

'use client';

import { ReadinessTier, type PublicQueueItem } from '@/types/harvest-method';
import { clusterLabel } from '@/services/harvest-method/clusters';

import styles from '../ritual.module.css';

export const WARM_MARKET_SUB_AGENT_NAME = 'your Warm Market Sub-Agent';
export const APPROVAL_BOUNDARY_LINE = 'Nothing sends without your approval.';

export interface UnmatchedHighlight {
  name: string;
}

export interface RitualConfirmationProps {
  queue: PublicQueueItem[];
  unmatchedHighlights?: UnmatchedHighlight[];
  onAcknowledgeExcluded: (contactId: string) => void;
  onAddNumber?: (name: string) => void;
  onHandToAgent: () => void;
}

export default function RitualConfirmation({
  queue,
  unmatchedHighlights = [],
  onAcknowledgeExcluded,
  onAddNumber,
  onHandToAgent,
}: RitualConfirmationProps) {
  const actionable = queue.filter(
    (item) => item.tier !== ReadinessTier.EXCLUDED && item.tier !== ReadinessTier.NEEDS_JURISDICTION
  );
  const excluded = queue.filter((item) => item.tier === ReadinessTier.EXCLUDED);
  const needsJurisdiction = queue.filter((item) => item.tier === ReadinessTier.NEEDS_JURISDICTION);

  return (
    <section className={styles.paper} aria-label="Ritual confirmation">
      <p className={styles.eyebrow}>Confirmation</p>
      <p className={styles.confirmationLede}>
        Here are the community members we&rsquo;ll introduce your business to first — on your behalf.
      </p>

      <p className={styles.boundaryLine}>
        {WARM_MARKET_SUB_AGENT_NAME} will take it from here. {APPROVAL_BOUNDARY_LINE}
      </p>

      {unmatchedHighlights.map((u) => (
        <div key={u.name} className={styles.unmatchedPrompt}>
          <span>We couldn&rsquo;t find {u.name} in your contacts — tap to add their number.</span>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => onAddNumber?.(u.name)}>
            Add number
          </button>
        </div>
      ))}

      <div className={styles.matchGrid}>
        {actionable.map((item) => (
          <article key={item.contactId} className={styles.matchCard}>
            <p className={styles.matchName}>
              {item.firstName} {item.lastInitial}.
            </p>
            <p>{item.clusters.map((c) => clusterLabel(c)).join(', ')}</p>
            <span className={styles.tierLabel}>{item.label}</span>
          </article>
        ))}
      </div>

      {excluded.length > 0 && (
        <div className={styles.excludedSection} aria-label="Excluded — requires your acknowledgment">
          <p>
            <strong>These contacts are excluded and need your acknowledgment</strong> — they are never
            actionable and nothing will ever be sent to them automatically.
          </p>
          {excluded.map((item) => (
            <div key={item.contactId} className={styles.excludedItem}>
              <span>
                {item.firstName} {item.lastInitial}.
              </span>
              <span className={styles.padlockChip}>{item.label}</span>
              {item.needsAcknowledgment && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => onAcknowledgeExcluded(item.contactId)}
                >
                  Acknowledge
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {needsJurisdiction.length > 0 && (
        <div className={styles.excludedSection} aria-label="Needs their state on file">
          <p>
            <strong>These contacts need their state on file</strong> — add it to move them into your
            action queue. Not an exclusion — just missing information.
          </p>
          {needsJurisdiction.map((item) => (
            <div key={item.contactId} className={styles.excludedItem}>
              <span>
                {item.firstName} {item.lastInitial}.
              </span>
              <span className={styles.padlockChip}>{item.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onHandToAgent}>
          Hand to my agent
        </button>
      </div>
    </section>
  );
}
