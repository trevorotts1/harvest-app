// T-33 — the Approval Inbox page (master-spec §9.2; uiux §5.6). Composes `ApprovalInboxItem`
// (which itself composes `ContactControls`, §9.4) over the REAL `/api/approval-inbox` list route —
// no demo/mock fallback. Filter chips map to the service's own `?state=` vocabulary
// (PENDING/APPROVED/DECLINED/HELD/ALL); the default "Awaiting" chip omits the param entirely, which
// `ApprovalInboxService.listInbox` already treats as the PENDING+HELD "awaiting attention" view.
//
// NO BATCH APPROVE: `handleApprove`/`handleDecline`/`handleEdit` each take exactly one draft id —
// there is no multi-select state anywhere on this page, by construction (uiux §5.6 "Batch operations
// do not exist by design").
//
// EDIT RE-ENTERS THE CFE: `handleEdit` posts to `/api/approval-inbox/edit`, which re-evaluates the
// content server-side before this page ever sees the new band; the response's `draft` fields (never
// the pre-edit ones) are merged into the item so a now-HELD edit renders HELD immediately.
//
// OFFLINE (T-54, master-spec §17.6; uiux §6.4/§4.3): approve/decline/edit taken while offline are
// NEVER a bare `fetch` that can silently throw — they enqueue onto the shared, persisted
// `PersistentOfflineQueue` (`src/lib/offline/offline-queue.ts`, T-R11) via `./offline.ts`'s handler
// map, optimistically mark the item `queuedOffline` (uiux §4.3's own named state — the item stays
// visible with an honest "will finish when you're back online; it will re-check compliance first"
// banner, never vanishes and never fabricates a completed action), and replay in FIFO order the
// moment the browser reconnects. EDIT's replay hits the exact same `/api/approval-inbox/edit` route
// online submits use, so an offline-composed edit RE-ENTERS THE CFE against its then-CURRENT state
// on reconnect — fail-closed if the CFE is unavailable (`./offline.ts`'s header has the full
// argument). A permanent, non-retryable rejection (the item's state moved on before this action
// could land) is never retried forever — it's surfaced as an explanation and the list reloads from
// the server so the rep sees the item's real state, mirroring master-spec §17.6's own "an approval
// that expired while offline returns to the queue with an explanation".

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { PersistentOfflineQueue } from '@/lib/offline/offline-queue';
import { isOnline, subscribeOnlineStatus } from '@/lib/offline/online-status';

import ApprovalInboxItem, { type InboxItemData } from './components/ApprovalInboxItem';
import { inboxEmptyStateMessage, type InboxFilterKey as FilterKey } from './empty-state';
import {
  approveMutationId,
  createInboxQueueHandlers,
  declineMutationId,
  deriveQueuedDraftIds,
  INBOX_MUTATION_KIND,
  INBOX_QUEUE_STORAGE_KEY,
  postJson,
  type PermanentRejectionInfo,
} from './offline';
import styles from './inbox.module.css';

const FILTERS: { key: FilterKey; label: string; stateParam?: string }[] = [
  { key: 'AWAITING', label: 'Awaiting' },
  { key: 'HELD', label: 'Held', stateParam: 'HELD' },
  { key: 'APPROVED', label: 'Approved', stateParam: 'APPROVED' },
  { key: 'DECLINED', label: 'Declined', stateParam: 'DECLINED' },
  { key: 'ALL', label: 'All', stateParam: 'ALL' },
];

export default function ApprovalInboxPage() {
  const [filter, setFilter] = useState<FilterKey>('AWAITING');
  const [items, setItems] = useState<InboxItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // OFFLINE (T-54): connectivity + the persisted, replay-on-reconnect mutation queue for
  // approve/decline/edit — see ./offline.ts's header for the CFE re-validation-on-reconnect
  // guarantee this wiring closes (master-spec §17.6). Constructed once (guarded so a re-render never
  // re-reads storage or drops what's already queued), same convention as WarmMarketRitual.tsx.
  const [isOffline, setIsOffline] = useState(() => !isOnline());
  const [queueLength, setQueueLength] = useState(0);
  const [syncing, setSyncing] = useState<{ total: number; remaining: number } | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const queueRef = useRef<PersistentOfflineQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new PersistentOfflineQueue({ storageKey: INBOX_QUEUE_STORAGE_KEY });
  }

  const load = useCallback(async (activeFilter: FilterKey) => {
    setLoading(true);
    setError(null);
    try {
      const stateParam = FILTERS.find((f) => f.key === activeFilter)?.stateParam;
      const url = stateParam ? `/api/approval-inbox?state=${stateParam}` : '/api/approval-inbox';
      const res = await fetch(url);
      if (!res.ok) {
        setError('Could not load the approval inbox. Try again.');
        setItems([]);
        return;
      }
      const body = await res.json();
      const fetched = (body.items ?? []) as InboxItemData[];
      // Re-apply `queuedOffline` for anything STILL genuinely queued (see
      // `deriveQueuedDraftIds`'s own doc comment) — the server's list response has no notion of a
      // locally-queued-but-not-yet-synced mutation, so a reload never silently drops that banner.
      const stillQueued = queueRef.current ? deriveQueuedDraftIds(queueRef.current) : new Set<string>();
      setItems(
        stillQueued.size === 0 ? fetched : fetched.map((it) => (stillQueued.has(it.id) ? { ...it, queuedOffline: true } : it))
      );
    } catch {
      setError('Could not load the approval inbox. Try again.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  // OFFLINE (T-54): replays everything queued, in FIFO order, against the real routes. A permanent
  // (business-final) rejection is resolved by the handler itself (see ./offline.ts) — collected here
  // only so it can be surfaced honestly, never silently. §6.4 "failures surface individually, never
  // as a silent partial sync".
  const flushQueue = useCallback(async () => {
    const q = queueRef.current;
    if (!q || q.length === 0) return;
    const total = q.length;
    setSyncing({ total, remaining: total });
    const rejections: PermanentRejectionInfo[] = [];
    const handlers = createInboxQueueHandlers(postJson, (info) => rejections.push(info));
    const result = await q.replay(handlers, () => {
      setQueueLength(q.length);
      setSyncing((prev) => (prev ? { ...prev, remaining: q.length } : prev));
    });
    setQueueLength(q.length);
    setSyncing(null);

    const notices: string[] = [];
    if (rejections.length > 0) {
      notices.push(
        rejections.length === 1
          ? rejections[0].message
          : `${rejections.length} queued actions could not complete — they need review again.`
      );
    }
    if (result.failed) {
      // A genuinely transient failure (network/5xx) — still queued, untouched, for the next attempt.
      notices.push(
        `${result.synced > 0 ? `${result.synced} item(s) synced. ` : ''}1 item couldn't sync yet (${result.failed.kind}) — it's still queued and we'll try again when you're back online.`
      );
    }
    setSyncNotice(notices.length > 0 ? notices.join(' ') : null);

    // Server truth may have changed for anything just replayed (approved/declined/re-checked to
    // HELD, or bounced back for review) — reload so the list reflects it honestly rather than
    // trusting the optimistic `queuedOffline` mark any longer.
    if (result.synced > 0 || rejections.length > 0) {
      await load(filter);
    }
  }, [filter, load]);

  useEffect(() => {
    const unsubscribe = subscribeOnlineStatus((online) => {
      setIsOffline(!online);
      if (online) void flushQueue();
    });
    return unsubscribe;
  }, [flushQueue]);

  useEffect(() => {
    // Initial queue length (e.g. items left over from a prior offline session) + an opportunistic
    // flush if we're already online at mount with something still queued from last time.
    const q = queueRef.current;
    if (!q) return;
    setQueueLength(q.length);
    if (!isOffline && q.length > 0) void flushQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleApprove(draftId: string, justification?: string): Promise<{ ok: boolean; error?: string }> {
    if (isOffline) {
      const q = queueRef.current!;
      // T-R16 — carries the flagged-approve justification (if any) through the offline queue so a
      // replay on reconnect posts the exact same body an online submit would (see ./offline.ts).
      q.enqueue(INBOX_MUTATION_KIND.APPROVE, { draftId, justification }, approveMutationId(draftId));
      setQueueLength(q.length);
      setItems((prev) => prev.map((it) => (it.id === draftId ? { ...it, queuedOffline: true } : it)));
      return { ok: true };
    }
    const res = await fetch('/api/approval-inbox/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId, justification }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? 'This draft could not be approved.' };
    setItems((prev) => prev.filter((it) => it.id !== draftId));
    return { ok: true };
  }

  async function handleDecline(
    draftId: string,
    reason: string,
    note?: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (isOffline) {
      const q = queueRef.current!;
      q.enqueue(INBOX_MUTATION_KIND.DECLINE, { draftId, reason, note }, declineMutationId(draftId));
      setQueueLength(q.length);
      setItems((prev) => prev.map((it) => (it.id === draftId ? { ...it, queuedOffline: true } : it)));
      return { ok: true };
    }
    const res = await fetch('/api/approval-inbox/decline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId, reason, note }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? 'This draft could not be declined.' };
    setItems((prev) => prev.filter((it) => it.id !== draftId));
    return { ok: true };
  }

  async function handleEdit(
    draftId: string,
    body: string
  ): Promise<{ ok: boolean; item?: InboxItemData; error?: string }> {
    if (isOffline) {
      const existing = items.find((it) => it.id === draftId);
      if (!existing) return { ok: false, error: 'This draft is no longer in the current view.' };
      const q = queueRef.current!;
      // No fixed id: a rep may save an edit, keep editing, and save again while still offline —
      // each is a distinct mutation and both must replay, in order (see ./offline.ts's header).
      q.enqueue(INBOX_MUTATION_KIND.EDIT, { draftId, body });
      setQueueLength(q.length);
      const merged: InboxItemData = { ...existing, body, queuedOffline: true };
      setItems((prev) => prev.map((it) => (it.id === draftId ? merged : it)));
      return { ok: true, item: merged };
    }
    const res = await fetch('/api/approval-inbox/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId, body }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? 'This edit could not be saved.' };

    const existing = items.find((it) => it.id === draftId);
    if (!existing) return { ok: false, error: 'This draft is no longer in the current view.' };

    // The re-checked band ALWAYS replaces the stale one — never a pre-edit field survives the merge.
    const merged: InboxItemData = {
      ...existing,
      body: data.draft.body,
      cfe_outcome: data.draft.cfe_outcome,
      cfe_risk_score: data.draft.cfe_risk_score,
      approval_state: data.draft.approval_state,
    };
    setItems((prev) => prev.map((it) => (it.id === draftId ? merged : it)));
    return { ok: true, item: merged };
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>Approval Inbox</h1>
          {/* WP08 reachability wiring — see community/page.tsx's identical Grow link. */}
          <Link href="/grow" className={styles.growLink}>
            Grow →
          </Link>
        </div>
        <p className={styles.subtitle}>
          Every agent-drafted message waits here for your review — nothing sends without your approval.
        </p>

        {/* OFFLINE (T-54, §6.4/§6.7): honest connectivity state — never a silent queue, never a
            fabricated "synced" while actually offline. */}
        {isOffline && (
          <p className={styles.offlineBanner} role="status">
            Offline — showing your saved field
            {queueLength > 0 ? ` (${queueLength} action${queueLength === 1 ? '' : 's'} queued)` : ''}. Anything you
            approve, decline, or edit will sync and re-check compliance when you&rsquo;re back.
          </p>
        )}
        {!isOffline && syncing && (
          <p className={styles.offlineBanner} role="status">
            Back online — syncing {syncing.total} item{syncing.total === 1 ? '' : 's'}…
          </p>
        )}
        {!isOffline && !syncing && syncNotice && (
          <p className={styles.syncFailureNotice} role="alert">
            {syncNotice}
          </p>
        )}

        <div className={styles.filterRow} role="tablist" aria-label="Filter the approval inbox">
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

        {loading && <p className={styles.loadingState}>Loading the approval inbox…</p>}

        {!loading && error && (
          <div className={styles.errorState}>
            <p>{error}</p>
            <button type="button" className={styles.retryButton} onClick={() => load(filter)}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <p className={styles.emptyState}>{inboxEmptyStateMessage(filter)}</p>
        )}

        {!loading && !error && items.length > 0 && (
          <div className={styles.itemList}>
            {items.map((item) => (
              <ApprovalInboxItem
                key={item.id}
                item={item}
                onApprove={handleApprove}
                onDecline={handleDecline}
                onEdit={handleEdit}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
