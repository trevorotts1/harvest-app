// T-26 (WP03 — master-spec §8.1 Layer 3 / §8.2 / §8.3). Proves, against an in-memory fake Prisma (no
// live DB), the five specific behaviors this build unit's brief calls out as "real tests with
// teeth" — each `describe` block states which named WP03 critical failure it would trip if the
// guard it tests were ever removed:
//
//   (a) all three layers required before the queue is produced — a short-circuit attempt is blocked;
//   (b) the HIDDEN readiness score never appears in any user-facing payload;
//   (c) a non-Primerica user never receives Primerica-specific content; a Primerica user gets the
//       overlay;
//   (d) an excluded contact (do_not_contact / DO_NOT_CONTACT / minor / opted-out) never appears in
//       the queue;
//   (e) the six clusters are all present (not five) in the actual queue data path.
//   (f) T-29R (WP03 gate remediation) — state-unlicensed exclusion: a REGULATED (Primerica) rep's
//       contact in a state the rep is NOT licensed in never appears in the queue either, mirroring
//       (d) exactly; a UNIVERSAL rep never over-excludes on this dimension.

import { OrgType, PipelineStage, QualityCluster, ReadinessTier } from '@prisma/client';

import { MethodStateService, type HarvestMethodPrismaClient } from '../../src/services/harvest-method/method-state.service';
import {
  PrioritizedQueueService,
  type QueueContactRow,
  type QueuePrismaClient,
} from '../../src/services/harvest-method/prioritized-queue.service';
import { checkJurisdictionExclusion } from '../../src/services/harvest-method/eligibility';
import { assertNoPrimericaLeak, OrgBranchViolation } from '../../src/services/onboarding/wp01/org-gate';
import { buildPrimericaVelocityContext } from '../../src/services/harvest-method/primerica-overlay';
import { assertAggregateOnly, computeUplineAggregateStats, UplineVisibilityLeakError } from '../../src/services/harvest-method/upline-aggregate';
import { encryptRequiredField } from '../../src/services/warm-market/vault/vault-encryption';
import { ALL_QUALITY_CLUSTERS } from '../../src/services/harvest-method/clusters';

// ── In-memory fake QueuePrismaClient (no live DB, per repo pattern) ────────────────────────────

function createFakeQueuePrisma() {
  const states = new Map<string, any>();
  const profiles = new Map<string, any>();
  const contacts = new Map<string, QueueContactRow & { user_id: string }>();
  const interactions: { contact_id: string; created_at: Date }[] = [];
  const optOuts = new Map<string, { identifier_hash: string }>();

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
      findUnique: async ({ where }) => profiles.get(`${where.user_id_contact_id.user_id}::${where.user_id_contact_id.contact_id}`) ?? null,
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
      findMany: async ({ where }) => {
        const ids = new Set(where.contact_id.in);
        return interactions
          .filter((i) => ids.has(i.contact_id))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      },
    },
    optOutRegistry: {
      findFirst: async ({ where }) => {
        for (const h of where.identifier_hash.in) {
          if (optOuts.has(h)) return optOuts.get(h)!;
        }
        return null;
      },
    },
  };

  return { prisma, states, profiles, contacts, interactions, optOuts };
}

function seedContact(
  contacts: Map<string, QueueContactRow & { user_id: string }>,
  input: {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    do_not_contact?: boolean;
    pipeline_stage?: PipelineStage;
    is_minor_flag?: boolean;
    phone_hash?: string | null;
    /** T-29R (§8.2 "Excluded: state-unlicensed"). Omitted = unknown jurisdiction. */
    jurisdiction?: string | null;
  }
) {
  contacts.set(input.id, {
    id: input.id,
    user_id: input.userId,
    first_name: encryptRequiredField(input.firstName),
    last_name: encryptRequiredField(input.lastName),
    do_not_contact: input.do_not_contact ?? false,
    pipeline_stage: input.pipeline_stage ?? PipelineStage.IDENTIFIED,
    is_minor_flag: input.is_minor_flag ?? false,
    phone_hash: input.phone_hash ?? null,
    email_hash: null,
    jurisdiction: input.jurisdiction ?? null,
  } as any);
}

/** Drives all three layers to completion for the given contact ids, with clean data guaranteed to
 *  produce a complete context (A-tier-eligible) for every one of them. */
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (a) THREE-LAYER SHORT-CIRCUIT — the queue is empty until all three layers are complete
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('(a) three-layer short-circuit — named WP03 critical failure "3-layer short-circuit"', () => {
  test('zero layers complete -> available:false, empty queue, never a raw Vault fallback', async () => {
    const { prisma } = createFakeQueuePrisma();
    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: true });
    expect(result).toEqual({ available: false, reason: 'layers_incomplete', layersCompleted: [], queue: [] });
  });

  test('Layer 1 + 2 complete but Layer 3 NOT complete -> still blocked (a short-circuit attempt is refused)', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'c1', userId: 'user-1', firstName: 'Alice', lastName: 'Jones' });
    const method = new MethodStateService(prisma);
    await method.submitBlankCanvas('user-1', {
      vaultCountAtStart: 40,
      entries: [{ typedName: 'Alice', matched: true, contactId: 'c1' }],
      softGateConfirmed: true,
    });
    await method.submitQualitiesFlip('user-1', {
      selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD],
      assignments: [{ contactId: 'c1', clusters: [QualityCluster.COMMUNITY_HUB] }],
    });
    // Layer 3 deliberately never submitted.

    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: true });
    expect(result.available).toBe(false);
    expect((result as any).queue).toEqual([]);
  });

  test('all three layers complete -> available:true, non-empty queue', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'c1', userId: 'user-1', firstName: 'Alice', lastName: 'Jones' });
    await completeAllThreeLayers(prisma, 'user-1', ['c1']);

    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: true });
    expect(result.available).toBe(true);
    expect((result as any).queue.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (b) HIDDEN SCORE NEVER SURFACES
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('(b) the readiness score never appears in any user-facing payload — named WP03 critical failure "readiness score SHOWN to user"', () => {
  test('the full getQueue() JSON payload contains no numeric score field anywhere', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'c1', userId: 'user-1', firstName: 'Alice', lastName: 'Jones' });
    seedContact(contacts as any, { id: 'c2', userId: 'user-1', firstName: 'Bob', lastName: 'Smith' });
    await completeAllThreeLayers(prisma, 'user-1', ['c1', 'c2']);

    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: true });

    expect(result.available).toBe(true);
    const queue = (result as any).queue as any[];
    expect(queue.length).toBe(2);
    for (const item of queue) {
      expect(Object.keys(item)).not.toContain('score');
      expect(Object.keys(item)).not.toContain('readinessScore');
      expect(item).not.toHaveProperty('readiness_score');
    }
    // Belt-and-suspenders: scan the ENTIRE serialized payload for a readiness-score-shaped key —
    // this is the exact scan `assertNoRawScoreLeak` runs internally on this same object before the
    // service returns it; re-running it here on the ACTUAL returned value (not a hand-built stub)
    // proves the guard the service calls has teeth against real data, not just isolated inputs.
    const serialized = JSON.stringify(result);
    expect(serialized.toLowerCase()).not.toMatch(/readiness_?score/);
    // Only qualitative tier/label ever cross this boundary — the rep sees a plain-language priority.
    expect(queue[0].tier).toEqual(expect.stringMatching(/^(A|B|SLOW_BURN|EXCLUDED)$/));
    expect(typeof queue[0].label).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (c) ORG-GATE — non-Primerica never sees Primerica content; a Primerica user gets the overlay
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('(c) org-gate — named WP03 critical failure "Primerica leak"', () => {
  test('a universal (non-Primerica) org gets NO primericaVelocity field, even when a rank is on file', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'c1', userId: 'user-1', firstName: 'Alice', lastName: 'Jones' });
    await completeAllThreeLayers(prisma, 'user-1', ['c1']);

    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: true, rank: 'Senior Vice President' });

    expect((result as any).primericaVelocity).toBeUndefined();
    expect(JSON.stringify(result).toLowerCase()).not.toContain('primerica');
  });

  test('a Primerica org WITH a rank on file gets the velocity overlay', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'c1', userId: 'user-2', firstName: 'Alice', lastName: 'Jones' });
    await completeAllThreeLayers(prisma, 'user-2', ['c1']);

    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('user-2', OrgType.PRIMERICA, { includeExcluded: true, rank: 'RVP' });

    expect((result as any).primericaVelocity).toBeDefined();
    expect((result as any).primericaVelocity.rank).toBe('RVP');
  });

  test('the underlying org-gate tripwire (assertNoPrimericaLeak) has real teeth: throws for a universal org carrying a Primerica string, no-ops for a Primerica org', () => {
    expect(() => assertNoPrimericaLeak({ note: 'Ask about your Primerica solution number' }, OrgType.EXTERNAL)).toThrow(OrgBranchViolation);
    expect(() => assertNoPrimericaLeak({ note: 'Ask about your Primerica solution number' }, OrgType.PRIMERICA)).not.toThrow();
  });

  test('buildPrimericaVelocityContext returns undefined outright for a universal org (not a null Primerica-shaped stub)', () => {
    expect(buildPrimericaVelocityContext(OrgType.EXTERNAL, 'RVP')).toBeUndefined();
    expect(buildPrimericaVelocityContext(OrgType.PRIMERICA, 'RVP')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (d) EXCLUDED CONTACTS — never in the (action) queue; do_not_contact / DO_NOT_CONTACT / minor / opted-out
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('(d) excluded contacts — named WP03 critical failure "excluded-contact in queue"', () => {
  test('do_not_contact / DO_NOT_CONTACT-stage / minor / opted-out never appear in the action-queue view (includeExcluded:false)', async () => {
    const { prisma, contacts, optOuts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'clean', userId: 'user-1', firstName: 'Clean', lastName: 'Contact' });
    seedContact(contacts as any, { id: 'dnc', userId: 'user-1', firstName: 'DNC', lastName: 'Flag', do_not_contact: true });
    seedContact(contacts as any, { id: 'stage', userId: 'user-1', firstName: 'Stage', lastName: 'Flag', pipeline_stage: PipelineStage.DO_NOT_CONTACT });
    seedContact(contacts as any, { id: 'minor', userId: 'user-1', firstName: 'Minor', lastName: 'Flag', is_minor_flag: true });
    seedContact(contacts as any, { id: 'optedout', userId: 'user-1', firstName: 'OptedOut', lastName: 'Flag', phone_hash: 'hash-opted-out' });
    optOuts.set('hash-opted-out', { identifier_hash: 'hash-opted-out' });

    const allIds = ['clean', 'dnc', 'stage', 'minor', 'optedout'];
    await completeAllThreeLayers(prisma, 'user-1', allIds);

    const service = new PrioritizedQueueService(prisma);

    // The §8.3 action-queue view: EXCLUDED never appears here at all.
    const actionQueue = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: false });
    expect(actionQueue.available).toBe(true);
    const actionIds = (actionQueue as any).queue.map((q: any) => q.contactId);
    expect(actionIds).toEqual(['clean']);
    expect(actionIds).not.toContain('dnc');
    expect(actionIds).not.toContain('stage');
    expect(actionIds).not.toContain('minor');
    expect(actionIds).not.toContain('optedout');

    // The ritual-review view (includeExcluded:true): they DO appear, tagged EXCLUDED, needing
    // acknowledgment — never silently dropped, per uiux §5.4 "never a silent removal".
    const fullQueue = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: true });
    const byId = new Map<string, any>((fullQueue as any).queue.map((q: any) => [q.contactId, q]));
    for (const excludedId of ['dnc', 'stage', 'minor', 'optedout']) {
      expect(byId.get(excludedId)?.tier).toBe(ReadinessTier.EXCLUDED);
      expect(byId.get(excludedId)?.needsAcknowledgment).toBe(true);
    }
    expect(byId.get('clean')?.tier).not.toBe(ReadinessTier.EXCLUDED);
  });

  test('the Layer-3 "existing licensee" soft-exclusion flag also lands a contact in EXCLUDED, never the action queue', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'licensee', userId: 'user-1', firstName: 'Already', lastName: 'Licensed' });

    const method = new MethodStateService(prisma);
    await method.submitBlankCanvas('user-1', {
      vaultCountAtStart: 40,
      entries: [{ typedName: 'Already', matched: true, contactId: 'licensee' }],
      softGateConfirmed: true,
    });
    await method.submitQualitiesFlip('user-1', {
      selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD],
      assignments: [{ contactId: 'licensee', clusters: [QualityCluster.COMMUNITY_HUB] }],
    });
    await method.submitBackgroundMatching('user-1', {
      entries: [{ contactId: 'licensee', tiles: { careerStage: 'early' }, existingLicenseeFlag: true }],
    });

    const service = new PrioritizedQueueService(prisma);
    const actionQueue = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: false });
    expect((actionQueue as any).queue).toEqual([]);

    const fullQueue = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: true });
    expect((fullQueue as any).queue[0].tier).toBe(ReadinessTier.EXCLUDED);

    // markActionComplete on an existing-licensee contact ALSO stamps the required acknowledgment.
    const before = await prisma.contactMethodProfile.findUnique({ where: { user_id_contact_id: { user_id: 'user-1', contact_id: 'licensee' } } });
    expect(before?.existing_licensee_acked_at).toBeNull();
    await service.markActionComplete('user-1', 'licensee');
    const after = await prisma.contactMethodProfile.findUnique({ where: { user_id_contact_id: { user_id: 'user-1', contact_id: 'licensee' } } });
    expect(after?.existing_licensee_acked_at).not.toBeNull();
    expect(after?.queue_actioned_at).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (e) SIX CLUSTERS — all present (not five) in the actual queue data path
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('(e) six clusters present end-to-end in the queue data path', () => {
  test('a contact assigned all six clusters carries all six through to the public queue item', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'c1', userId: 'user-1', firstName: 'Alice', lastName: 'Jones' });

    const method = new MethodStateService(prisma);
    await method.submitBlankCanvas('user-1', {
      vaultCountAtStart: 40,
      entries: [{ typedName: 'Alice', matched: true, contactId: 'c1' }],
      softGateConfirmed: true,
    });
    await method.submitQualitiesFlip('user-1', {
      selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD, QualityCluster.QUIET_INFLUENCER],
      assignments: [{ contactId: 'c1', clusters: [...ALL_QUALITY_CLUSTERS] }],
    });
    await method.submitBackgroundMatching('user-1', {
      entries: [{ contactId: 'c1', tiles: { careerStage: 'early', financialSituation: 'building', familyContext: 'x', communityRole: 'y' } }],
    });

    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: true });
    const item = (result as any).queue[0];
    expect(new Set(item.clusters)).toEqual(new Set(ALL_QUALITY_CLUSTERS));
    expect(item.clusters).toHaveLength(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (f) STATE-UNLICENSED EXCLUSION — T-29R (WP03 gate remediation, §8.2 "Excluded: state-unlicensed",
// §17.1 regulated-vs-universal). Named WP03 critical failure this closes: "An excluded contact
// (licensee/minor/unlicensed-state) surfacing in the action queue" — the "unlicensed-state" third of
// that named triple was, before this build unit, entirely unimplemented (Contact had no jurisdiction
// field; eligibility.ts never consulted LicensingService).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('(f) state-unlicensed exclusion — T-29R', () => {
  test('(a) a REGULATED (Primerica) rep + a contact in a state the rep is NOT licensed in -> excluded from the action queue, tagged EXCLUDED in the ritual view', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'ny-contact', userId: 'rep-1', firstName: 'Nadia', lastName: 'York', jurisdiction: 'NY' });
    await completeAllThreeLayers(prisma, 'rep-1', ['ny-contact']);

    // The rep is licensed ONLY in TX — never NY, where this contact lives.
    const licensedOnlyTX = { getLicensedJurisdictions: async () => ['TX'] };
    const service = new PrioritizedQueueService(prisma, undefined, licensedOnlyTX);

    const actionQueue = await service.getQueue('rep-1', OrgType.PRIMERICA, { includeExcluded: false });
    expect((actionQueue as any).queue).toEqual([]);

    const fullQueue = await service.getQueue('rep-1', OrgType.PRIMERICA, { includeExcluded: true });
    expect((fullQueue as any).queue[0].tier).toBe(ReadinessTier.EXCLUDED);
    expect((fullQueue as any).queue[0].needsAcknowledgment).toBe(true);
  });

  test('(b) a REGULATED rep with EMPTY/unavailable licensed jurisdictions -> fail-closed (excluded even though the contact would otherwise be A-tier)', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'tx-contact', userId: 'rep-2', firstName: 'Tex', lastName: 'Anderson', jurisdiction: 'TX' });
    await completeAllThreeLayers(prisma, 'rep-2', ['tx-contact']);

    const noLicensesOnFile = { getLicensedJurisdictions: async () => [] };
    const service = new PrioritizedQueueService(prisma, undefined, noLicensesOnFile);

    const actionQueue = await service.getQueue('rep-2', OrgType.PRIMERICA, { includeExcluded: false });
    expect((actionQueue as any).queue).toEqual([]);

    const fullQueue = await service.getQueue('rep-2', OrgType.PRIMERICA, { includeExcluded: true });
    expect((fullQueue as any).queue[0].tier).toBe(ReadinessTier.EXCLUDED);
  });

  test('(b2) an UNAVAILABLE (throwing) licensing lookup for a regulated rep ALSO fails closed — degrades to excluded, never throws the whole queue request', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'tx-contact', userId: 'rep-2b', firstName: 'Tex', lastName: 'Anderson', jurisdiction: 'TX' });
    await completeAllThreeLayers(prisma, 'rep-2b', ['tx-contact']);

    const unavailable = {
      getLicensedJurisdictions: async () => {
        throw new Error('licensing service unavailable');
      },
    };
    const service = new PrioritizedQueueService(prisma, undefined, unavailable);

    const result = await service.getQueue('rep-2b', OrgType.PRIMERICA, { includeExcluded: true });
    expect(result.available).toBe(true);
    expect((result as any).queue[0].tier).toBe(ReadinessTier.EXCLUDED);
  });

  test('(c) a UNIVERSAL (non-Primerica) rep -> NO state-based exclusion; contacts in any state (or with no jurisdiction at all) remain eligible, and the licensing provider is never even consulted', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'ny', userId: 'rep-3', firstName: 'Nadia', lastName: 'York', jurisdiction: 'NY' });
    seedContact(contacts as any, { id: 'unknown', userId: 'rep-3', firstName: 'Uma', lastName: 'Unknown' }); // no jurisdiction on file
    await completeAllThreeLayers(prisma, 'rep-3', ['ny', 'unknown']);

    // T-29R2 TEETH: a bare "throws if called" provider is not actually proof of anything — if a
    // future refactor accidentally moved the call inside a broader try/catch (or ahead of the
    // `if (regulated)` gate) the throw would simply be swallowed and this test would still pass on
    // its OWN merits (a universal rep's ids stay correct regardless, since checkJurisdictionExclusion
    // returns null for `!regulated` before ever touching licensedJurisdictions). A `jest.fn()` spy +
    // `not.toHaveBeenCalled()` is the only assertion that actually trips if the no-op gate regresses.
    const licensingProviderSpy = jest.fn(async (): Promise<string[]> => {
      throw new Error('must never be called for a universal (non-Primerica) rep — §17.1 no-op');
    });
    const service = new PrioritizedQueueService(prisma, undefined, { getLicensedJurisdictions: licensingProviderSpy });

    const actionQueue = await service.getQueue('rep-3', OrgType.EXTERNAL, { includeExcluded: false });
    const ids = (actionQueue as any).queue.map((q: any) => q.contactId).sort();
    expect(ids).toEqual(['ny', 'unknown']);
    expect(licensingProviderSpy).not.toHaveBeenCalled();
  });

  test('(d) a REGULATED rep + a contact in a state the rep IS licensed in -> remains eligible (not excluded on this dimension)', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'tx-contact', userId: 'rep-4', firstName: 'Tex', lastName: 'Anderson', jurisdiction: 'TX' });
    await completeAllThreeLayers(prisma, 'rep-4', ['tx-contact']);

    const licensedTXandCA = { getLicensedJurisdictions: async () => ['TX', 'CA'] };
    const service = new PrioritizedQueueService(prisma, undefined, licensedTXandCA);

    const actionQueue = await service.getQueue('rep-4', OrgType.PRIMERICA, { includeExcluded: false });
    const ids = (actionQueue as any).queue.map((q: any) => q.contactId);
    expect(ids).toEqual(['tx-contact']);
    expect((actionQueue as any).queue[0].tier).not.toBe(ReadinessTier.EXCLUDED);
  });

  test('(e) T-29R2: a REGULATED rep + a contact with an UNKNOWN jurisdiction -> a DISTINCT "needs jurisdiction" state, never EXCLUDED, never silently dropped — and the data gap is remediable', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'unknown', userId: 'rep-5', firstName: 'Uma', lastName: 'Unknown' }); // no jurisdiction set
    await completeAllThreeLayers(prisma, 'rep-5', ['unknown']);

    const licensedTX = { getLicensedJurisdictions: async () => ['TX'] };
    const service = new PrioritizedQueueService(prisma, undefined, licensedTX);

    // Held out of the actionable §8.3 action queue — an unknown state can't be drafted compliant
    // outreach for either — but this is NOT the same thing as EXCLUDED.
    const actionQueue = await service.getQueue('rep-5', OrgType.PRIMERICA, { includeExcluded: false });
    expect((actionQueue as any).queue).toEqual([]);

    // Surfaced (never silently dropped) in the ritual-review view as the DISTINCT NEEDS_JURISDICTION
    // state — assert the distinct state explicitly, not merely "not visible."
    const fullQueue = await service.getQueue('rep-5', OrgType.PRIMERICA, { includeExcluded: true });
    const item = (fullQueue as any).queue[0];
    expect(item.tier).toBe(ReadinessTier.NEEDS_JURISDICTION);
    expect(item.tier).not.toBe(ReadinessTier.EXCLUDED);
    expect(item.needsJurisdiction).toBe(true);
    expect(item.needsAcknowledgment).toBe(false); // this is a data-completion prompt, not an exclusion tap

    // Remediation, part 1: setting the jurisdiction to a state the rep IS licensed in makes the
    // contact eligible/actionable — proving the data gap, once filled, no longer gates the queue.
    contacts.get('unknown')!.jurisdiction = 'TX';
    const afterLicensed = await service.getQueue('rep-5', OrgType.PRIMERICA, { includeExcluded: false });
    expect((afterLicensed as any).queue.map((q: any) => q.contactId)).toEqual(['unknown']);
    const licensedItem = (afterLicensed as any).queue[0];
    expect(licensedItem.tier).not.toBe(ReadinessTier.EXCLUDED);
    expect(licensedItem.tier).not.toBe(ReadinessTier.NEEDS_JURISDICTION);

    // Remediation, part 2: setting the jurisdiction to a state the rep is NOT licensed in instead
    // correctly lands the CONFIRMED-unlicensed contact in EXCLUDED (unchanged T-29R behavior) —
    // proving this is a genuine three-way split, not unknown/known collapsing back together.
    contacts.get('unknown')!.jurisdiction = 'NY';
    const afterUnlicensed = await service.getQueue('rep-5', OrgType.PRIMERICA, { includeExcluded: true });
    expect((afterUnlicensed as any).queue[0].tier).toBe(ReadinessTier.EXCLUDED);
  });

  test('case-insensitive / whitespace-tolerant jurisdiction match: a lowercase-imported "tx" still matches a licensed "TX"', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    seedContact(contacts as any, { id: 'tx-lower', userId: 'rep-6', firstName: 'Tex', lastName: 'Lower', jurisdiction: ' tx ' });
    await completeAllThreeLayers(prisma, 'rep-6', ['tx-lower']);

    const licensedTX = { getLicensedJurisdictions: async () => ['TX'] };
    const service = new PrioritizedQueueService(prisma, undefined, licensedTX);

    const actionQueue = await service.getQueue('rep-6', OrgType.PRIMERICA, { includeExcluded: false });
    expect((actionQueue as any).queue.map((q: any) => q.contactId)).toEqual(['tx-lower']);
  });

  // Mutation-proof: exercises the pure boundary function directly. If `checkJurisdictionExclusion`'s
  // `!context.regulated` early-return were deleted, the third assertion below (universal, mismatched
  // jurisdiction) would flip from `null` to `'unlicensed_jurisdiction'` and fail — proving the
  // no-op-for-universal branch has real teeth, not just the integration tests above. T-29R2 adds the
  // `needs_jurisdiction` assertions: if the needs-info branch were REMOVED (reverting to the T-29R
  // behavior of `if (!jurisdiction) return 'unlicensed_jurisdiction'`), the null/undefined-jurisdiction
  // assertions below would flip from `'needs_jurisdiction'` to `'unlicensed_jurisdiction'` and fail —
  // this is the exact mutation the T-29R2 brief calls out as required to trip test (e) above.
  test('mutation-proof: checkJurisdictionExclusion trips ONLY on the regulated+non-licensed-jurisdiction case; unknown jurisdiction is its OWN distinct outcome', () => {
    expect(checkJurisdictionExclusion('NY', { regulated: true, licensedJurisdictions: ['TX'] })).toBe('unlicensed_jurisdiction');
    expect(checkJurisdictionExclusion('TX', { regulated: true, licensedJurisdictions: ['TX'] })).toBeNull();
    expect(checkJurisdictionExclusion('NY', { regulated: false, licensedJurisdictions: [] })).toBeNull(); // universal no-op
    expect(checkJurisdictionExclusion(null, { regulated: true, licensedJurisdictions: ['TX'] })).toBe('needs_jurisdiction'); // unknown jurisdiction -> distinct needs-info state, NOT excluded (T-29R2)
    expect(checkJurisdictionExclusion(undefined, { regulated: true, licensedJurisdictions: ['TX'] })).toBe('needs_jurisdiction'); // same for undefined as for null
    expect(checkJurisdictionExclusion('TX', { regulated: true, licensedJurisdictions: [] })).toBe('unlicensed_jurisdiction'); // KNOWN jurisdiction + empty licensure, fail-closed EXCLUDED (unchanged)
    expect(checkJurisdictionExclusion(undefined, { regulated: false, licensedJurisdictions: [] })).toBeNull(); // universal + unknown jurisdiction: still a no-op
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Sorting — A before B before Slow Burn before Excluded
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('queue ordering — tier precedence (A > B > Slow Burn > Excluded), score breaks ties only within a tier', () => {
  test('a Slow Burn contact with an incidentally high score never outranks a true B/A-tier contact', async () => {
    const { prisma, contacts } = createFakeQueuePrisma();
    // "a" -> full context, top score (A). "b" -> full context, moderate (B). "slow" -> needs_time (Slow Burn), even
    // though its own context is fully filled (so its RAW score could exceed b's) — tier precedence must still win.
    seedContact(contacts as any, { id: 'a', userId: 'user-1', firstName: 'A', lastName: 'One' });
    seedContact(contacts as any, { id: 'b', userId: 'user-1', firstName: 'B', lastName: 'Two' });
    seedContact(contacts as any, { id: 'slow', userId: 'user-1', firstName: 'S', lastName: 'Three' });

    const method = new MethodStateService(prisma);
    await method.submitBlankCanvas('user-1', {
      vaultCountAtStart: 40,
      entries: [
        { typedName: 'A', matched: true, contactId: 'a' },
        { typedName: 'B', matched: true, contactId: 'b' },
        { typedName: 'S', matched: true, contactId: 'slow' },
      ],
      softGateConfirmed: true,
    });
    await method.submitQualitiesFlip('user-1', {
      selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD],
      assignments: [
        { contactId: 'a', clusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.HEART_OF_GOLD] },
        { contactId: 'b', clusters: [QualityCluster.COMMUNITY_HUB] },
        { contactId: 'slow', needsTime: true },
      ],
    });
    await method.submitBackgroundMatching('user-1', {
      entries: [
        { contactId: 'a', tiles: { careerStage: 'early', financialSituation: 'building', familyContext: 'x', communityRole: 'y' } },
        { contactId: 'b', tiles: { careerStage: 'established', financialSituation: 'just_starting', familyContext: 'x', communityRole: 'y' } },
        { contactId: 'slow', tiles: { careerStage: 'early', financialSituation: 'building', familyContext: 'x', communityRole: 'y' } },
      ],
    });

    const service = new PrioritizedQueueService(prisma);
    const result = await service.getQueue('user-1', OrgType.EXTERNAL, { includeExcluded: true });
    const order = (result as any).queue.map((q: any) => q.contactId);
    expect(order).toEqual(['a', 'b', 'slow']); // tier precedence, not raw score, decides ordering
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// upline-aggregate.ts — §8.4 "aggregate stats only", named critical failure "upline non-aggregate visibility"
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('upline-aggregate — named WP03 critical failure "upline non-aggregate visibility"', () => {
  test('computeUplineAggregateStats produces only tier counts, avg readiness, and completion % — nothing contact-identifying', () => {
    const stats = computeUplineAggregateStats({
      entries: [
        { tier: ReadinessTier.A, score: 80 },
        { tier: ReadinessTier.B, score: 60 },
        { tier: ReadinessTier.SLOW_BURN, score: 20 },
      ],
      layersCompleted: ['BLANK_CANVAS', 'QUALITIES_FLIP', 'BACKGROUND_MATCHING'] as any,
    });
    expect(stats.countsByTier[ReadinessTier.A]).toBe(1);
    expect(stats.countsByTier[ReadinessTier.B]).toBe(1);
    expect(stats.countsByTier[ReadinessTier.SLOW_BURN]).toBe(1);
    expect(stats.countsByTier[ReadinessTier.EXCLUDED]).toBe(0);
    expect(stats.avgReadiness).toBe(Math.round((80 + 60 + 20) / 3));
    expect(stats.methodCompletionPercent).toBe(100);
    expect(Object.keys(stats)).toEqual(['countsByTier', 'avgReadiness', 'methodCompletionPercent']);
  });

  test('assertAggregateOnly throws the instant a contact-identifying field appears (would trip if a bug forwarded per-contact data)', () => {
    expect(() => assertAggregateOnly({ countsByTier: {}, avgReadiness: 50 })).not.toThrow();
    expect(() => assertAggregateOnly({ countsByTier: {}, contactId: 'c1' })).toThrow(UplineVisibilityLeakError);
    expect(() => assertAggregateOnly({ reps: [{ name: 'Alice' }] })).toThrow(UplineVisibilityLeakError);
    expect(() => assertAggregateOnly({ note: 'some background note' })).toThrow(UplineVisibilityLeakError);
  });
});
