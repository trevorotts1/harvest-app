// Codebase-wide offline primitive (T-R11, uiux §5.4 AC-5.4-7 / §6.4 "Queue-and-sync with
// re-validation"). A generic, framework-free, PERSISTED, idempotent-replay FIFO mutation queue.
//
// This generalizes the in-memory `OfflineActionQueue` already built for the Shift
// (`src/app/shift/ShiftView.tsx`, T-34 QC fix D3): same "runs now when online, defers + optimistic
// callback when offline, replays FIFO on reconnect, a write enqueued mid-replay is deferred to the
// NEXT replay" contract, but with two additions the repo-wide gap needed:
//   1. Every queued mutation is PERSISTED (via `storage.ts`'s KeyValueStorage) the moment it is
//      queued, and removed from persisted storage the moment (and only the moment) its handler
//      resolves — so the queue itself survives a reload/app-close while offline (T-34's version
//      lived only in a React `useRef`, lost on reload) and a crash mid-replay leaves exactly the
//      not-yet-applied tail queued, never re-running an already-applied mutation.
//   2. Mutations are typed by `kind` + carry a stable `id`, so a caller can (a) dedupe an
//      accidental double-enqueue of the same logical action and (b) dispatch replay to a handler
//      map keyed by kind, rather than closing over a bound function the way T-34's queue does
//      (T-34's approach doesn't survive serialization to storage — a closure can't be persisted).
//
// Idempotent replay: this queue's OWN contract (dedupe-by-id at enqueue, remove-by-id only after
// success, never reorder) guarantees a given queued mutation is applied AT MOST ONCE by this
// queue. The mutation's SERVER-SIDE handler must still be safe to call more than once in the rare
// case a caller flushes twice concurrently or a network response is lost after the write actually
// landed (fire-and-retry) — see the warm-market ritual's wiring
// (`src/app/ritual/warm-market/WarmMarketRitual.tsx`) for how its two mutation kinds are
// idempotent for that reason too (full-state upserts, not increments).

import { KeyValueStorage, readJson, resolveStorage, writeJson } from './storage';

export interface QueuedMutation<TPayload = unknown> {
  /** Stable identity for this mutation — used to dedupe re-enqueue and to remove-on-success by id
   *  (not by array index, which could shift if something else mutates the queue concurrently). */
  id: string;
  /** Discriminates which handler in the `replay()` handler map applies this mutation. */
  kind: string;
  payload: TPayload;
  /** ISO timestamp — surfaced to the UI for honest "queued since"/freshness labeling (§6.4). */
  enqueuedAt: string;
}

export type MutationHandler<TPayload = unknown> = (payload: TPayload) => Promise<void>;

export interface ReplayResult {
  /** Count of mutations this call successfully applied and removed from the queue. */
  synced: number;
  /** Count still queued after this call returns (0 means the queue fully drained). */
  remaining: number;
  /** Present only if replay stopped early — the queue keeps this mutation (and everything after
   *  it, untouched) for the next reconnect attempt; nothing is ever dropped silently. */
  failed?: { id: string; kind: string; error: unknown };
}

function defaultIdGenerator(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface PersistentOfflineQueueOptions {
  /** Storage key this queue's contents are persisted under — one key per logical queue (e.g. one
   *  per feature/route), so unrelated queues never collide. */
  storageKey: string;
  storage?: KeyValueStorage;
  idGenerator?: () => string;
}

export class PersistentOfflineQueue<TPayload = unknown> {
  private storageKey: string;
  private storage: KeyValueStorage;
  private idGenerator: () => string;
  private queue: QueuedMutation<TPayload>[];

  constructor(options: PersistentOfflineQueueOptions) {
    this.storageKey = options.storageKey;
    this.storage = options.storage ?? resolveStorage();
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.queue = readJson<QueuedMutation<TPayload>[]>(this.storageKey, this.storage) ?? [];
  }

  get length(): number {
    return this.queue.length;
  }

  /** Read-only snapshot of what's queued — for rendering honest "N items queued to sync" copy
   *  (§6.4 "visible `sync-queued` chips"), never for external mutation. */
  get items(): ReadonlyArray<QueuedMutation<TPayload>> {
    return this.queue;
  }

  private persist(): void {
    writeJson(this.storageKey, this.queue, this.storage);
  }

  /** True once a mutation with this id is currently queued. Lets a caller check "did I already
   *  queue this?" before deciding whether to enqueue again (belt-and-suspenders alongside
   *  `enqueue`'s own dedupe, for callers that want to branch on it explicitly). */
  has(id: string): boolean {
    return this.queue.some((m) => m.id === id);
  }

  /** Enqueues a mutation for later replay. Runs while offline, mirroring
   *  `OfflineActionQueue.runOrQueue` (`ShiftView.tsx`): pass a stable `id` for a mutation the
   *  caller can identify again (e.g. "this layer's submission") — a second `enqueue()` call with
   *  the same id is a no-op, not a duplicate entry, so a retried submit or a double-fired React
   *  effect can never double-queue the same logical action. Returns the id used (generated when
   *  omitted). */
  enqueue(kind: string, payload: TPayload, id?: string): string {
    const mutationId = id ?? this.idGenerator();
    if (this.has(mutationId)) return mutationId;
    this.queue.push({ id: mutationId, kind, payload, enqueuedAt: new Date().toISOString() });
    this.persist();
    return mutationId;
  }

  /**
   * Replays every queued mutation in FIFO order, one at a time, dispatching each to the handler
   * registered for its `kind`. A mutation is removed from persisted storage ONLY after its
   * handler resolves — so a reload mid-replay leaves exactly the not-yet-applied tail queued
   * (idempotent by construction: an already-removed mutation cannot be replayed again by a later
   * call). On the FIRST handler failure (including "no handler registered for this kind", which
   * is treated as a failure rather than a silent drop), replay STOPS — the failed mutation and
   * everything queued after it stays queued, in original order, for the next attempt. This mirrors
   * `OfflineActionQueue.flush`'s FIFO contract in ShiftView.tsx: order must match the order the
   * rep actually took the actions in, because later mutations can depend on earlier ones having
   * already landed server-side (e.g. the ritual's Qualities Flip submission requires Blank Canvas
   * to already be complete — §8.1 layer order).
   *
   * A mutation enqueued WHILE this call is in flight is appended to `this.queue` by `enqueue()`
   * as normal but is never visited by THIS call — it is deferred to the NEXT `replay()` (mirrors
   * T-34's "mid-flush" rule). We make that guarantee real by iterating a SNAPSHOT of the ids
   * queued at the moment this call starts, rather than looping `while (this.queue.length > 0)`:
   * because each applied mutation is removed from the head, a tail append would otherwise shift
   * toward the head and be picked up by the very same call (and, if the handler itself re-enqueues,
   * loop forever). The final `remaining` therefore reflects anything appended mid-replay, so the
   * caller can flush again to drain it.
   */
  async replay(
    handlers: Record<string, MutationHandler<TPayload>>,
    onItemSynced?: (mutation: QueuedMutation<TPayload>) => void
  ): Promise<ReplayResult> {
    let synced = 0;
    const plannedIds = this.queue.map((m) => m.id);
    for (const id of plannedIds) {
      const next = this.queue.find((m) => m.id === id);
      if (!next) continue; // defensively skip an id already gone (e.g. removed by a concurrent path)
      const handler = handlers[next.kind];
      if (!handler) {
        return { synced, remaining: this.queue.length, failed: { id: next.id, kind: next.kind, error: new Error(`No replay handler registered for mutation kind "${next.kind}"`) } };
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await handler(next.payload);
      } catch (error) {
        return { synced, remaining: this.queue.length, failed: { id: next.id, kind: next.kind, error } };
      }
      this.queue = this.queue.filter((m) => m.id !== next.id);
      this.persist();
      synced++;
      onItemSynced?.(next);
    }
    return { synced, remaining: this.queue.length };
  }
}
