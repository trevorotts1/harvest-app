// WP03 §8.1 — the three-layer method's own state machine: Blank Canvas -> Qualities Flip ->
// Background Matching, in that fixed order, UNIVERSAL for every organization (§8 preamble, §17.1 —
// this service carries no Primerica-only branch; org-gated method CONTEXT, not the layers
// themselves, lives in primerica-overlay.ts).
//
// Persists via the narrow `HarvestMethodPrismaClient` delegate (same DI-mockable convention as
// `SegmentationPrismaClient`/`VaultPrismaClient`) — tests supply an in-memory Map-backed fake, no
// live database required. This service owns ONLY `HarvestMethodState` + `ContactMethodProfile`
// (both additive, WP03-owned tables); it never reads or writes the WP02-owned `Contact` model
// directly — eligibility/readiness computation (which DOES need Contact + ContactInteraction data)
// is `prioritized-queue.service.ts`'s job, kept deliberately separate so this service's Prisma
// surface stays narrow.

import { PrismaClient, ReadinessTier } from '@prisma/client';

import {
  BackgroundMatchingSubmission,
  BackgroundMatchingSubmitResult,
  BlankCanvasSubmission,
  BlankCanvasSubmitResult,
  MAX_SELECTED_CLUSTERS,
  MIN_SELECTED_CLUSTERS,
  MethodLayer,
  MethodStateView,
  NoteCorrection,
  QualitiesFlipSubmission,
  QualitiesFlipSubmitResult,
} from '../../types/harvest-method';
import { ALL_QUALITY_CLUSTERS, isValidQualityCluster, toClusterArray } from './clusters';
import { lintNote } from './doctrine-notes';
import { encryptOptionalField, getContactEncryptionKey } from '../warm-market/vault/vault-encryption';

// ─── Narrow, DI-mockable Prisma surface ────────────────────────────────────────────────────────────

export interface HarvestMethodStateRow {
  id: string;
  user_id: string;
  vault_count_at_blank_canvas: number | null;
  blank_canvas_completed_at: Date | null;
  blank_canvas_seed_count: number | null;
  blank_canvas_soft_gate_confirmed: boolean;
  qualities_flip_selected_clusters: unknown;
  qualities_flip_completed_at: Date | null;
  background_matching_completed_at: Date | null;
}

export interface ContactMethodProfileRow {
  id: string;
  user_id: string;
  contact_id: string;
  is_seed: boolean;
  needs_time: boolean;
  clusters: unknown;
  career_stage: string | null;
  financial_situation: string | null;
  family_context: string | null;
  community_role: string | null;
  note: string | null;
  existing_licensee_flag: boolean;
  existing_licensee_acked_at: Date | null;
  readiness_score: number | null;
  readiness_tier: ReadinessTier | null;
  queue_actioned_at: Date | null;
}

export interface HarvestMethodPrismaClient {
  harvestMethodState: {
    findUnique(args: { where: { user_id: string } }): Promise<HarvestMethodStateRow | null>;
    upsert(args: {
      where: { user_id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<HarvestMethodStateRow>;
  };
  contactMethodProfile: {
    findMany(args: { where: Record<string, unknown> }): Promise<ContactMethodProfileRow[]>;
    findUnique(args: { where: { user_id_contact_id: { user_id: string; contact_id: string } } }): Promise<ContactMethodProfileRow | null>;
    upsert(args: {
      where: { user_id_contact_id: { user_id: string; contact_id: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<ContactMethodProfileRow>;
  };
}

export class LayerOrderViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayerOrderViolationError';
  }
}

export class MethodStateService {
  constructor(
    private prisma: HarvestMethodPrismaClient = new PrismaClient() as unknown as HarvestMethodPrismaClient,
    private encryptionKey: string = getContactEncryptionKey()
  ) {}

  async getState(userId: string): Promise<MethodStateView> {
    const state = await this.prisma.harvestMethodState.findUnique({ where: { user_id: userId } });
    const layersCompleted: MethodLayer[] = [];
    if (state?.blank_canvas_completed_at) layersCompleted.push(MethodLayer.BLANK_CANVAS);
    if (state?.qualities_flip_completed_at) layersCompleted.push(MethodLayer.QUALITIES_FLIP);
    if (state?.background_matching_completed_at) layersCompleted.push(MethodLayer.BACKGROUND_MATCHING);

    const currentLayer: MethodLayer | 'COMPLETE' =
      layersCompleted.length === 3
        ? 'COMPLETE'
        : ([MethodLayer.BLANK_CANVAS, MethodLayer.QUALITIES_FLIP, MethodLayer.BACKGROUND_MATCHING][layersCompleted.length]);

    return {
      userId,
      layersCompleted,
      currentLayer,
      vaultCountAtBlankCanvas: state?.vault_count_at_blank_canvas ?? null,
      blankCanvasSeedCount: state?.blank_canvas_seed_count ?? null,
      selectedClusters: toClusterArray(state?.qualities_flip_selected_clusters),
    };
  }

  // ─── Layer 1 — Blank Canvas (§8.1) ────────────────────────────────────────────────────────────

  /**
   * §8.1: "Soft gate at < 5 names ('Are you sure you want to stop at N?'), never a hard block."
   * Below 5 without `softGateConfirmed` returns `ok:false` so the caller can re-prompt — this is NOT
   * a block (the rep may resubmit with confirmation, or simply add more names); nothing is ever
   * persisted as "complete" until the rep has either reached 5+ names or explicitly confirmed.
   */
  async submitBlankCanvas(userId: string, submission: BlankCanvasSubmission): Promise<BlankCanvasSubmitResult> {
    const seedCount = submission.entries.length;
    if (seedCount < 5 && !submission.softGateConfirmed) {
      return { ok: false, reason: 'soft_gate_confirmation_required', seedCount };
    }

    await this.prisma.harvestMethodState.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        vault_count_at_blank_canvas: submission.vaultCountAtStart,
        blank_canvas_completed_at: new Date(),
        blank_canvas_seed_count: seedCount,
        blank_canvas_soft_gate_confirmed: Boolean(submission.softGateConfirmed),
      },
      update: {
        vault_count_at_blank_canvas: submission.vaultCountAtStart,
        blank_canvas_completed_at: new Date(),
        blank_canvas_seed_count: seedCount,
        blank_canvas_soft_gate_confirmed: Boolean(submission.softGateConfirmed),
      },
    });

    // Matched entries become seed ContactMethodProfile rows immediately; an unmatched "add?" entry
    // has no contactId yet (§8.1: it triggers a Memory Jogger capture, T-23's own module) — it still
    // counts toward `seedCount` (the curated ~20-name list is about NAMES, not yet-created rows) but
    // has nothing to persist here until the Memory Jogger resolves it to a real contact id.
    for (const entry of submission.entries) {
      if (!entry.matched || !entry.contactId) continue;
      await this.prisma.contactMethodProfile.upsert({
        where: { user_id_contact_id: { user_id: userId, contact_id: entry.contactId } },
        create: { user_id: userId, contact_id: entry.contactId, is_seed: true },
        update: { is_seed: true },
      });
    }

    return { ok: true, seedCount };
  }

  // ─── Layer 2 — Qualities Flip (§8.1 — SIX clusters govern) ────────────────────────────────────

  /**
   * Requires Layer 1 complete first (the layers are read in Blank Canvas -> Qualities Flip ->
   * Background Matching order, §8.1) and requires EVERY seed contact to receive >= 1 cluster or
   * `needsTime` before the layer itself is marked complete — this is what keeps a partial Layer 2
   * from silently advancing the method (the no-short-circuit doctrine applies within a layer, not
   * only across layers).
   */
  async submitQualitiesFlip(userId: string, submission: QualitiesFlipSubmission): Promise<QualitiesFlipSubmitResult> {
    const state = await this.prisma.harvestMethodState.findUnique({ where: { user_id: userId } });
    if (!state?.blank_canvas_completed_at) {
      throw new LayerOrderViolationError('Qualities Flip cannot start before Layer 1 (Blank Canvas) is complete (§8.1).');
    }

    const { selectedClusters } = submission;
    if (
      selectedClusters.length < MIN_SELECTED_CLUSTERS ||
      selectedClusters.length > MAX_SELECTED_CLUSTERS ||
      !selectedClusters.every(isValidQualityCluster)
    ) {
      return {
        ok: false,
        reason: 'invalid_selected_cluster_count',
        detail: `selectedClusters must contain ${MIN_SELECTED_CLUSTERS}-${MAX_SELECTED_CLUSTERS} of the six valid clusters (§8.1); got ${selectedClusters.length}.`,
      };
    }

    for (const a of submission.assignments) {
      const hasClusters = Array.isArray(a.clusters) && a.clusters.length > 0;
      const hasNeedsTime = a.needsTime === true;
      if (hasClusters === hasNeedsTime) {
        // both set, or neither set — §8.1 requires exactly one of "assign >=1 cluster" XOR "need more time"
        return {
          ok: false,
          reason: 'invalid_assignment',
          detail: `Contact ${a.contactId} must have either >=1 cluster or needsTime, never both/neither.`,
        };
      }
      if (hasClusters && !a.clusters!.every(isValidQualityCluster)) {
        return { ok: false, reason: 'invalid_assignment', detail: `Contact ${a.contactId} has an invalid cluster value (outside the six, §8.1).` };
      }
    }

    const seeds = await this.prisma.contactMethodProfile.findMany({ where: { user_id: userId, is_seed: true } });
    const assignedIds = new Set(submission.assignments.map((a) => a.contactId));
    const uncovered = seeds.filter((s) => !assignedIds.has(s.contact_id));
    if (uncovered.length > 0) {
      return {
        ok: false,
        reason: 'invalid_assignment',
        detail: `${uncovered.length} seed contact(s) have no cluster/needsTime assignment yet — every seed contact must be covered before Layer 2 completes (§8.1 no-short-circuit).`,
      };
    }

    let assignedCount = 0;
    let needsTimeCount = 0;
    for (const a of submission.assignments) {
      const needsTime = a.needsTime === true;
      if (needsTime) needsTimeCount++;
      else assignedCount++;

      await this.prisma.contactMethodProfile.upsert({
        where: { user_id_contact_id: { user_id: userId, contact_id: a.contactId } },
        create: {
          user_id: userId,
          contact_id: a.contactId,
          is_seed: true,
          needs_time: needsTime,
          clusters: needsTime ? [] : a.clusters,
        },
        update: {
          needs_time: needsTime,
          clusters: needsTime ? [] : a.clusters,
        },
      });
    }

    await this.prisma.harvestMethodState.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        qualities_flip_selected_clusters: selectedClusters,
        qualities_flip_completed_at: new Date(),
      },
      update: {
        qualities_flip_selected_clusters: selectedClusters,
        qualities_flip_completed_at: new Date(),
      },
    });

    return { ok: true, assignedCount, needsTimeCount };
  }

  // ─── Layer 3 — Background Matching (§8.1) ─────────────────────────────────────────────────────

  /**
   * Requires Layer 2 complete first. Applies the §8.5 doctrine linter to every note before it is
   * encrypted and persisted, collecting corrections for the caller to surface (logged, per §8.5
   * "detected and replaced ... logged"). Marks the layer complete once called — the readiness SCORE
   * itself is computed downstream by `prioritized-queue.service.ts` (which needs Contact/interaction
   * data this service deliberately does not touch), not here.
   */
  async submitBackgroundMatching(
    userId: string,
    submission: BackgroundMatchingSubmission
  ): Promise<BackgroundMatchingSubmitResult> {
    const state = await this.prisma.harvestMethodState.findUnique({ where: { user_id: userId } });
    if (!state?.qualities_flip_completed_at) {
      throw new LayerOrderViolationError('Background Matching cannot start before Layer 2 (Qualities Flip) is complete (§8.1).');
    }

    const corrections: NoteCorrection[] = [];
    let tilesFilledCount = 0;

    for (const entry of submission.entries) {
      const linted = lintNote(entry.contactId, entry.note);
      if (linted.correction) corrections.push(linted.correction);

      const filled = [entry.tiles.careerStage, entry.tiles.financialSituation, entry.tiles.familyContext, entry.tiles.communityRole].filter(
        Boolean
      ).length;
      tilesFilledCount += filled;

      await this.prisma.contactMethodProfile.upsert({
        where: { user_id_contact_id: { user_id: userId, contact_id: entry.contactId } },
        create: {
          user_id: userId,
          contact_id: entry.contactId,
          is_seed: true,
          career_stage: entry.tiles.careerStage ?? null,
          financial_situation: entry.tiles.financialSituation ?? null,
          family_context: entry.tiles.familyContext ?? null,
          community_role: entry.tiles.communityRole ?? null,
          note: linted.text ? encryptOptionalField(linted.text, this.encryptionKey) : null,
          existing_licensee_flag: Boolean(entry.existingLicenseeFlag),
        },
        update: {
          career_stage: entry.tiles.careerStage ?? null,
          financial_situation: entry.tiles.financialSituation ?? null,
          family_context: entry.tiles.familyContext ?? null,
          community_role: entry.tiles.communityRole ?? null,
          note: linted.text ? encryptOptionalField(linted.text, this.encryptionKey) : null,
          existing_licensee_flag: Boolean(entry.existingLicenseeFlag),
        },
      });
    }

    await this.prisma.harvestMethodState.upsert({
      where: { user_id: userId },
      create: { user_id: userId, background_matching_completed_at: new Date() },
      update: { background_matching_completed_at: new Date() },
    });

    return { ok: true, tilesFilledCount, corrections };
  }
}

/** Re-exported for callers needing the closed cluster vocabulary without a second import path. */
export { ALL_QUALITY_CLUSTERS };
