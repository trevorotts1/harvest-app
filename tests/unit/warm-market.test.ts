import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { ContactService } from '../../src/services/warm-market/contact.service';
import { PipelineService } from '../../src/services/warm-market/pipeline.service';
import { MemoryJoggerService, MemoryJoggerVocabViolationError } from '../../src/services/warm-market/memory-jogger.service';
import { PipelineStage, RelationshipType } from '../../src/types/warm-market';
import {
  encryptRequiredField,
  encryptOptionalField,
  decryptRequiredField,
} from '../../src/services/warm-market/vault/vault-encryption';
import {
  SegmentationService,
  SegmentationClient,
  SegmentationRequest,
  SegmentationResult,
  HaikuSegmentationClient,
  MissingClaudeCredentialError,
  SegmentationError,
  type SegmentationContactRow,
  type SegmentationInteractionRow,
  type SegmentationPrismaClient,
} from '../../src/services/warm-market/segmentation';
import { MemoryJoggerCategory } from '../../src/services/warm-market/memory-jogger/types';
import type { MemoryJoggerCategoryClient } from '../../src/services/warm-market/memory-jogger/category-client';
import {
  HaikuMemoryJoggerCategoryClient,
  MemoryJoggerCategoryError,
} from '../../src/services/warm-market/memory-jogger';

// Mock PrismaClient
const mockContactFindMany = jest.fn();
const mockContactFindFirst = jest.fn();
const mockContactFindUnique = jest.fn();
const mockContactCreate = jest.fn();
const mockContactUpdate = jest.fn();
const mockInteractionFindFirst = jest.fn();
const mockInteractionFindMany = jest.fn();

const mockPrisma = {
  contact: {
    findMany: mockContactFindMany,
    findFirst: mockContactFindFirst,
    findUnique: mockContactFindUnique,
    create: mockContactCreate,
    update: mockContactUpdate,
  },
  contactInteraction: {
    findFirst: mockInteractionFindFirst,
    findMany: mockInteractionFindMany,
  },
} as unknown as PrismaClient;

// T-23 (§16.4/§7.1): a real, deterministic encrypted Contact row — every PII field run through the
// SAME `encryptRequiredField`/`encryptOptionalField` helpers T-22's Vault write path uses, so tests
// below exercise a genuine encrypt→store→decrypt round trip (via `CONTACT_ENCRYPTION_KEY`, seeded
// by tests/jest.setup.ts) instead of a plaintext stand-in. This is what makes the Memory
// Jogger/Pipeline "reads DECRYPTED PII" tests have teeth: pre-fix code that read `contact.first_name`
// raw would see the ciphertext envelope JSON below, not "Sarah"/"Vega", and every assertion that
// checks for the plaintext name would fail against it.
function encryptedContactRow(overrides: Partial<{
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  industry: string | null;
  pipeline_stage: string;
  segment_score: number;
}> = {}) {
  const plain = {
    id: 'contact-1',
    first_name: 'Sarah',
    last_name: 'Vega',
    phone: '5551234567',
    email: 'sarah@example.com',
    notes: null as string | null,
    industry: 'insurance',
    pipeline_stage: PipelineStage.IDENTIFIED,
    segment_score: 0,
    ...overrides,
  };
  return {
    id: plain.id,
    first_name: encryptRequiredField(plain.first_name),
    last_name: encryptRequiredField(plain.last_name),
    phone: encryptOptionalField(plain.phone),
    email: encryptOptionalField(plain.email),
    notes: encryptOptionalField(plain.notes),
    industry: plain.industry,
    pipeline_stage: plain.pipeline_stage,
    segment_score: plain.segment_score,
  };
}

describe('Warm Market Engine', () => {
  const userId = 'user-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ContactService', () => {
    let contactService: ContactService;

    beforeEach(() => {
      contactService = new ContactService(mockPrisma);
    });

    test('should calculate scoring based on interactions', () => {
      const contactHigh = { interactions: Array(6).fill({}) };
      expect(contactService.scoreContact(contactHigh)).toBe(80);

      const contactLow = { interactions: Array(2).fill({}) };
      expect(contactService.scoreContact(contactLow)).toBe(20);
    });

    test('should calculate hidden earnings with safe harbor framing', () => {
      mockContactFindUnique.mockResolvedValue({
        id: 'contact-1',
        name: 'Test Contact',
        interactions: Array(6).fill({}),
      });

      const earnings = contactService.calculateHiddenEarnings('contact-1');
      expect(earnings).resolves.toBe(80000); // strength 80 * 1000
    });

    test('should get pipeline contacts by stage', async () => {
      const mockContacts = [
        { id: 'c1', name: 'Alice', pipeline_stage: PipelineStage.IDENTIFIED },
        { id: 'c2', name: 'Bob', pipeline_stage: PipelineStage.IDENTIFIED },
      ];
      mockContactFindMany.mockResolvedValue(mockContacts);

      const result = await contactService.getPipelineContacts(userId, PipelineStage.IDENTIFIED);
      expect(result).toHaveLength(2);
      expect(mockContactFindMany).toHaveBeenCalledWith({
        where: { user_id: userId, pipeline_stage: PipelineStage.IDENTIFIED },
      });
    });

  });

  // T-R8 (housekeeping, from the T-22 QC): `ContactService.importContacts` used to dedupe via
  // `{ phone: normalized.phone }` / `{ email: normalized.email }` — a plaintext equality query
  // that could never match once T-22 made `Contact.phone`/`.email` AES-256-GCM ciphertext (IV
  // varies per call, so equality against a plaintext value is dead by construction). The only
  // *live* import path is `VaultService.importBatch` (tests/unit/vault.test.ts), which already
  // dedupes correctly via the keyed `phone_hash`/`email_hash` columns. Since `importContacts` had
  // zero live (non-test) call sites, it was retired rather than fixed — this block proves the
  // retirement stuck: the method (and its orphaned `normalize`/`splitName`/`ContactInput`
  // helpers) are actually gone, and nothing under `src/` references them. Reintroduce the old
  // `{ phone: normalized.phone }` dedup query, or a live caller of `importContacts`, and these
  // tests fail.
  describe('ContactService.importContacts retirement (T-R8)', () => {
    const REPO_ROOT = path.join(__dirname, '..', '..');
    const SRC_DIR = path.join(REPO_ROOT, 'src');
    const CONTACT_SERVICE_FILE = path.join(SRC_DIR, 'services', 'warm-market', 'contact.service.ts');

    function findFiles(dir: string, predicate: (name: string) => boolean): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) out.push(...findFiles(full, predicate));
        else if (predicate(entry)) out.push(full);
      }
      return out;
    }

    test('importContacts/normalize/splitName no longer exist on ContactService', () => {
      const proto = ContactService.prototype as unknown as Record<string, unknown>;
      expect(typeof proto.importContacts).toBe('undefined');
      expect(typeof proto.normalize).toBe('undefined');
      expect(typeof proto.splitName).toBe('undefined');
    });

    test('ContactInput is no longer exported from contact.service', () => {
      const mod = require('../../src/services/warm-market/contact.service');
      expect(mod.ContactInput).toBeUndefined();
    });

    test('the dead plaintext dedup query is gone from contact.service.ts source', () => {
      const src = readFileSync(CONTACT_SERVICE_FILE, 'utf8');
      expect(src).not.toMatch(/phone:\s*normalized\.phone/);
      expect(src).not.toMatch(/email:\s*normalized\.email/);
      expect(src).not.toContain('importContacts');
    });

    // NOTE: this deliberately checks for an import of the `contact.service` MODULE, not the bare
    // word "importContacts" — `src/app/dashboard/contact-upload-demo.tsx` happens to have its own,
    // wholly unrelated local `importContacts()` handler (a demo `fetch('/api/contacts/import')`
    // caller) that shares the name by coincidence. The real signal that nothing live can still
    // reach `ContactService.importContacts` is that nothing outside this file even constructs a
    // `ContactService` in the first place.
    test('no remaining source file (other than contact.service.ts itself) imports the ContactService module', () => {
      const allSourceFiles = findFiles(SRC_DIR, (name) => name.endsWith('.ts') || name.endsWith('.tsx'));
      const offenders: string[] = [];
      for (const file of allSourceFiles) {
        if (file === CONTACT_SERVICE_FILE) continue;
        const src = readFileSync(file, 'utf8');
        if (/from\s+['"][^'"]*\/contact\.service['"]/.test(src) || /require\(\s*['"][^'"]*\/contact\.service['"]\s*\)/.test(src)) {
          offenders.push(path.relative(REPO_ROOT, file));
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('PipelineService', () => {
    let pipelineService: PipelineService;

    beforeEach(() => {
      pipelineService = new PipelineService(mockPrisma);
    });

    test('should progress pipeline stage', async () => {
      mockContactUpdate.mockResolvedValue({
        id: 'contact-1',
        name: 'Alice',
        pipeline_stage: PipelineStage.INTRODUCED,
      });

      const updated = await pipelineService.moveContact('contact-1', PipelineStage.INTRODUCED);
      expect(updated.pipeline_stage).toBe(PipelineStage.INTRODUCED);
    });

    // T-23 DECRYPT FIX teeth: contacts are stored as real AES-256-GCM ciphertext (T-22). Pre-fix
    // code pushed the raw row into the summary, so `summary.IDENTIFIED[0].first_name` would have
    // been the ciphertext envelope JSON, not "Alice" — this test fails against that code because it
    // asserts on the DECRYPTED `firstName` field the fixed service now returns.
    test('should return pipeline summary with DECRYPTED contact PII', async () => {
      mockContactFindMany.mockResolvedValue([
        encryptedContactRow({ id: 'c1', first_name: 'Alice', last_name: 'Doe', pipeline_stage: 'IDENTIFIED' }),
        encryptedContactRow({ id: 'c2', first_name: 'Bob', last_name: 'Roe', pipeline_stage: 'IDENTIFIED' }),
        encryptedContactRow({ id: 'c3', first_name: 'Charlie', last_name: 'Poe', pipeline_stage: 'RESPONDED' }),
      ]);

      const summary = await pipelineService.getPipelineSummary(userId);
      expect(summary.IDENTIFIED).toHaveLength(2);
      expect(summary.RESPONDED).toHaveLength(1);
      expect(summary.INTRODUCED).toHaveLength(0);
      expect(summary.IDENTIFIED.map((c) => c.firstName).sort()).toEqual(['Alice', 'Bob']);
      expect(summary.RESPONDED[0].firstName).toBe('Charlie');
      // Never the raw ciphertext envelope.
      expect(summary.IDENTIFIED[0].firstName).not.toContain('ciphertext');
    });

    // T-R10: the real `/api/contacts/pipeline` route (and the `/community` page it feeds) needs each
    // contact's ACTUAL persisted is_recruit_target/is_client state to seed its flag toggles — not an
    // assumed-false default. This fails if that passthrough ever regresses.
    test('should carry the real isRecruitTarget/isClient flags through (T-R10)', async () => {
      mockContactFindMany.mockResolvedValue([
        {
          ...encryptedContactRow({ id: 'c1', first_name: 'Flagged', last_name: 'Contact', pipeline_stage: 'IDENTIFIED' }),
          is_recruit_target: true,
          is_client: false,
        },
        {
          ...encryptedContactRow({ id: 'c2', first_name: 'Unflagged', last_name: 'Contact', pipeline_stage: 'IDENTIFIED' }),
          is_recruit_target: false,
          is_client: true,
        },
      ]);

      const summary = await pipelineService.getPipelineSummary(userId);
      const flagged = summary.IDENTIFIED.find((c) => c.id === 'c1');
      const unflagged = summary.IDENTIFIED.find((c) => c.id === 'c2');
      expect(flagged).toMatchObject({ isRecruitTarget: true, isClient: false });
      expect(unflagged).toMatchObject({ isRecruitTarget: false, isClient: true });
    });

    // T-R10 ownership teeth: `getPipelineSummary`'s ONLY filter is `where: { user_id: userId }` — a
    // rep must never see another rep's contacts in their Community home. This test fails if that
    // filter is ever dropped or widened (e.g. accidentally reintroducing a shared/demo fallback).
    test('is scoped to exactly the given user — never returns another rep\'s contacts (T-R10)', async () => {
      mockContactFindMany.mockImplementation(async ({ where }: { where: { user_id: string } }) => {
        if (where.user_id !== 'rep-a') return [];
        return [encryptedContactRow({ id: 'rep-a-contact', first_name: 'Owned', last_name: 'ByRepA', pipeline_stage: 'IDENTIFIED' })];
      });

      const summaryForRepA = await pipelineService.getPipelineSummary('rep-a');
      expect(summaryForRepA.IDENTIFIED.map((c) => c.id)).toEqual(['rep-a-contact']);

      const summaryForRepB = await pipelineService.getPipelineSummary('rep-b');
      expect(summaryForRepB.IDENTIFIED).toHaveLength(0);
      Object.values(summaryForRepB).forEach((stageContacts) => expect(stageContacts).toHaveLength(0));

      expect(mockContactFindMany).toHaveBeenCalledWith({ where: { user_id: 'rep-a' } });
      expect(mockContactFindMany).toHaveBeenCalledWith({ where: { user_id: 'rep-b' } });
    });
  });

  describe('PipelineService — agent queue (§7.5 contact pipeline to agents)', () => {
    let pipelineService: PipelineService;

    beforeEach(() => {
      pipelineService = new PipelineService(mockPrisma);
    });

    test('getAgentQueue excludes closed/dormant/opted-out/paused/minor contacts and orders by segment_score DESC', async () => {
      mockContactFindMany.mockResolvedValue([
        encryptedContactRow({ id: 'top', first_name: 'Top', last_name: 'Scorer', segment_score: 95 }),
      ]);

      const result = await pipelineService.getAgentQueue(userId, { status: 'ready', limit: 10 });

      expect(mockContactFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: userId,
            do_not_contact: false,
            agents_paused: false,
            is_minor_flag: false,
            pipeline_stage: expect.objectContaining({
              notIn: expect.arrayContaining([
                PipelineStage.CLOSED_CLIENT,
                PipelineStage.CLOSED_RECRUIT,
                PipelineStage.DORMANT,
                PipelineStage.DO_NOT_CONTACT,
              ]),
            }),
          }),
          orderBy: { segment_score: 'desc' },
          take: 10,
        })
      );
      // DECRYPTED PII on the agent-queue contract (never the raw ciphertext).
      expect(result[0].firstName).toBe('Top');
      expect(result[0].lastName).toBe('Scorer');
      expect(result[0].segmentScore).toBe(95);
    });

    test('getAgentQueue clamps an out-of-range limit to AGENT_QUEUE_MAX_LIMIT', async () => {
      mockContactFindMany.mockResolvedValue([]);
      await pipelineService.getAgentQueue(userId, { limit: 999999 });
      expect(mockContactFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
    });

    test('recordOutreach (§7.5 "after outreach it updates last_contact_date and pipeline_stage")', async () => {
      mockContactUpdate.mockResolvedValue({
        id: 'contact-1',
        pipeline_stage: PipelineStage.RESPONDED,
        last_contact_date: new Date('2026-07-17T00:00:00Z'),
      });

      const contactedAt = new Date('2026-07-17T00:00:00Z');
      await pipelineService.recordOutreach({ contactId: 'contact-1', toStage: PipelineStage.RESPONDED, contactedAt });

      expect(mockContactUpdate).toHaveBeenCalledWith({
        where: { id: 'contact-1' },
        data: { pipeline_stage: PipelineStage.RESPONDED, last_contact_date: contactedAt },
      });
    });
  });

  describe('MemoryJoggerService', () => {
    let memoryJogger: MemoryJoggerService;

    beforeEach(() => {
      memoryJogger = new MemoryJoggerService(mockPrisma);
    });

    // T-23 DECRYPT FIX teeth: `contact.first_name` is a real AES-256-GCM ciphertext envelope
    // (T-22), not the plaintext "Sarah" a pre-fix mock would have supplied directly. Pre-fix code
    // read `contact.first_name` raw, so this prompt text would have contained the ciphertext JSON
    // envelope instead of "Sarah" — this assertion fails against that code and only passes because
    // `generatePrompts` now runs every PII field through `decryptContactPII` first.
    test('should generate prompts with DECRYPTED contact PII (encrypt→store→decrypt round trip)', async () => {
      mockContactFindUnique.mockResolvedValue(
        encryptedContactRow({ id: 'contact-1', first_name: 'Sarah', last_name: 'Vega', industry: 'insurance' })
      );

      const prompts = await memoryJogger.generatePrompts('contact-1');
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain('Sarah');
      expect(prompts[0]).toContain('insurance');
      // Never the raw ciphertext envelope leaking into rep-facing prompt text.
      expect(prompts[0]).not.toContain('ciphertext');
      expect(prompts[0]).not.toContain('authTag');
    });

    test('should return null for contacts with no interactions', async () => {
      mockInteractionFindFirst.mockResolvedValue(null);
      const result = await memoryJogger.getLastInteraction('contact-1');
      expect(result).toBeNull();
    });

    test('should return empty prompts for non-existent contact', async () => {
      mockContactFindUnique.mockResolvedValue(null);
      const prompts = await memoryJogger.generatePrompts('non-existent');
      expect(prompts).toEqual([]);
    });

    // §7.4: "triggered when contact count is low (< 50) or on demand."
    test('shouldTrigger: low contact count OR on-demand', () => {
      expect(memoryJogger.shouldTrigger(10)).toBe(true);
      expect(memoryJogger.shouldTrigger(50)).toBe(false);
      expect(memoryJogger.shouldTrigger(500, true)).toBe(true);
    });

    // §7.4: "New names search the Vault and add if absent; a jogger that surfaces an existing
    // contact increments a counter and skips." Matching happens on DECRYPTED plaintext.
    test('captureNamedMemory: a brand-new name is added as a new (encrypted) Contact', async () => {
      mockContactFindMany.mockResolvedValue([]); // no existing contacts for this rep
      mockContactCreate.mockResolvedValue({ id: 'new-contact-1' });

      const result = await memoryJogger.captureNamedMemory(userId, 'Jordan Blake');

      expect(result).toEqual({ outcome: 'added', contactId: 'new-contact-1' });
      const createArgs = mockContactCreate.mock.calls[0][0];
      expect(createArgs.data.user_id).toBe(userId);
      // Written as ciphertext, never plaintext (§7.1/§16.4).
      expect(() => JSON.parse(createArgs.data.first_name)).not.toThrow();
      expect(decryptRequiredField(createArgs.data.first_name)).toBe('Jordan');
      expect(decryptRequiredField(createArgs.data.last_name)).toBe('Blake');
    });

    test('captureNamedMemory: a name matching an ALREADY-Vaulted contact increments memory_jogger_skip_count and skips (no duplicate)', async () => {
      mockContactFindMany.mockResolvedValue([
        encryptedContactRow({ id: 'existing-1', first_name: 'Jordan', last_name: 'Blake' }),
      ]);

      const result = await memoryJogger.captureNamedMemory(userId, 'jordan blake');

      expect(result).toEqual({ outcome: 'existing', contactId: 'existing-1' });
      expect(mockContactCreate).not.toHaveBeenCalled();
      expect(mockContactUpdate).toHaveBeenCalledWith({
        where: { id: 'existing-1' },
        data: { memory_jogger_skip_count: { increment: 1 } },
      });
    });

    // §4.4 "Haiku 4.5 selects which category prompt to show next" + §0.5 doctrine-vocab-clean
    // defensive re-check. Proves the defensive check actually runs against injected client output —
    // not merely against the static prompt bank, which is clean by construction.
    test('selectNextCategoryPrompt throws MemoryJoggerVocabViolationError on forbidden vocab in an injected client\'s output', async () => {
      const dirtyClient: MemoryJoggerCategoryClient = {
        selectNextCategory: async () => ({
          category: MemoryJoggerCategory.OLD_FRIENDS,
          promptText: 'Find a new prospect at your last cookout.',
        }),
      };
      const joggerWithDirtyClient = new MemoryJoggerService(mockPrisma, dirtyClient);

      await expect(joggerWithDirtyClient.selectNextCategoryPrompt([])).rejects.toThrow(
        MemoryJoggerVocabViolationError
      );
    });

    test('selectNextCategoryPrompt passes clean prompts through unchanged', async () => {
      const cleanClient: MemoryJoggerCategoryClient = {
        selectNextCategory: async () => ({
          category: MemoryJoggerCategory.GATHERINGS,
          promptText: 'Who was at your last cookout, party, or get-together?',
        }),
      };
      const joggerWithCleanClient = new MemoryJoggerService(mockPrisma, cleanClient);

      const result = await joggerWithCleanClient.selectNextCategoryPrompt([]);
      expect(result.category).toBe(MemoryJoggerCategory.GATHERINGS);
    });
  });

  describe('SegmentationService (§7.2 segmentation & scoring)', () => {
    function makeSegPrisma(
      contact: SegmentationContactRow | null,
      interactions: SegmentationInteractionRow[] = []
    ): SegmentationPrismaClient {
      return {
        contact: {
          findUnique: jest.fn().mockResolvedValue(contact),
          update: jest.fn().mockResolvedValue(undefined),
        },
        contactInteraction: {
          findMany: jest.fn().mockResolvedValue(interactions),
        },
      };
    }

    test('infers relationship type via the injected client, computes segment score, and writes both + is_a_list back', async () => {
      const notesCiphertext = encryptOptionalField('My brother — great guy, always up for a call.');
      const segPrisma = makeSegPrisma(
        { id: 'contact-1', notes: notesCiphertext, industry: null },
        [{ created_at: new Date() }, { created_at: new Date() }, { created_at: new Date() }]
      );
      const mockClient: SegmentationClient = {
        inferRelationshipType: jest.fn(async (req: SegmentationRequest): Promise<SegmentationResult> => {
          // The client must receive DECRYPTED notes, never the ciphertext envelope.
          expect(req.hints.notes).toBe('My brother — great guy, always up for a call.');
          return { relationshipType: RelationshipType.FAMILY, confidence: 0.9 };
        }),
      };

      const service = new SegmentationService(segPrisma, mockClient);
      const result = await service.segmentContact('contact-1');

      expect(mockClient.inferRelationshipType).toHaveBeenCalledTimes(1);
      expect(result?.relationshipType).toBe(RelationshipType.FAMILY);
      expect(result?.source).toBe('inferred');
      expect(result?.needsManualPrompt).toBe(false);
      expect(segPrisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'contact-1' },
        data: {
          relationship_type: RelationshipType.FAMILY,
          segment_score: result?.segmentScore,
          is_a_list: result?.isAList,
        },
      });
    });

    // §7.2: "no data → 'other' with a manual prompt." Must NOT spend a Haiku call when there is
    // nothing to infer from (§4.4 cost discipline).
    test('no hints at all → OTHER + needsManualPrompt, and the client is never called', async () => {
      const segPrisma = makeSegPrisma({ id: 'contact-2', notes: null, industry: null }, []);
      const mockClient: SegmentationClient = { inferRelationshipType: jest.fn() };

      const service = new SegmentationService(segPrisma, mockClient);
      const result = await service.segmentContact('contact-2');

      expect(mockClient.inferRelationshipType).not.toHaveBeenCalled();
      expect(result?.relationshipType).toBe(RelationshipType.OTHER);
      expect(result?.needsManualPrompt).toBe(true);
      expect(result?.source).toBe('no_data_default');
    });

    test('returns null for a contact that no longer exists (never throws)', async () => {
      const segPrisma = makeSegPrisma(null);
      const service = new SegmentationService(segPrisma, { inferRelationshipType: jest.fn() });
      const result = await service.segmentContact('gone');
      expect(result).toBeNull();
    });

    // Claude-only (§0.3): missing credential → fail CLOSED, no network attempt, no non-Claude
    // fallback. Mirrors the exact pattern in tests/unit/cfe-fail-closed.test.ts test (c).
    test('HaikuSegmentationClient: missing ANTHROPIC_API_KEY fails CLOSED with no network attempt', async () => {
      const prevKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const fetchSpy = jest.fn(async () => {
        throw new Error('network must NOT be called when the key is missing');
      });

      try {
        const client = new HaikuSegmentationClient({ fetchImpl: fetchSpy });
        await expect(
          client.inferRelationshipType({
            contactId: 'contact-1',
            hints: { notes: 'some notes', industry: null, groupMembership: null },
          })
        ).rejects.toThrow(MissingClaudeCredentialError);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = prevKey;
      }
    });

    // Regression (T-R2 lint-refactor QC reject): a degenerate JSON response body — the literal
    // `"null"` — must still throw SegmentationError('Haiku segmentation verdict missing a valid
    // relationship_type.'), the same domain error the pre-refactor `payload?.relationship_type`
    // optional chaining produced. A lint pass that dropped the `?.` in favor of bare
    // `payload.relationship_type` would instead throw a raw `TypeError: Cannot read properties of
    // null` here — this must never regress.
    test('HaikuSegmentationClient: a degenerate ("null") Haiku JSON body throws SegmentationError, never a raw TypeError', async () => {
      const prevKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
      const fakeFetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ content: [{ type: 'text', text: 'null' }] }),
      }));
      try {
        const client = new HaikuSegmentationClient({ fetchImpl: fakeFetch });
        await expect(
          client.inferRelationshipType({
            contactId: 'contact-1',
            hints: { notes: 'some notes', industry: null, groupMembership: null },
          })
        ).rejects.toThrow(SegmentationError);
        await expect(
          client.inferRelationshipType({
            contactId: 'contact-1',
            hints: { notes: 'some notes', industry: null, groupMembership: null },
          })
        ).rejects.toThrow('Haiku segmentation verdict missing a valid relationship_type.');
      } finally {
        if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = prevKey;
      }
    });
  });

  describe('HaikuMemoryJoggerCategoryClient (§7.4 real Haiku call path, driven with a fake transport)', () => {
    // Regression (T-R2 lint-refactor QC reject): a degenerate JSON response body — the literal
    // `"null"` — must still throw MemoryJoggerCategoryError('Haiku Memory Jogger verdict missing a
    // valid category.'), the same domain error the pre-refactor `payload?.category` optional
    // chaining produced. A lint pass that dropped the `?.` in favor of bare `payload.category`
    // would instead throw a raw `TypeError: Cannot read properties of null` here — this must never
    // regress.
    test('a degenerate ("null") Haiku JSON body throws MemoryJoggerCategoryError, never a raw TypeError', async () => {
      const prevKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
      const fakeFetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ content: [{ type: 'text', text: 'null' }] }),
      }));
      try {
        const client = new HaikuMemoryJoggerCategoryClient({ fetchImpl: fakeFetch });
        await expect(
          client.selectNextCategory({ recentCategories: [] })
        ).rejects.toThrow(MemoryJoggerCategoryError);
        await expect(
          client.selectNextCategory({ recentCategories: [] })
        ).rejects.toThrow('Haiku Memory Jogger verdict missing a valid category.');
      } finally {
        if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = prevKey;
      }
    });
  });
});
