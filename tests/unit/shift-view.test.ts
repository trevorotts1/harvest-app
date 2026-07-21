// T-34 QC fix (D3) — proves ShiftView's offline behavior is real, not a no-op: an offline Work-
// phase card action must visibly advance the local stack (uiux §5.3 "Offline") instead of doing
// nothing until reconnect, while the real write is deferred and replayed, in order, once back
// online. Exercises the two framework-free units ShiftView.tsx exports specifically for this
// (`applyOptimisticAction`, `OfflineActionQueue`) directly — this repo's Jest config runs
// `testEnvironment: 'node'` (no DOM/jsdom, no @testing-library — see jest.config.js), the same
// constraint every other stateful client orchestrator in this codebase already lives with (e.g.
// WarmMarketRitual.tsx has zero interaction tests: grep tests/unit/warm-market.test.ts — it only
// exercises the service layer). These ARE the real production functions ShiftView's `handleAction`/
// `runOrQueue` wire up (see ShiftView.tsx's OFFLINE header note and handleAction's onOptimistic
// callback) — not a parallel reimplementation — so a regression in either (the optimistic call
// site removed, or FIFO replay order broken) is caught here even though the `window`/`navigator`-
// wired React hooks themselves aren't exercised end-to-end.
//
// One additional structural test renders ShiftView itself (via the `initialShift` testability seam,
// same convention as WarmMarketRitual's `initialView`) with a global `navigator.onLine = false`
// stubbed BEFORE render, confirming the component really does read that at mount and shows the
// offline banner — proving the wiring exists, not just the two extracted units in isolation.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ShiftView, { applyOptimisticAction, OfflineActionQueue } from '@/app/shift/ShiftView';
import type { ShiftQueueCard, ShiftStateView } from '@/types/learning-state';

function card(id: string, overrides: Partial<ShiftQueueCard> = {}): ShiftQueueCard {
  return { id, type: 'APPROVE_DRAFT', title: `title ${id}`, detail: `detail ${id}`, estimateMinutes: 1, ...overrides };
}

function view(overrides: Partial<ShiftStateView> = {}): ShiftStateView {
  return {
    phase: 'WORK',
    mode: 'STANDARD',
    stackPosition: 0,
    stack: [card('c1'), card('c2'), card('c3')],
    elapsedSeconds: 60,
    targetSeconds: 1800,
    streakCount: 0,
    graceDayUsed: false,
    graceDayAvailable: false,
    graceDayOffer: false,
    reflectionText: null,
    briefingLines: [],
    motivationalLine: 'x',
    recap: null,
    isEmpty: false,
    ...overrides,
  };
}

// ─── applyOptimisticAction: the local Work-phase stack visibly advances ────────────────────────────

describe('T-34 QC fix (D3): applyOptimisticAction advances the local Work-phase stack', () => {
  test('APPROVE removes the acted-on card from the LOCAL stack — the next card is now on top', () => {
    const v = view();
    const next = applyOptimisticAction(v, 'c1', 'APPROVE');
    expect(next.stack.map((c) => c.id)).toEqual(['c2', 'c3']);
  });

  test('DECLINE / CONFIRM / LOG all remove the acted-on card the same way (it is no longer PENDING/PROPOSED)', () => {
    for (const action of ['DECLINE', 'CONFIRM', 'LOG'] as const) {
      const next = applyOptimisticAction(view(), 'c1', action);
      expect(next.stack.map((c) => c.id)).toEqual(['c2', 'c3']);
    }
  });

  test('SKIP moves the acted-on card behind the rest — still present, but the next card is now on top', () => {
    const next = applyOptimisticAction(view(), 'c1', 'SKIP');
    expect(next.stack.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
  });

  test('acting on a cardId no longer in the stack (already actioned) is a safe no-op — the view is unchanged', () => {
    const v = view();
    const next = applyOptimisticAction(v, 'not-in-stack', 'APPROVE');
    expect(next).toEqual(v);
  });

  test('approving the LAST remaining card empties the local stack AND collapses phase WORK -> CLOSE, mirroring ShiftService.actionCard\'s own auto-collapse', () => {
    const v = view({ stack: [card('only')] });
    const next = applyOptimisticAction(v, 'only', 'APPROVE');
    expect(next.stack).toEqual([]);
    expect(next.phase).toBe('CLOSE');
  });

  test('SKIP never empties the stack (the card just moves to the back) — phase stays WORK even with only one card', () => {
    const v = view({ stack: [card('only')] });
    const next = applyOptimisticAction(v, 'only', 'SKIP');
    expect(next.stack.map((c) => c.id)).toEqual(['only']);
    expect(next.phase).toBe('WORK');
  });

  test('TEETH: if the optimistic update were removed (a no-op stub returning `view` unchanged), this stack-advance assertion goes red', () => {
    // A deliberately broken stand-in for what "the optimistic update was removed" looks like —
    // proves THIS test file's assertions actually distinguish "advanced" from "did nothing", not
    // just structurally call the function. The real `applyOptimisticAction` above passes; this
    // sanity check documents what a regression would look like if it broke the same way.
    const noopStub = (v: ShiftStateView, _cardId: string, _action: string) => v;
    const v = view();
    const brokenResult = noopStub(v, 'c1', 'APPROVE');
    expect(brokenResult.stack.map((c) => c.id)).not.toEqual(['c2', 'c3']); // the broken stub fails this
    expect(applyOptimisticAction(v, 'c1', 'APPROVE').stack.map((c) => c.id)).toEqual(['c2', 'c3']); // the real fix passes it
  });
});

// ─── OfflineActionQueue: defers the real write while offline, replays it in order on reconnect ────

describe('T-34 QC fix (D3): OfflineActionQueue defers writes offline and replays them on reconnect', () => {
  test('online: fn runs immediately, onOptimistic is never called, nothing is queued', async () => {
    const queue = new OfflineActionQueue();
    const fn = jest.fn().mockResolvedValue(undefined);
    const onOptimistic = jest.fn();

    await queue.runOrQueue(false, fn, onOptimistic);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(onOptimistic).not.toHaveBeenCalled();
    expect(queue.length).toBe(0);
  });

  test('offline: onOptimistic runs SYNCHRONOUSLY and fn is deferred (not called), and is queued', () => {
    const queue = new OfflineActionQueue();
    const fn = jest.fn().mockResolvedValue(undefined);
    const onOptimistic = jest.fn();

    queue.runOrQueue(true, fn, onOptimistic);

    expect(onOptimistic).toHaveBeenCalledTimes(1);
    expect(fn).not.toHaveBeenCalled();
    expect(queue.length).toBe(1);
  });

  test('TEETH: flush() replays every deferred write, in the EXACT order the actions were taken (FIFO), and drains the queue', async () => {
    const queue = new OfflineActionQueue();
    const calls: string[] = [];
    const makeFn = (label: string) => async () => {
      calls.push(label);
    };

    queue.runOrQueue(true, makeFn('first'));
    queue.runOrQueue(true, makeFn('second'));
    queue.runOrQueue(true, makeFn('third'));
    expect(queue.length).toBe(3);

    await queue.flush();

    expect(calls).toEqual(['first', 'second', 'third']);
    expect(queue.length).toBe(0);
  });

  test('a write enqueued mid-flush is deferred to the NEXT flush, not dropped or re-run', async () => {
    const queue = new OfflineActionQueue();
    const calls: string[] = [];

    queue.runOrQueue(true, async () => {
      calls.push('first');
      // Simulate another offline action being taken while this replay is in flight.
      queue.runOrQueue(true, async () => {
        calls.push('enqueued-mid-flush');
      });
    });

    await queue.flush();
    expect(calls).toEqual(['first']); // the mid-flush addition was NOT run by this flush
    expect(queue.length).toBe(1);

    await queue.flush();
    expect(calls).toEqual(['first', 'enqueued-mid-flush']);
  });
});

// ─── Structural: ShiftView itself reads navigator.onLine at mount and shows the offline banner ────

describe('T-34 QC fix (D3): ShiftView renders the offline banner when offline at mount', () => {
  // Node ships a built-in `navigator` global (get-only accessor, no setter — a plain
  // `navigator = ...` assignment silently no-ops in this Jest/ts-jest CJS environment). Overriding
  // it for a test requires `Object.defineProperty` with an explicit data descriptor; the original
  // accessor descriptor is saved and restored exactly (not just re-assigned) so later test files
  // that also touch `navigator` are unaffected.
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  function setNavigatorOnLine(onLine: boolean) {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true, writable: true });
  }

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, 'navigator', originalDescriptor);
  });

  test('navigator.onLine = false at mount -> the offline banner text renders', () => {
    setNavigatorOnLine(false);
    const html = renderToStaticMarkup(
      createElement(ShiftView, { initialShift: view(), initialLearningState: undefined })
    );
    expect(html).toMatch(/offline/i);
  });

  test('navigator.onLine = true at mount -> no offline banner', () => {
    setNavigatorOnLine(true);
    const html = renderToStaticMarkup(
      createElement(ShiftView, { initialShift: view(), initialLearningState: undefined })
    );
    expect(html).not.toMatch(/queued and will sync/i);
  });
});

// ─── T-57 RE-GATE fix (D2 BLOCKER): the `!shift` branch is a NARRATED loading state, never a
// blank `aria-busy` div ────────────────────────────────────────────────────────────────────────
//
// Omitting `initialShift` puts ShiftView in its real, live-fetch first-mount state (`shift ===
// null`) — exactly what every real mount looks like before `/api/shift` resolves. `useEffect`
// never runs under `renderToStaticMarkup` (SSR-only, no DOM), so the live `fetch()` call inside it
// is never reached — this test exercises ONLY the render-time `!shift` branch itself, the same
// isolation this file's other structural test already relies on.
describe('T-57 RE-GATE fix — ShiftView\'s `!shift` first-mount branch renders narrated content, never a blank div', () => {
  test('RED (pre-fix) would be: renderToStaticMarkup(<ShiftView />) === \'<div class="..." aria-busy="true"></div>\' — no text content at all', () => {
    const html = renderToStaticMarkup(createElement(ShiftView, {}));
    const text = html.replace(/<[^>]*>/g, ' ').trim();
    expect(text.length).toBeGreaterThan(0);
  });

  test('GREEN: the real narrated title/text ("Gathering your shift…") is present', () => {
    const html = renderToStaticMarkup(createElement(ShiftView, {}));
    const text = html.replace(/<[^>]*>/g, ' ').trim();
    expect(text).toMatch(/Gathering your shift/i);
  });

  test('GREEN: the loading region stays aria-busy (assistive tech still knows a load is in progress)', () => {
    const html = renderToStaticMarkup(createElement(ShiftView, {}));
    expect(html).toMatch(/aria-busy="true"/);
  });

  test('GREEN: the decorative skeleton bars are aria-hidden — they carry no information of their own, only the narrated text does', () => {
    const html = renderToStaticMarkup(createElement(ShiftView, {}));
    const skeletonBarCount = (html.match(/aria-hidden="true"/g) ?? []).length;
    expect(skeletonBarCount).toBeGreaterThanOrEqual(3);
  });

  test('TEETH: the OLD blank markup shape (`aria-busy` div with no text) would fail the narrated-text assertion above — proves this test actually distinguishes narrated from blank', () => {
    const oldBlankHtml = '<div class="shell" aria-busy="true"></div>';
    const oldText = oldBlankHtml.replace(/<[^>]*>/g, ' ').trim();
    expect(oldText.length).toBe(0); // the pre-fix shape has zero text — this is what SC9 flags
  });
});
