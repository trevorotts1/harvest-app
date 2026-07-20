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

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'DRAFTING', label: 'Drafting' },
  { key: 'READY_FOR_REVIEW', label: 'Ready for Review' },
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'FOLLOWUPS', label: 'Follow-ups' },
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
      setError('Could not load the content queue. Try again.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  async function generateBatch() {
    setBusy(true);
    try {
      const res = await fetch('/api/content/batch/generate', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not generate this week\'s batch.');
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
        <h1 className={styles.title}>Content Queue</h1>
        <p className={styles.subtitle}>
          Every social post, blog, and email draft waits here — compliance-cleared before it can go out. Nothing publishes without your review.
        </p>

        {banner?.publishingPaused && (
          <div className={styles.pausedBanner} role="alert">
            PUBLISHING PAUSED — COMPLIANCE OFFLINE. Nothing can publish right now; there is no manual bypass. Your drafts are safe.
          </div>
        )}

        <div className={styles.headerActions}>
          <button type="button" className={styles.primaryButton} onClick={generateBatch} disabled={busy}>
            Generate this week&apos;s batch
          </button>
          <button type="button" className={styles.secondaryLink} onClick={() => setTriggerOpen((v) => !v)}>
            Trigger a launch kit
          </button>
          <Link href="/content/templates" className={styles.secondaryLink}>
            Template library
          </Link>
        </div>

        {triggerOpen && <LaunchKitTrigger onTriggered={() => setTriggerOpen(false)} />}

        <div className={styles.filterRow} role="tablist" aria-label="Filter the content queue">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={`${styles.filterChip} ${filter === f.key ? styles.filterChipActive : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filter === 'READY_FOR_REVIEW' && items.length > 0 && (
          <div className={styles.bulkRow}>
            <span>{selected.size} selected</span>
            <button type="button" className={styles.actionButton} onClick={bulkApprove} disabled={busy || selected.size === 0}>
              Bulk-approve selected
            </button>
          </div>
        )}

        {loading && <p className={styles.loadingState}>Loading the content queue…</p>}
        {!loading && error && (
          <div className={styles.errorState}>
            <p>{error}</p>
            <button type="button" className={styles.retryButton} onClick={() => load(filter)}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && filter === 'FOLLOWUPS' && followUps.length === 0 && (
          <p className={styles.emptyState}>No engagement follow-ups waiting — nothing published in the last 48 hours needs a check-in yet.</p>
        )}
        {!loading && !error && filter === 'FOLLOWUPS' && followUps.length > 0 && (
          <div className={styles.itemList}>
            {followUps.map((task) => (
              <div key={task.id} className={styles.item}>
                <p className={styles.itemMeta}>Engagement follow-up due {new Date(task.due_at).toLocaleString()}</p>
                <div className={styles.itemFooter}>
                  <button type="button" className={styles.actionButton} onClick={() => completeFollowUp(task.id)}>
                    Mark done
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && filter !== 'FOLLOWUPS' && items.length === 0 && (
          <p className={styles.emptyState}>Nothing here yet — generate this week&apos;s batch to get started.</p>
        )}

        {!loading && !error && filter !== 'FOLLOWUPS' && items.length > 0 && (
          <div className={styles.itemList}>
            {items.map((item) => (
              <div key={item.id} className={`${styles.item} ${item.state === 'BLOCKED' ? styles.itemBlocked : ''}`}>
                <div className={styles.itemHeader}>
                  <div className={styles.itemHeaderMeta}>
                    <span>{item.content_type}</span>
                    {item.platform && <span>· {item.platform}</span>}
                    {item.category && <span>· {item.category.replace(/_/g, ' ')}</span>}
                  </div>
                  <span className={`${styles.stateChip} ${styles[STATE_CLASS[item.state]]}`}>{item.state.replace(/_/g, ' ')}</span>
                </div>

                {item.headline && <p className={styles.headline}>{item.headline}</p>}

                {editingId === item.id ? (
                  <textarea className={styles.editArea} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                ) : (
                  <p className={styles.itemBody}>{item.body}</p>
                )}

                {!item.vocab_clean && <p className={styles.violationNote}>Doctrine vocabulary violation — this draft was held, not published.</p>}
                {item.publish_hold_reason && <p className={styles.violationNote}>Hold reason: {item.publish_hold_reason}</p>}
                {item.scheduled_for && <p className={styles.itemMeta}>Scheduled for {new Date(item.scheduled_for).toLocaleString()}</p>}

                <div className={styles.itemFooter}>
                  {item.state === 'READY_FOR_REVIEW' && (
                    <>
                      <input
                        type="checkbox"
                        aria-label="Select for bulk-approve"
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                      />
                      <button type="button" className={`${styles.actionButton} ${styles.approveButton}`} onClick={() => approveOne(item.id)}>
                        Approve &amp; schedule
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
                      Edit
                    </button>
                  )}
                  {editingId === item.id && (
                    <button type="button" className={styles.actionButton} onClick={() => saveEdit(item.id)}>
                      Save edit
                    </button>
                  )}
                  {item.state === 'SCHEDULED' && (
                    <button type="button" className={styles.actionButton} onClick={() => publishNow(item.id)}>
                      Publish now
                    </button>
                  )}
                  {item.state === 'SCHEDULED' && item.publish_attempts >= 3 && (
                    <button type="button" className={`${styles.actionButton} ${styles.approveButton}`} onClick={() => publishManually(item.id)}>
                      Publish manually (automated publish failed {item.publish_attempts}x)
                    </button>
                  )}
                  {item.state !== 'PUBLISHED' && (
                    <button type="button" className={`${styles.actionButton} ${styles.declineButton}`} onClick={() => declineOne(item.id)}>
                      Decline
                    </button>
                  )}
                  {item.launch_kit_id && (
                    <Link href={`/content/launch-kit/${item.launch_kit_id}`} className={styles.secondaryLink}>
                      View launch kit
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
        setResult(body.error ?? 'Could not generate the launch kit.');
        return;
      }
      setResult(`Launch kit generated in ${body.generationMs}ms.${body.wholeKitHeld ? ' Held for review — one piece needs your attention.' : ' Ready for review.'}`);
      onTriggered();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.triggerForm}>
      <label htmlFor="newMemberFirstName">New member&apos;s first name</label>
      <input
        id="newMemberFirstName"
        value={newMemberFirstName}
        onChange={(e) => setNewMemberFirstName(e.target.value)}
        placeholder="e.g. Jordan"
      />
      <label htmlFor="welcomeVariant">How they joined</label>
      <select id="welcomeVariant" value={welcomeVariant} onChange={(e) => setWelcomeVariant(e.target.value)}>
        <option value="PERSONAL_REFERRAL">Personal referral</option>
        <option value="EVENT_ATTENDEE">Event attendee</option>
        <option value="BASE_MEMBER_INTRODUCED">Base-member introduced</option>
      </select>
      <button type="button" className={styles.primaryButton} onClick={submit} disabled={busy}>
        Generate launch kit
      </button>
      {result && <p>{result}</p>}
    </div>
  );
}
