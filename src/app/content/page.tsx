// T-41 (WP06 §11.5 "Unified Content Queue") — the reachable Content Queue page. Reached from Today
// (src/app/today/page.tsx's "Content Queue" link) and from the rail/tab bar wherever the app's own
// nav renders it. Composes the REAL `/api/content/*` routes — no demo/mock fallback.
//
// Six states exactly per spec; bulk-approve IS allowed here (unlike the Approval Inbox — see
// content-item.service.ts's class header for why that is not the same anti-pattern); every inline
// edit re-enters the CFE + doctrine scan server-side.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import styles from './content.module.css';
import { useLocale, useT } from '@/app/locale-context';
import { formatDateTime } from '@/lib/i18n/format';
import { errorDisplay } from '@/lib/i18n/error-display';
import { reasonDisplay } from '@/lib/i18n/reason-display';
import { contentCategoryLabel, contentStateLabel, contentTypeLabel } from '@/lib/i18n/content-token-display';

type QueueState = 'DRAFTING' | 'COMPLIANCE_CHECK' | 'READY_FOR_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'BLOCKED';

interface ContentItemData {
  id: string;
  content_type: 'SOCIAL_POST' | 'BLOG' | 'EMAIL';
  category: string | null;
  platform: string | null;
  headline: string | null;
  body: string;
  state: QueueState;
  cfe_outcome: string | null;
  vocab_clean: boolean;
  vocab_violations: unknown;
  publish_hold_reason: string | null;
  publish_attempts: number;
  scheduled_for: string | null;
  launch_kit_id: string | null;
}

interface FollowUpTask {
  id: string;
  content_item_id: string;
  due_at: string;
  completed: boolean;
}

type FilterKey = 'ALL' | QueueState | 'FOLLOWUPS';

const FILTERS: { key: FilterKey; labelKey: string }[] = [
  { key: 'ALL', labelKey: 'content.queue.filters.all' },
  { key: 'DRAFTING', labelKey: 'content.queue.filters.drafting' },
  { key: 'READY_FOR_REVIEW', labelKey: 'content.queue.filters.readyForReview' },
  { key: 'SCHEDULED', labelKey: 'content.queue.filters.scheduled' },
  { key: 'PUBLISHED', labelKey: 'content.queue.filters.published' },
  { key: 'BLOCKED', labelKey: 'content.queue.filters.blocked' },
  { key: 'FOLLOWUPS', labelKey: 'content.queue.filters.followups' },
];

const STATE_CLASS: Record<QueueState, string> = {
  DRAFTING: 'stateDrafting',
  COMPLIANCE_CHECK: 'stateComplianceCheck',
  READY_FOR_REVIEW: 'stateReadyForReview',
  SCHEDULED: 'stateScheduled',
  PUBLISHED: 'statePublished',
  BLOCKED: 'stateBlocked',
};

export default function ContentQueuePage() {
  const { locale, t } = useLocale();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [items, setItems] = useState<ContentItemData[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpTask[]>([]);
  const [banner, setBanner] = useState<{ publishingPaused: boolean; reason?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);

  const load = useCallback(async (activeFilter: FilterKey) => {
    setLoading(true);
    setError(null);
    try {
      if (activeFilter === 'FOLLOWUPS') {
        const res = await fetch('/api/content/followups');
        if (!res.ok) throw new Error();
        const body = await res.json();
        setFollowUps(body.tasks ?? []);
        setItems([]);
        return;
      }
      const url = activeFilter === 'ALL' ? '/api/content/queue' : `/api/content/queue?state=${activeFilter}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const body = await res.json();
      setItems(body.items ?? []);
      setBanner(body.banner ?? null);
    } catch {
      setError(t('content.queue.loadFailedGeneric'));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  async function generateBatch() {
    setBusy(true);
    try {
      const res = await fetch('/api/content/batch/generate', { method: 'POST' });
      if (!res.ok) {
        // T-57 RE-GATE B [af7789d3] Finding 1 — never render the raw English `body.error`; resolve
        // a locale-correct string from the `errors.*` catalog by the route's machine `code`.
        const body = await res.json().catch(() => ({}) as { code?: string });
        setError(errorDisplay(t, body.code));
      } else {
        await load(filter);
      }
    } finally {
      setBusy(false);
    }
  }

  async function approveOne(id: string) {
    const res = await fetch(`/api/content/queue/${id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (res.ok) await load(filter);
  }

  async function declineOne(id: string) {
    const res = await fetch(`/api/content/queue/${id}/decline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'not_my_voice' }),
    });
    if (res.ok) await load(filter);
  }

  async function saveEdit(id: string) {
    const res = await fetch(`/api/content/queue/${id}/edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: editBody }),
    });
    if (res.ok) {
      setEditingId(null);
      await load(filter);
    }
  }

  async function publishNow(id: string) {
    const res = await fetch(`/api/content/queue/${id}/publish-attempt`, { method: 'POST' });
    await res.json().catch(() => ({}));
    await load(filter);
  }

  async function publishManually(id: string) {
    const res = await fetch(`/api/content/queue/${id}/publish-manual`, { method: 'POST' });
    await res.json().catch(() => ({}));
    await load(filter);
  }

  async function bulkApprove() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/content/queue/bulk-approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (res.ok) {
        setSelected(new Set());
        await load(filter);
      }
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function completeFollowUp(id: string) {
    const res = await fetch(`/api/content/followups/${id}/complete`, { method: 'POST' });
    if (res.ok) await load(filter);
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <h1 className={styles.title}>{t('content.queue.title')}</h1>
        <p className={styles.subtitle}>
          {t('content.queue.subtitle')}
        </p>

        {banner?.publishingPaused && (
          <div className={styles.pausedBanner} role="alert">
            {t('content.queue.pausedBanner')}
          </div>
        )}

        <div className={styles.headerActions}>
          <button type="button" className={styles.primaryButton} onClick={generateBatch} disabled={busy}>
            {t('content.queue.generateBatchCta')}
          </button>
          <button type="button" className={styles.secondaryLink} onClick={() => setTriggerOpen((v) => !v)}>
            {t('content.queue.triggerLaunchKitCta')}
          </button>
          <Link href="/content/templates" className={styles.secondaryLink}>
            {t('content.queue.templateLibraryLink')}
          </Link>
        </div>

        {triggerOpen && <LaunchKitTrigger onTriggered={() => setTriggerOpen(false)} />}

        <div className={styles.filterRow} role="tablist" aria-label={t('content.queue.filterAriaLabel')}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={`${styles.filterChip} ${filter === f.key ? styles.filterChipActive : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>

        {filter === 'READY_FOR_REVIEW' && items.length > 0 && (
          <div className={styles.bulkRow}>
            <span>{selected.size} {t('content.queue.selectedSuffix')}</span>
            <button type="button" className={styles.actionButton} onClick={bulkApprove} disabled={busy || selected.size === 0}>
              {t('content.queue.bulkApproveCta')}
            </button>
          </div>
        )}

        {loading && <p className={styles.loadingState}>{t('content.queue.loading')}</p>}
        {!loading && error && (
          <div className={styles.errorState}>
            <p role="alert">{error}</p>
            <button type="button" className={styles.retryButton} onClick={() => load(filter)}>
              {t('common.retry')}
            </button>
          </div>
        )}

        {!loading && !error && filter === 'FOLLOWUPS' && followUps.length === 0 && (
          <p className={styles.emptyState}>{t('content.queue.noFollowups')}</p>
        )}
        {!loading && !error && filter === 'FOLLOWUPS' && followUps.length > 0 && (
          <div className={styles.itemList}>
            {followUps.map((task) => (
              <div key={task.id} className={styles.item}>
                <p className={styles.itemMeta}>{t('content.queue.followupDuePrefix')} {formatDateTime(locale, task.due_at)}</p>
                <div className={styles.itemFooter}>
                  <button type="button" className={styles.actionButton} onClick={() => completeFollowUp(task.id)}>
                    {t('content.queue.markDoneCta')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && filter !== 'FOLLOWUPS' && items.length === 0 && (
          <p className={styles.emptyState}>{t('content.queue.emptyState')}</p>
        )}

        {!loading && !error && filter !== 'FOLLOWUPS' && items.length > 0 && (
          <div className={styles.itemList}>
            {items.map((item) => (
              <div key={item.id} className={`${styles.item} ${item.state === 'BLOCKED' ? styles.itemBlocked : ''}`}>
                <div className={styles.itemHeader}>
                  <div className={styles.itemHeaderMeta}>
                    <span>{contentTypeLabel(t, item.content_type)}</span>
                    {item.platform && <span>· {item.platform}</span>}
                    {/* T-57 RG6 (i18n) — was `{item.category.replace(/_/g, ' ')}`: the raw
                        `ContentCategory` token, merely de-snake-cased, never translated. */}
                    {item.category && <span>· {contentCategoryLabel(t, item.category)}</span>}
                  </div>
                  {/* T-57 RG6 (i18n) — was `{item.state.replace(/_/g, ' ')}`: the raw
                      `ContentQueueState` token, merely de-snake-cased, never translated.
                      `contentStateLabel` reuses this queue's own `filters.*` catalog keys. */}
                  <span className={`${styles.stateChip} ${styles[STATE_CLASS[item.state]]}`}>{contentStateLabel(t, item.state)}</span>
                </div>

                {item.headline && <p className={styles.headline}>{item.headline}</p>}

                {editingId === item.id ? (
                  <textarea className={styles.editArea} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                ) : (
                  <p className={styles.itemBody}>{item.body}</p>
                )}

                {!item.vocab_clean && <p className={styles.violationNote}>{t('content.queue.vocabViolationNote')}</p>}
                {/* T-57 RG7 (i18n) — was raw `{item.publish_hold_reason}`: a backend compliance-hold
                    token (`CFE_BLOCKED_AT_PUBLISH_TIME`, `DOCTRINE_VOCABULARY_VIOLATION`, `CFE_<band>`)
                    rendered verbatim. `reasonDisplay` resolves it to a localized phrase, falling back
                    to a localized "a compliance hold" for the open-ended `CFE_*` set — never the raw
                    token, always still communicating a compliance hold (see reason-display.ts). */}
                {item.publish_hold_reason && <p className={styles.violationNote}>{t('content.queue.holdReasonLabel')} {reasonDisplay(t, item.publish_hold_reason)}</p>}
                {item.scheduled_for && <p className={styles.itemMeta}>{t('content.queue.scheduledForLabel')} {formatDateTime(locale, item.scheduled_for)}</p>}

                <div className={styles.itemFooter}>
                  {item.state === 'READY_FOR_REVIEW' && (
                    <>
                      <input
                        type="checkbox"
                        aria-label={t('content.queue.selectForBulkApproveAria')}
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                      />
                      <button type="button" className={`${styles.actionButton} ${styles.approveButton}`} onClick={() => approveOne(item.id)}>
                        {t('content.queue.approveScheduleCta')}
                      </button>
                    </>
                  )}
                  {(item.state === 'READY_FOR_REVIEW' || item.state === 'DRAFTING') && (
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => {
                        setEditingId(item.id);
                        setEditBody(item.body);
                      }}
                    >
                      {t('content.queue.editCta')}
                    </button>
                  )}
                  {editingId === item.id && (
                    <button type="button" className={styles.actionButton} onClick={() => saveEdit(item.id)}>
                      {t('content.queue.saveEditCta')}
                    </button>
                  )}
                  {item.state === 'SCHEDULED' && (
                    <button type="button" className={styles.actionButton} onClick={() => publishNow(item.id)}>
                      {t('content.queue.publishNowCta')}
                    </button>
                  )}
                  {item.state === 'SCHEDULED' && item.publish_attempts >= 3 && (
                    <button type="button" className={`${styles.actionButton} ${styles.approveButton}`} onClick={() => publishManually(item.id)}>
                      {t('content.queue.publishManuallyPrefix')} {item.publish_attempts}x)
                    </button>
                  )}
                  {item.state !== 'PUBLISHED' && (
                    <button type="button" className={`${styles.actionButton} ${styles.declineButton}`} onClick={() => declineOne(item.id)}>
                      {t('content.queue.declineCta')}
                    </button>
                  )}
                  {item.launch_kit_id && (
                    <Link href={`/content/launch-kit/${item.launch_kit_id}`} className={styles.secondaryLink}>
                      {t('content.queue.viewLaunchKitCta')}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LaunchKitTrigger({ onTriggered }: { onTriggered: () => void }) {
  const t = useT();
  const [newMemberFirstName, setNewMemberFirstName] = useState('');
  const [welcomeVariant, setWelcomeVariant] = useState('PERSONAL_REFERRAL');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    if (!newMemberFirstName.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/content/launch-kit/trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newMemberFirstName, welcomeVariant }),
      });
      const body = await res.json();
      if (!res.ok) {
        // T-57 RE-GATE B [af7789d3] Finding 1 — never render the raw English `body.error`; resolve
        // a locale-correct string from the `errors.*` catalog by the route's machine `code`.
        setResult(errorDisplay(t, body.code));
        return;
      }
      setResult(
        `${t('content.queue.launchKitTrigger.resultGenerated', { ms: body.generationMs })}${
          body.wholeKitHeld
            ? t('content.queue.launchKitTrigger.heldForReview')
            : t('content.queue.launchKitTrigger.readyForReview')
        }`
      );
      onTriggered();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.triggerForm}>
      <label htmlFor="newMemberFirstName">{t('content.queue.launchKitTrigger.newMemberFirstNameLabel')}</label>
      <input
        id="newMemberFirstName"
        value={newMemberFirstName}
        onChange={(e) => setNewMemberFirstName(e.target.value)}
        placeholder={t('content.queue.launchKitTrigger.firstNamePlaceholder')}
      />
      <label htmlFor="welcomeVariant">{t('content.queue.launchKitTrigger.howTheyJoinedLabel')}</label>
      <select id="welcomeVariant" value={welcomeVariant} onChange={(e) => setWelcomeVariant(e.target.value)}>
        <option value="PERSONAL_REFERRAL">{t('content.queue.launchKitTrigger.welcomeVariant.personalReferral')}</option>
        <option value="EVENT_ATTENDEE">{t('content.queue.launchKitTrigger.welcomeVariant.eventAttendee')}</option>
        <option value="BASE_MEMBER_INTRODUCED">{t('content.queue.launchKitTrigger.welcomeVariant.baseMemberIntroduced')}</option>
      </select>
      <button type="button" className={styles.primaryButton} onClick={submit} disabled={busy}>
        {t('content.queue.launchKitTrigger.generateCta')}
      </button>
      {result && <p role="status">{result}</p>}
    </div>
  );
}
