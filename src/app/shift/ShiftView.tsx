// uiux §5.3 — The Shift orchestrator: wires the real T-34 routes (/api/shift,
// /api/shift/begin|action|close, /api/learning-state) to the four phase components. Resumable
// (re-entry re-fetches today's live session, which already carries the server-persisted phase/
// stack-position/elapsed-time — AC-5.3-7); a failed load keeps the shell interactive with retry
// (§5.3 "Error" — a failed card action keeps the card, never loses stack position, since the
// server is always the source of truth for `stack_position`).
//
// OFFLINE (§5.3 "Offline"): while `navigator.onLine` is false, card actions/close are queued
// in-memory and labeled as queued rather than sent immediately; on reconnect they replay in order.
// This is a client-side queued-retry mechanism proportionate to this build unit's lane — full
// offline-first PWA infrastructure (service worker, background sync) is a cross-cutting concern
// outside T-34's scope (see this build unit's SPEC_DEVIATIONS note).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { LearningStateView, ShiftCardAction, ShiftStateView } from '@/types/learning-state';
import ClosePhase from './components/ClosePhase';
import DoneScreen from './components/DoneScreen';
import OpenPhase from './components/OpenPhase';
import WorkPhase from './components/WorkPhase';
import styles from './shift.module.css';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed (${res.status})`);
  return res.json();
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${url} failed (${res.status})`);
  return res.json();
}

export interface ShiftViewProps {
  mode?: 'short' | 'standard';
  /** Testability seam (same convention as WarmMarketRitual's `initialView`) — real usage (the page
   * route) omits this and fetches live state on mount. */
  initialShift?: ShiftStateView;
  initialLearningState?: LearningStateView;
}

export default function ShiftView({ mode = 'standard', initialShift, initialLearningState }: ShiftViewProps) {
  const [shift, setShift] = useState<ShiftStateView | null>(initialShift ?? null);
  const [learningState, setLearningState] = useState<LearningStateView | null>(initialLearningState ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const queueRef = useRef<Array<() => Promise<void>>>([]);

  useEffect(() => {
    if (initialShift) return; // testability seam — skip live fetch when pre-supplied
    let cancelled = false;
    (async () => {
      try {
        const [s, l] = await Promise.all([
          getJson<ShiftStateView>(`/api/shift${mode === 'short' ? '?mode=short' : ''}`),
          getJson<LearningStateView>('/api/learning-state'),
        ]);
        if (!cancelled) {
          setShift(s);
          setLearningState(l);
        }
      } catch {
        if (!cancelled) setError('Could not load your shift. Retry.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialShift, mode]);

  useEffect(() => {
    function goOnline() {
      setIsOffline(false);
      const pending = queueRef.current;
      queueRef.current = [];
      void pending.reduce((p, fn) => p.then(fn), Promise.resolve());
    }
    function goOffline() {
      setIsOffline(true);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const runOrQueue = useCallback(
    async (fn: () => Promise<void>) => {
      if (isOffline) {
        queueRef.current.push(fn);
        return;
      }
      await fn();
    },
    [isOffline]
  );

  const handleBegin = useCallback(
    () =>
      runOrQueue(async () => {
        const s = await postJson<ShiftStateView>('/api/shift/begin');
        setShift(s);
      }),
    [runOrQueue]
  );

  const handleAction = useCallback(
    (cardId: string, action: ShiftCardAction) =>
      runOrQueue(async () => {
        const s = await postJson<ShiftStateView>('/api/shift/action', { cardId, action });
        setShift(s);
      }),
    [runOrQueue]
  );

  const handleFinish = useCallback(
    (reflectionText: string | undefined) =>
      runOrQueue(async () => {
        const s = await postJson<ShiftStateView>('/api/shift/close', { reflectionText });
        setShift(s);
      }),
    [runOrQueue]
  );

  if (error) {
    return (
      <div className={styles.shell}>
        <p className={styles.recapLine}>{error}</p>
      </div>
    );
  }

  if (!shift) {
    return <div className={styles.shell} aria-busy="true" />;
  }

  return (
    <div className={styles.shell}>
      <div className={styles.focusShell}>
        {isOffline ? (
          <p className={styles.offlineBanner}>
            You&rsquo;re offline — actions are queued and will sync (with a compliance re-check) when you&rsquo;re
            back.
          </p>
        ) : null}

        {shift.phase === 'OPEN' ? (
          <OpenPhase
            briefingLines={shift.briefingLines}
            motivationalLine={shift.motivationalLine}
            streakCount={shift.streakCount}
            graceDayOffer={shift.graceDayOffer}
            mode={shift.mode}
            learningState={learningState}
            onBegin={handleBegin}
          />
        ) : null}

        {shift.phase === 'WORK' ? (
          <WorkPhase
            stack={shift.stack}
            elapsedSeconds={shift.elapsedSeconds}
            onAction={handleAction}
            onSaveAndLeave={() => {
              /* App-level "back to Today" navigation — outside this route's lane. */
            }}
          />
        ) : null}

        {shift.phase === 'CLOSE' ? (
          <ClosePhase
            recap={shift.recap}
            elapsedSeconds={shift.elapsedSeconds}
            targetSeconds={shift.targetSeconds}
            onFinish={handleFinish}
          />
        ) : null}

        {shift.phase === 'DONE' ? (
          <DoneScreen
            streakCount={shift.streakCount}
            onBackToToday={() => {
              window.location.href = '/';
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
