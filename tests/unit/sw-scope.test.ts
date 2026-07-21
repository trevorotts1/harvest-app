// T-58a — behavioral test for the offline app-shell service worker (public/sw.js). Master spec
// §5.2/§18.1 ("CFE unavailable -> fail closed, system-wide") and §17.6/§18.6 (offline) are the
// reason this worker's cache scope matters: a stale response on `/api/*` (where every CFE
// decision and every dynamic/per-user response lives) or `/auth*` would be a compliance
// violation, not just a bug.
//
// This test loads and EXECUTES THE REAL public/sw.js FILE — not a hand-typed mirror/fixture of
// its logic — inside a minimal `vm` sandbox that stubs the browser Service Worker globals
// (`self`, `caches`) it needs. That distinction matters: a test asserting against a copy of the
// intended logic can pass while the shipped artifact silently drifts from it; this test only
// passes if the actual file in public/sw.js behaves correctly.
//
// One behavior (`request.mode === 'navigate'`) is NOT exercised via a real `Request` object,
// because the Fetch API spec disallows constructing a `Request` with `mode: 'navigate'` from
// script (`TypeError: Failed to construct 'Request': Cannot construct a Request with a
// RequestInit whose mode member is set as 'navigate'`) — browsers only ever set that mode
// internally for actual page navigations, and Node's built-in `Request` enforces the same spec
// rule. That one branch is instead checked with a plain source-level assertion (in the same spirit
// as this repo's existing guard-*.mjs static scans), called out explicitly below so it is not
// mistaken for an executed assertion.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';

const SW_PATH = path.join(__dirname, '..', '..', 'public', 'sw.js');

type FetchListener = (event: {
  request: Request;
  respondWith: (p: unknown) => void;
  waitUntil: (p: Promise<unknown>) => void;
}) => void;

function loadServiceWorker() {
  const source = readFileSync(SW_PATH, 'utf8');
  const listeners: Record<string, FetchListener[]> = {};
  const cacheStore = new Map<string, Set<string>>();

  const fakeCache = {
    addAll: async (urls: string[]) => {
      const store = cacheStore.get('harvest-shell-v1') ?? new Set<string>();
      urls.forEach((u) => store.add(u));
      cacheStore.set('harvest-shell-v1', store);
    },
    put: async () => {
      // Intentionally a no-op: this test's job is to prove the fetch handler never calls
      // `caches.match`/`put` in a way that would serve stale dynamic content — see the
      // `never writes a navigation response into the cache` assertion below, which checks the
      // real source text for exactly this.
    },
  };

  const fakeCaches = {
    open: async () => fakeCache,
    match: async () => undefined,
    keys: async () => Array.from(cacheStore.keys()),
    delete: async () => true,
  };

  const fakeSelf = {
    location: { origin: 'https://example.test' },
    addEventListener: (type: string, handler: FetchListener) => {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(handler);
    },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };

  const context: Record<string, unknown> = {
    self: fakeSelf,
    caches: fakeCaches,
    fetch: async () => new Response('ok'),
    Request,
    Response,
    URL,
    console,
  };

  createContext(context);
  runInContext(source, context, { filename: 'sw.js' });

  return { listeners, source };
}

describe('public/sw.js — offline app-shell cache scope', () => {
  it('never intercepts /api/, /auth, or /_next/ requests (no event.respondWith call at all)', () => {
    const { listeners } = loadServiceWorker();
    const fetchHandlers = listeners.fetch;
    expect(fetchHandlers).toBeDefined();
    expect(fetchHandlers.length).toBeGreaterThan(0);

    const excludedUrls = [
      'https://example.test/api/mission-control/today',
      'https://example.test/api/inngest',
      'https://example.test/api/compliance-review/queue',
      'https://example.test/auth',
      'https://example.test/auth/callback/credentials',
      'https://example.test/_next/static/chunks/main.js',
    ];

    for (const url of excludedUrls) {
      let respondWithCalled = false;
      const event = {
        request: new Request(url, { method: 'GET' }),
        respondWith: () => {
          respondWithCalled = true;
        },
        waitUntil: (p: Promise<unknown>) => p,
      };
      for (const handler of fetchHandlers) handler(event);
      expect(respondWithCalled).toBe(false);
    }
  });

  it('DOES intercept a same-origin static shell asset (cache-first behavior applies)', () => {
    const { listeners } = loadServiceWorker();
    let respondWithCalled = false;
    const event = {
      request: new Request('https://example.test/icons/icon-192.png', { method: 'GET' }),
      respondWith: () => {
        respondWithCalled = true;
      },
      waitUntil: (p: Promise<unknown>) => p,
    };
    for (const handler of listeners.fetch) handler(event);
    expect(respondWithCalled).toBe(true);
  });

  it('never intercepts non-GET requests, even to an otherwise-cacheable path', () => {
    const { listeners } = loadServiceWorker();
    let respondWithCalled = false;
    const event = {
      request: new Request('https://example.test/icons/icon-192.png', { method: 'POST' }),
      respondWith: () => {
        respondWithCalled = true;
      },
      waitUntil: (p: Promise<unknown>) => p,
    };
    for (const handler of listeners.fetch) handler(event);
    expect(respondWithCalled).toBe(false);
  });

  it('never intercepts a cross-origin request', () => {
    const { listeners } = loadServiceWorker();
    let respondWithCalled = false;
    const event = {
      request: new Request('https://third-party.example/whatever', { method: 'GET' }),
      respondWith: () => {
        respondWithCalled = true;
      },
      waitUntil: (p: Promise<unknown>) => p,
    };
    for (const handler of listeners.fetch) handler(event);
    expect(respondWithCalled).toBe(false);
  });

  it('precaches only the offline fallback page + manifest icons — never anything under /api or /auth', () => {
    const { source } = loadServiceWorker();

    // OFFLINE_URL itself must point at the real offline fallback page.
    const offlineUrlMatch = source.match(/OFFLINE_URL\s*=\s*'([^']*)'/);
    expect(offlineUrlMatch).not.toBeNull();
    expect(offlineUrlMatch?.[1]).toBe('/offline.html');

    // The precache list references OFFLINE_URL plus manifest icon paths only — never /api or /auth.
    const shellAssetsMatch = source.match(/SHELL_ASSETS\s*=\s*\[([^\]]*)]/);
    expect(shellAssetsMatch).not.toBeNull();
    const shellAssetsBlock = shellAssetsMatch?.[1] ?? '';
    expect(shellAssetsBlock).not.toMatch(/\/api\//);
    expect(shellAssetsBlock).not.toMatch(/\/auth/);
    expect(shellAssetsBlock).toMatch(/OFFLINE_URL/);
  });

  // SOURCE-LEVEL ASSERTION (not executed) — see file header: `mode: 'navigate'` cannot be set on
  // a `Request` constructed from script, so this one branch is checked by reading the real
  // source text rather than by triggering it through a synthetic fetch event.
  it('[source-level] the navigate branch never writes a navigation response into the cache', () => {
    const source = readFileSync(SW_PATH, 'utf8');
    const navigateBranch = source.split("mode === 'navigate'")[1]?.split('return;')[0] ?? '';
    expect(navigateBranch.length).toBeGreaterThan(0);
    expect(navigateBranch).not.toMatch(/cache\.put/);
    expect(navigateBranch).not.toMatch(/caches\.open/);
    expect(navigateBranch).toMatch(/OFFLINE_URL/);
  });
});
