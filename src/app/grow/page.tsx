// WP08 — the Orchard / Grow page (master-spec §13, uiux §5.5). The Primerica orchard or the
// universal network-rings view, org-gated at the API layer (never merely hidden in the UI, §17.1).
// Composes: the toolbar (canvas/list toggle, zoom, time-lapse share), the canvas OR list view, the
// Rules-of-Building chip row, the phased timeline panel, and the org-switch control (§13.5/§18.7 —
// no "Me"/Settings page exists yet for this to live on instead, see OrgSwitchPanel's doc comment).
//
// Day-one empty state (uiux AC-5.5-9, §17.7): renders the rep's own root + the full ghosted 3×4
// vision + ONE action ("Invite your first") — never a blank canvas. `isEmpty` comes straight from
// the API's own `OrgTreeResult.isEmpty`, never inferred client-side.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { buildOverrideMathSheet } from '@/services/taprooting/override-math';
import type { OrgTreeResult, OverrideMathSheet, PhasedTimelineResult } from '@/types/taprooting';
import OrchardCanvas from './components/OrchardCanvas';
import TreeListView from './components/TreeListView';
import RulesOfBuildingChips from './components/RulesOfBuildingChips';
import PhasedTimelinePanel from './components/PhasedTimelinePanel';
import OrgSwitchPanel from './components/OrgSwitchPanel';
import TimeLapseShare from './components/TimeLapseShare';
import styles from './grow.module.css';
import { useT, useLocale } from '@/app/locale-context';
import { StatusMessage } from '@/components/StatusMessage';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; tree: OrgTreeResult; timeline: PhasedTimelineResult; orgType: 'PRIMERICA' | 'EXTERNAL' }
  | { kind: 'failed' };

export default function GrowPage() {
  const t = useT();
  const { locale } = useLocale();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [view, setView] = useState<'canvas' | 'list'>('canvas');
  const [zoom, setZoom] = useState(1);

  const load = useCallback(async () => {
    try {
      const [treeRes, timelineRes] = await Promise.all([
        fetch('/api/taprooting/tree'),
        fetch('/api/taprooting/timeline'),
      ]);
      if (!treeRes.ok || !timelineRes.ok) {
        setState({ kind: 'failed' });
        return;
      }
      const tree = (await treeRes.json()) as OrgTreeResult;
      const timeline = (await timelineRes.json()) as PhasedTimelineResult;
      // Derived from the SAME fresh, DB-backed `tree.branch` the API just computed — never the
      // session/JWT's `orgType` claim, which can lag briefly after a switch (§13.5 "wiped
      // instantly, mid-session"; see org-switch.service.ts's module doc for why the API layer,
      // not the session, is the source of truth here).
      const orgType: 'PRIMERICA' | 'EXTERNAL' = tree.branch === 'primerica' ? 'PRIMERICA' : 'EXTERNAL';
      setState({ kind: 'ready', tree, timeline, orgType });
    } catch {
      setState({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenMath = async (depth: number): Promise<OverrideMathSheet> => buildOverrideMathSheet(depth, locale);

  const handleMarkAttested = async (phase: 'launch' | 'licensing', itemKey: string): Promise<boolean> => {
    const res = await fetch('/api/taprooting/timeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phase, itemKey }),
    });
    if (res.ok) await load();
    return res.ok;
  };

  const handlePreviewInsuranceBlock = async () => {
    const res = await fetch('/api/taprooting/insurance-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await res.json();
    return { released: !!body.released, hardBlockActive: !!body.hardBlockActive, licensingState: body.licensingState ?? 'UNLICENSED' };
  };

  if (state.kind === 'loading') {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.card}>
            <p>{t('grow.page.loading')}</p>
          </div>
        </div>
      </main>
    );
  }

  if (state.kind === 'failed') {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.card}>
            {/* T-57 RG7 (SC 4.1.3) — page-failed state announced via StatusMessage (role=alert). */}
            <StatusMessage>{t('grow.page.loadFailed')}</StatusMessage>
            <button type="button" className={styles.iconButton} onClick={load}>
              {t('common.retry')}
            </button>
          </div>
        </div>
      </main>
    );
  }

  const { tree, timeline, orgType } = state;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <h1 className={styles.title}>{tree.branch === 'primerica' ? t('grow.page.titlePrimerica') : t('grow.page.titleExternal')}</h1>
          <Link href="/today" className={styles.navLink}>
            {t('grow.page.backToToday')}
          </Link>
        </div>

        {/* T-57 R3c-1 (BLOCKER-E1, uiux §5.4 "Entry: /ritual/warm-market from Grow, from the phased
            timeline ... or from a Today queue suggestion") — the ritual is universal (Primerica
            overlay changes calibration, not reachability), so this entry point is unconditional,
            unlike the branch-gated cards below it. */}
        <div className={styles.card}>
          <p>{t('grow.page.warmMarketRitualBody')}</p>
          <Link href="/ritual/warm-market" className={styles.navLink}>
            {t('grow.page.warmMarketRitualCta')}
          </Link>
        </div>

        <div className={styles.card}>
          <div className={styles.toolbar}>
            <div className={styles.segmentGroup} role="group" aria-label={t('grow.page.viewToggleAria')}>
              <button
                type="button"
                className={styles.segmentButton}
                aria-pressed={view === 'canvas'}
                onClick={() => setView('canvas')}
              >
                {t('grow.page.canvasCta')}
              </button>
              <button
                type="button"
                className={styles.segmentButton}
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                {t('grow.page.listCta')}
              </button>
            </div>
            <TimeLapseShare ownerDisplayName={tree.ownerDisplayName} nodes={tree.nodes} />
          </div>

          {tree.isEmpty ? (
            <div className={styles.emptyState}>
              <p>
                {tree.branch === 'primerica'
                  ? t('grow.page.emptyPrimericaBody')
                  : t('grow.page.emptyExternalBody')}
              </p>
              <Link href="/community" className={styles.navLink}>
                {t('grow.page.inviteFirstCta')}
              </Link>
              {view === 'canvas' ? (
                <OrchardCanvas branch={tree.branch} nodes={[]} ghosts={tree.ghosts} zoom={zoom} onZoomIn={() => setZoom((z) => Math.min(2, z + 0.2))} onZoomOut={() => setZoom((z) => Math.max(0.5, z - 0.2))} />
              ) : (
                <TreeListView branch={tree.branch} nodes={[]} ghosts={tree.ghosts} />
              )}
            </div>
          ) : view === 'canvas' ? (
            <OrchardCanvas
              branch={tree.branch}
              nodes={tree.nodes}
              ghosts={tree.ghosts}
              zoom={zoom}
              onZoomIn={() => setZoom((z) => Math.min(2, z + 0.2))}
              onZoomOut={() => setZoom((z) => Math.max(0.5, z - 0.2))}
            />
          ) : (
            <TreeListView branch={tree.branch} nodes={tree.nodes} ghosts={tree.ghosts} />
          )}
        </div>

        {tree.branch === 'primerica' && (
          <div className={styles.card}>
            <RulesOfBuildingChips chips={tree.robChips} onOpenMath={handleOpenMath} />
          </div>
        )}

        <PhasedTimelinePanel timeline={timeline} onMarkAttested={handleMarkAttested} onPreviewInsuranceBlock={handlePreviewInsuranceBlock} />

        <OrgSwitchPanel currentOrgType={orgType} onSwitched={load} />
      </div>
    </main>
  );
}
