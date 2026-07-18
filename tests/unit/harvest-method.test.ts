// T-26 (WP03 — the Harvest warm-market method, master-spec §8.1-§8.2). Full rewrite: the previous
// version of this file asserted "should block non-Primerica users" (`getMethodState(nonUserId)
// .available` === false) — exactly the INVERSE of §8 preamble's "WP03 is unblocked for all
// organizations." That assertion would fail loudly against the corrected engine, which is the point:
// this suite proves the corrected doctrine with real, running assertions against an in-memory fake
// Prisma (no live DB, per repo pattern — mirrors vault.test.ts's `createFakeVaultPrisma`).
//
// Queue-orchestration proof tests (three-layer short-circuit, hidden score, org-gate, excluded
// contacts) live in harvest-method-queue.test.ts, which needs the fuller Contact/OptOutRegistry
// fake surface; this file covers the layer state machine + the pure engine/vocabulary/eligibility
// units in isolation.

import { PipelineStage, QualityCluster, ReadinessTier } from '@prisma/client';

import { ALL_QUALITY_CLUSTERS, QUALITY_CLUSTER_COUNT, isValidQualityCluster } from '../../src/services/harvest-method/clusters';
import { lintNote, MAX_NOTE_LENGTH, NoteTooLongError } from '../../src/services/harvest-method/doctrine-notes';
import { checkContactHardExclusion, checkEligibility, type EligibilityContactRow, type OptOutLookupClient } from '../../src/services/harvest-method/eligibility';
import {
  LayerOrderViolationError,
  MethodStateService,
  type ContactMethodProfileRow,
  type HarvestMethodPrismaClient,
  type HarvestMethodStateRow,
} from '../../src/services/harvest-method/method-state.service';
import {
  assertNoRawScoreLeak,
  clusterStrength,
  computeReadiness,
  computeReadinessScore,
  contextCompleteness,
  mapScoreToTier,
  relationshipRecency,
  ReadinessScoreLeakError,
  toPublicQueueItem,
} from '../../src/services/harvest-method/readiness-engine';
import { MethodLayer } from '../../src/types/harvest-method';
import { decryptOptionalField } from '../../src/services/warm-market/vault/vault-encryption';

// ── In-memory fake HarvestMethodPrismaClient (no live DB, per repo pattern) ─────────────────────

function defaultStateRow(user_id: string): HarvestMethodStateRow {
  return {
    id: `state-${user_id}`,
    user_id,
    vault_count_at_blank_canvas: null,
    blank_canvas_completed_at: null,
    blank_canvas_seed_count: null,
    blank_canvas_soft_gate_confirmed: false,
    qualities_flip_selected_clusters: [],
    qualities_flip_completed_at: null,
    background_matching_completed_at: null,
  };
}

function defaultProfileRow(user_id: string, contact_id: string): ContactMethodProfileRow {
  return {
    id: `profile-${user_id}-${contact_id}`,
    user_id,
    contact_id,
    is_seed: false,
    needs_time: false,
    clusters: [],
    career_stage: null,
    financial_situation: null,
    family_context: null,
    community_role: null,
    note: null,
    existing_licensee_flag: false,
    existing_licensee_acked_at: null,
    readiness_score: null,
    readiness_tier: null,
    queue_actioned_at: null,
  };
}

export function createFakeMethodPrisma() {
  const states = new Map<string, HarvestMethodStateRow>();
  const profiles = new Map<string, ContactMethodProfileRow>();

  const prisma: HarvestMethodPrismaClient = {
    harvestMethodState: {
      findUnique: async ({ where }) => states.get(where.user_id) ?? null,
      upsert: async ({ where, create, update }) => {
        const existing = states.get(where.user_id);
        const next = existing ? { ...existing, ...update } : { ...defaultStateRow(where.user_id), ...create };
        states.set(where.user_id, next as HarvestMethodStateRow);
        return next as HarvestMethodStateRow;
      },
    },
    contactMethodProfile: {
      findMany: async ({ where }) => {
        const all = [...profiles.values()].filter((p) => p.user_id === (where as any).user_id);
        if ((where as any).is_seed !== undefined) return all.filter((p) => p.is_seed === (where as any).is_seed);
        return all;
      },
      findUnique: async ({ where }) => profiles.get(`${where.user_id_contact_id.user_id}::${where.user_id_contact_id.contact_id}`) ?? null,
      upsert: async ({ where, create, update }) => {
        const key = `${where.user_id_contact_id.user_id}::${where.user_id_contact_id.contact_id}`;
        const existing = profiles.get(key);
        const next = existing
          ? { ...existing, ...update }
          : { ...defaultProfileRow(where.user_id_contact_id.user_id, where.user_id_contact_id.contact_id), ...create };
        profiles.set(key, next as ContactMethodProfileRow);
        return next as ContactMethodProfileRow;
      },
    },
  };

  return { prisma, states, profiles };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SIX_CLUSTERS — confirms 6, not 5 (§8.1 governs over the blueprint's five-quality flip)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('Qualities Flip — the SIX clusters (§8.1 governs over the blueprint\'s five)', () => {
  test('exactly six clusters exist — would fail if a future edit dropped back to five or grew to seven', () => {
    expect(QUALITY_CLUSTER_COUNT).toBe(6);
    expect(ALL_QUALITY_CLUSTERS).toHaveLength(6);
  });

  test('the six are the exact master-spec §8.1 set', () => {
    expect(new Set(ALL_QUALITY_CLUSTERS)).toEqual(
      new Set([
        QualityCluster.COMMUNITY_HUB,
        QualityCluster.RISING_ACHIEVER,
        QualityCluster.NATURAL_TEACHER,
        QualityCluster.STEADY_BUILDER,
        QualityCluster.HEART_OF_GOLD,
        QualityCluster.QUIET_INFLUENCER,
      ])
    );
  });

  test('isValidQualityCluster rejects anything outside the six', () => {
    expect(isValidQualityCluster('COMMUNITY_HUB')).toBe(true);
    expect(isValidQualityCluster('SEVENTH_CLUSTER')).toBe(false);
    expect(isValidQualityCluster('lead')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// The three-layer method state machine — universal availability, layer ordering, soft gate
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('MethodStateService — universal (§8 preamble: "WP03 is unblocked for all organizations")', () => {
  test('a brand-new (never-Primerica) user gets a real, available state — never gated by org', async () => {
    const { prisma } = createFakeMethodPrisma();
    const service = new MethodStateService(prisma);
    const state = await service.getState('user-external-1');
    expect(state.currentLayer).toBe(MethodLayer.BLANK_CANVAS);
    expect(state.layersCompleted).toEqual([]);
  });

  describe('Layer 1 — Blank Canvas soft gate (§8.1: "never a hard block")', () => {
    test('< 5 names without confirmation returns ok:false (a re-prompt, not a block) and persists nothing as complete', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = new MethodStateService(prisma);
      const result = await service.submitBlankCanvas('user-1', {
        vaultCountAtStart: 40,
        entries: [
          { typedName: 'Alice', matched: true, contactId: 'c1' },
          { typedName: 'Bob', matched: true, contactId: 'c2' },
        ],
      });
      expect(result).toEqual({ ok: false, reason: 'soft_gate_confirmation_required', seedCount: 2 });

      const state = await service.getState('user-1');
      expect(state.layersCompleted).toEqual([]); // never silently completed
    });

    test('< 5 names WITH confirmation proceeds — soft gate, never a hard block', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = new MethodStateService(prisma);
      const result = await service.submitBlankCanvas('user-1', {
        vaultCountAtStart: 40,
        entries: [{ typedName: 'Alice', matched: true, contactId: 'c1' }],
        softGateConfirmed: true,
      });
      expect(result).toEqual({ ok: true, seedCount: 1 });

      const state = await service.getState('user-1');
      expect(state.layersCompleted).toContain(MethodLayer.BLANK_CANVAS);
    });

    test('>= 5 names proceeds without any confirmation flag', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = new MethodStateService(prisma);
      const entries = Array.from({ length: 5 }, (_, i) => ({ typedName: `Name${i}`, matched: true, contactId: `c${i}` }));
      const result = await service.submitBlankCanvas('user-1', { vaultCountAtStart: 40, entries });
      expect(result).toEqual({ ok: true, seedCount: 5 });
    });

    test('unmatched ("add?") entries count toward the seed list but create no profile row yet', async () => {
      const { prisma, profiles } = createFakeMethodPrisma();
      const service = new MethodStateService(prisma);
      await service.submitBlankCanvas('user-1', {
        vaultCountAtStart: 40,
        entries: [
          { typedName: 'Alice', matched: true, contactId: 'c1' },
          { typedName: 'NewPerson', matched: false },
        ],
        softGateConfirmed: true,
      });
      expect(profiles.size).toBe(1); // only the matched entry became a profile row
    });
  });

  describe('layer ordering — no short-circuit within the method itself', () => {
    test('Qualities Flip before Blank Canvas throws LayerOrderViolationError', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = new MethodStateService(prisma);
      await expect(
        service.submitQualitiesFlip('user-1', { selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD], assignments: [] })
      ).rejects.toThrow(LayerOrderViolationError);
    });

    test('Background Matching before Qualities Flip throws LayerOrderViolationError', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = new MethodStateService(prisma);
      await service.submitBlankCanvas('user-1', {
        vaultCountAtStart: 40,
        entries: [{ typedName: 'Alice', matched: true, contactId: 'c1' }],
        softGateConfirmed: true,
      });
      await expect(service.submitBackgroundMatching('user-1', { entries: [] })).rejects.toThrow(LayerOrderViolationError);
    });
  });

  describe('Layer 2 — Qualities Flip (2-3 selected clusters; every seed assigned >=1 cluster XOR needsTime)', () => {
    async function seededUser(prisma: HarvestMethodPrismaClient, userId = 'user-1') {
      const service = new MethodStateService(prisma);
      await service.submitBlankCanvas(userId, {
        vaultCountAtStart: 40,
        entries: [
          { typedName: 'Alice', matched: true, contactId: 'c1' },
          { typedName: 'Bob', matched: true, contactId: 'c2' },
        ],
        softGateConfirmed: true,
      });
      return service;
    }

    test('rejects a single selected cluster (must be 2-3, §8.1)', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = await seededUser(prisma);
      const result = await service.submitQualitiesFlip('user-1', {
        selectedClusters: [QualityCluster.COMMUNITY_HUB],
        assignments: [
          { contactId: 'c1', clusters: [QualityCluster.COMMUNITY_HUB] },
          { contactId: 'c2', needsTime: true },
        ],
      });
      expect(result.ok).toBe(false);
    });

    test('rejects 4 selected clusters (must be 2-3, §8.1)', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = await seededUser(prisma);
      const result = await service.submitQualitiesFlip('user-1', {
        selectedClusters: [
          QualityCluster.COMMUNITY_HUB,
          QualityCluster.RISING_ACHIEVER,
          QualityCluster.NATURAL_TEACHER,
          QualityCluster.STEADY_BUILDER,
        ],
        assignments: [{ contactId: 'c1', clusters: [QualityCluster.COMMUNITY_HUB] }, { contactId: 'c2', needsTime: true }],
      });
      expect(result.ok).toBe(false);
    });

    test('rejects an assignment with both clusters AND needsTime (must be XOR)', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = await seededUser(prisma);
      const result = await service.submitQualitiesFlip('user-1', {
        selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD],
        assignments: [
          { contactId: 'c1', clusters: [QualityCluster.COMMUNITY_HUB], needsTime: true },
          { contactId: 'c2', needsTime: true },
        ],
      });
      expect(result).toMatchObject({ ok: false, reason: 'invalid_assignment' });
    });

    test('rejects incomplete coverage — every seed contact must be assigned before the layer completes', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = await seededUser(prisma);
      const result = await service.submitQualitiesFlip('user-1', {
        selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD],
        assignments: [{ contactId: 'c1', clusters: [QualityCluster.COMMUNITY_HUB] }], // c2 missing
      });
      expect(result).toMatchObject({ ok: false, reason: 'invalid_assignment' });

      const state = await service.getState('user-1');
      expect(state.layersCompleted).not.toContain(MethodLayer.QUALITIES_FLIP);
    });

    test('a valid, fully-covered submission completes Layer 2', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = await seededUser(prisma);
      const result = await service.submitQualitiesFlip('user-1', {
        selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD],
        assignments: [
          { contactId: 'c1', clusters: [QualityCluster.COMMUNITY_HUB] },
          { contactId: 'c2', needsTime: true },
        ],
      });
      expect(result).toEqual({ ok: true, assignedCount: 1, needsTimeCount: 1 });

      const state = await service.getState('user-1');
      expect(state.layersCompleted).toContain(MethodLayer.QUALITIES_FLIP);
      expect(state.selectedClusters).toHaveLength(2);
    });
  });

  describe('Layer 3 — Background Matching: doctrine linter on the note (§8.5)', () => {
    async function fullyFlippedUser(prisma: HarvestMethodPrismaClient) {
      const service = new MethodStateService(prisma);
      await service.submitBlankCanvas('user-1', {
        vaultCountAtStart: 40,
        entries: [{ typedName: 'Alice', matched: true, contactId: 'c1' }],
        softGateConfirmed: true,
      });
      await service.submitQualitiesFlip('user-1', {
        selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD],
        assignments: [{ contactId: 'c1', clusters: [QualityCluster.COMMUNITY_HUB] }],
      });
      return service;
    }

    test('"prospect" in a note is detected, replaced with a doctrine-clean term, and logged as a correction', async () => {
      const { prisma, profiles } = createFakeMethodPrisma();
      const service = await fullyFlippedUser(prisma);
      const result = await service.submitBackgroundMatching('user-1', {
        entries: [{ contactId: 'c1', tiles: { careerStage: 'early' }, note: 'This prospect seems ready.' }],
      });
      expect(result.corrections).toHaveLength(1);
      expect(result.corrections[0].corrected).not.toMatch(/prospect/i);
      expect(result.corrections[0].original).toMatch(/prospect/i);

      // The PERSISTED (encrypted) note must be the corrected text, not the raw doctrine violation —
      // decrypt it back and confirm.
      const stored = profiles.get('user-1::c1')!.note;
      const decrypted = decryptOptionalField(stored);
      expect(decrypted).not.toMatch(/prospect/i);
    });

    test('a clean note produces zero corrections', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = await fullyFlippedUser(prisma);
      const result = await service.submitBackgroundMatching('user-1', {
        entries: [{ contactId: 'c1', tiles: { careerStage: 'early' }, note: 'A wonderful community member.' }],
      });
      expect(result.corrections).toHaveLength(0);
    });

    test('a note over 500 chars throws NoteTooLongError', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = await fullyFlippedUser(prisma);
      await expect(
        service.submitBackgroundMatching('user-1', { entries: [{ contactId: 'c1', tiles: {}, note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }] })
      ).rejects.toThrow(NoteTooLongError);
    });

    test('completing Layer 3 marks all three layers complete', async () => {
      const { prisma } = createFakeMethodPrisma();
      const service = await fullyFlippedUser(prisma);
      await service.submitBackgroundMatching('user-1', { entries: [{ contactId: 'c1', tiles: { careerStage: 'early' } }] });
      const state = await service.getState('user-1');
      expect(state.currentLayer).toBe('COMPLETE');
      expect(state.layersCompleted).toEqual([MethodLayer.BLANK_CANVAS, MethodLayer.QUALITIES_FLIP, MethodLayer.BACKGROUND_MATCHING]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// doctrine-notes.ts — the lintNote unit in isolation
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('doctrine-notes — §8.5 "lead/prospect ... detected and replaced ... logged"', () => {
  test('no note -> no correction, empty text', () => {
    expect(lintNote('c1', undefined)).toEqual({ text: '', correction: null });
  });

  test('"lead" is replaced and the violation recorded', () => {
    const result = lintNote('c1', 'This lead is warm.');
    expect(result.correction).not.toBeNull();
    expect(result.text).not.toMatch(/\blead\b/i);
    expect(result.correction!.violations[0].forbidden).toBe('lead');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// eligibility.ts — the exclusion boundary, in isolation
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('eligibility — excluded contacts never pass this boundary (§8.2/§8.5)', () => {
  function contact(overrides: Partial<EligibilityContactRow> = {}): EligibilityContactRow {
    return {
      id: 'c1',
      do_not_contact: false,
      pipeline_stage: PipelineStage.IDENTIFIED,
      is_minor_flag: false,
      phone_hash: null,
      email_hash: null,
      ...overrides,
    };
  }

  const noOptOuts: OptOutLookupClient = { findFirst: async () => null };

  test('do_not_contact=true is hard-excluded synchronously (no DB round-trip needed)', () => {
    expect(checkContactHardExclusion(contact({ do_not_contact: true }))).toBe('do_not_contact');
  });

  test('pipeline_stage=DO_NOT_CONTACT is hard-excluded', () => {
    expect(checkContactHardExclusion(contact({ pipeline_stage: PipelineStage.DO_NOT_CONTACT }))).toBe('do_not_contact_pipeline_stage');
  });

  test('is_minor_flag=true is hard-excluded', () => {
    expect(checkContactHardExclusion(contact({ is_minor_flag: true }))).toBe('minor');
  });

  test('a clean contact with no opt-out hit is eligible', async () => {
    const result = await checkEligibility(contact({ phone_hash: 'hash-1' }), noOptOuts);
    expect(result).toEqual({ eligible: true, hardExclusionReason: null });
  });

  test('a global OptOutRegistry hash match excludes even a contact with clean Contact-level flags', async () => {
    const optedOut: OptOutLookupClient = { findFirst: async () => ({ identifier_hash: 'hash-1' }) };
    const result = await checkEligibility(contact({ phone_hash: 'hash-1' }), optedOut);
    expect(result).toEqual({ eligible: false, hardExclusionReason: 'opted_out' });
  });

  test('Contact-level exclusion short-circuits before any OptOutRegistry lookup runs', async () => {
    let called = false;
    const spy: OptOutLookupClient = {
      findFirst: async () => {
        called = true;
        return null;
      },
    };
    await checkEligibility(contact({ do_not_contact: true, phone_hash: 'hash-1' }), spy);
    expect(called).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// readiness-engine.ts — the §8.2 formula, tier mapping, and the hidden-score tripwire
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('readiness-engine — §8.2 formula (exact weights/inputs)', () => {
  test('clusterStrength: 1/2/3 clusters -> 33/66/99; caps at 3', () => {
    expect(clusterStrength(0)).toBe(0);
    expect(clusterStrength(1)).toBe(33);
    expect(clusterStrength(2)).toBe(66);
    expect(clusterStrength(3)).toBe(99);
    expect(clusterStrength(5)).toBe(99); // capped, never rewards over-assignment
  });

  test('contextCompleteness: % of 4 tiles filled', () => {
    expect(contextCompleteness(0)).toBe(0);
    expect(contextCompleteness(2)).toBe(50);
    expect(contextCompleteness(4)).toBe(100);
  });

  test('relationshipRecency: 100/<30d, 75/30-90d, 50/>90d, 25/never', () => {
    expect(relationshipRecency(5)).toBe(100);
    expect(relationshipRecency(29)).toBe(100);
    expect(relationshipRecency(30)).toBe(75);
    expect(relationshipRecency(90)).toBe(75);
    expect(relationshipRecency(91)).toBe(50);
    expect(relationshipRecency(null)).toBe(25);
  });

  test('computeReadinessScore combines the weighted formula exactly', () => {
    // 3 clusters(99*.30=29.7) + 4 tiles(100*.25=25) + <30d(100*.20=20) + early(100*.15=15) + building(100*.10=10) = 99.7 -> 100
    const score = computeReadinessScore({
      assignedClusterCount: 3,
      tilesFilledCount: 4,
      daysSinceLastInteraction: 10,
      careerStage: 'early',
      financialSituation: 'building',
    });
    expect(score).toBe(100);
  });

  test('an all-zero/no-data profile scores at the floor (never negative, never NaN)', () => {
    const score = computeReadinessScore({
      assignedClusterCount: 0,
      tilesFilledCount: 0,
      daysSinceLastInteraction: null,
      careerStage: null,
      financialSituation: null,
    });
    expect(score).toBe(Math.round(25 * 0.2)); // only the "never" recency contributes
    expect(Number.isFinite(score)).toBe(true);
  });

  describe('mapScoreToTier — §8.2 priority tiers', () => {
    test('excluded always wins regardless of score', () => {
      expect(mapScoreToTier({ score: 99, contextComplete: true, needsTime: false, excluded: true })).toBe(ReadinessTier.EXCLUDED);
    });
    test('needsTime forces Slow Burn regardless of score', () => {
      expect(mapScoreToTier({ score: 95, contextComplete: true, needsTime: true, excluded: false })).toBe(ReadinessTier.SLOW_BURN);
    });
    test('incomplete context forces Slow Burn regardless of score', () => {
      expect(mapScoreToTier({ score: 95, contextComplete: false, needsTime: false, excluded: false })).toBe(ReadinessTier.SLOW_BURN);
    });
    test('score >= 75 + complete context -> A', () => {
      expect(mapScoreToTier({ score: 75, contextComplete: true, needsTime: false, excluded: false })).toBe(ReadinessTier.A);
    });
    test('score 50-74 + complete context -> B', () => {
      expect(mapScoreToTier({ score: 50, contextComplete: true, needsTime: false, excluded: false })).toBe(ReadinessTier.B);
      expect(mapScoreToTier({ score: 74, contextComplete: true, needsTime: false, excluded: false })).toBe(ReadinessTier.B);
    });
    test('score < 50 + complete context -> Slow Burn (the watch-list fallback)', () => {
      expect(mapScoreToTier({ score: 10, contextComplete: true, needsTime: false, excluded: false })).toBe(ReadinessTier.SLOW_BURN);
    });
    // T-29R2 (§7.6 "needs info" mirrored for §8.2 eligibility): needsJurisdiction is a distinct tier,
    // ranked below `excluded` (a confirmed exclusion always wins) but above score/needsTime (an
    // unknown jurisdiction gates the contact regardless of how "ready" it otherwise looks).
    test('needsJurisdiction forces NEEDS_JURISDICTION regardless of score or context completeness', () => {
      expect(
        mapScoreToTier({ score: 99, contextComplete: true, needsTime: false, excluded: false, needsJurisdiction: true })
      ).toBe(ReadinessTier.NEEDS_JURISDICTION);
      expect(
        mapScoreToTier({ score: 10, contextComplete: false, needsTime: true, excluded: false, needsJurisdiction: true })
      ).toBe(ReadinessTier.NEEDS_JURISDICTION);
    });
    test('excluded still wins over needsJurisdiction if a caller ever set both (defense-in-depth — the two should be mutually exclusive by construction)', () => {
      expect(
        mapScoreToTier({ score: 99, contextComplete: true, needsTime: false, excluded: true, needsJurisdiction: true })
      ).toBe(ReadinessTier.EXCLUDED);
    });
    test('omitting needsJurisdiction entirely behaves exactly as false (backward-compatible, pre-T-29R2 call sites unaffected)', () => {
      expect(mapScoreToTier({ score: 99, contextComplete: true, needsTime: false, excluded: false })).toBe(ReadinessTier.A);
    });
  });

  describe('the hidden-score tripwire (named WP03 critical failure: "readiness score SHOWN to user")', () => {
    test('assertNoRawScoreLeak is a no-op for a clean (tier/label-only) payload', () => {
      expect(() => assertNoRawScoreLeak({ tier: ReadinessTier.A, label: 'Ready now' })).not.toThrow();
    });

    test('assertNoRawScoreLeak THROWS the instant a numeric score field appears anywhere in the payload — this is the guard that would trip if a future refactor spread a raw DB row into a response', () => {
      expect(() => assertNoRawScoreLeak({ tier: ReadinessTier.A, readiness_score: 82 })).toThrow(ReadinessScoreLeakError);
      expect(() => assertNoRawScoreLeak({ contact: { score: 55 } })).toThrow(ReadinessScoreLeakError);
      expect(() => assertNoRawScoreLeak([{ tier: 'A' }, { readinessScore: 10 }])).toThrow(ReadinessScoreLeakError);
    });

    test('toPublicQueueItem never includes a score field structurally — the type itself has no score key', () => {
      const item = toPublicQueueItem({
        contactId: 'c1',
        firstName: 'Alice',
        lastInitial: 'J',
        clusters: [QualityCluster.COMMUNITY_HUB],
        tiles: {},
        tier: ReadinessTier.A,
        label: 'Ready now',
        layersCompleted: [MethodLayer.BLANK_CANVAS, MethodLayer.QUALITIES_FLIP, MethodLayer.BACKGROUND_MATCHING],
      });
      expect(Object.keys(item)).not.toContain('score');
      expect(Object.keys(item)).not.toContain('readinessScore');
      expect(JSON.stringify(item)).not.toMatch(/score/i);
    });

    test('toPublicQueueItem sets needsAcknowledgment=true only for the EXCLUDED tier', () => {
      const excluded = toPublicQueueItem({
        contactId: 'c1',
        firstName: 'Alice',
        lastInitial: 'J',
        clusters: [],
        tiles: {},
        tier: ReadinessTier.EXCLUDED,
        label: 'Not eligible',
        layersCompleted: [],
      });
      expect(excluded.needsAcknowledgment).toBe(true);

      const a = toPublicQueueItem({ ...excluded, tier: ReadinessTier.A, label: 'Ready now' });
      expect(a.needsAcknowledgment).toBe(false);
    });

    // T-29R2 — the mirrored data-completion-prompt signal, distinct from needsAcknowledgment.
    test('toPublicQueueItem sets needsJurisdiction=true only for the NEEDS_JURISDICTION tier, and never alongside needsAcknowledgment', () => {
      const needsJurisdictionItem = toPublicQueueItem({
        contactId: 'c1',
        firstName: 'Alice',
        lastInitial: 'J',
        clusters: [],
        tiles: {},
        tier: ReadinessTier.NEEDS_JURISDICTION,
        label: 'Needs jurisdiction info',
        layersCompleted: [],
      });
      expect(needsJurisdictionItem.needsJurisdiction).toBe(true);
      expect(needsJurisdictionItem.needsAcknowledgment).toBe(false);

      const excludedItem = toPublicQueueItem({ ...needsJurisdictionItem, tier: ReadinessTier.EXCLUDED, label: 'Not eligible' });
      expect(excludedItem.needsJurisdiction).toBe(false);
      expect(excludedItem.needsAcknowledgment).toBe(true);
    });
  });

  describe('computeReadiness — the full per-contact orchestration', () => {
    test('a fully-scored, fully-complete, unexcluded contact lands in A', () => {
      const result = computeReadiness(
        { assignedClusterCount: 3, tilesFilledCount: 4, daysSinceLastInteraction: 5, careerStage: 'early', financialSituation: 'building' },
        false,
        false
      );
      expect(result.tier).toBe(ReadinessTier.A);
      expect(result.label).toBe('Ready now');
      expect(result.contextComplete).toBe(true);
      expect(typeof result.score).toBe('number'); // the score IS computed ...
    });

    test('the same inputs marked excluded=true land in EXCLUDED regardless of the score', () => {
      const result = computeReadiness(
        { assignedClusterCount: 3, tilesFilledCount: 4, daysSinceLastInteraction: 5, careerStage: 'early', financialSituation: 'building' },
        true,
        false
      );
      expect(result.tier).toBe(ReadinessTier.EXCLUDED);
    });

    // T-29R2 — the 4th (optional) parameter routes to the distinct NEEDS_JURISDICTION tier/label,
    // never EXCLUDED, even though the same fully-scored inputs would otherwise land in A.
    test('the same fully-scored inputs marked needsJurisdiction=true land in NEEDS_JURISDICTION, not EXCLUDED', () => {
      const result = computeReadiness(
        { assignedClusterCount: 3, tilesFilledCount: 4, daysSinceLastInteraction: 5, careerStage: 'early', financialSituation: 'building' },
        false,
        false,
        true
      );
      expect(result.tier).toBe(ReadinessTier.NEEDS_JURISDICTION);
      expect(result.tier).not.toBe(ReadinessTier.EXCLUDED);
      expect(result.label).toBe('Needs jurisdiction info');
    });
  });
});
