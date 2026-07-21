// uiux §4.2 Action Queue Item / §5.2 zone 3 — header shows the total minute cost (AC-5.2-3), items
// capped at 5 visually with a "show all (N)" count (the API returns the top 5 by priority plus the
// real total; a full paginated queue view is the Approval Inbox's job — T-33). Empty queue renders
// the earned-calm done-state, not emptiness.
//
// QUEUED-OFFLINE (T-54, master-spec §17.6; uiux §4.2 "queued-offline (sync-queued icon, 'will
// sync')"): `queuedOfflineIds` is a PAGE-owned, ephemeral, client-local set (never a server field on
// `QueueItem` — `src/app/today/page.tsx` tracks it alongside its `PersistentOfflineQueue`,
// `src/app/today/offline.ts`). An item whose id is in the set renders the named queued-offline state
// instead of its normal action buttons — honest ("will sync"), never a button that looks live but
// silently does nothing while offline.

import styles from '../today.module.css';
import type { ActionQueueZoneData, QueueItem, ZoneResult } from '@/services/mission-control/types';
import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

export interface ActionQueueProps {
  result: ZoneResult<ActionQueueZoneData>;
  onAction: (item: QueueItem, action: 'approve' | 'decline' | 'confirm') => void | Promise<void>;
  /** T-54 — see this file's header "QUEUED-OFFLINE" note. Optional; omitted/empty for every
   *  existing caller (no behavior change when nothing is queued). */
  queuedOfflineIds?: ReadonlySet<string>;
  /** T-R32b (§17.5 locale-aware copy) — optional so every existing caller/test (including the
   *  `ActionQueue({...})` direct-function-call pattern this file's own tests use to walk the raw
   *  element tree, e.g. mission-control-ui.test.ts's INTERACTION tests — a plain function call
   *  outside React's render cycle, where a hook like `useT()`/`useLocale()` would crash) keeps
   *  compiling and rendering byte-identical EN output. A real caller that knows the rep's locale
   *  (`src/app/today/page.tsx`, via `useLocale()`) passes it through — same pattern as
   *  `HiddenEarningsReveal`'s own `locale` prop (T-R32). Uses the pure `t(locale, key, vars)`
   *  catalog function rather than the `useT()` hook for exactly that reason — this component must
   *  stay callable as a plain function, not just renderable. */
  locale?: Locale;
}

// T-R32b — routed through catalog keys instead of a hardcoded EN map (same fix as AnchorHeader's
// momentum-band label): a plain object lookup, never a JSX text/attribute literal, so the
// no-literals scanner cannot see it, but it was still unconditionally English regardless of locale.
const KIND_LABEL_KEY: Record<QueueItem['kind'], string> = {
  approve_draft: 'today.actionQueue.kind.approve',
  review_flagged: 'today.actionQueue.kind.review',
  confirm_appointment: 'today.actionQueue.kind.confirm',
};

export default function ActionQueue({ result, onAction, queuedOfflineIds, locale = DEFAULT_LOCALE }: ActionQueueProps) {
  if (result.status === 'error') {
    return (
      <section className={styles.zoneCard} data-zone="action-queue">
        <span className={styles.zoneBadge}>{t(locale, 'today.actionQueue.badge')}</span>
        <p className={styles.zoneErrorText}>{result.message}</p>
      </section>
    );
  }

  const { totalMinutes, items, totalCount } = result.data;

  if (totalCount === 0) {
    return (
      <section className={styles.zoneCard} data-zone="action-queue">
        <span className={styles.zoneBadge}>{t(locale, 'today.actionQueue.badgeZeroMinutes')}</span>
        <p className={styles.narrativeLine}>{t(locale, 'today.actionQueue.emptyNarrative')}</p>
      </section>
    );
  }

  return (
    <section className={styles.zoneCard} data-zone="action-queue">
      <div className={styles.zoneHeaderRow}>
        <span className={styles.zoneBadge}>{t(locale, 'today.actionQueue.badgeWithMinutes', { minutes: totalMinutes })}</span>
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
                  {item.cfeBand === 'BLOCK' ? t(locale, 'today.actionQueue.blockedByCompliance') : t(locale, 'today.actionQueue.flaggedByCompliance')}
                  {t(locale, 'today.actionQueue.cfeBandSuffix', { band: item.cfeBand })}
                </span>
              )}
              <span className={styles.queueMeta}>
                {item.contactLabel ? `${item.contactLabel} · ` : ''}
                {`~${item.minutes} min`}
              </span>
            </div>
            <div className={styles.queueActions}>
              {queuedOfflineIds?.has(item.id) ? (
                // uiux §4.2 "queued-offline (sync-queued icon, 'will sync')" — an honest deferral,
                // never a button that looks live but silently does nothing while offline.
                <span className={styles.queueQueuedOffline} role="status">
                  <span aria-hidden="true">{t(locale, 'today.actionQueue.reloadIcon')}</span> {t(locale, 'today.actionQueue.queuedWillSync')}
                </span>
              ) : item.kind === 'confirm_appointment' ? (
                <button type="button" className={styles.queueActionButton} onClick={() => onAction(item, 'confirm')}>
                  {t(locale, KIND_LABEL_KEY[item.kind])}
                </button>
              ) : item.kind === 'review_flagged' ? (
                // T-32 QC fix: a FLAG/BLOCK-banded draft is NEVER one-tap-approvable from Today —
                // the fix is fail-closed at the endpoint (today.service.ts's actOnQueueDraft), and
                // this affordance is removed here too so the rep is never shown a button that looks
                // like it would work. Real adjudication (re-checked CFE, classifier drawer) is the
                // Approval Inbox's job (T-33) — this is a plain navigation link, not T-33 code.
                <>
                  <a href="/inbox" className={styles.queueReviewLink}>
                    {t(locale, 'today.actionQueue.reviewInApprovalInboxCta')}
                  </a>
                  <button type="button" className={styles.queueActionButtonSecondary} onClick={() => onAction(item, 'decline')}>
                    {t(locale, 'today.actionQueue.declineCta')}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className={styles.queueActionButton} onClick={() => onAction(item, 'approve')}>
                    {t(locale, KIND_LABEL_KEY[item.kind])}
                  </button>
                  <button type="button" className={styles.queueActionButtonSecondary} onClick={() => onAction(item, 'decline')}>
                    {t(locale, 'today.actionQueue.declineCta')}
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {totalCount > items.length && (
        <p className={styles.showAllNote}>{t(locale, 'today.actionQueue.showAllCount', { count: totalCount })}</p>
      )}
    </section>
  );
}
