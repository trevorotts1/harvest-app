// uiux §5.4 — the Warm-Market Ritual orchestrator: wires the three pure layer components to the
// real T-26 engine routes (state/blank-canvas/qualities-flip/background-matching/prioritized-queue).
// Resumable per layer (re-entry lands on the incomplete layer, §5.4 "Resume"); a failed save keeps
// the layer interactive with retry and never discards what was typed (§5.4 "Error").
//
// FIDELITY NOTE (stated, not silent — T-28 charter): the T-26 engine's public API has no read
// endpoint for an in-progress Layer 2/3 seed roster (only `getState()` — completed-layer booleans —
// and the post-Layer-3 queue). Within one browser session this component holds the seed roster
// (names entered at Layer 1) in local React state, which is sufficient for the common
// same-session resume case; a cross-device/cross-session resume of an IN-PROGRESS Layer 2/3 roster
// would need an additional read endpoint that is out of this build unit's lane (T-26 owns that
// service). Layer COMPLETION itself (which layer to land on) is always read live from the server.
//
// OFFLINE (§5.4 "Offline"; AC-5.4-7; T-R11): Layers 1-2 must work fully offline, with LOCAL
// PERSISTENCE that survives a reload, syncing to the server on reconnect. This closes the FIDELITY
// NOTE gap above for the same-device case too: `./offline.ts`'s `RitualDraftSnapshot` persists the
// in-progress roster/selections/assignments (+ which layer the rep is on) to `localStorage` on
// every change, and a mount hydrates from it before anything else — online or offline, reload or
// fresh tab. Submissions taken while offline apply an OPTIMISTIC local layer-advance immediately
// (the ritual visibly continues) and defer the real write onto a `PersistentOfflineQueue`
// (`@/lib/offline/offline-queue.ts`) that replays it, in order, the moment the browser reconnects —
// the same "optimistic now, authoritative on replay" shape as `ShiftView.tsx`'s `OfflineActionQueue`
// (T-34 QC fix D3), generalized + given real cross-reload persistence. Layer 3 (Background
// Matching) is NOT queued the same way — §5.4 draws that line deliberately ("Layer 3's matching
// requires connection: tiles capture offline, matching defers") — `BackgroundMatchingLayer` simply
// disables its submit and shows the honest deferred notice while offline; tile/note edits stay
// local-only either way, so nothing typed there is ever lost, online or off.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PersistentOfflineQueue } from '@/lib/offline/offline-queue';
import { isOnline, subscribeOnlineStatus } from '@/lib/offline/online-status';
import {
  BackgroundContextTiles,
  MethodLayer,
  NoteCorrection,
  PublicQueueItem,
  QualityCluster,
  ReadinessTier,
} from '@/types/harvest-method';

import BlankCanvasLayer, { type BlankCanvasDraftEntry } from './components/BlankCanvasLayer';
import QualitiesFlipLayer, {
  type QualitiesFlipAssignmentDraft,
  type QualitiesFlipSeed,
} from './components/QualitiesFlipLayer';
import BackgroundMatchingLayer, {
  type BackgroundMatchingDraftEntry,
} from './components/BackgroundMatchingLayer';
import RitualConfirmation from './components/RitualConfirmation';
import {
  clearRitualDraft,
  createRitualQueueHandlers,
  loadRitualDraft,
  loadRitualViewCache,
  needsSoftGateConfirmation,
  RITUAL_MUTATION_ID,
  RITUAL_MUTATION_KIND,
  RITUAL_QUEUE_STORAGE_KEY,
  saveRitualDraft,
  saveRitualViewCache,
  type VaultContactSummary,
} from './offline';
import styles from './ritual.module.css';
import { useT } from '@/app/locale-context';

type Stage = MethodLayer | 'COMPLETE' | 'LOADING' | 'ERROR';

export interface WarmMarketRitualInitialView {
  currentLayer: Stage;
  vaultCount: number;
  vaultContacts: VaultContactSummary[];
  queue?: PublicQueueItem[];
}

export interface WarmMarketRitualProps {
  /** Testability seam — see file header. Real usage (the page route) omits this; the component
   *  fetches live engine state on mount. */
  initialView?: WarmMarketRitualInitialView;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request to ${url} failed (${res.status})`);
  return res.json();
}

/** The exact `POST /api/agents/dispatch` body `handToAgent` sends for one contact. */
export interface WarmMarketDispatchBody {
  agentKey: 'warm_market_sub'; // AgentKey.WARM_MARKET_SUB (agent-runtime/runtime-model-map.ts)
  contactId: string;
  channel: 'SMS_HANDOFF';
  trigger: 'ritual_hand_to_agent';
  idempotencyKey: string;
}

/**
 * T-57 R3c-1 (BLOCKER-E1 terminal-exit fix) — the pure decision `handToAgent` drives, extracted
 * framework-free (no hooks, no fetch) so it is directly unit-testable in this repo's no-DOM Jest
 * environment, same rationale/convention as this file's own sibling extraction
 * (`applyOptimisticAction`/`OfflineActionQueue` in `../../shift/ShiftView.tsx`,
 * `viewFromHandoffResponse` in `../../community/components/composer-handoff-core.ts`). Excluded /
 * needs-jurisdiction contacts are never included (mirrors §8.2 "never actionable" — the exclusion
 * list some contacts sit in for compliance reasons, not the CFE's own separate per-message gate,
 * which still runs server-side on every draft this produces). Each entry's `idempotencyKey` is
 * stable per contact (contact ids are globally unique UUIDs — no userId needed to disambiguate,
 * `IdempotencyLog.key` is `@unique`, store.ts) so a re-tap can never double-dispatch the same
 * contact.
 */
export function actionableForHandoff(queue: PublicQueueItem[]): WarmMarketDispatchBody[] {
  return queue
    .filter((item) => item.tier !== ReadinessTier.EXCLUDED && item.tier !== ReadinessTier.NEEDS_JURISDICTION)
    .map((item) => ({
      agentKey: 'warm_market_sub',
      contactId: item.contactId,
      channel: 'SMS_HANDOFF',
      trigger: 'ritual_hand_to_agent',
      idempotencyKey: `ritual_hand_to_agent:${item.contactId}`,
    }));
}

export default function WarmMarketRitual({ initialView }: WarmMarketRitualProps) {
  const t = useT();
  // OFFLINE (T-R11): hydrate any previously-saved Layer 1-2 draft up front — before the live
  // fetch even starts — so a reload (online or offline) never shows an empty roster while the
  // real load resolves, and so the offline branch below has this available with no async gap.
  // The testability seam (`initialView`) skips this entirely, same as it skips the live fetch,
  // so component tests stay deterministic and independent of any real browser storage.
  const initialDraft = useMemo(() => (initialView ? null : loadRitualDraft()), [initialView]);

  const [stage, setStage] = useState<Stage>(initialView?.currentLayer ?? initialDraft?.currentLayer ?? 'LOADING');
  const [error, setError] = useState<string | null>(null);
  const [vaultCount, setVaultCount] = useState(initialView?.vaultCount ?? 0);
  const [vaultContacts, setVaultContacts] = useState<VaultContactSummary[]>(initialView?.vaultContacts ?? []);
  const [queue, setQueue] = useState<PublicQueueItem[]>(initialView?.queue ?? []);
  // T-57 R3c-1 (BLOCKER-E1 terminal-exit fix): "Hand to my agent" used to be a pure no-op — the
  // ritual's own final CTA did nothing at all, so the §8.3 action-queue fill it promises never
  // actually happened. `'idle'` guards against a double-dispatch on a repeat tap (this component
  // owns no prop it can pass to `RitualConfirmation` to disable its button — see `handToAgent`'s
  // own doc comment below for why the guard lives here instead).
  const [handoffStatus, setHandoffStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  // OFFLINE (T-R11): connectivity + the persisted, replay-on-reconnect mutation queue for Layers
  // 1-2 (§5.4/§6.4, AC-5.4-7). `PersistentOfflineQueue` is constructed once (guarded so a re-render
  // never re-reads storage or drops what's already queued) and lives for the component's lifetime.
  const [isOffline, setIsOffline] = useState(() => !isOnline());
  const [queueLength, setQueueLength] = useState(0);
  const [syncing, setSyncing] = useState<{ total: number; remaining: number } | null>(null);
  const [syncFailure, setSyncFailure] = useState<string | null>(null);
  const queueRef = useRef<PersistentOfflineQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new PersistentOfflineQueue({ storageKey: RITUAL_QUEUE_STORAGE_KEY });
  }

  // Layer 1 draft state — hydrated from the local draft when present (see `initialDraft` above).
  const [entries, setEntries] = useState<BlankCanvasDraftEntry[]>(initialDraft?.entries ?? []);
  const [softGateOpen, setSoftGateOpen] = useState(false);

  // Layer 2 draft state — hydrated from the local draft when present.
  const [selectedClusters, setSelectedClusters] = useState<QualityCluster[]>(initialDraft?.selectedClusters ?? []);
  const [assignments, setAssignments] = useState<Record<string, QualitiesFlipAssignmentDraft>>(
    initialDraft?.assignments ?? {}
  );

  // Layer 3 draft state (not persisted — §5.4 "Layer 3's matching requires connection"; tile/note
  // edits are local-only either way, so a same-session reload never loses them regardless).
  const [bgEntries, setBgEntries] = useState<Record<string, BackgroundMatchingDraftEntry>>({});
  const [corrections, setCorrections] = useState<NoteCorrection[]>([]);

  // OFFLINE (T-R11): persist the Layer 1-2 draft on every change — this is the "local persistence"
  // AC-5.4-7 requires, independent of online/offline state (writing it unconditionally means a
  // rep who goes offline mid-Layer-1 already has everything saved up to that point, with no extra
  // "did we save before you dropped connection" race). Skipped once the ritual is COMPLETE (there
  // is nothing left to resume) and for the testability seam (no storage access from tests that
  // supply `initialView`).
  useEffect(() => {
    if (initialView) return;
    if (stage === 'COMPLETE' || stage === 'LOADING' || stage === 'ERROR') return;
    saveRitualDraft({ currentLayer: stage, entries, selectedClusters, assignments });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView, stage, entries, selectedClusters, assignments]);

  // OFFLINE (T-R11): once the ritual actually reaches COMPLETE with nothing left queued, the
  // draft has fully served its purpose (everything in it is now server-confirmed) — clear it so
  // stale, plaintext-in-localStorage contact names/selections don't linger indefinitely.
  useEffect(() => {
    if (stage === 'COMPLETE' && queueRef.current && queueRef.current.length === 0) {
      clearRitualDraft();
    }
  }, [stage]);

  const flushQueue = useCallback(async () => {
    const q = queueRef.current;
    if (!q || q.length === 0) return;
    const total = q.length;
    setSyncing({ total, remaining: total });
    const handlers = createRitualQueueHandlers(postJson);
    const result = await q.replay(handlers, () => {
      setQueueLength(q.length);
      setSyncing((prev) => (prev ? { ...prev, remaining: q.length } : prev));
    });
    setQueueLength(q.length);
    setSyncing(null);
    // §6.4 "failures surface individually, never as a silent partial sync" — the failed mutation
    // (and anything after it) is still queued, untouched, for the next reconnect attempt.
    setSyncFailure(
      result.failed
        ? `${result.synced > 0 ? `${result.synced} item(s) synced. ` : ''}1 item couldn't sync yet (${result.failed.kind}) — it's still queued and we'll try again when you're back online.`
        : null
    );
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOnlineStatus((online) => {
      setIsOffline(!online);
      if (online) void flushQueue();
    });
    return unsubscribe;
  }, [flushQueue]);

  useEffect(() => {
    // Initial queue length (e.g. items left over from a prior offline session) + an opportunistic
    // flush if we're already online at mount with something still queued from last time.
    const q = queueRef.current;
    if (!q) return;
    setQueueLength(q.length);
    if (!isOffline && q.length > 0) void flushQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Captured once, synchronously, before either the mount-flush effect or the mount-fetch effect
  // below has run — closes a race where a live fetch's response (reflecting the server's state as
  // of BEFORE a still-in-flight queue replay lands) would otherwise roll `stage` back to a layer
  // the rep has already optimistically moved past (see the live-fetch success branch below).
  const hadPendingQueueAtMountRef = useRef(queueRef.current.length > 0);

  useEffect(() => {
    if (initialView) return; // testability seam — skip live fetch when pre-supplied
    let cancelled = false;

    function hydrateFromCacheOrFreshStart() {
      const cache = loadRitualViewCache();
      setVaultCount(cache?.vaultCount ?? 0);
      setVaultContacts(cache?.vaultContacts ?? []);
      setQueue(cache?.queue ?? []);
      // The local draft's own layer (if any) reflects real progress the rep has already made —
      // including an optimistic advance still waiting in the offline queue — so it takes priority
      // over the cache's last-server-confirmed layer, which would otherwise roll the rep back to
      // a layer they've already moved past (§5.4 "Resume" — prior work stays intact).
      setStage(initialDraft?.currentLayer ?? cache?.currentLayer ?? MethodLayer.BLANK_CANVAS);
      setError(null);
    }

    (async () => {
      if (!isOnline()) {
        // Cache-first, no network attempt at all while offline (§6.4 "Cache-first render") — an
        // honest, immediate resume instead of waiting out a doomed fetch.
        hydrateFromCacheOrFreshStart();
        return;
      }
      try {
        const [stateRes, vaultRes] = await Promise.all([
          fetch('/api/harvest-method/state'),
          fetch('/api/contacts/import'),
        ]);
        if (!stateRes.ok || !vaultRes.ok) throw new Error('Failed to load ritual state');
        const state = await stateRes.json();
        const vault = await vaultRes.json();
        if (cancelled) return;

        const contacts: VaultContactSummary[] = (vault.contacts ?? []).map(
          (c: { id: string; firstName: string; lastName: string }) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
          })
        );
        setVaultCount(vault.count ?? 0);
        setVaultContacts(contacts);

        if (state.currentLayer === 'COMPLETE') {
          const queueRes = await fetch('/api/harvest-method/prioritized-queue');
          if (!queueRes.ok) throw new Error('Failed to load the ritual queue');
          const queueBody = await queueRes.json();
          if (cancelled) return;
          setQueue(queueBody.queue ?? []);
          setStage('COMPLETE');
          saveRitualViewCache({ currentLayer: 'COMPLETE', vaultCount: vault.count ?? 0, vaultContacts: contacts, queue: queueBody.queue ?? [] });
        } else {
          // Narrower than `Stage`: this branch's `state.currentLayer` can only ever be a real
          // `MethodLayer` value from the server (never the client-only 'LOADING'/'ERROR'
          // sentinels), which is also exactly what `RitualViewCache.currentLayer` accepts.
          const serverStage = state.currentLayer as MethodLayer;
          // If a mutation was still queued at mount (an offline-optimistic advance not yet
          // replayed), prefer the LOCAL draft's layer over this response — the server's answer
          // may reflect a snapshot from before the concurrent mount-flush lands (§5.4 "Resume":
          // prior work — including an unreplayed advance — stays intact, never rolled back).
          setStage(hadPendingQueueAtMountRef.current && initialDraft?.currentLayer ? initialDraft.currentLayer : serverStage);
          // The cache itself always records the server's OWN truth, never the optimistic guess —
          // it must stay honest for the next offline-fallback read (§6.4 "never stale data
          // silently presented as fresh").
          saveRitualViewCache({ currentLayer: serverStage, vaultCount: vault.count ?? 0, vaultContacts: contacts, queue: [] });
        }
      } catch {
        if (cancelled) return;
        // Cache-first fallback even when nominally "online" (a transient failure, e.g. `fetch`
        // rejecting mid-flight) — never worse than the generic error unless there's truly nothing
        // cached to fall back to.
        if (loadRitualViewCache() || initialDraft) hydrateFromCacheOrFreshStart();
        else setError(t('ritual.warmMarketRitual.loadFailedError'));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seeds: QualitiesFlipSeed[] = useMemo(
    () => entries.filter((e) => e.matched && e.contactId).map((e) => ({ contactId: e.contactId!, name: e.typedName })),
    [entries]
  );

  function addName(name: string) {
    const match = vaultContacts.find((c) => c.firstName.toLowerCase() === name.toLowerCase());
    setEntries((prev) => [
      ...prev,
      match
        ? { typedName: name, matched: true, contactId: match.id }
        : { typedName: name, matched: false },
    ]);
  }

  async function finishBlankCanvas(confirmed: boolean) {
    const body = {
      vaultCountAtStart: vaultCount,
      entries: entries.map((e) => ({ typedName: e.typedName, matched: e.matched, contactId: e.contactId })),
      softGateConfirmed: confirmed || undefined,
    };

    if (isOffline) {
      // OFFLINE (T-R11, AC-5.4-7): the soft gate is a pure local decision — no network round trip
      // needed to ask "are you sure?" (see `needsSoftGateConfirmation`, which mirrors
      // `MethodStateService.submitBlankCanvas`'s identical server-side rule exactly). Once the
      // rule is satisfied, the real write is queued (replayed, and STILL re-validated server-side
      // on replay — see `createRitualQueueHandlers`) and the ritual advances optimistically now,
      // so Layer 1 visibly completes instead of stalling until reconnect.
      if (needsSoftGateConfirmation(entries.length, confirmed)) {
        setSoftGateOpen(true);
        return;
      }
      queueRef.current!.enqueue(RITUAL_MUTATION_KIND.BLANK_CANVAS, body, RITUAL_MUTATION_ID.BLANK_CANVAS);
      setQueueLength(queueRef.current!.length);
      setSoftGateOpen(false);
      setStage(MethodLayer.QUALITIES_FLIP);
      return;
    }

    try {
      const result = await postJson<{ ok: boolean; reason?: string }>('/api/harvest-method/blank-canvas', body);
      if (!result.ok && result.reason === 'soft_gate_confirmation_required') {
        setSoftGateOpen(true);
        return;
      }
      setSoftGateOpen(false);
      setStage(MethodLayer.QUALITIES_FLIP);
    } catch {
      setError(t('ritual.warmMarketRitual.saveLayer1FailedError'));
    }
  }

  function toggleSelectedCluster(cluster: QualityCluster) {
    setSelectedClusters((prev) => (prev.includes(cluster) ? prev.filter((c) => c !== cluster) : [...prev, cluster]));
  }

  function toggleAssignedCluster(contactId: string, cluster: QualityCluster) {
    setAssignments((prev) => {
      const current = prev[contactId] ?? { clusters: [], needsTime: false };
      const clusters = current.clusters.includes(cluster)
        ? current.clusters.filter((c) => c !== cluster)
        : [...current.clusters, cluster];
      return { ...prev, [contactId]: { clusters, needsTime: false } };
    });
  }

  function toggleNeedsTime(contactId: string) {
    setAssignments((prev) => {
      const current = prev[contactId] ?? { clusters: [], needsTime: false };
      return { ...prev, [contactId]: { clusters: [], needsTime: !current.needsTime } };
    });
  }

  async function submitQualitiesFlip() {
    const body = {
      selectedClusters,
      assignments: seeds.map((s) => {
        const a = assignments[s.contactId] ?? { clusters: [], needsTime: false };
        return a.needsTime
          ? { contactId: s.contactId, needsTime: true }
          : { contactId: s.contactId, clusters: a.clusters };
      }),
    };

    function advanceToBackgroundMatching() {
      const initialBg: Record<string, BackgroundMatchingDraftEntry> = {};
      for (const s of seeds) {
        const a = assignments[s.contactId];
        if (a && !a.needsTime && a.clusters.length > 0) {
          initialBg[s.contactId] = { contactId: s.contactId, name: s.name, tiles: {}, note: '', existingLicenseeFlag: false };
        }
      }
      setBgEntries(initialBg);
      setStage(MethodLayer.BACKGROUND_MATCHING);
    }

    if (isOffline) {
      // OFFLINE (T-R11, AC-5.4-7): `QualitiesFlipLayer` already keeps `onContinue`/this function
      // unreachable until `selectionValid && everyoneCovered` (2-3 clusters selected, every seed
      // covered by exactly clusters XOR needsTime) — the same invariant the server itself checks
      // in `submitQualitiesFlip` — so the queued payload is already known-valid; the server still
      // re-checks it for real on replay (`createRitualQueueHandlers`), including the Layer-1-must-
      // already-be-complete order gate, which a FIFO-ordered queue naturally preserves.
      queueRef.current!.enqueue(RITUAL_MUTATION_KIND.QUALITIES_FLIP, body, RITUAL_MUTATION_ID.QUALITIES_FLIP);
      setQueueLength(queueRef.current!.length);
      advanceToBackgroundMatching();
      return;
    }

    try {
      await postJson('/api/harvest-method/qualities-flip', body);
      advanceToBackgroundMatching();
    } catch {
      setError(t('ritual.warmMarketRitual.saveLayer2FailedError'));
    }
  }

  function changeTile(contactId: string, tile: keyof BackgroundContextTiles, value: string) {
    setBgEntries((prev) => ({
      ...prev,
      [contactId]: { ...prev[contactId], tiles: { ...prev[contactId].tiles, [tile]: value || undefined } },
    }));
  }

  function changeNote(contactId: string, note: string) {
    setBgEntries((prev) => ({ ...prev, [contactId]: { ...prev[contactId], note } }));
  }

  function toggleExistingLicensee(contactId: string) {
    setBgEntries((prev) => ({
      ...prev,
      [contactId]: { ...prev[contactId], existingLicenseeFlag: !prev[contactId].existingLicenseeFlag },
    }));
  }

  async function submitBackgroundMatching() {
    if (isOffline) {
      // OFFLINE (T-R11, §5.4): "Layer 3's matching requires connection" — a deliberately different
      // treatment than Layers 1-2 (no queue-and-replay here); `BackgroundMatchingLayer` itself
      // hides the submit control while `offline` is true and shows the honest deferred notice, so
      // this is a defensive no-op (never reachable via the UI) rather than the primary guard —
      // tile/note edits already stayed local-only above and are never lost.
      return;
    }
    try {
      const result = await postJson<{ ok: true; corrections: NoteCorrection[] }>(
        '/api/harvest-method/background-matching',
        {
          entries: Object.values(bgEntries).map((e) => ({
            contactId: e.contactId,
            tiles: e.tiles,
            note: e.note || undefined,
            existingLicenseeFlag: e.existingLicenseeFlag,
          })),
        }
      );
      setCorrections(result.corrections ?? []);

      const queueRes = await fetch('/api/harvest-method/prioritized-queue');
      const queueBody = await queueRes.json();
      setQueue(queueBody.queue ?? []);
      setStage('COMPLETE');
    } catch {
      setError(t('ritual.warmMarketRitual.saveLayer3FailedError'));
    }
  }

  async function acknowledgeExcluded(contactId: string) {
    try {
      await postJson('/api/harvest-method/action-complete', { contactId });
      setQueue((prev) => prev.map((i) => (i.contactId === contactId ? { ...i, needsAcknowledgment: false } : i)));
    } catch {
      setError(t('ritual.warmMarketRitual.acknowledgeFailedError'));
    }
  }

  /**
   * T-57 R3c-1 (BLOCKER-E1 terminal-exit fix) — "Hand to my agent" was a pure no-op (a comment
   * claiming "no further write needed here ... already drives from the same engine"). That claim
   * was FALSE for the surface §5.4/§8.3 actually mean by "the action queue begins filling":
   * `queue` (this component's own state) is the RITUAL's read-only review list —
   * `GET /api/harvest-method/prioritized-queue`, already fetched above — real top-match CARDS, but
   * nothing has drafted any outreach for them yet. The WP04-facing action queue (the Approval
   * Inbox / Today's Action Queue of AGENT-DRAFTED items, §8.3's actual referent) only fills once
   * the `warm_market_sub` agent (`AgentKey.WARM_MARKET_SUB`, agent-runtime/runtime-model-map.ts) is
   * DISPATCHED per contact — and nothing dispatches it automatically: the scheduled/cron pass
   * (`scheduled-dispatch.ts`'s `PIPELINE_STAGE_TO_AGENT`) deliberately never maps to it, precisely
   * because this ritual CTA is its real trigger. So this now calls the REAL, existing,
   * session-gated dispatch route (`POST /api/agents/dispatch`, dispatch/route.ts) once per
   * actionable contact — the same route + agent key an operator could already invoke by hand;
   * nothing here is stubbed or newly invented server-side.
   *
   * Channel = `SMS_HANDOFF` (own-number first touch, uiux §5.7/§10.1): a warm-market introduction
   * is the definitionally personal, own-relationship first touch, not a platform-number cadence
   * send — matching `agent-runtime.ts`'s own `output.channel ?? 'SMS_HANDOFF'` default for exactly
   * this shape of draft. Each draft still clears the CFE and needs the rep's own Approval Inbox
   * OK before anything sends (the confirmation screen's own boundary line, unchanged): this call
   * only gets the draft AS FAR AS that queue, never further.
   *
   * Excluded / needs-jurisdiction contacts are never dispatched (mirrors §8.2 "never actionable");
   * `idempotencyKey` is a stable, per-contact key (contact ids are globally unique UUIDs — no
   * userId needed to disambiguate) so a re-tap after a partial failure — or an accidental double
   * click, since this component owns no prop to disable `RitualConfirmation`'s own button — can
   * never double-dispatch the same contact (`IdempotencyLog.key` is `@unique`, store.ts).
   */
  async function handToAgent() {
    if (handoffStatus !== 'idle') return;
    const actionable = actionableForHandoff(queue);
    if (actionable.length === 0) {
      setHandoffStatus('done');
      return;
    }
    setHandoffStatus('sending');
    try {
      await Promise.all(actionable.map((body) => postJson('/api/agents/dispatch', body)));
      setHandoffStatus('done');
    } catch {
      setHandoffStatus('error');
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.stage}>
        {/* OFFLINE (T-R11, §5.4/§6.4): honest connectivity state — never a silent queue, never a
            fabricated "synced" while actually offline. Layers 1-2 keep working underneath this;
            it is purely informational. */}
        {isOffline && (
          <p className={styles.offlineBanner} role="status">
            {t('ritual.warmMarketRitual.offlineBannerLine1')}
            {queueLength > 0 ? t('ritual.warmMarketRitual.offlineBannerQueuedSuffix', { count: queueLength }) : ''}
            {t('ritual.warmMarketRitual.offlineBannerLine2')}
          </p>
        )}
        {!isOffline && syncing && (
          <p className={styles.offlineBanner} role="status">
            {t('ritual.warmMarketRitual.syncingBanner', { count: syncing.total })}
          </p>
        )}
        {!isOffline && !syncing && syncFailure && (
          <p className={styles.softGateText} role="alert">
            {syncFailure}
          </p>
        )}

        {error && (
          <div className={styles.softGate} role="alert">
            <p className={styles.softGateText}>{error}</p>
          </div>
        )}

        {stage === 'LOADING' && <p>{t('ritual.warmMarketRitual.loadingRitual')}</p>}

        {stage === MethodLayer.BLANK_CANVAS && (
          <BlankCanvasLayer
            vaultCount={vaultCount}
            entries={entries}
            onAddName={addName}
            softGateOpen={softGateOpen}
            onRequestFinish={() => finishBlankCanvas(false)}
            onConfirmSoftGate={() => finishBlankCanvas(true)}
            onKeepAdding={() => setSoftGateOpen(false)}
          />
        )}

        {stage === MethodLayer.QUALITIES_FLIP && (
          <QualitiesFlipLayer
            selectedClusters={selectedClusters}
            onToggleSelectedCluster={toggleSelectedCluster}
            seeds={seeds}
            assignments={assignments}
            onToggleAssignedCluster={toggleAssignedCluster}
            onToggleNeedsTime={toggleNeedsTime}
            onContinue={submitQualitiesFlip}
          />
        )}

        {stage === MethodLayer.BACKGROUND_MATCHING && (
          <BackgroundMatchingLayer
            entries={Object.values(bgEntries)}
            onChangeTile={changeTile}
            onChangeNote={changeNote}
            onToggleExistingLicensee={toggleExistingLicensee}
            corrections={corrections}
            onSubmit={submitBackgroundMatching}
            offline={isOffline}
          />
        )}

        {stage === 'COMPLETE' && (
          <>
            <RitualConfirmation
              queue={queue}
              unmatchedHighlights={entries.filter((e) => !e.matched).map((e) => ({ name: e.typedName }))}
              onAcknowledgeExcluded={acknowledgeExcluded}
              onHandToAgent={handToAgent}
            />
            {/* Status for the real dispatch above — additive, never inside RitualConfirmation
                (owned elsewhere; this component only wires props into it, §5.4). */}
            {handoffStatus === 'sending' && (
              <p className={styles.softGateText} role="status">
                {t('ritual.warmMarketRitual.handoffSending')}
              </p>
            )}
            {handoffStatus === 'done' && (
              <p className={styles.softGateText} role="status">
                {t('ritual.warmMarketRitual.handoffDone')}
              </p>
            )}
            {handoffStatus === 'error' && (
              <p className={styles.softGateText} role="alert">
                {t('ritual.warmMarketRitual.handoffError')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
