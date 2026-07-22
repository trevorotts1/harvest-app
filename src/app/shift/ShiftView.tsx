// uiux §5.3 — The Shift orchestrator: wires the real T-34 routes (/api/shift,
// /api/shift/begin|action|close, /api/learning-state) to the four phase components. Resumable
// (re-entry re-fetches today's live session, which already carries the server-persisted phase/
// stack-position/elapsed-time — AC-5.3-7); a failed load keeps the shell interactive with retry
// (§5.3 "Error" — a failed card action keeps the card, never loses stack position, since the
// server is always the source of truth for `stack_position`).
//
// OFFLINE (§5.3 "Offline", T-34 QC fix D3): while `navigator.onLine` is false, a Work-phase card
// action (`handleAction`) applies an OPTIMISTIC local transition to the visible stack — via the
// pure `applyOptimisticAction` below — the instant it's taken, so the ritual visibly advances
// (the acted-on card leaves/reorders and the next one shows) instead of silently doing nothing
// until reconnect. The REAL write is deferred onto `OfflineActionQueue` and replayed, in the exact
// order the rep took the actions, the moment the browser comes back online — `setShift(realView)`
// on each replayed response then overwrites the optimistic guess with the server's authoritative
// answer (recap counts, true skip-twice semantics, and any fail-closed refusal — T-34 QC D2 — all
// belong to the server, never the optimistic guess). `handleBegin`/`handleFinish` (Open/Close
// phase) are queued the same way but WITHOUT an optimistic transition — §5.3 names the Work-phase
// stack specifically as the thing that must visibly advance; Open/Close are one-shot phase
// transitions with no per-card stack to advance. This is a client-side queued-retry mechanism
// proportionate to this build unit's lane — full offline-first PWA infrastructure (service worker,
// background sync) is a cross-cutting concern outside T-34's scope (see this build unit's
// SPEC_DEVIATIONS note).
//
// TESTING NOTE: `applyOptimisticAction` and `OfflineActionQueue` are exported specifically so
// tests/unit/shift-view.test.ts can exercise the real production logic directly — this repo's Jest
// config runs `testEnvironment: 'node'` (no DOM/jsdom, no @testing-library — see jest.config.js),
// the same constraint every other stateful client orchestrator in this codebase already lives
// with (e.g. WarmMarketRitual.tsx has zero interaction tests), so the `window`/`navigator`-wired
// hooks below aren't independently exercised end-to-end. Extracting the framework-free pieces this
// way is what makes them testable at all under that constraint.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '@/app/locale-context';
import type { LearningStateView, ShiftCardAction, ShiftPhase, ShiftStateView } from '@/types/learning-state';
import ClosePhase from './components/ClosePhase';
import DoneScreen from './components/DoneScreen';
import OpenPhase from './components/OpenPhase';
import WorkPhase from './components/WorkPhase';
import styles from './shift.module.css';

/** T-34 QC fix (D3) — a pure, framework-free simulation of what the server's real
 * `ShiftService.actionCard` will do to the Work-phase stack for one action: `SKIP` moves the card
 * behind the rest (mirrors the "skip once -> end of stack" semantics); every other action
 * (APPROVE/DECLINE/CONFIRM/LOG) removes it outright (it is no longer PENDING/PROPOSED). This is
 * legible, not authoritative — true skip-twice-removal, recap counters, and `stack_position` stay
 * entirely server-owned and are corrected for real the moment the queued write replays (see
 * `OfflineActionQueue.flush` below). Mirrors `ShiftService.actionCard`'s own auto-collapse too:
 * once the LOCAL stack empties out from a non-SKIP action, Work is optimistically over and the
 * phase advances to CLOSE immediately, rather than leaving WorkPhase rendering nothing until the
 * real response confirms the same thing. A `cardId` no longer present in the stack (e.g. it was
 * already actioned) is a safe no-op — the view is returned unchanged. */
export function applyOptimisticAction(view: ShiftStateView, cardId: string, action: ShiftCardAction): ShiftStateView {
  const idx = view.stack.findIndex((c) => c.id === cardId);
  if (idx === -1) return view;
  const card = view.stack[idx];
  const withoutCard = [...view.stack.slice(0, idx), ...view.stack.slice(idx + 1)];
  const nextStack = action === 'SKIP' ? [...withoutCard, card] : withoutCard;
  const nextPhase: ShiftPhase = nextStack.length === 0 && view.phase === 'WORK' ? 'CLOSE' : view.phase;
  return { ...view, stack: nextStack, phase: nextPhase };
}

/** T-34 QC fix (D3) — a small, framework-free FIFO offline-action queue: decouples "run this now
 * or defer it" from React so the policy is unit-testable without a DOM (see the TESTING NOTE
 * above). `runOrQueue` runs `fn` immediately when online; while offline it fires `onOptimistic`
 * synchronously — so the caller can apply a local-only state update the instant the action is
 * taken — and defers `fn` itself for later replay. `flush` replays every deferred write, in
 * original (FIFO) order, one at a time — the real server call order must match the order the rep
 * actually took the actions in. The queue is cleared up front so a write enqueued mid-flush (e.g.
 * another offline action taken the moment reconnect starts replaying) is deferred to the NEXT
 * flush rather than dropped or re-run. */
export class OfflineActionQueue {
  private pending: Array<() => Promise<void>> = [];

  get length(): number {
    return this.pending.length;
  }

  runOrQueue(isOffline: boolean, fn: () => Promise<void>, onOptimistic?: () => void): Promise<void> | undefined {
    if (isOffline) {
      onOptimistic?.();
      this.pending.push(fn);
      return undefined;
    }
    return fn();
  }

  async flush(): Promise<void> {
    const queued = this.pending;
    this.pending = [];
    for (const fn of queued) {
      await fn();
    }
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed (${res.status})`);
  return res.json();
}

/** A failed `postJson` throw carries the route's machine `code` (and `currentState`, where the
 *  route sets one) as extra properties on the `Error` — never as its `.message`. This is the
 *  "surface the code, not the prose" half of the T-57 RE-GATE ROUND-3 (B [a7133fce]) fix: every
 *  Work-phase action (`handleAction` -> `/api/shift/action`) shares this one POST helper, so
 *  fixing it here means `DraftApprovalCard`'s approve/decline handlers (the other half of the fix)
 *  can resolve a real, localized display string via `errorDisplay` for ANY Work-phase action
 *  refusal — not just the two codes that prompted this fix (`NOT_OWNED`/`REQUIRES_REVIEW`) — the
 *  instant a future route teaches this endpoint a new `code`. */
export interface CodedActionError extends Error {
  code?: string;
  currentState?: string;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // Read the failure body so the route's machine `code` survives this generic helper instead of
    // being discarded into an opaque "POST ... failed (status)" message. The raw `error` prose
    // (always English on this route, see api/shift/action/route.ts) is deliberately NEVER read
    // here for display — callers resolve a DISPLAY string from `code` via `errorDisplay`,
    // mirroring `inbox/page.tsx`'s handleApprove/handleDecline and this file's own
    // `makeEditHandler` (which reads `code` directly since it does its own fetch).
    let code: string | undefined;
    let currentState: string | undefined;
    try {
      const data = (await res.json()) as { code?: unknown; currentState?: unknown };
      code = typeof data.code === 'string' ? data.code : undefined;
      currentState = typeof data.currentState === 'string' ? data.currentState : undefined;
    } catch {
      // Body wasn't JSON (or already consumed) — fall through with no code; the catch site still
      // resolves a safe, localized `errors.generic` display, never English/technical prose.
    }
    const err: CodedActionError = new Error(`POST ${url} failed (${res.status})`);
    err.code = code;
    err.currentState = currentState;
    throw err;
  }
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
  const t = useT();
  const [shift, setShift] = useState<ShiftStateView | null>(initialShift ?? null);
  const [learningState, setLearningState] = useState<LearningStateView | null>(initialLearningState ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const queueRef = useRef(new OfflineActionQueue());

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
        if (!cancelled) setError(t('shift.loadError'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialShift, mode, t]);

  useEffect(() => {
    function goOnline() {
      setIsOffline(false);
      void queueRef.current.flush();
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
    (fn: () => Promise<void>, onOptimistic?: () => void) => queueRef.current.runOrQueue(isOffline, fn, onOptimistic),
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
      runOrQueue(
        async () => {
          const s = await postJson<ShiftStateView>('/api/shift/action', { cardId, action });
          setShift(s);
        },
        // T-34 QC fix (D3): fires ONLY while offline (see OfflineActionQueue.runOrQueue) — applies
        // the local-only optimistic stack advance immediately; the real write above replaces it
        // with the server's authoritative view once it actually replays on reconnect.
        () => setShift((prev) => (prev ? applyOptimisticAction(prev, cardId, action) : prev))
      ),
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
        {/* T-57 RG4 (A, WCAG SC 4.1.3) — a top-level Shift load failure must be announced to AT.
            role="alert" (assertive) mirrors the landed content/page.tsx load-error precedent. */}
        <p className={styles.recapLine} role="alert">{error}</p>
      </div>
    );
  }

  if (!shift) {
    // T-57 RE-GATE fix (D2 BLOCKER, master-spec SC9): every real mount lands here FIRST — before
    // the initial `/api/shift` + `/api/learning-state` fetch above resolves — so this branch is
    // not a rare edge case, it is what every rep sees on every open of this screen. It used to be
    // a bare `aria-busy` div with ZERO text content: a screen-reader user got nothing at all
    // during the load window (an SC9 violation). Narrated Open-phase loading state, mirroring
    // TodayPage's own loading branch (today/page.tsx `state.kind === 'loading'` ->
    // `t('today.loadingReport')`): real narrated text plus a decorative (aria-hidden) skeleton
    // silhouette of the Open-phase card about to render — the skeleton bars carry no information
    // of their own (screen readers never see them); the narrated line is what actually tells a
    // rep — sighted or not — that their shift is on its way, nothing was lost.
    return (
      <div className={styles.shell} aria-busy="true">
        <div className={styles.focusShell}>
          <div className={styles.loadingCard}>
            <p className={styles.loadingNarrative}>{t('shift.loading.narrativeLine')}</p>
            <div className={styles.skeletonBar} aria-hidden="true" />
            <div className={`${styles.skeletonBar} ${styles.skeletonBarMedium}`} aria-hidden="true" />
            <div className={`${styles.skeletonBar} ${styles.skeletonBarNarrow}`} aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.focusShell}>
        {isOffline ? <p className={styles.offlineBanner}>{t('shift.offlineBanner')}</p> : null}

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
            // T-57 R3c-1 (terminal-exit fix): this used to be a pure no-op — tapping "Save and
            // leave" during Work did nothing at all. Every Work-phase action already round-trips
            // to the server the instant it's taken (`handleAction` above), so there is no separate
            // "unsaved" state to flush here; the real gap was navigation. Lands on `/today` — the
            // same real exit target as DoneScreen's "Back to Today" below (a resumed Shift
            // re-fetches this exact in-progress stack, §5.3 "Resume").
            onSaveAndLeave={() => {
              window.location.href = '/today';
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
            recap={shift.recap}
            // T-57 R3c-1 (terminal-exit fix): was `'/'` — the marketing/public landing route, not
            // Mission Control. Corrected to the real Today destination (uiux §2.4).
            onBackToToday={() => {
              window.location.href = '/today';
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
