// uiux §4.6 — the Contact Card: avatar/initials, name, relationship-closeness dots (1-5), a recency
// dot (leaf < 30d / soil 30-90d / hollow > 90d, icon+tooltip TEXT — never color alone, §6.1), TWO
// INDEPENDENT flag toggles (`is_recruit_target` / `is_client`), a segment tag, and the five §4.6
// states: rest, needs-info, excluded, agents-paused, removed-from-phone.
//
// The two flag toggles call SEPARATE callbacks (`onToggleRecruitTarget` / `onToggleClient`) — never
// a single combined handler — so this component can never itself couple the two flags together; the
// write-path independence guarantee lives in the API route/service (T-28's carried-forward toggle
// fix), and this component is written so it cannot violate it even by accident.
//
// T-39 QC FIX 1 (uiux §5.7) — every card links to `/community/{id}`, the contact-detail/conversation
// route that mounts `ConversationTimeline`. Before this fix that route existed on no page at all, so
// a rep had no way to open a contact's conversation from the Community list; this is the one added
// affordance that makes it reachable. A plain `next/link` `<a>`, never nested inside the flag-toggle
// `<button>`s above (sibling elements only), so it can never intercept their clicks.

import Link from 'next/link';

import styles from '../community.module.css';
import { useT } from '@/app/locale-context';

export type RecencyState = 'leaf' | 'soil' | 'hollow';
export type ContactCardState = 'rest' | 'needs-info' | 'excluded' | 'agents-paused' | 'removed-from-phone';

const RECENCY_LABEL_KEY: Record<RecencyState, string> = {
  leaf: 'community.contactCard.recencyLabel.leaf',
  soil: 'community.contactCard.recencyLabel.soil',
  hollow: 'community.contactCard.recencyLabel.hollow',
};

export interface ContactCardProps {
  id: string;
  name: string;
  initials: string;
  /** 1-5 relationship-closeness dots (§4.6). */
  closeness: number;
  recency: RecencyState;
  isRecruitTarget: boolean;
  isClient: boolean;
  onToggleRecruitTarget: (id: string, next: boolean) => void;
  onToggleClient: (id: string, next: boolean) => void;
  segmentTag?: string;
  state?: ContactCardState;
}

export default function ContactCard({
  id,
  name,
  initials,
  closeness,
  recency,
  isRecruitTarget,
  isClient,
  onToggleRecruitTarget,
  onToggleClient,
  segmentTag,
  state = 'rest',
}: ContactCardProps) {
  const t = useT();
  const closenessClamped = Math.max(0, Math.min(5, closeness));
  const recencyLabel = t(RECENCY_LABEL_KEY[recency]);

  return (
    <article
      className={`${styles.contactCard} ${state === 'needs-info' ? styles.contactCardNeedsInfo : ''} ${
        state === 'excluded' ? styles.contactCardExcluded : ''
      }`}
      aria-label={t('community.contactCard.cardAriaLabel', { name })}
    >
      <div className={styles.cardHeader}>
        <div className={styles.avatar} role="img" aria-label={t('community.contactCard.avatarAriaLabel', { name })}>
          {initials}
        </div>
        <div>
          <p className={styles.cardName}>{name}</p>
          <div className={styles.closenessRow} role="img" aria-label={t('community.contactCard.closenessAriaLabel', { count: closenessClamped })}>
            {Array.from({ length: 5 }, (_, i) => (
              <span
                key={i}
                className={`${styles.closenessDot} ${i < closenessClamped ? styles.closenessDotFilled : ''}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className={styles.recencyRow} title={recencyLabel}>
        <span
          className={`${styles.recencyDot} ${
            recency === 'leaf' ? styles.recencyLeaf : recency === 'soil' ? styles.recencySoil : styles.recencyHollow
          }`}
          aria-hidden="true"
        />
        <span>{recencyLabel}</span>
      </div>

      {state === 'needs-info' && (
        <p className={styles.needsInfoNote}>{t('community.contactCard.needsInfoNote')}</p>
      )}

      {state === 'excluded' && (
        <span className={`${styles.stateChip} ${styles.stateChipExcluded}`}>{t('community.contactCard.excludedChip')}</span>
      )}
      {state === 'agents-paused' && <span className={`${styles.stateChip} ${styles.stateChipPaused}`}>{t('community.conversation.agentsPausedChip')}</span>}
      {state === 'removed-from-phone' && (
        <span className={`${styles.stateChip} ${styles.stateChipInfo}`}>{t('community.contactCard.retainedInVaultChip')}</span>
      )}

      <div className={styles.flagRow}>
        <button
          type="button"
          role="switch"
          aria-checked={isRecruitTarget}
          aria-label={t('community.contactCard.recruitTargetAriaLabel', { name })}
          className={`${styles.flagToggle} ${isRecruitTarget ? styles.flagToggleOn : ''}`}
          onClick={() => onToggleRecruitTarget(id, !isRecruitTarget)}
        >
          {t('community.contactCard.recruitTargetCta')}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={isClient}
          aria-label={t('community.contactCard.clientAriaLabel', { name })}
          className={`${styles.flagToggle} ${isClient ? styles.flagToggleOn : ''}`}
          onClick={() => onToggleClient(id, !isClient)}
        >
          {t('community.contactCard.clientCta')}
        </button>
      </div>

      {segmentTag && <span className={styles.segmentTag}>{segmentTag}</span>}

      <Link href={`/community/${id}`} className={styles.viewConversationLink}>
        {t('community.contactCard.viewConversationCta')}
      </Link>
    </article>
  );
}
