// T-R22 (remediation, T-40R re-QC LOW/UX finding) — the Team surface. Before this page, POST
// /api/messaging/handoff/join (T-40R's upline-accepts-the-bridge endpoint) had no rep-facing UI
// affordance at all: the handoff lifecycle worked end to end (trigger → invite → 24h return sweep;
// see ../community/components/BridgeUplinePanel.tsx and
// ../../services/messaging/handoff/handoff-return-sweep.ts) EXCEPT that the invited UPLINE could
// never actually reach the "accept" action from anywhere in the app. This page closes that gap.
//
// Composes over the REAL, session-scoped, org-gated GET /api/messaging/handoff/pending (this
// remediation's own new read route — consumes `ThreeWayHandoffService.visibleToUpline`, never
// reimplements the org/upline scoping) and invokes the PRE-EXISTING, unmodified POST
// /api/messaging/handoff/join to accept a bridge.
//
// `/team` was already a reserved, pre-gated downstream page prefix (src/middleware.ts's matcher +
// GATED_DOWNSTREAM_PAGE_PREFIXES in onboarding-gate-edge.ts) with no route mounted under it yet —
// this is the first surface to live there, so it inherits the hard onboarding gate with zero gate
// config changes. Reachable from Today's AnchorHeader ("Team" badge, alongside the existing
// Approval Inbox link).

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import PendingBridgeItem, { type PendingBridgeData } from './components/PendingBridgeItem';
import styles from './team.module.css';

export default function TeamPage() {
  const [items, setItems] = useState<PendingBridgeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/messaging/handoff/pending');
      if (!res.ok) {
        setError('Could not load your team requests. Try again.');
        setItems([]);
        return;
      }
      const body = await res.json();
      setItems((body.items ?? []) as PendingBridgeData[]);
    } catch {
      setError('Could not load your team requests. Try again.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleJoin(handoffId: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch('/api/messaging/handoff/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handoffId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (res.status === 409) return { ok: false, error: 'This request can no longer be joined.' };
      if (res.status === 404) return { ok: false, error: 'This request is no longer available.' };
      return { ok: false, error: data.error ?? 'Could not join this conversation.' };
    }
    // The joined bridge is no longer a PENDING one — drop it from this list rather than refetch.
    setItems((prev) => prev.filter((it) => it.id !== handoffId));
    return { ok: true };
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <Link href="/today" className={styles.subtitle}>
          ← Back to Today
        </Link>
        <h1 className={styles.title}>Team</h1>
        <p className={styles.subtitle}>
          When a rep on your team bridges you into a conversation, it waits here. Join within 24
          hours or it returns to them with a coached next step.
        </p>

        {loading && <p className={styles.loadingState}>Loading your team requests…</p>}

        {!loading && error && (
          <div className={styles.errorState}>
            <p>{error}</p>
            <button type="button" className={styles.retryButton} onClick={() => load()}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <p className={styles.emptyState}>No pending bridge requests right now.</p>
        )}

        {!loading && !error && items.length > 0 && (
          <div className={styles.itemList}>
            {items.map((item) => (
              <PendingBridgeItem key={item.id} item={item} onJoin={handleJoin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
