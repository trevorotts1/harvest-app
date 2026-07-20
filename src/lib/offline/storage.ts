// Codebase-wide offline primitive (T-R11, uiux §5.4 AC-5.4-7 / §6.4 "queue-and-sync"): a tiny,
// framework-free, SSR-safe key-value storage abstraction. This is the persistence layer underneath
// `offline-queue.ts`'s replay queue and any component's own "local draft" snapshot (see
// `src/app/ritual/warm-market/WarmMarketRitual.tsx` for the first concrete wiring).
//
// BUILD-SAFETY: no module-scope access to `window`/`localStorage` — every access happens lazily
// inside a function call, so `next build`'s page-data collection (which imports client-component
// modules with no `window` present) never touches a browser global at import time (same lazy-
// construction discipline as `MethodStateService`'s `getContactEncryptionKey()` default param —
// see blank-canvas/route.ts's header comment).
//
// Doctrine (§5.4 "Error" / §6.4): a storage failure (quota exceeded, privacy-mode exception) must
// degrade to "this session's in-memory state is still correct, only cross-reload persistence is
// lost" — never a thrown error that crashes the caller or discards what the rep typed.

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory fallback — used server-side (SSR/build), in this repo's node-env Jest suite (no DOM,
 *  per jest.config.js), and in any real browser where `localStorage` throws (privacy-mode Safari
 *  raises on `setItem`, not just on access). Never throws; behaves like an always-available empty
 *  store for the life of the current module instance. */
export class MemoryStorage implements KeyValueStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const memoryFallback = new MemoryStorage();

/** Lazily resolves the real `window.localStorage` when it's actually usable — probing with a
 *  throwaway write/delete (privacy-mode Safari exposes `localStorage` but throws on `setItem`) —
 *  falling back to the shared in-memory store otherwise. Called fresh on every operation (never
 *  cached at module scope) so a mid-session storage failure degrades gracefully for that call
 *  rather than wedging the caller into a broken singleton. */
export function resolveStorage(): KeyValueStorage {
  if (typeof window === 'undefined' || !window.localStorage) return memoryFallback;
  try {
    const probeKey = '__harvest_offline_probe__';
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return memoryFallback;
  }
}

export function readJson<T>(key: string, storage: KeyValueStorage = resolveStorage()): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Corrupt/foreign data under this key — treat as absent rather than throwing (§5.4 "Error":
    // never crash the caller; the rep's session state, if any, is unaffected).
    return null;
  }
}

export function writeJson<T>(key: string, value: T, storage: KeyValueStorage = resolveStorage()): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota/privacy-mode failure: the caller's own in-memory state is still correct for this
    // session — losing cross-reload PERSISTENCE is the only degrade, never a crash or a lost
    // in-session edit.
  }
}

export function removeStoredItem(key: string, storage: KeyValueStorage = resolveStorage()): void {
  try {
    storage.removeItem(key);
  } catch {
    // best-effort clear
  }
}
