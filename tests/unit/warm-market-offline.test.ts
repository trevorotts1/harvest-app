// T-R11 (uiux §5.4 AC-5.4-7) — proves the warm-market ritual's OFFLINE wiring is real, not a no-op:
//
//   (a) `needsSoftGateConfirmation` mirrors the server's own soft-gate rule exactly (no drift);
//   (b) TEETH — a previously-saved Layer 1-2 draft (`saveRitualDraft`) HYDRATES on render: the
//       roster/cluster selections survive a simulated reload (the negative case — no draft saved —
//       lands on the plain Loading state, proving this assertion actually distinguishes
//       "restored" from "lost", not just structurally rendering something);
//   (c) TEETH — `createRitualQueueHandlers` + `PersistentOfflineQueue.replay()` against the REAL
//       `MethodStateService` (same in-memory fake Prisma as harvest-method.test.ts, no live DB):
//       queued Blank Canvas + Qualities Flip mutations replay in order and actually complete the
//       layers server-side; a soft-gate rejection or a Layer-order violation on replay is a real
//       FAILURE (item stays queued, nothing is falsely marked synced, the layer stays incomplete)
//       — "no gate bypass on replay"; replaying the same mutation twice never double-applies (the
//       server's own upsert-based writes converge, and the queue itself only ever applies a given
//       mutation once, having removed it after the first success);
//   (d) `BackgroundMatchingLayer` degrades gracefully offline — no crash, tile capture stays live,
//       the submit control is replaced by the honest deferred notice;
//   (e) structural — `WarmMarketRitual` reads `navigator.onLine` at mount and shows the offline
//       banner, mirroring `tests/unit/shift-view.test.ts`'s own structural proof for `ShiftView`.
//
// This repo's Jest config runs `testEnvironment: 'node'` (no jsdom — jest.config.js), so
// component/interaction tests are done via `react-dom/server`'s `renderToStaticMarkup` (same
// convention as `tests/unit/ritual-ui.test.ts` / `tests/unit/shift-view.test.ts`), and
// `navigator`/`localStorage` are exercised through this repo's real in-memory storage fallback
// (`src/lib/offline/storage.ts`'s `MemoryStorage`) rather than a real browser.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { QualityCluster } from '@prisma/client';

import BackgroundMatchingLayer from '../../src/app/ritual/warm-market/components/BackgroundMatchingLayer';
import {
  createRitualQueueHandlers,
  loadRitualDraft,
  loadRitualViewCache,
  needsSoftGateConfirmation,
  RITUAL_MUTATION_ID,
  RITUAL_MUTATION_KIND,
  RITUAL_QUEUE_STORAGE_KEY,
  saveRitualDraft,
  saveRitualViewCache,
  clearRitualDraft,
} from '../../src/app/ritual/warm-market/offline';
import WarmMarketRitual from '../../src/app/ritual/warm-market/WarmMarketRitual';
import { PersistentOfflineQueue } from '../../src/lib/offline/offline-queue';
import { removeStoredItem } from '../../src/lib/offline/storage';
import { MethodLayer } from '../../src/types/harvest-method';
import type { BlankCanvasSubmission, QualitiesFlipSubmission } from '../../src/types/harvest-method';
import { LayerOrderViolationError, MethodStateService } from '../../src/services/harvest-method/method-state.service';
import { createFakeMethodPrisma } from './harvest-method.test';

const render = (el: unknown, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el as never, props));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
const noop = () => {};

// The three storage keys this build unit's offline lane owns — cleared before/after every test in
// this file so `saveRitualDraft`/`saveRitualViewCache`'s DEFAULT (module-shared, in-memory-fallback
// in this node test env) storage never leaks state between test cases.
function resetOfflineStorage() {
  clearRitualDraft();
  removeStoredItem('harvest:ritual:warm-market:view-cache:v1');
  removeStoredItem(RITUAL_QUEUE_STORAGE_KEY);
}

beforeEach(resetOfflineStorage);
afterEach(resetOfflineStorage);

// ─── (a) needsSoftGateConfirmation mirrors the server's own §8.1 rule exactly ──────────────────

describe('(a) needsSoftGateConfirmation — the OFFLINE branch\'s local mirror of the server\'s soft-gate rule (§8.1)', () => {
  test('below 5 names, not yet confirmed -> true (ask once)', () => {
    expect(needsSoftGateConfirmation(3, false)).toBe(true);
  });
  test('below 5 names, already confirmed -> false (proceed)', () => {
    expect(needsSoftGateConfirmation(3, true)).toBe(false);
  });
  test('5 or more names, regardless of confirmation -> false (never asks)', () => {
    expect(needsSoftGateConfirmation(5, false)).toBe(false);
    expect(needsSoftGateConfirmation(20, false)).toBe(false);
  });
});

// ─── (b) Local draft persistence — TEETH: survives a simulated reload, or honestly doesn't exist ──

describe('(b) RitualDraftSnapshot persistence — TEETH: a reload restores prior work, never fabricates it', () => {
  test('round-trips through save/load exactly', () => {
    saveRitualDraft({
      currentLayer: MethodLayer.QUALITIES_FLIP,
      entries: [{ typedName: 'Jordan', matched: true, contactId: 'c-1' }],
      selectedClusters: [QualityCluster.COMMUNITY_HUB],
      assignments: { 'c-1': { clusters: [QualityCluster.COMMUNITY_HUB], needsTime: false } },
    });
    const loaded = loadRitualDraft();
    expect(loaded?.currentLayer).toBe(MethodLayer.QUALITIES_FLIP);
    expect(loaded?.entries).toEqual([{ typedName: 'Jordan', matched: true, contactId: 'c-1' }]);
    expect(loaded?.selectedClusters).toEqual([QualityCluster.COMMUNITY_HUB]);
    expect(typeof loaded?.savedAt).toBe('string');
  });

  test('with nothing saved, loadRitualDraft returns null (never fabricates a draft)', () => {
    expect(loadRitualDraft()).toBeNull();
  });

  test('TEETH: a previously-saved Layer 2 draft HYDRATES the real WarmMarketRitual component on render — the roster is NOT lost on a simulated reload', () => {
    saveRitualDraft({
      currentLayer: MethodLayer.QUALITIES_FLIP,
      entries: [{ typedName: 'Priya', matched: true, contactId: 'c-1' }],
      selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.RISING_ACHIEVER],
      assignments: {},
    });
    // No `initialView` — this exercises the REAL production hydration path (`loadRitualDraft()`
    // inside WarmMarketRitual's own render), not a test-only stand-in. `renderToStaticMarkup`
    // never runs effects, so the live fetch this component would otherwise issue never fires —
    // what's on screen here comes ENTIRELY from local persistence, exactly like an offline reload.
    const html = render(WarmMarketRitual, {});
    expect(textOf(html)).toContain('Priya'); // the seed contact survived the "reload"
    expect(html).toContain('aria-label="Qualities Flip — Layer 2 of 3"'); // landed on the SAME layer, not rolled back to Layer 1
  });

  test('TEETH (negative control): with NO draft saved, the same render shows the plain Loading state, not Layer 2 — proving the previous assertion is really about restored persistence, not a hardcoded default', () => {
    const html = render(WarmMarketRitual, {});
    expect(textOf(html)).toMatch(/Loading your ritual/i);
    expect(textOf(html)).not.toContain('Priya');
  });

  test('clearRitualDraft removes a saved draft', () => {
    saveRitualDraft({ currentLayer: MethodLayer.BLANK_CANVAS, entries: [], selectedClusters: [], assignments: {} });
    clearRitualDraft();
    expect(loadRitualDraft()).toBeNull();
  });

  test('RitualViewCache round-trips too, stamped with cachedAt', () => {
    saveRitualViewCache({ currentLayer: MethodLayer.BLANK_CANVAS, vaultCount: 12, vaultContacts: [], queue: [] });
    const cache = loadRitualViewCache();
    expect(cache?.vaultCount).toBe(12);
    expect(typeof cache?.cachedAt).toBe('string');
  });
});

// ─── (c) Offline queue replay against the REAL MethodStateService — compliance intact ──────────

/** Mirrors the real `/api/harvest-method/blank-canvas` and `/api/harvest-method/qualities-flip`
 *  route handlers' request/response/error-mapping EXACTLY (see method-state.service.ts's real
 *  callers in `src/app/api/harvest-method/*\/route.ts`) — without a live HTTP server, the same
 *  "in-memory fake Prisma, no live DB" convention every other WP03 test in this repo already
 *  uses (`createFakeMethodPrisma`). This is not a parallel reimplementation of the gate logic: the
 *  actual `MethodStateService` instance is what decides success/failure below. */
function createFakePostJson(service: MethodStateService, userId: string) {
  return async function fakePostJson<T>(url: string, body: unknown): Promise<T> {
    if (url === '/api/harvest-method/blank-canvas') {
      const result = await service.submitBlankCanvas(userId, body as BlankCanvasSubmission);
      return result as unknown as T; // the real route returns this JSON verbatim, HTTP 200 either way
    }
    if (url === '/api/harvest-method/qualities-flip') {
      try {
        const result = await service.submitQualitiesFlip(userId, body as QualitiesFlipSubmission);
        return result as unknown as T;
      } catch (error) {
        if (error instanceof LayerOrderViolationError) {
          // Mirrors qualities-flip/route.ts exactly: LayerOrderViolationError -> HTTP 409 ->
          // WarmMarketRitual's real `postJson`'s `!res.ok` check throws.
          throw new Error(`Request to ${url} failed (409)`);
        }
        throw error;
      }
    }
    throw new Error(`unexpected url in test double: ${url}`);
  };
}

function validBlankCanvasBody(): BlankCanvasSubmission {
  return {
    vaultCountAtStart: 40,
    entries: [
      { typedName: 'A', matched: true, contactId: 'c-1' },
      { typedName: 'B', matched: true, contactId: 'c-2' },
      { typedName: 'C', matched: true, contactId: 'c-3' },
      { typedName: 'D', matched: true, contactId: 'c-4' },
      { typedName: 'E', matched: true, contactId: 'c-5' },
    ],
  };
}

function validQualitiesFlipBody(): QualitiesFlipSubmission {
  return {
    selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.RISING_ACHIEVER],
    assignments: [
      { contactId: 'c-1', clusters: [QualityCluster.COMMUNITY_HUB] },
      { contactId: 'c-2', clusters: [QualityCluster.COMMUNITY_HUB] },
      { contactId: 'c-3', clusters: [QualityCluster.RISING_ACHIEVER] },
      { contactId: 'c-4', clusters: [QualityCluster.RISING_ACHIEVER] },
      { contactId: 'c-5', needsTime: true },
    ],
  };
}

describe('(c) Offline queue replay hits the REAL server-side gates — no bypass, idempotent', () => {
  test('TEETH: queued Blank Canvas + Qualities Flip replay IN ORDER and actually complete both layers server-side', async () => {
    const { prisma, states } = createFakeMethodPrisma();
    const service = new MethodStateService(prisma);
    const userId = 'user-1';
    const queue = new PersistentOfflineQueue({ storageKey: 'test-ritual-queue-a' });

    queue.enqueue(RITUAL_MUTATION_KIND.BLANK_CANVAS, validBlankCanvasBody(), RITUAL_MUTATION_ID.BLANK_CANVAS);
    queue.enqueue(RITUAL_MUTATION_KIND.QUALITIES_FLIP, validQualitiesFlipBody(), RITUAL_MUTATION_ID.QUALITIES_FLIP);

    const handlers = createRitualQueueHandlers(createFakePostJson(service, userId));
    const result = await queue.replay(handlers);

    expect(result).toEqual({ synced: 2, remaining: 0 });
    expect(queue.length).toBe(0);
    const state = states.get(userId);
    expect(state?.blank_canvas_completed_at).not.toBeNull();
    expect(state?.qualities_flip_completed_at).not.toBeNull();
  });

  test('TEETH: a soft-gate rejection on replay is a REAL failure — the mutation stays queued, Layer 1 is NOT marked complete, nothing is falsely "synced"', async () => {
    const { prisma, states } = createFakeMethodPrisma();
    const service = new MethodStateService(prisma);
    const userId = 'user-2';
    const queue = new PersistentOfflineQueue({ storageKey: 'test-ritual-queue-b' });

    // A hypothetical bad payload that never should have been queued (< 5 names, not confirmed) —
    // proves the SERVER, not just the client's own offline pre-check, is what actually enforces
    // §8.1's soft gate on replay.
    const badBody: BlankCanvasSubmission = { vaultCountAtStart: 10, entries: [{ typedName: 'A', matched: false }] };
    queue.enqueue(RITUAL_MUTATION_KIND.BLANK_CANVAS, badBody, RITUAL_MUTATION_ID.BLANK_CANVAS);

    const handlers = createRitualQueueHandlers(createFakePostJson(service, userId));
    const result = await queue.replay(handlers);

    expect(result.synced).toBe(0);
    expect(result.remaining).toBe(1);
    expect(result.failed?.kind).toBe(RITUAL_MUTATION_KIND.BLANK_CANVAS);
    expect(queue.length).toBe(1); // still queued — never dropped, never force-applied
    expect(states.get(userId)?.blank_canvas_completed_at ?? null).toBeNull(); // never actually applied
  });

  test('TEETH: a Layer-order violation on replay (Qualities Flip queued without Blank Canvas ever landing) is a REAL failure, not a silent success', async () => {
    const { prisma, states } = createFakeMethodPrisma();
    const service = new MethodStateService(prisma);
    const userId = 'user-3';
    const queue = new PersistentOfflineQueue({ storageKey: 'test-ritual-queue-c' });

    // Only the Layer 2 mutation is queued — simulates the order guarantee being violated (it
    // never should be, given FIFO enqueue order in WarmMarketRitual.tsx, but this proves the
    // SERVER — not just queue ordering — is the real backstop).
    queue.enqueue(RITUAL_MUTATION_KIND.QUALITIES_FLIP, validQualitiesFlipBody(), RITUAL_MUTATION_ID.QUALITIES_FLIP);

    const handlers = createRitualQueueHandlers(createFakePostJson(service, userId));
    const result = await queue.replay(handlers);

    expect(result.synced).toBe(0);
    expect(result.remaining).toBe(1);
    expect(result.failed?.kind).toBe(RITUAL_MUTATION_KIND.QUALITIES_FLIP);
    expect(states.get(userId)?.qualities_flip_completed_at ?? null).toBeNull();
  });

  test('TEETH: idempotent — replaying an already-drained queue a second time never re-applies anything (no double-apply)', async () => {
    const { prisma, states } = createFakeMethodPrisma();
    const service = new MethodStateService(prisma);
    const userId = 'user-4';
    const queue = new PersistentOfflineQueue({ storageKey: 'test-ritual-queue-d' });
    queue.enqueue(RITUAL_MUTATION_KIND.BLANK_CANVAS, validBlankCanvasBody(), RITUAL_MUTATION_ID.BLANK_CANVAS);
    const handlers = createRitualQueueHandlers(createFakePostJson(service, userId));

    const first = await queue.replay(handlers);
    expect(first.synced).toBe(1);
    const firstCompletedAt = states.get(userId)?.blank_canvas_completed_at ?? null;
    expect(firstCompletedAt).not.toBeNull();

    // A second replay call on the now-empty queue must do NOTHING — the mutation isn't there to
    // re-apply (idempotent by construction, not by luck of the server's own upsert semantics).
    const second = await queue.replay(handlers);
    expect(second).toEqual({ synced: 0, remaining: 0 });
    expect(states.get(userId)?.blank_canvas_completed_at ?? null).toEqual(firstCompletedAt);
  });

  test('the underlying server write is ALSO idempotent at the data level: calling the same submission twice converges, never double-counts', async () => {
    const { prisma, profiles } = createFakeMethodPrisma();
    const service = new MethodStateService(prisma);
    const userId = 'user-5';
    const body = validBlankCanvasBody();

    await service.submitBlankCanvas(userId, body);
    const countAfterFirst = [...profiles.values()].filter((p) => p.user_id === userId && p.is_seed).length;
    await service.submitBlankCanvas(userId, body); // identical resubmission
    const countAfterSecond = [...profiles.values()].filter((p) => p.user_id === userId && p.is_seed).length;

    expect(countAfterFirst).toBe(5);
    expect(countAfterSecond).toBe(5); // same 5 seed rows, not 10 — upsert converges, never doubles
  });

  test('createRitualQueueHandlers dispatches the EXACT same endpoint/body a live online submit would use', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fakePostJson = async <T>(url: string, body: unknown): Promise<T> => {
      calls.push({ url, body });
      return { ok: true } as T;
    };
    const handlers = createRitualQueueHandlers(fakePostJson);
    await handlers[RITUAL_MUTATION_KIND.BLANK_CANVAS]({ vaultCountAtStart: 5, entries: [] });
    expect(calls[0]).toEqual({ url: '/api/harvest-method/blank-canvas', body: { vaultCountAtStart: 5, entries: [] } });
  });

  test('TEETH: createRitualQueueHandlers THROWS when the server responds ok:false, even with a 2xx-shaped resolution — a 2xx response is not the same thing as "applied"', async () => {
    const fakePostJson = async <T>(): Promise<T> => ({ ok: false, reason: 'soft_gate_confirmation_required' } as T);
    const handlers = createRitualQueueHandlers(fakePostJson);
    await expect(handlers[RITUAL_MUTATION_KIND.BLANK_CANVAS]({})).rejects.toThrow(/rejected by the server/);
  });
});

// ─── (d) BackgroundMatchingLayer degrades gracefully offline — no crash, capture stays live ─────

describe('(d) BackgroundMatchingLayer offline degrade (§5.4 "Layer 3\'s matching requires connection")', () => {
  const entry = { contactId: 'c-1', name: 'Riley', tiles: {}, note: '', existingLicenseeFlag: false };

  test('offline=true: the submit button is replaced by the honest deferred notice; tile capture stays fully rendered', () => {
    const html = render(BackgroundMatchingLayer, {
      entries: [entry],
      onChangeTile: noop,
      onChangeNote: noop,
      onToggleExistingLicensee: noop,
      corrections: [],
      onSubmit: noop,
      offline: true,
    });
    expect(textOf(html)).toMatch(/finish matching when you.{1,3}re back online/i);
    expect(html).not.toMatch(/<button[^>]*>\s*Finish matching\s*<\/button>/);
    // Tile capture is unaffected by connectivity — still fully present.
    expect(textOf(html)).toMatch(/Career Stage/);
    expect(textOf(html)).toContain('Riley');
  });

  test('offline=false (default): the real submit button renders, the deferred notice does not — no regression to the online path', () => {
    const html = render(BackgroundMatchingLayer, {
      entries: [entry],
      onChangeTile: noop,
      onChangeNote: noop,
      onToggleExistingLicensee: noop,
      corrections: [],
      onSubmit: noop,
    });
    expect(html).toMatch(/<button[^>]*>\s*Finish matching\s*<\/button>/);
    expect(textOf(html)).not.toMatch(/finish matching when you.{1,3}re back online/i);
  });
});

// ─── (e) WarmMarketRitual reads navigator.onLine at mount and shows the offline banner ──────────

describe('(e) WarmMarketRitual renders the offline banner when offline at mount (mirrors ShiftView\'s own structural proof)', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  function setNavigatorOnLine(onLine: boolean) {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true, writable: true });
  }

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, 'navigator', originalDescriptor);
  });

  const initialView = { currentLayer: MethodLayer.BLANK_CANVAS, vaultCount: 3, vaultContacts: [] };

  test('navigator.onLine = false at mount -> the offline banner renders, honestly, with no fabricated "synced" text', () => {
    setNavigatorOnLine(false);
    const html = render(WarmMarketRitual, { initialView });
    expect(textOf(html)).toMatch(/you.{1,3}re offline/i);
    expect(textOf(html)).not.toMatch(/\bsynced\b/i);
  });

  test('navigator.onLine = true at mount -> no offline banner', () => {
    setNavigatorOnLine(true);
    const html = render(WarmMarketRitual, { initialView });
    expect(textOf(html)).not.toMatch(/you.{1,3}re offline/i);
  });
});
