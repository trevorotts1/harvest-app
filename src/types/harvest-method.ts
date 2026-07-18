// WP03 — the Harvest warm-market method + readiness engine (master-spec §8.1-§8.2, T-26).
//
// Full rewrite (T-26): this file previously described a baseline shape (`MethodStep`,
// `PrioritizedContact` with a bare `compositeScore` field) that predates the master-spec rebuild
// and was gated backwards (the old `method.service.ts` refused every NON-Primerica user — exactly
// inverted from §8 preamble's "WP03 is unblocked for all organizations"). Every type below is
// authored fresh against master-spec §8.1/§8.2 and the uiux §5.4 ritual.
//
// Doctrine note (§0.5): "seed"/"contact"/"community member" only — never "lead"/"prospect" appear
// in any identifier or comment in this file.

import { QualityCluster, ReadinessTier } from '@prisma/client';

export { QualityCluster, ReadinessTier };

/** The three layers, in their fixed, non-reorderable, non-skippable order (§8.1). */
export enum MethodLayer {
  BLANK_CANVAS = 'BLANK_CANVAS',
  QUALITIES_FLIP = 'QUALITIES_FLIP',
  BACKGROUND_MATCHING = 'BACKGROUND_MATCHING',
}

export const METHOD_LAYER_ORDER: MethodLayer[] = [
  MethodLayer.BLANK_CANVAS,
  MethodLayer.QUALITIES_FLIP,
  MethodLayer.BACKGROUND_MATCHING,
];

// ─── Layer 1 — Blank Canvas (§8.1) ────────────────────────────────────────────────────────────────

/** §8.1: "a curated ~20-name seed list tagged blank_canvas / warm_market_seed." */
export interface BlankCanvasEntry {
  /** A Vault contact id (soft-matched) OR undefined for an unmatched "add?" capture (Memory Jogger). */
  contactId?: string;
  typedName: string;
  matched: boolean;
}

export interface BlankCanvasSubmission {
  vaultCountAtStart: number;
  entries: BlankCanvasEntry[];
  /** Required once entries.length < 5 and the rep has been asked "are you sure?" (§8.1 soft gate). */
  softGateConfirmed?: boolean;
}

export type BlankCanvasSubmitResult =
  | { ok: true; seedCount: number }
  | { ok: false; reason: 'soft_gate_confirmation_required'; seedCount: number };

// ─── Layer 2 — Qualities Flip (§8.1 — the SIX clusters govern; uiux §5.4 reconciliation) ──────────

export const MIN_SELECTED_CLUSTERS = 2;
export const MAX_SELECTED_CLUSTERS = 3;

export interface QualitiesFlipAssignment {
  contactId: string;
  /** >= 1 cluster, XOR `needsTime` — never both, per §8.1's swipe-card "assign >=1 cluster OR need more time". */
  clusters?: QualityCluster[];
  needsTime?: boolean;
}

export interface QualitiesFlipSubmission {
  /** The 2-3 clusters the rep picked as resonant (§8.1: "the rep picks 2-3 that resonate"). */
  selectedClusters: QualityCluster[];
  assignments: QualitiesFlipAssignment[];
}

export type QualitiesFlipSubmitResult =
  | { ok: true; assignedCount: number; needsTimeCount: number }
  | { ok: false; reason: 'invalid_selected_cluster_count' | 'invalid_assignment'; detail: string };

// ─── Layer 3 — Background Matching (§8.1) ─────────────────────────────────────────────────────────

/** §8.1: "four context tiles (Career Stage, Financial Situation, Family Context, Community Role)." */
export interface BackgroundContextTiles {
  careerStage?: string;
  financialSituation?: string;
  familyContext?: string;
  communityRole?: string;
}

export interface BackgroundMatchingEntry {
  contactId: string;
  tiles: BackgroundContextTiles;
  /** Optional, <= 500 chars pre-encryption (§8.1); doctrine-linted (§8.5) before persistence. */
  note?: string;
  /** §8.1 "flags immediate unsuitability (e.g., an existing licensee) with a soft exclusion note." */
  existingLicenseeFlag?: boolean;
}

export interface BackgroundMatchingSubmission {
  entries: BackgroundMatchingEntry[];
}

export interface NoteCorrection {
  contactId: string;
  original: string;
  corrected: string;
  violations: { forbidden: string; replacement: string; match: string }[];
}

export interface BackgroundMatchingSubmitResult {
  ok: true;
  tilesFilledCount: number;
  corrections: NoteCorrection[];
}

// ─── §8.2 Readiness formula inputs & priority tiers ───────────────────────────────────────────────

export interface ReadinessInputs {
  /** Number of QualityCluster values assigned (0-3+; formula caps the credited count at 3). */
  assignedClusterCount: number;
  /** 0-4: how many of the four Layer-3 tiles are filled. */
  tilesFilledCount: number;
  daysSinceLastInteraction: number | null; // null = "never" (§8.2)
  careerStage: string | null;
  financialSituation: string | null;
}

export interface ReadinessResult {
  /** HIDDEN — 0-100. Never leave this module's internal computation; every projector below must
   *  drop it before a payload reaches a rep-facing route (see readiness-engine.ts `assertNoRawScoreLeak`). */
  score: number;
  tier: ReadinessTier;
  /** Plain-language label — the ONLY readiness datum a rep ever sees (§8.1, §8.2, uiux AC-5.4-4). */
  label: string;
  contextComplete: boolean;
}

/** The public (rep-facing) projection of a queued contact — structurally excludes any numeric score. */
export interface PublicQueueItem {
  contactId: string;
  firstName: string;
  lastInitial: string;
  clusters: QualityCluster[];
  tiles: BackgroundContextTiles;
  tier: ReadinessTier;
  label: string;
  needsAcknowledgment: boolean;
  /** T-29R2 (§7.6 "needs info" pattern mirrored for §8.2 eligibility): true only for the distinct
   *  `NEEDS_JURISDICTION` tier — an UNKNOWN contact jurisdiction for a regulated rep. Mirrors
   *  `needsAcknowledgment`'s shape but signals a data-completion prompt ("add this contact's
   *  state") rather than an exclusion the rep must acknowledge; never true at the same time as
   *  `needsAcknowledgment`. */
  needsJurisdiction: boolean;
  layersCompleted: MethodLayer[];
}

export interface MethodStateView {
  userId: string;
  layersCompleted: MethodLayer[];
  currentLayer: MethodLayer | 'COMPLETE';
  vaultCountAtBlankCanvas: number | null;
  blankCanvasSeedCount: number | null;
  selectedClusters: QualityCluster[];
}

export type QueueResult =
  | { available: true; queue: PublicQueueItem[] }
  | { available: false; reason: 'layers_incomplete'; layersCompleted: MethodLayer[]; queue: [] };
