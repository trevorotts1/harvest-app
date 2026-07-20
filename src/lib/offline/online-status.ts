// Codebase-wide offline primitive (T-R11, uiux §5.4/§6.4): a small, framework-free, testable
// wrapper around `navigator.onLine` + the browser's `online`/`offline` events. No component talks
// to `navigator`/`window` directly — this is the one seam, so it can be exercised in this repo's
// node-env Jest suite (no jsdom — see jest.config.js) the same way `tests/unit/shift-view.test.ts`
// exercises `navigator.onLine` via `Object.defineProperty`.
//
// Mirrors the existing convention in `src/app/shift/ShiftView.tsx` (T-34 QC fix D3), generalized
// out of that one component so any surface can detect/subscribe to connectivity the same way.

/** SSR/non-browser environments (no `navigator`, or a `navigator` without a boolean `onLine`)
 *  never block on connectivity — treated as online so server-rendered output doesn't spuriously
 *  show an offline state that only a real browser could ever observe. */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return true;
  return navigator.onLine;
}

export type OnlineStatusListener = (online: boolean) => void;

/** Subscribes to browser online/offline transitions; returns an unsubscribe function. A no-op
 *  (returning a no-op unsubscribe) outside a real browser — SSR and this repo's node-env Jest
 *  suite both lack `window`. */
export function subscribeOnlineStatus(listener: OnlineStatusListener): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  const goOnline = () => listener(true);
  const goOffline = () => listener(false);
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);
  return () => {
    window.removeEventListener('online', goOnline);
    window.removeEventListener('offline', goOffline);
  };
}
