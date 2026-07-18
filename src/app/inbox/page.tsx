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

'use client';

import { useCallback, useEffect, useState } from 'react';

import ApprovalInboxItem, { type InboxItemData } from './components/ApprovalInboxItem';
import styles from './inbox.module.css';

type FilterKey = 'AWAITING' | 'HELD' | 'APPROVED' | 'DECLINED' | 'ALL';

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
      setItems((body.items ?? []) as InboxItemData[]);
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

  async function handleApprove(draftId: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/approval-inbox/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId }),
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
        <h1 className={styles.title}>Approval Inbox</h1>
        <p className={styles.subtitle}>
          Every agent-drafted message waits here for your review — nothing sends without your approval.
        </p>

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
          <p className={styles.emptyState}>Nothing waiting on you right now — a good day.</p>
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
