// T-R22R (re-integration of T-R22, master-spec §10.6, §2.5 upline-visibility boundary) — the
// "Pending bridges" tab of WP09's (T-45) `/team` surface. T-R22 originally mounted this affordance
// at the bare `/team` page itself (build/T-R22-handoff-join-ui@765c793), before WP09 landed and
// took `/team` for the upline/RVP dashboard (roster, needs-you-now, downline leak, Field Trainer's
// Ratio). Rather than collide with that page, this re-integration mounts the SAME affordance as a
// sibling tab in WP09's existing tab strip (src/app/team/layout.tsx) — one more tool under the
// `/team` umbrella, reached the same way as Team Calendar / Sponsor Cockpit.
//
// Composes over the REAL, session-scoped, org-gated GET /api/messaging/handoff/pending (re-created
// identically from T-R22 at src/app/api/messaging/handoff/pending/route.ts — consumes
// `ThreeWayHandoffService.visibleToUpline`, never reimplements the org/upline scoping) and invokes
// the PRE-EXISTING, unmodified POST /api/messaging/handoff/join (T-40R) to accept a bridge. Neither
// handoff route nor service is modified by this re-integration — both are consumed as-is.
//
// WP09's own dashboard ("Needs you now") already surfaces INVITED handoffs today via a separate,
// parallel read (DashboardService.getNeedsYouNow) with a "Join the three-way" link that only
// navigates to the rep drill-in page — it does not itself call POST /join. This tab is the actual,
// working accept-the-bridge affordance; the two panels are not wired together, by design, since
// WP09's dashboard is preserved unmodified by this re-integration.

'use client';

import { useCallback, useEffect, useState } from 'react';

import { useT } from '@/app/locale-context';
import PendingBridgesList from './components/PendingBridgesList';
import type { PendingBridgeData } from './components/PendingBridgeItem';

type LoadState = { kind: 'loading' } | { kind: 'ready'; items: PendingBridgeData[] } | { kind: 'failed' };

export default function TeamBridgesPage() {
  const t = useT();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/messaging/handoff/pending');
      if (!res.ok) {
        setState({ kind: 'failed' });
        return;
      }
      const body = await res.json();
      setState({ kind: 'ready', items: (body.items ?? []) as PendingBridgeData[] });
    } catch {
      setState({ kind: 'failed' });
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
      if (res.status === 409) return { ok: false, error: t('team.bridges.joinErrors.conflict') };
      if (res.status === 404) return { ok: false, error: t('team.bridges.joinErrors.notFound') };
      return { ok: false, error: data.error ?? t('team.bridges.joinErrors.generic') };
    }
    // The joined bridge is no longer a PENDING one — drop it from this list rather than refetch.
    setState((prev) =>
      prev.kind === 'ready' ? { kind: 'ready', items: prev.items.filter((it) => it.id !== handoffId) } : prev
    );
    return { ok: true };
  }

  if (state.kind === 'loading') {
    return <div className="card panel"><p>{t('team.bridges.loading')}</p></div>;
  }
  if (state.kind === 'failed') {
    return (
      <div className="card panel">
        <p>{t('team.bridges.loadFailed')}</p>
        <button type="button" className="btn btn-secondary" onClick={load}>{t('common.retry')}</button>
      </div>
    );
  }

  const { items } = state;

  return (
    <div className="stack">
      <section className="card panel">
        <span className="badge">{t('team.bridges.badge')}</span>
        <p style={{ marginTop: 8 }}>
          {t('team.bridges.intro')}
        </p>

        <PendingBridgesList items={items} onJoin={handleJoin} />
      </section>
    </div>
  );
}
