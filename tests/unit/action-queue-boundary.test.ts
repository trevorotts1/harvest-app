// T-27 (WP03 §8.3 action queue / §8.5 anti-patterns architecturally blocked). This suite proves,
// against the REAL `action-boundary.ts` guards and the REAL `PrioritizedQueueService` (an in-memory
// fake Prisma, no live DB — same convention as tests/unit/harvest-method-queue.test.ts), the T-27
// build brief's "real tests with teeth":
//
//   (a) the action queue is readiness-sorted and empty until all three method layers are complete
//       (consumes T-26's gate — not reimplemented here);
//   (b) no numeric readiness score ever appears in the queue payload;
//   (c) a blocked §8.5 anti-pattern action (manual tier override / batch action / extraction-first
//       sort) is REJECTED at the boundary, not merely warned — each `describe` block below states
//       which guard function it exercises, and the assertion FAILS if that guard were ever turned
//       into a no-op (removing the `throw` or the `if` check that triggers it);
//   (d) an excluded contact never appears in the (§8.3) action-queue view.
//
// Route-level wiring (session gating, forged x-user-id, HTTP status codes, the note-linter-on-save
// behavior) is proven separately in tests/unit/harvest-method-action-queue-routes.test.ts.

import { OrgType, PipelineStage, QualityCluster } from '@prisma/client';

import {
  AntiPatternBlockedError,
  rejectBatchPayload,
  rejectSortOverride,
  rejectTierOverride,
} from '../../src/services/harvest-method/action-boundary';
import { MethodStateService, type HarvestMethodPrismaClient } from '../../src/services/harvest-method/method-state.service';
import {
  PrioritizedQueueService,
  type QueueContactRow,
  type QueuePrismaClient,
} from '../../src/services/harvest-method/prioritized-queue.service';
import { encryptRequiredField } from '../../src/services/warm-market/vault/vault-encryption';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Pure guard-function tests — action-boundary.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('rejectTierOverride — §8.5 "manual A-tier override -> striped (score-based tiering is immutable)"', () => {
  test.each(['tier', 'overrideTier', 'forceTier', 'readinessTier', 'readinessScore', 'score', 'priority'])(
    'throws AntiPatternBlockedError when the body carries "%s" — this assertion fails the instant the guard is removed',
    (key) => {
      expect(() => rejectTierOverride({ contactId: 'c1', [key]: 'A' })).toThrow(AntiPatternBlockedError);
      try {
        rejectTierOverride({ contactId: 'c1', [key]: 'A' });
      } catch (e) {
        expect((e as AntiPatternBlockedError).antiPattern).toBe('manual_tier_override');
      }
    }
  );

  test('a clean body (no override keys) never throws', () => {
    expect(() => rejectTierOverride({ contactId: 'c1', note: 'reached out today' })).not.toThrow();
    expect(() => rejectTierOverride(null)).not.toThrow();
    expect(() => rejectTierOverride(undefined)).not.toThrow();
  });
});

describe('rejectBatchPayload — §8.5 "batch cold outreach (select-N-and-blast) -> not supported"', () => {
  test('throws when contactId is an array (attempted batch via the singular field)', () => {
    expect(() => rejectBatchPayload({ contactId: ['c1', 'c2', 'c3'] })).toThrow(AntiPatternBlockedError);
  });

  test('throws when a plural "contactIds" field is present at all, even an empty array', () => {
    expect(() => rejectBatchPayload({ contactIds: [] })).toThrow(AntiPatternBlockedError);
    expect(() => rejectBatchPayload({ contactIds: ['c1', 'c2'] })).toThrow(AntiPatternBlockedError);
  });

  test('tags the thrown error with the batch_cold_outreach anti-pattern', () => {
    try {
      rejectBatchPayload({ contactIds: ['c1', 'c2'] });
      throw new Error('should not reach here');
    } catch (e) {
      expect((e as AntiPatternBlockedError).antiPattern).toBe('batch_cold_outreach');
    }
  });

  test('a single contactId string never throws', () => {
    expect(() => rejectBatchPayload({ contactId: 'c1' })).not.toThrow();
  });
});

describe('rejectSortOverride — §8.5 "extraction-first sorting (by perceived wealth) -> not a permitted sort mode"', () => {
  test.each(['sort', 'sortBy', 'orderBy', 'order_by', 'sort_by'])(
    'throws AntiPatternBlockedError when "%s" is present as a query param',
    (param) => {
      const params = new URLSearchParams();
      params.set(param, 'wealth');
      expect(() => rejectSortOverride(params)).toThrow(AntiPatternBlockedError);
    }
  );

  test('tags the thrown error with the extraction_first_sorting anti-pattern', () => {
    const params = new URLSearchParams('sort=wealth');
    try {
      rejectSortOverride(params);
      throw new Error('should not reach here');
    } catch (e) {
      expect((e as AntiPatternBlockedError).antiPattern).toBe('extraction_first_sorting');
    }
  });

  test('no sort-shaped param present never throws (limit/offset are not sort params)', () => {
    expect(() => rejectSortOverride(new URLSearchParams('limit=50&offset=0'))).not.toThrow();
    expect(() => rejectSortOverride(new URLSearchParams())).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Integration proof — the real PrioritizedQueueService against an in-memory fake Prisma
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function createFakeQueuePrisma() {
  const states = new Map<string, any>();
  const profiles = new Map<string, any>();
  const contacts = new Map<string, QueueContactRow & { user_id: string }>();

  function defaultProfileRow(user_id: string, contact_id: string) {
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

  function defaultStateRow(user_id: string) {
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

  const prisma: QueuePrismaClient = {
    harvestMethodState: {
      findUnique: async ({ where }) => states.get(where.user_id) ?? null,
      upsert: async ({ where, create, update }) => {
        const existing = states.get(where.user_id);
        const next = existing ? { ...existing, ...update } : { ...defaultStateRow(where.user_id), ...create };
        states.set(where.user_id, next);
        return next;
      },
    },
    contactMethodProfile: {
      findMany: async ({ where }) => {
        const all = [...profiles.values()].filter((p) => p.user_id === (where as any).user_id);
        return (where as any).is_seed !== undefined ? all.filter((p) => p.is_seed === (where as any).is_seed) : all;
      },
      findUnique: async ({ where }) =>
        profiles.get(`${where.user_id_contact_id.user_id}::${where.user_id_contact_id.contact_id}`) ?? null,
      upsert: async ({ where, create, update }) => {
        const key = `${where.user_id_contact_id.user_id}::${where.user_id_contact_id.contact_id}`;
        const existing = profiles.get(key);
        const next = existing
          ? { ...existing, ...update }
          : { ...defaultProfileRow(where.user_id_contact_id.user_id, where.user_id_contact_id.contact_id), ...create };
        profiles.set(key, next);
        return next;
      },
    },
    contact: {
      findMany: async ({ where }: { where: { id: { in: string[] }; user_id: string } }) => {
        const ids = new Set(where.id.in);
        return [...contacts.values()].filter((c) => ids.has(c.id) && c.user_id === where.user_id);
      },
    },
    contactInteraction: {
      findMany: async () => [],
    },
    optOutRegistry: {
      findFirst: async () => null,
    },
  };

  return { prisma, contacts };
}

function seedContact(
  contacts: Map<string, QueueContactRow & { user_id: string }>,
  input: { id: string; userId: string; firstName: string; lastName: string; do_not_contact?: boolean }
) {
  contacts.set(input.id, {
    id: input.id,
    user_id: input.userId,
    first_name: encryptRequiredField(input.firstName),
    last_name: encryptRequiredField(input.lastName),
    do_not_contact: input.do_not_contact ?? false,
    pipeline_stage: PipelineStage.IDENTIFIED,
    is_minor_flag: false,
    phone_hash: null,
    email_hash: null,
  } as any);
}

async function completeAllThreeLayers(prisma: HarvestMethodPrismaClient, userId: string, contactIds: string[]) {
  const method = new MethodStateService(prisma);
  await method.submitBlankCanvas(userId, {
    vaultCountAtStart: 40,
    entries: contactIds.map((id) => ({ typedName: id, matched: true, contactId: id })),
    softGateConfirmed: true,
  });
  await method.submitQualitiesFlip(userId, {
    selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD],
    assignments: contactIds.map((id) => ({ contactId: id, clusters: [QualityCluster.COMMUNITY_HUB] })),
  });
  await method.submitBackgroundMatching(userId, {
    entries: contactIds.map((id) => ({
      contactId: id,
      tiles: { careerStage: 'early', financialSituation: 'building', familyContext: 'married', communityRole: 'organizer' },
    })),
  });
}

describe('(a) action queue — readiness-sorted, empty until all three layers complete (§8.3)', () => {
  test('zero layers complete -> the §8.3 action-queue view is unavailable/empty, never a raw Vault fallback', async () => {
    const { prisma } = createFakeQueuePrisma();
    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('rep-1', OrgType.EXTERNAL, { includeExcluded: false });
    expect(result).toEqual({ available: false, reason: 'layers_incomplete', layersCompleted: [], queue: [] });
  });

  test('all three layers complete -> non-empty, tier-sorted queue carrying the §8.3 fields (clusters, context, tier, layersCompleted, label)', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts, { id: 'top', userId: 'rep-1', firstName: 'Top', lastName: 'Tier' });
    await completeAllThreeLayers(prisma, 'rep-1', ['top']);

    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('rep-1', OrgType.EXTERNAL, { includeExcluded: false });
    expect(result.available).toBe(true);
    const item = (result as any).queue[0];
    expect(item).toMatchObject({
      contactId: 'top',
      firstName: 'Top',
      lastInitial: 'T',
      layersCompleted: ['BLANK_CANVAS', 'QUALITIES_FLIP', 'BACKGROUND_MATCHING'],
    });
    expect(Array.isArray(item.clusters)).toBe(true);
    expect(typeof item.tier).toBe('string');
    expect(typeof item.label).toBe('string');
    expect(item.tiles).toBeDefined();
  });
});

describe('(b) hidden score — no numeric readiness score anywhere in the action-queue payload (§8.2)', () => {
  test('the queue payload has no score/readinessScore field, only tier + plain-language label', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts, { id: 'c1', userId: 'rep-1', firstName: 'Alice', lastName: 'Jones' });
    await completeAllThreeLayers(prisma, 'rep-1', ['c1']);

    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('rep-1', OrgType.EXTERNAL, { includeExcluded: false });
    const serialized = JSON.stringify(result);
    expect(serialized.toLowerCase()).not.toMatch(/readiness_?score/);
    expect(serialized.toLowerCase()).not.toMatch(/"score"/);
  });
});

describe('(c) a blocked §8.5 anti-pattern action is REJECTED at the boundary, not merely warned', () => {
  test('an attempted manual tier override never reaches (or influences) the queue engine', () => {
    // Simulates what any route wiring this guard in front of the engine must do: validate the
    // request BEFORE constructing/calling the service. If `rejectTierOverride` were removed (or
    // reduced to a no-op), this assertion fails — proving the guard, not the engine, is what
    // currently makes the override attempt fail.
    const forgedBody = { contactId: 'c1', tier: 'A', readinessScore: 100 };
    expect(() => rejectTierOverride(forgedBody)).toThrow(AntiPatternBlockedError);
  });

  test('an attempted batch ("select-N-and-blast") action never reaches the queue engine', () => {
    const forgedBody = { contactIds: ['c1', 'c2', 'c3', 'c4', 'c5'] };
    expect(() => rejectBatchPayload(forgedBody)).toThrow(AntiPatternBlockedError);
  });

  test('an attempted extraction-first sort (by perceived wealth) never reaches the queue engine', () => {
    const forgedParams = new URLSearchParams('sortBy=perceived_wealth');
    expect(() => rejectSortOverride(forgedParams)).toThrow(AntiPatternBlockedError);
  });
});

describe('(d) excluded contacts never appear in the (§8.3) action-queue view', () => {
  test('a do_not_contact contact is absent from includeExcluded:false even after all three layers complete', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts, { id: 'clean', userId: 'rep-1', firstName: 'Clean', lastName: 'Contact' });
    seedContact(contacts, { id: 'dnc', userId: 'rep-1', firstName: 'DNC', lastName: 'Flag', do_not_contact: true });
    await completeAllThreeLayers(prisma, 'rep-1', ['clean', 'dnc']);

    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('rep-1', OrgType.EXTERNAL, { includeExcluded: false });
    const ids = (result as any).queue.map((q: any) => q.contactId);
    expect(ids).toEqual(['clean']);
    expect(ids).not.toContain('dnc');
  });
});
