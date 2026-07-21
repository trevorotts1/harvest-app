// uiux §5.2 — Mission Control / Today (rep view). The CEO's morning report: six zones, each fetched
// and rendered INDEPENDENTLY (master-spec §9.5 / AC-5.2-6) — the page issues ONE request to
// `/api/mission-control/today` (which itself isolates each zone's server-side query, see
// today.service.ts's `safeZone`), and every zone component below additionally sits behind its own
// `ZoneErrorBoundary` so a RENDER-time bug in one zone's component tree can never blank the other
// five either. Session-gated by `withOnboardingGate` on the API route; `/today` is itself a gated
// downstream page (src/lib/auth/onboarding-gate-edge.ts).
//
// OFFLINE (T-54, master-spec §17.6; uiux §6.4/§4.2): before this build unit, `onQueueAction` and
// `onMarkAttendance` were a bare `fetch` with NO offline handling at all (T-51 finding) — offline,
// the fetch simply rejects and the action is silently lost. Both now run through the same shared
// `PersistentOfflineQueue` primitive (`src/lib/offline/offline-queue.ts`, T-R11) every other T-54
// offline surface uses, via `./offline.ts`'s handler map: taken while offline, the mutation is
// enqueued (visible `sync-queued` state on the affected row, uiux §4.2), and replayed in FIFO order
// the moment the browser reconnects, against the exact same routes an online action would hit — so
// `actOnQueueDraft`'s fail-closed CFE-outcome re-check and every ownership check apply on replay
// exactly as they do online, never bypassed.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { PersistentOfflineQueue } from '@/lib/offline/offline-queue';
import { isOnline, subscribeOnlineStatus } from '@/lib/offline/online-status';

import AnchorHeader from './components/AnchorHeader';
import BriefingCard from './components/BriefingCard';
import ActionQueue from './components/ActionQueue';
import PipelineGlance from './components/PipelineGlance';
import RatioCards from './components/RatioCards';
import CalendarStrip from './components/CalendarStrip';
import ZoneErrorBoundary from './components/ZoneErrorBoundary';
import WP07Panel from './components/WP07Panel';
import {
  attendanceMutationId,
  createTodayQueueHandlers,
  postJson,
  queueActionMutationId,
  TODAY_MUTATION_KIND,
  TODAY_QUEUE_STORAGE_KEY,
  type AttendanceMutationPayload,
  type QueueActionMutationPayload,
  type TodayPermanentRejectionInfo,
} from './offline';
import styles from './today.module.css';
import type { CalendarEventItem, MissionControlToday, QueueItem } from '@/services/mission-control/types';

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: MissionControlToday } | { kind: 'failed' };

/** Re-derives which Action Queue items / calendar events are STILL genuinely queued (not yet
 *  resolved, one way or the other) straight from the persisted queue's own contents — never a
 *  blanket "clear everything" after a flush, which would visually un-queue an item that's still
 *  actually sitting there because its replay hit a TRANSIENT failure (see ./offline.ts's header on
 *  permanent vs transient). This is the single source of truth for both the initial-mount case
 *  (leftover items from a prior offline session) and the post-flush case. */
function deriveQueuedIds(q: PersistentOfflineQueue): { actionIds: Set<string>; eventIds: Set<string> } {
  const actionIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const m of q.items) {
    if (m.kind === TODAY_MUTATION_KIND.QUEUE_ACTION) {
      actionIds.add((m.payload as QueueActionMutationPayload).id);
    } else if (m.kind === TODAY_MUTATION_KIND.ATTENDANCE) {
      eventIds.add((m.payload as AttendanceMutationPayload).eventId);
    }
  }
  return { actionIds, eventIds };
}

export default function TodayPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  // OFFLINE (T-54): connectivity + the persisted, replay-on-reconnect mutation queue for the Action
  // Queue's approve/decline/confirm and the Team calendar's attendance marking — see ./offline.ts's
  // header. Constructed once (guarded so a re-render never re-reads storage or drops what's already
  // queued), same convention as WarmMarketRitual.tsx / the Approval Inbox page.
  const [isOffline, setIsOffline] = useState(() => !isOnline());
  const [queueLength, setQueueLength] = useState(0);
  const [syncing, setSyncing] = useState<{ total: number; remaining: number } | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [queuedActionIds, setQueuedActionIds] = useState<ReadonlySet<string>>(new Set());
  const [queuedEventIds, setQueuedEventIds] = useState<ReadonlySet<string>>(new Set());
  const queueRef = useRef<PersistentOfflineQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new PersistentOfflineQueue({ storageKey: TODAY_QUEUE_STORAGE_KEY });
  }

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

  // OFFLINE (T-54): replays everything queued, in FIFO order, against the real routes. A permanent
  // (business-final) rejection is resolved by the handler itself (see ./offline.ts) — collected
  // here only so it can be surfaced honestly, never silently (§6.4 "failures surface individually,
  // never as a silent partial sync").
  const flushQueue = useCallback(async () => {
    const q = queueRef.current;
    if (!q || q.length === 0) return;
    const total = q.length;
    setSyncing({ total, remaining: total });
    const rejections: TodayPermanentRejectionInfo[] = [];
    const handlers = createTodayQueueHandlers(postJson, (info) => rejections.push(info));
    const result = await q.replay(handlers, () => {
      setQueueLength(q.length);
      setSyncing((prev) => (prev ? { ...prev, remaining: q.length } : prev));
    });
    setQueueLength(q.length);
    setSyncing(null);
    const { actionIds, eventIds } = deriveQueuedIds(q);
    setQueuedActionIds(actionIds);
    setQueuedEventIds(eventIds);

    const notices: string[] = [];
    if (rejections.length > 0) {
      notices.push(
        rejections.length === 1
          ? rejections[0].message
          : `${rejections.length} queued actions could not complete — they need review again.`
      );
    }
    if (result.failed) {
      notices.push(
        `${result.synced > 0 ? `${result.synced} item(s) synced. ` : ''}1 item couldn't sync yet (${result.failed.kind}) — it's still queued and we'll try again when you're back online.`
      );
    }
    setSyncNotice(notices.length > 0 ? notices.join(' ') : null);

    // Server truth may have changed for anything just replayed — reload Today so every zone
    // reflects it honestly rather than trusting the optimistic queued marks any longer.
    if (result.synced > 0 || rejections.length > 0) {
      await load();
    }
  }, [load]);

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
    const { actionIds, eventIds } = deriveQueuedIds(q);
    setQueuedActionIds(actionIds);
    setQueuedEventIds(eventIds);
    if (!isOffline && q.length > 0) void flushQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onQueueAction = useCallback(
    async (item: QueueItem, action: 'approve' | 'decline' | 'confirm') => {
      const kind = item.kind === 'confirm_appointment' ? 'appointment' : 'draft';
      const body = { kind, id: item.id, action: action === 'confirm' ? undefined : action } as const;

      if (isOffline) {
        const q = queueRef.current!;
        q.enqueue(TODAY_MUTATION_KIND.QUEUE_ACTION, body, queueActionMutationId(kind, item.id, body.action));
        setQueueLength(q.length);
        setQueuedActionIds((prev) => new Set(prev).add(item.id));
        return;
      }

      await fetch('/api/mission-control/queue-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      await load();
    },
    [isOffline, load]
  );

  const onMarkAttendance = useCallback(
    async (event: CalendarEventItem, attendance: 'attended' | 'missed') => {
      if (isOffline) {
        const q = queueRef.current!;
        q.enqueue(
          TODAY_MUTATION_KIND.ATTENDANCE,
          { eventId: event.id, state: attendance },
          attendanceMutationId(event.id)
        );
        setQueueLength(q.length);
        setQueuedEventIds((prev) => new Set(prev).add(event.id));
        return;
      }

      await fetch('/api/mission-control/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, state: attendance }),
      });
      await load();
    },
    [isOffline, load]
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
        {/* T-45 (WP09 §14.4/uiux §5.9 "Entry: Team rail item") — the reachable entry point into the
            team calendar + upline/RVP dashboard + Sponsor Cockpit. `/team` is itself a gated
            downstream page (GATED_DOWNSTREAM_PAGE_PREFIXES) and each sub-page authorizes itself. */}
        <nav aria-label="Team navigation" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Link href="/team" style={{ fontWeight: 600 }}>Team</Link>
        </nav>

        {/* OFFLINE (T-54, §6.4/§6.7): honest connectivity state — never a silent queue, never a
            fabricated "synced" while actually offline. */}
        {isOffline && (
          <p className={styles.offlineBanner} role="status">
            Offline — showing your saved field
            {queueLength > 0 ? ` (${queueLength} action${queueLength === 1 ? '' : 's'} queued)` : ''}. Anything you
            approve, decline, confirm, or mark will sync when you&rsquo;re back.
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

        <ZoneErrorBoundary zoneName="header">
          <AnchorHeader result={data.header} />
        </ZoneErrorBoundary>

        {/* T-43 (WP07 §12.2/§12.3): First-48 banner, milestone pins, and Learn/Grow/Momentum links —
            independently error-bounded like every other zone (uiux AC-5.2-6). */}
        <ZoneErrorBoundary zoneName="wp07">
          <WP07Panel milestones={data.milestones ?? { status: 'error', message: 'Not available.' }} />
        </ZoneErrorBoundary>

        <div className={styles.grid}>
          <div className={styles.gridMain}>
            <ZoneErrorBoundary zoneName="briefing">
              <BriefingCard result={data.briefing} />
            </ZoneErrorBoundary>

            <ZoneErrorBoundary zoneName="action queue">
              <ActionQueue result={data.actionQueue} onAction={onQueueAction} queuedOfflineIds={queuedActionIds} />
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
              <CalendarStrip
                result={data.calendar}
                onMarkAttendance={onMarkAttendance}
                queuedOfflineEventIds={queuedEventIds}
              />
            </ZoneErrorBoundary>
          </div>
        </div>

        {/* T-35R (WP04 gate remediation): master-spec §9.8 "Entered from Today's primary CTA" /
            uiux §5.2 AC-5.2-2 — the daily ritual (T-34, /shift) is now live, so this CTA navigates
            there. `/shift` is itself a gated downstream page (see
            GATED_DOWNSTREAM_PAGE_PREFIXES in src/lib/auth/onboarding-gate-edge.ts), so an
            authenticated-but-not-onboarded rep is still correctly routed into onboarding first. */}
        <Link href="/shift" className={styles.primaryCta}>
          Start today&apos;s 30 minutes
        </Link>

        {/* T-41 (WP06 §11.5 Unified Content Queue / §11.4 Launch Kit): the reachable entry point to
            the social/blog/email content surface — mirrors the same plain-Link pattern the T-32 QC
            fix used for the Approval Inbox badge (AnchorHeader.tsx) rather than reaching into the
            mission-control zone service/types this build unit does not own. */}
        <Link href="/content" className={styles.queueReviewLink}>
          Content Queue — social, blog &amp; email drafts waiting for review
        </Link>
      </div>
    </main>
  );
}
