// uiux §5.2 — Mission Control / Today (rep view). The CEO's morning report: six zones, each fetched
// and rendered INDEPENDENTLY (master-spec §9.5 / AC-5.2-6) — the page issues ONE request to
// `/api/mission-control/today` (which itself isolates each zone's server-side query, see
// today.service.ts's `safeZone`), and every zone component below additionally sits behind its own
// `ZoneErrorBoundary` so a RENDER-time bug in one zone's component tree can never blank the other
// five either. Session-gated by `withOnboardingGate` on the API route; `/today` is itself a gated
// downstream page (src/lib/auth/onboarding-gate-edge.ts).

'use client';

import { useCallback, useEffect, useState } from 'react';

import AnchorHeader from './components/AnchorHeader';
import BriefingCard from './components/BriefingCard';
import ActionQueue from './components/ActionQueue';
import PipelineGlance from './components/PipelineGlance';
import RatioCards from './components/RatioCards';
import CalendarStrip from './components/CalendarStrip';
import ZoneErrorBoundary from './components/ZoneErrorBoundary';
import styles from './today.module.css';
import type { CalendarEventItem, MissionControlToday, QueueItem } from '@/services/mission-control/types';

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: MissionControlToday } | { kind: 'failed' };

export default function TodayPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mission-control/today');
      if (!res.ok) {
        setState({ kind: 'failed' });
        return;
      }
      const data = (await res.json()) as MissionControlToday;
      setState({ kind: 'ready', data });
    } catch {
      setState({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onQueueAction = useCallback(
    async (item: QueueItem, action: 'approve' | 'decline' | 'confirm') => {
      const kind = item.kind === 'confirm_appointment' ? 'appointment' : 'draft';
      await fetch('/api/mission-control/queue-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id: item.id, action: action === 'confirm' ? undefined : action }),
      });
      await load();
    },
    [load]
  );

  const onMarkAttendance = useCallback(
    async (event: CalendarEventItem, attendance: 'attended' | 'missed') => {
      await fetch('/api/mission-control/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, state: attendance }),
      });
      await load();
    },
    [load]
  );

  if (state.kind === 'loading') {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.zoneCard}>
            <p className={styles.narrativeLine}>Gathering your report…</p>
          </div>
        </div>
      </main>
    );
  }

  if (state.kind === 'failed') {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.zoneCard}>
            <p className={styles.zoneErrorText}>We couldn&apos;t load Today — your work is safe.</p>
            <button type="button" className={styles.queueActionButton} onClick={load}>
              Retry
            </button>
          </div>
        </div>
      </main>
    );
  }

  const { data } = state;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <ZoneErrorBoundary zoneName="header">
          <AnchorHeader result={data.header} />
        </ZoneErrorBoundary>

        <div className={styles.grid}>
          <div className={styles.gridMain}>
            <ZoneErrorBoundary zoneName="briefing">
              <BriefingCard result={data.briefing} />
            </ZoneErrorBoundary>

            <ZoneErrorBoundary zoneName="action queue">
              <ActionQueue result={data.actionQueue} onAction={onQueueAction} />
            </ZoneErrorBoundary>

            <ZoneErrorBoundary zoneName="pipeline">
              <PipelineGlance result={data.pipeline} />
            </ZoneErrorBoundary>
          </div>

          <div className={styles.gridSide}>
            <ZoneErrorBoundary zoneName="ratios">
              <RatioCards result={data.ratios} />
            </ZoneErrorBoundary>

            <ZoneErrorBoundary zoneName="team calendar">
              <CalendarStrip result={data.calendar} onMarkAttendance={onMarkAttendance} />
            </ZoneErrorBoundary>
          </div>
        </div>

        <button type="button" className={styles.primaryCta}>
          Start today&apos;s 30 minutes
        </button>
      </div>
    </main>
  );
}
