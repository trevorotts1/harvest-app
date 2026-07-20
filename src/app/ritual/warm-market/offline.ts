// uiux §5.4 AC-5.4-7 — offline local-persistence + reconnect-sync wiring SPECIFIC to the
// warm-market ritual. Framework-free (no React import), built on the codebase-wide primitives in
// `src/lib/offline/*` (storage, online-status, the persisted queue — T-R11). Kept in its own
// module so tests can exercise the real production logic directly without a DOM (this repo's
// Jest config runs `testEnvironment: 'node'` — no jsdom, see jest.config.js), the same rationale
// `ShiftView.tsx` gives for exporting `applyOptimisticAction`/`OfflineActionQueue` directly
// (T-34 QC fix D3).
//
// FIDELITY NOTE (see WarmMarketRitual.tsx's own header note): the T-26 engine has no read
// endpoint for an in-progress Layer 2/3 seed roster — only `getState()` (which layer is COMPLETE)
// and the post-Layer-3 queue. `RitualDraftSnapshot` is what fills that gap CLIENT-SIDE: the rep's
// typed names (Layer 1), selected clusters + per-contact assignments (Layer 2), and which layer
// they're currently on, persisted locally so a reload — online OR offline — restores exactly what
// was there before, rather than re-fetching from a server endpoint that doesn't exist
// (AC-5.4-7: "Each layer resumes independently with no data loss").

import { MutationHandler } from '@/lib/offline/offline-queue';
import { readJson, removeStoredItem, writeJson } from '@/lib/offline/storage';
import { MethodLayer, PublicQueueItem, QualityCluster } from '@/types/harvest-method';

import type { BlankCanvasDraftEntry } from './components/BlankCanvasLayer';
import type { QualitiesFlipAssignmentDraft } from './components/QualitiesFlipLayer';

export const RITUAL_DRAFT_STORAGE_KEY = 'harvest:ritual:warm-market:draft:v1';
export const RITUAL_VIEW_CACHE_STORAGE_KEY = 'harvest:ritual:warm-market:view-cache:v1';
export const RITUAL_QUEUE_STORAGE_KEY = 'harvest:ritual:warm-market:offline-queue:v1';

export interface VaultContactSummary {
  id: string;
  firstName: string;
  lastName: string;
}

/** Layer 1-2 in-progress content — the whole point of AC-5.4-7's "local persistence": everything
 *  here is typed by the rep and has no server-side read endpoint (see FIDELITY NOTE above). Which
 *  layer the rep is currently on travels with it too, so an offline reload lands back on the SAME
 *  layer the rep was optimistically advanced to — not rolled back to the last server-confirmed
 *  layer while a queued submission for the next one is still in flight (see
 *  WarmMarketRitual.tsx's mount-hydration wiring, which prefers this over the view cache's
 *  `currentLayer` whenever a draft is present). */
export interface RitualDraftSnapshot {
  currentLayer: MethodLayer;
  entries: BlankCanvasDraftEntry[];
  selectedClusters: QualityCluster[];
  assignments: Record<string, QualitiesFlipAssignmentDraft>;
  savedAt: string;
}

export function loadRitualDraft(): RitualDraftSnapshot | null {
  return readJson<RitualDraftSnapshot>(RITUAL_DRAFT_STORAGE_KEY);
}

export function saveRitualDraft(snapshot: Omit<RitualDraftSnapshot, 'savedAt'>): void {
  writeJson<RitualDraftSnapshot>(RITUAL_DRAFT_STORAGE_KEY, { ...snapshot, savedAt: new Date().toISOString() });
}

export function clearRitualDraft(): void {
  removeStoredItem(RITUAL_DRAFT_STORAGE_KEY);
}

/** The last SERVER-confirmed view — `vaultCount`/`vaultContacts`/`queue` have no local-authoring
 *  equivalent (they only ever come from the server), so this is a plain read-through cache: used
 *  ONLY as a fallback when a live fetch can't run at all (offline) or fails, never as a
 *  substitute for a live fetch that succeeds (§6.4 "never stale data silently presented as
 *  fresh" — the `cachedAt` stamp travels with it wherever this is shown, so the UI can be honest
 *  about staleness rather than pretending this is live). */
export interface RitualViewCache {
  currentLayer: MethodLayer | 'COMPLETE';
  vaultCount: number;
  vaultContacts: VaultContactSummary[];
  queue: PublicQueueItem[];
  cachedAt: string;
}

export function loadRitualViewCache(): RitualViewCache | null {
  return readJson<RitualViewCache>(RITUAL_VIEW_CACHE_STORAGE_KEY);
}

export function saveRitualViewCache(snapshot: Omit<RitualViewCache, 'cachedAt'>): void {
  writeJson<RitualViewCache>(RITUAL_VIEW_CACHE_STORAGE_KEY, { ...snapshot, cachedAt: new Date().toISOString() });
}

// ─── Offline mutation queue wiring (§6.4 "Queue-and-sync with re-validation") ───────────────────

export const RITUAL_MUTATION_KIND = {
  BLANK_CANVAS: 'warm-market/blank-canvas',
  QUALITIES_FLIP: 'warm-market/qualities-flip',
} as const;

/** Stable per-layer mutation ids: a rep completes each layer's submission exactly once per
 *  ritual, so a FIXED id (rather than one generated per call) makes
 *  `PersistentOfflineQueue`'s own dedupe-by-id guard meaningful here — a double-fired submit
 *  (e.g. a duplicate click while still offline, before `stage` has re-rendered past the button)
 *  enqueues only once instead of queuing (and later double-applying) the same layer twice. */
export const RITUAL_MUTATION_ID = {
  BLANK_CANVAS: 'warm-market/blank-canvas/submit',
  QUALITIES_FLIP: 'warm-market/qualities-flip/submit',
} as const;

export interface RitualSubmitResponse {
  ok: boolean;
  reason?: string;
  detail?: string;
}

/**
 * Builds the `replay()` handler map the ritual's offline queue dispatches to on reconnect. Takes
 * the same `postJson`-shaped function the component already uses for its ONLINE submits, so
 * replay hits the exact same endpoints with the exact same request shape a live online submit
 * would — no parallel/duplicate write path that could drift out of sync with the real one.
 *
 * COMPLIANCE, NOT JUST TRANSPORT: a 2xx HTTP response is not the same thing as "the mutation
 * actually applied" — `/api/harvest-method/blank-canvas` can return HTTP 200 with
 * `{ok:false, reason:'soft_gate_confirmation_required'}` (§8.1's own soft-gate rule, re-checked
 * SERVER-side — never just trusted from the client's own offline pre-check, see
 * `needsSoftGateConfirmation` below and its call site in WarmMarketRitual.tsx). Both handlers
 * explicitly inspect `result.ok` and THROW when it's false, so `PersistentOfflineQueue.replay()`
 * treats a server-side rejection as a genuine failure — the mutation STAYS queued (never silently
 * marked synced, never force-applied) — the "no gate bypass on replay" guarantee this build unit
 * is required to hold. Qualities Flip's own `LayerOrderViolationError` already surfaces as a
 * non-2xx and is caught by `postJsonFn`'s own `!res.ok` check, needing no extra inspection here.
 */
export function createRitualQueueHandlers(
  postJsonFn: <T>(url: string, body: unknown) => Promise<T>
): Record<string, MutationHandler<unknown>> {
  return {
    [RITUAL_MUTATION_KIND.BLANK_CANVAS]: async (payload) => {
      const result = await postJsonFn<RitualSubmitResponse>('/api/harvest-method/blank-canvas', payload);
      if (!result.ok) {
        throw new Error(
          `Blank Canvas replay was rejected by the server (${result.reason ?? 'unknown reason'}) — the compliance/order gate applies on replay too.`
        );
      }
    },
    [RITUAL_MUTATION_KIND.QUALITIES_FLIP]: async (payload) => {
      const result = await postJsonFn<RitualSubmitResponse>('/api/harvest-method/qualities-flip', payload);
      if (!result.ok) {
        throw new Error(
          `Qualities Flip replay was rejected by the server (${result.reason ?? 'unknown reason'}${
            result.detail ? `: ${result.detail}` : ''
          }) — the compliance/order gate applies on replay too.`
        );
      }
    },
  };
}

/** §8.1's own soft-gate rule ("< 5 names asks once"), mirrored client-side ONLY so the offline
 *  branch can ask the rep "are you sure?" without a network round trip (see
 *  `MethodStateService.submitBlankCanvas`'s identical check in method-state.service.ts). Kept as
 *  one exported predicate so the client-side copy can never silently drift from the server's —
 *  both are the same one-line check against the same two inputs, and the ONLINE code path never
 *  uses this at all (it still asks the server, unchanged — this predicate exists purely to let
 *  the OFFLINE branch decide the same thing locally). */
export function needsSoftGateConfirmation(seedCount: number, confirmed: boolean): boolean {
  return seedCount < 5 && !confirmed;
}
