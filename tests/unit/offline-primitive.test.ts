// T-R11 (uiux §5.4 AC-5.4-7 / §6.4 "Queue-and-sync with re-validation") — proves the codebase-wide
// offline primitive (`src/lib/offline/*`) is real, not a no-op, in isolation from any component:
//
//   (a) `storage.ts`'s JSON read/write/remove round-trips through a real KeyValueStorage, and
//       degrades to an in-memory fallback (never throws) when the underlying store is unusable —
//       "nothing typed is lost" even under a storage failure (§5.4 "Error");
//   (b) `online-status.ts`'s `isOnline()` reflects `navigator.onLine`, and `subscribeOnlineStatus`
//       actually wires the browser's `online`/`offline` events (and unsubscribes cleanly);
//   (c) `PersistentOfflineQueue` (offline-queue.ts) TEETH: enqueue while offline is deferred and
//       PERSISTED; replay() applies queued mutations in FIFO order and is idempotent by
//       construction — a mutation removed after success is never replayed again, even by a second
//       `replay()` call on the same (now-empty) queue; a failed mutation stays queued (and
//       everything after it, untouched) rather than being dropped or silently marked synced; a
//       mutation enqueued mid-replay is deferred to the NEXT replay, never dropped or double-run;
//       the queue survives being reconstructed from the same storage backend (simulating a reload).
//
// This repo's Jest config runs `testEnvironment: 'node'` (no jsdom — see jest.config.js), so
// `navigator`/`window` are stubbed the same way `tests/unit/shift-view.test.ts` does (T-34 QC fix
// D3): `Object.defineProperty` with the original descriptor saved and restored.

import { PersistentOfflineQueue } from '../../src/lib/offline/offline-queue';
import { isOnline, subscribeOnlineStatus } from '../../src/lib/offline/online-status';
import { KeyValueStorage, MemoryStorage, readJson, removeStoredItem, writeJson } from '../../src/lib/offline/storage';

// ─── (a) storage.ts — JSON round-trip + graceful degrade on a broken store ─────────────────────

describe('(a) storage.ts — JSON round-trip through a real KeyValueStorage', () => {
  test('writeJson then readJson returns a deep-equal value back', () => {
    const storage = new MemoryStorage();
    writeJson('k', { a: 1, b: ['x', 'y'] }, storage);
    expect(readJson<{ a: number; b: string[] }>('k', storage)).toEqual({ a: 1, b: ['x', 'y'] });
  });

  test('readJson on a missing key returns null, never throws', () => {
    const storage = new MemoryStorage();
    expect(readJson('missing', storage)).toBeNull();
  });

  test('removeStoredItem actually removes the key', () => {
    const storage = new MemoryStorage();
    writeJson('k', { a: 1 }, storage);
    removeStoredItem('k', storage);
    expect(readJson('k', storage)).toBeNull();
  });

  test('TEETH: readJson on CORRUPT stored data returns null (not a thrown exception) — never crashes the caller (§5.4 "Error")', () => {
    const storage = new MemoryStorage();
    storage.setItem('k', 'not valid json{{{');
    expect(() => readJson('k', storage)).not.toThrow();
    expect(readJson('k', storage)).toBeNull();
  });

  test('TEETH: writeJson on a storage that throws on setItem degrades silently — no exception escapes', () => {
    const brokenStorage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
    };
    expect(() => writeJson('k', { a: 1 }, brokenStorage)).not.toThrow();
  });
});

// ─── (b) online-status.ts — navigator.onLine + online/offline event wiring ─────────────────────

describe('(b) online-status.ts — connectivity detection is real, not hardcoded', () => {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

  function setNavigatorOnLine(onLine: boolean) {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true, writable: true });
  }

  afterEach(() => {
    if (originalNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    if (originalWindowDescriptor) Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    else delete (globalThis as { window?: unknown }).window;
  });

  test('isOnline() reflects navigator.onLine = true', () => {
    setNavigatorOnLine(true);
    expect(isOnline()).toBe(true);
  });

  test('TEETH: isOnline() reflects navigator.onLine = false — this is the exact signal the ritual banner depends on', () => {
    setNavigatorOnLine(false);
    expect(isOnline()).toBe(false);
  });

  test('isOnline() defaults to true when navigator is unavailable (SSR/non-browser) — never spuriously blocks', () => {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });
    expect(isOnline()).toBe(true);
  });

  test('subscribeOnlineStatus wires real "online"/"offline" window events and unsubscribes cleanly', () => {
    const listeners: Record<string, Array<() => void>> = { online: [], offline: [] };
    const fakeWindow = {
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = listeners[type] ?? [];
        listeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners[type] = (listeners[type] ?? []).filter((l) => l !== fn);
      },
    };
    Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true, writable: true });

    const events: boolean[] = [];
    const unsubscribe = subscribeOnlineStatus((online) => events.push(online));

    listeners.offline.forEach((fn) => fn());
    listeners.online.forEach((fn) => fn());
    expect(events).toEqual([false, true]);

    unsubscribe();
    expect(listeners.online).toHaveLength(0);
    expect(listeners.offline).toHaveLength(0);
  });
});

// ─── (c) PersistentOfflineQueue — persisted, ordered, idempotent-replay FIFO queue ──────────────

describe('(c) PersistentOfflineQueue — TEETH: persisted, FIFO, idempotent replay, never drops a failure', () => {
  function freshQueue(storage: KeyValueStorage = new MemoryStorage()) {
    return { storage, queue: new PersistentOfflineQueue({ storageKey: 'test-queue', storage }) };
  }

  test('enqueue persists immediately — a NEW queue instance over the SAME storage sees it (simulates a reload)', () => {
    const storage = new MemoryStorage();
    const q1 = new PersistentOfflineQueue({ storageKey: 'test-queue', storage });
    q1.enqueue('kind-a', { x: 1 });
    expect(q1.length).toBe(1);

    const q2 = new PersistentOfflineQueue({ storageKey: 'test-queue', storage });
    expect(q2.length).toBe(1);
    expect(q2.items[0].kind).toBe('kind-a');
    expect(q2.items[0].payload).toEqual({ x: 1 });
  });

  test('enqueue with an explicit id dedupes a second call with the same id — no duplicate entry', () => {
    const { queue } = freshQueue();
    queue.enqueue('kind-a', { x: 1 }, 'stable-id');
    queue.enqueue('kind-a', { x: 999 }, 'stable-id'); // different payload, same id — ignored
    expect(queue.length).toBe(1);
    expect(queue.items[0].payload).toEqual({ x: 1 }); // the FIRST enqueue wins, not overwritten
    expect(queue.has('stable-id')).toBe(true);
  });

  test('TEETH: replay() applies every mutation in FIFO order, removes each on success, and drains the queue', async () => {
    const { queue } = freshQueue();
    const calls: string[] = [];
    queue.enqueue('kind-a', { label: 'first' });
    queue.enqueue('kind-a', { label: 'second' });
    queue.enqueue('kind-a', { label: 'third' });

    const result = await queue.replay({
      'kind-a': async (payload) => {
        calls.push((payload as { label: string }).label);
      },
    });

    expect(calls).toEqual(['first', 'second', 'third']);
    expect(result).toEqual({ synced: 3, remaining: 0 });
    expect(queue.length).toBe(0);
  });

  test('TEETH: idempotent replay — a mutation removed after success is never re-applied, even by a second replay() on the same queue', async () => {
    const { queue } = freshQueue();
    let applyCount = 0;
    queue.enqueue('kind-a', {}, 'once-only');

    await queue.replay({ 'kind-a': async () => { applyCount++; } });
    expect(applyCount).toBe(1);

    // A second replay on the now-empty queue must call the handler ZERO more times — this is what
    // "idempotent by construction" means: the mutation simply isn't there anymore to re-apply.
    const secondResult = await queue.replay({ 'kind-a': async () => { applyCount++; } });
    expect(applyCount).toBe(1);
    expect(secondResult).toEqual({ synced: 0, remaining: 0 });
  });

  test('TEETH: a mutation surviving a simulated crash mid-replay (new queue instance over the same storage) is applied exactly once, not twice', async () => {
    const storage = new MemoryStorage();
    const producer = new PersistentOfflineQueue({ storageKey: 'crash-sim', storage });
    producer.enqueue('kind-a', { label: 'A' });
    producer.enqueue('kind-a', { label: 'B' });

    let appliedA = 0;
    let appliedB = 0;
    // Replay ONLY the first item, then simulate a crash (never call replay again on `producer`).
    const firstAttempt = new PersistentOfflineQueue({ storageKey: 'crash-sim', storage });
    await firstAttempt.replay({
      'kind-a': async (payload) => {
        const label = (payload as { label: string }).label;
        if (label === 'A') { appliedA++; return; }
        appliedB++;
        throw new Error('simulated crash before B could be marked synced'); // stop here
      },
    });
    expect(appliedA).toBe(1);
    expect(appliedB).toBe(1); // B was attempted...
    // ...but since it THREW, it was never removed — a fresh instance over the same storage still
    // has exactly B queued (A is gone — applied and removed for real, not re-queued).
    const reloaded = new PersistentOfflineQueue({ storageKey: 'crash-sim', storage });
    expect(reloaded.length).toBe(1);
    expect(reloaded.items[0].payload).toEqual({ label: 'B' });

    // Retrying now applies B exactly once more (total: A once, B once) — never a double-apply of A.
    await reloaded.replay({
      'kind-a': async (payload) => {
        if ((payload as { label: string }).label === 'A') appliedA++;
        else appliedB++;
      },
    });
    expect(appliedA).toBe(1);
    expect(appliedB).toBe(2); // B was attempted twice (once failed, once succeeded) — A never was
    expect(reloaded.length).toBe(0);
  });

  test('TEETH: replay STOPS on the first failure — the failed mutation AND everything queued after it stay queued, untouched, in order (no drop, no reorder, no false-success)', async () => {
    const { queue } = freshQueue();
    const calls: string[] = [];
    queue.enqueue('kind-a', { label: 'first' });
    queue.enqueue('kind-a', { label: 'second-fails' });
    queue.enqueue('kind-a', { label: 'third' });

    const result = await queue.replay({
      'kind-a': async (payload) => {
        const label = (payload as { label: string }).label;
        calls.push(label);
        if (label === 'second-fails') throw new Error('server rejected this mutation');
      },
    });

    expect(calls).toEqual(['first', 'second-fails']); // "third" was never even attempted
    expect(result.synced).toBe(1);
    expect(result.remaining).toBe(2);
    expect(result.failed?.kind).toBe('kind-a');
    expect(queue.length).toBe(2);
    expect(queue.items.map((m) => (m.payload as { label: string }).label)).toEqual(['second-fails', 'third']);
  });

  test('TEETH: a mutation with NO registered handler is treated as a failure (kept queued), never silently dropped', async () => {
    const { queue } = freshQueue();
    queue.enqueue('unregistered-kind', {});
    const result = await queue.replay({});
    expect(result.remaining).toBe(1);
    expect(queue.length).toBe(1);
    expect(result.failed?.kind).toBe('unregistered-kind');
  });

  test('a mutation enqueued WHILE replay is in flight is deferred to the NEXT replay call, not dropped or run out of order', async () => {
    const { queue } = freshQueue();
    const calls: string[] = [];
    queue.enqueue('kind-a', { label: 'first' });

    await queue.replay({
      'kind-a': async (payload) => {
        calls.push((payload as { label: string }).label);
        // Simulate another offline mutation being taken while this replay is still in flight.
        queue.enqueue('kind-a', { label: 'enqueued-mid-replay' });
      },
    });
    expect(calls).toEqual(['first']); // NOT run by this replay call
    expect(queue.length).toBe(1);

    await queue.replay({ 'kind-a': async (payload) => { calls.push((payload as { label: string }).label); } });
    expect(calls).toEqual(['first', 'enqueued-mid-replay']);
    expect(queue.length).toBe(0);
  });
});
