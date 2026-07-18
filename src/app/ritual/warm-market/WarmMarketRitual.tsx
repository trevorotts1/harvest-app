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

'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  BackgroundContextTiles,
  MethodLayer,
  NoteCorrection,
  PublicQueueItem,
  QualityCluster,
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
import styles from './ritual.module.css';

type Stage = MethodLayer | 'COMPLETE' | 'LOADING' | 'ERROR';

interface VaultContactSummary {
  id: string;
  firstName: string;
  lastName: string;
}

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

export default function WarmMarketRitual({ initialView }: WarmMarketRitualProps) {
  const [stage, setStage] = useState<Stage>(initialView?.currentLayer ?? 'LOADING');
  const [error, setError] = useState<string | null>(null);
  const [vaultCount, setVaultCount] = useState(initialView?.vaultCount ?? 0);
  const [vaultContacts, setVaultContacts] = useState<VaultContactSummary[]>(initialView?.vaultContacts ?? []);
  const [queue, setQueue] = useState<PublicQueueItem[]>(initialView?.queue ?? []);

  // Layer 1 draft state
  const [entries, setEntries] = useState<BlankCanvasDraftEntry[]>([]);
  const [softGateOpen, setSoftGateOpen] = useState(false);

  // Layer 2 draft state
  const [selectedClusters, setSelectedClusters] = useState<QualityCluster[]>([]);
  const [assignments, setAssignments] = useState<Record<string, QualitiesFlipAssignmentDraft>>({});

  // Layer 3 draft state
  const [bgEntries, setBgEntries] = useState<Record<string, BackgroundMatchingDraftEntry>>({});
  const [corrections, setCorrections] = useState<NoteCorrection[]>([]);

  useEffect(() => {
    if (initialView) return; // testability seam — skip live fetch when pre-supplied
    let cancelled = false;

    (async () => {
      try {
        const [stateRes, vaultRes] = await Promise.all([
          fetch('/api/harvest-method/state'),
          fetch('/api/contacts/import'),
        ]);
        if (!stateRes.ok || !vaultRes.ok) throw new Error('Failed to load ritual state');
        const state = await stateRes.json();
        const vault = await vaultRes.json();
        if (cancelled) return;

        setVaultCount(vault.count ?? 0);
        setVaultContacts(
          (vault.contacts ?? []).map((c: { id: string; firstName: string; lastName: string }) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
          }))
        );

        if (state.currentLayer === 'COMPLETE') {
          const queueRes = await fetch('/api/harvest-method/prioritized-queue');
          if (!queueRes.ok) throw new Error('Failed to load the ritual queue');
          const queueBody = await queueRes.json();
          if (cancelled) return;
          setQueue(queueBody.queue ?? []);
          setStage('COMPLETE');
        } else {
          setStage(state.currentLayer as Stage);
        }
      } catch {
        if (!cancelled) setError('We could not load your ritual — nothing typed was lost. Try again.');
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
    try {
      const result = await postJson<{ ok: boolean; reason?: string }>('/api/harvest-method/blank-canvas', {
        vaultCountAtStart: vaultCount,
        entries: entries.map((e) => ({ typedName: e.typedName, matched: e.matched, contactId: e.contactId })),
        softGateConfirmed: confirmed || undefined,
      });
      if (!result.ok && result.reason === 'soft_gate_confirmation_required') {
        setSoftGateOpen(true);
        return;
      }
      setSoftGateOpen(false);
      setStage(MethodLayer.QUALITIES_FLIP);
    } catch {
      setError('We could not save Layer 1 — nothing typed was lost. Try again.');
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
    try {
      await postJson('/api/harvest-method/qualities-flip', {
        selectedClusters,
        assignments: seeds.map((s) => {
          const a = assignments[s.contactId] ?? { clusters: [], needsTime: false };
          return a.needsTime
            ? { contactId: s.contactId, needsTime: true }
            : { contactId: s.contactId, clusters: a.clusters };
        }),
      });

      const initialBg: Record<string, BackgroundMatchingDraftEntry> = {};
      for (const s of seeds) {
        const a = assignments[s.contactId];
        if (a && !a.needsTime && a.clusters.length > 0) {
          initialBg[s.contactId] = { contactId: s.contactId, name: s.name, tiles: {}, note: '', existingLicenseeFlag: false };
        }
      }
      setBgEntries(initialBg);
      setStage(MethodLayer.BACKGROUND_MATCHING);
    } catch {
      setError('We could not save Layer 2 — nothing typed was lost. Try again.');
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
      setError('We could not save Layer 3 — nothing typed was lost. Try again.');
    }
  }

  async function acknowledgeExcluded(contactId: string) {
    try {
      await postJson('/api/harvest-method/action-complete', { contactId });
      setQueue((prev) => prev.map((i) => (i.contactId === contactId ? { ...i, needsAcknowledgment: false } : i)));
    } catch {
      setError('We could not record that acknowledgment. Try again.');
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.stage}>
        {error && (
          <div className={styles.softGate} role="alert">
            <p className={styles.softGateText}>{error}</p>
          </div>
        )}

        {stage === 'LOADING' && <p>Loading your ritual...</p>}

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
          />
        )}

        {stage === 'COMPLETE' && (
          <RitualConfirmation
            queue={queue}
            unmatchedHighlights={entries.filter((e) => !e.matched).map((e) => ({ name: e.typedName }))}
            onAcknowledgeExcluded={acknowledgeExcluded}
            onHandToAgent={() => {
              /* §5.4: "Hand to my agent" begins the action-queue fill; the action-queue route
                 (T-26-owned) already drives from the same engine, no further write needed here. */
            }}
          />
        )}
      </div>
    </div>
  );
}
