// T-58a — the offline APP-SHELL service worker (master spec §17.6/§18.6, uiux spec §6.4).
//
// SCOPE, DELIBERATELY NARROW: this worker caches ONLY the static app shell (icons + the offline
// fallback page below) and serves that fallback page for a failed navigation. It does NOT cache
// or intercept any dynamic, per-user, per-locale, or compliance-adjacent content. The rich
// "briefing/queue/approvals read from cache, queue-and-sync with CFE re-validation on reconnect"
// behavior the specs describe (uiux §6.4 items 1-2) is implemented at the APPLICATION layer
// (src/lib/offline/{offline-queue,storage,online-status,http}.ts + the per-surface
// src/app/{inbox,today,ritual/warm-market}/offline.ts files already in this repo) — this worker
// is strictly the layer beneath that: it makes sure the app's own shell (JS/CSS/icons) and a
// static "you're offline" page are available even if the network is down before that
// application-level logic can even boot.
//
// COMPLIANCE-CRITICAL INVARIANT: never serve a stale response for anything dynamic. Concretely,
// this worker (a) never precaches or cache-writes any `/api/*`, `/auth*`, or page navigation
// response, and (b) explicitly bypasses (never calls `event.respondWith`, i.e. never intercepts —
// the browser's normal network fetch proceeds exactly as if this worker didn't exist)
// `NEVER_INTERCEPT_PREFIXES` below. A stale response on any CFE-adjacent path would violate the
// fail-closed guarantee (master spec §5.2/§18.1: "CFE unavailable -> fail closed, system-wide; no
// outbound of any kind"). Every CFE decision and every piece of dynamic/data-bearing content in
// this app flows through `/api/**` (see src/app/api/inngest/route.ts's header comment for the
// equivalent reasoning about Inngest's own cron scheduling vs. Vercel Cron) — bypassing `/api/`
// entirely therefore also transitively covers every CFE path; there is no separate non-`/api`
// surface that serves live CFE state. `/auth` is bypassed as its own explicit category per this
// build unit's brief, and independently because the app's own offline UX already says plainly
// that auth requires a connection (uiux spec: "onboarding requires connection for auth/CFE-
// adjacent steps; the offline card says so plainly") — this worker must not paper over that with
// a friendly cached-shell substitute.
//
// Verified by tests/unit/sw-scope.test.ts, which loads and executes THIS file (not a mirrored
// copy) in a sandboxed `vm` context and asserts `event.respondWith` is never called for `/api/`,
// `/auth`, or `/_next/` requests.

const SHELL_CACHE = 'harvest-shell-v1';
const OFFLINE_URL = '/offline.html';

// Precached at install time. Deliberately just the offline fallback page and the icons the web
// manifest (src/app/manifest.ts) references — NOT any app route/page, which are all
// server-rendered per-request (RSC payload, per-user data, locale, CFE-adjacent banners) and must
// never be served stale.
const SHELL_ASSETS = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

// Any request whose path starts with one of these is passed straight to the network with no
// interception whatsoever — no cache read, no cache write, no offline fallback substitution.
const NEVER_INTERCEPT_PREFIXES = [
  '/api/', // every Route Handler — CFE decisions, auth, billing, all dynamic/data-bearing content.
  '/auth', // Auth.js sign-in/callback flows and the /auth login page — requires a live connection.
  '/_next/', // Next's own build/runtime assets; already versioned/immutable via its own headers.
];

function shouldBypass(url) {
  return NEVER_INTERCEPT_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only ever act on same-origin GET requests. Anything else (cross-origin calls, POST/PUT/etc.)
  // is left completely alone — no respondWith, no interception.
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (shouldBypass(url)) {
    return;
  }

  // A page navigation: try the network first (always fresh, never cached), and ONLY on total
  // network failure fall back to the static offline shell page. Note there is no `cache.put`
  // anywhere in this branch — a navigation response is never written to the cache, so a dynamic
  // page can never be served stale from here.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Everything remaining is a static shell asset (icons, the manifest, etc.): cache-first,
  // falling back to network for anything not precached.
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
