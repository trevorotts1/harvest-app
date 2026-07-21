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
import { useT } from '@/app/locale-context';

// T-R32b — kept as the EN reference strings existing tests import (unchanged byte-for-byte, and
// still exactly what renders under the default/EN locale — the live render below now goes through
// `useT()` via matching `ritual.confirmation.subAgentName`/`.approvalBoundaryLine` catalog keys, so
// a non-EN locale genuinely translates both). Neither is a compliance-mandated verbatim statement
// (unlike GDPR_CONSENT_LABEL/SAFE_HARBOR_LINE elsewhere in this codebase) — ordinary product copy.
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
  const t = useT();
  const actionable = queue.filter(
    (item) => item.tier !== ReadinessTier.EXCLUDED && item.tier !== ReadinessTier.NEEDS_JURISDICTION
  );
  const excluded = queue.filter((item) => item.tier === ReadinessTier.EXCLUDED);
  const needsJurisdiction = queue.filter((item) => item.tier === ReadinessTier.NEEDS_JURISDICTION);

  return (
    <section className={styles.paper} aria-label={t('ritual.confirmation.sectionAria')}>
      <p className={styles.eyebrow}>{t('ritual.confirmation.eyebrow')}</p>
      <p className={styles.confirmationLede}>
        {t('ritual.confirmation.lede')}
      </p>

      <p className={styles.boundaryLine}>
        {t('ritual.confirmation.subAgentName')} {t('ritual.confirmation.boundaryMiddle')} {t('ritual.confirmation.approvalBoundaryLine')}
      </p>

      {unmatchedHighlights.map((u) => (
        <div key={u.name} className={styles.unmatchedPrompt}>
          <span>{t('ritual.confirmation.unmatchedPromptPrefix')} {u.name} {t('ritual.confirmation.unmatchedPromptSuffix')}</span>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => onAddNumber?.(u.name)}>
            {t('ritual.confirmation.addNumberCta')}
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
        <div className={styles.excludedSection} aria-label={t('ritual.confirmation.excludedSectionAria')}>
          <p>
            <strong>{t('ritual.confirmation.excludedHeading')}</strong> {t('ritual.confirmation.excludedBody')}
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
                  {t('ritual.confirmation.acknowledgeCta')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {needsJurisdiction.length > 0 && (
        <div className={styles.excludedSection} aria-label={t('ritual.confirmation.needsJurisdictionSectionAria')}>
          <p>
            <strong>{t('ritual.confirmation.needsJurisdictionHeading')}</strong> {t('ritual.confirmation.needsJurisdictionBody')}
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
          {t('ritual.confirmation.handToAgentCta')}
        </button>
      </div>
    </section>
  );
}
