'use client';

import { useEffect } from 'react';

/**
 * T-58a — registers the offline app-shell service worker (public/sw.js).
 *
 * WHY A ROOT `template.tsx` AND NOT A `layout.tsx` EDIT: Next's App Router automatically composes
 * `Layout > Template > Page` for any route segment that has both a `layout.tsx` and a
 * `template.tsx` — no import/reference needs adding to layout.tsx for this to take effect. That
 * matters here specifically because layout.tsx is a shared file another build unit is
 * concurrently editing (i18n); this stays purely additive. `Providers` (theme/locale context,
 * declared in layout.tsx) sits ABOVE this component in the tree and is therefore unaffected —
 * only the page content below it remounts on navigation, which is template.tsx's normal,
 * documented behavior and is harmless here since `navigator.serviceWorker.register()` is
 * idempotent (a repeat call with the same script URL is a no-op against the existing
 * registration).
 *
 * Registration is gated to production only: Next's dev server frequently recompiles/rewrites
 * bundles, and a live service worker caching old chunks during `next dev` is a well-known source
 * of confusing stale-content bugs that have nothing to do with the app itself.
 *
 * Failure is non-fatal by design: the app is fully functional online without this worker; a
 * rejected `register()` call (older browser, disabled in a WebView, etc.) simply means the
 * offline app-shell fallback (public/offline.html) and shell-asset caching aren't available this
 * session — every other feature, including the application-level offline-queue-and-sync system
 * (src/lib/offline/*), is unaffected because it does not depend on this worker.
 */
export default function RootTemplate({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal — see header comment.
    });
  }, []);

  return <>{children}</>;
}
