import * as fs from 'fs';
import * as path from 'path';
import { Role } from '@prisma/client';
import {
  AuditService,
  InMemoryAuditRepository,
  PrismaAuditRepository,
  verifyChain,
  deepFreeze,
  computeCheckpointHash,
  verifyAnchoring,
  InMemoryAuditCheckpointRepository,
  PrismaAuditCheckpointRepository,
  type AuditEntryRecord,
  type AuditEntryPrismaDelegate,
  type AuditCheckpoint,
  type AuditCheckpointPrismaDelegate,
  type RecordAuditEventInput,
  type ChainedEntry,
} from '@/services/compliance/audit';

/**
 * T-R4 (WP11 audit hardening — remediation unit): proves the three additive hardening layers on
 * top of T-10's existing append-only + hash-chained audit store, without touching (and without
 * regressing) any existing writer/reader:
 *   (a) DB-level immutability — the migration's trigger actually exists and blocks UPDATE/DELETE
 *       while allowing INSERT (statically verified here from the migration SQL itself; the same
 *       trigger was additionally hand-verified against a real throwaway local Postgres 16 instance
 *       as part of this build — INSERT succeeded, UPDATE and DELETE were both rejected with the
 *       trigger's RAISE EXCEPTION, on both AuditEntry and AuditCheckpoint — see the T-R4 build
 *       report; that step isn't repeated here since this suite runs key-less/DB-less like the rest
 *       of CI) — plus the pre-existing, now also Prisma-side-verified, app-level guard (no
 *       update/delete method anywhere in the TS surface).
 *   (b) hash-chain verify detects a tampered past entry (already proven in audit-store.test.ts;
 *       re-asserted here via the public `verifyChain` export for completeness of this suite).
 *   (c) anchoring verify detects tail-truncation via the new AuditCheckpoint mechanism.
 *   (d) returned audit rows (both repositories) are DEEPLY frozen, not just top-level.
 *   (e) no regression: existing writers/readers are exercised via the *same* `AuditService`
 *       surface this suite uses, so a break here would also break `audit-store.test.ts`,
 *       `licensing.test.ts`, `incident-service.test.ts`, and the messaging send-support path
 *       (proven independently by their own suites, which still import the same `audit-service.ts`
 *       unmodified in its non-additive parts).
 */

/** `classifier_data` is an opaque `Record<string, unknown>` JSON blob at the type level (its shape
 *  is genuinely caller-defined) — this narrows it to the specific test-fixture shape the freeze
 *  proofs below actually poke at, rather than reading through `any` at each access. */
interface TestClassifierData {
  nested?: { deeper: string[] };
  scores?: { INCOME_CLAIM: number };
  results?: Array<{ tag: string }>;
  [key: string]: unknown;
}

function baseCfeInput(overrides: Partial<RecordAuditEventInput> = {}): RecordAuditEventInput {
  return {
    domain: 'cfe',
    user_id: 'rep-1',
    role: Role.REP,
    content_id: 'content-1',
    content_text: 'Join my Primerica team and change your life!',
    channel: 'SMS',
    risk_score: 5,
    outcome: 'PASS',
    event_data: { classifier_scores: { INCOME_CLAIM: 0.1 }, nested: { deeper: ['a', 'b'] } },
    regulation: 'FINRA',
    rule_version: '1.0.0',
    ...overrides,
  };
}

// ── (a) DB-level immutability — migration SQL + app-level surface ──────────────────────────────

describe('T-R4 (a): DB-level immutability trigger + app-level guard', () => {
  const migrationPath = path.join(
    __dirname,
    '../../prisma/migrations/20260720140000_t_r4_audit_hardening/migration.sql'
  );

  it('the migration defines a trigger function that RAISEs (blocks) on UPDATE/DELETE for AuditEntry, and leaves INSERT untouched', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // The shared trigger function raises an exception — an aborting error, not a silent no-op.
    expect(sql).toMatch(/CREATE (OR REPLACE )?FUNCTION prevent_audit_mutation\(\)/);
    expect(sql).toMatch(/RAISE EXCEPTION/);

    // AuditEntry gets BOTH an UPDATE-blocking and a DELETE-blocking trigger.
    expect(sql).toMatch(/CREATE TRIGGER audit_entry_block_update\s+BEFORE UPDATE ON "AuditEntry"/);
    expect(sql).toMatch(/CREATE TRIGGER audit_entry_block_delete\s+BEFORE DELETE ON "AuditEntry"/);

    // No trigger blocks INSERT — append is always allowed.
    expect(sql).not.toMatch(/BEFORE INSERT ON "AuditEntry"/);

    // The new AuditCheckpoint anchoring table gets the identical immutability posture — a
    // checkpoint that could itself be edited/removed would defeat tail-truncation detection.
    expect(sql).toMatch(/CREATE TRIGGER audit_checkpoint_block_update\s+BEFORE UPDATE ON "AuditCheckpoint"/);
    expect(sql).toMatch(/CREATE TRIGGER audit_checkpoint_block_delete\s+BEFORE DELETE ON "AuditCheckpoint"/);
  });

  it('AuditRepository (in-memory AND Prisma-backed) exposes no update/delete/remove method', () => {
    const inMemoryRepo = new InMemoryAuditRepository();
    const mockDelegate: AuditEntryPrismaDelegate = {
      create: async () => ({}),
      findMany: async () => [],
      findUnique: async () => null,
      findFirst: async () => null,
    };
    const prismaRepo = new PrismaAuditRepository({ auditEntry: mockDelegate });

    for (const repo of [inMemoryRepo, prismaRepo] as unknown as Record<string, unknown>[]) {
      expect(repo.update).toBeUndefined();
      expect(repo.delete).toBeUndefined();
      expect(repo.remove).toBeUndefined();
    }

    // Prototype-level check too (not just "this instance doesn't have an own property") — proves
    // the method genuinely does not exist on the class, not merely unset on one instance.
    expect(Object.getOwnPropertyNames(PrismaAuditRepository.prototype)).not.toContain('update');
    expect(Object.getOwnPropertyNames(PrismaAuditRepository.prototype)).not.toContain('delete');
    expect(Object.getOwnPropertyNames(InMemoryAuditRepository.prototype)).not.toContain('update');
    expect(Object.getOwnPropertyNames(InMemoryAuditRepository.prototype)).not.toContain('delete');
  });

  it('AuditCheckpointRepository (in-memory AND Prisma-backed) exposes no update/delete/remove method', () => {
    const inMemoryRepo = new InMemoryAuditCheckpointRepository();
    const mockDelegate: AuditCheckpointPrismaDelegate = {
      create: async () => ({}),
      findFirst: async () => null,
    };
    const prismaRepo = new PrismaAuditCheckpointRepository({ auditCheckpoint: mockDelegate });

    for (const repo of [inMemoryRepo, prismaRepo] as unknown as Record<string, unknown>[]) {
      expect(repo.update).toBeUndefined();
      expect(repo.delete).toBeUndefined();
      expect(repo.remove).toBeUndefined();
    }
  });
});

// ── (b) hash-chain tamper detection (re-asserted for this suite's own completeness) ────────────

describe('T-R4 (b): hash-chain verify still detects a tampered past entry', () => {
  it('flags a mutated row via the public verifyChain export', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);
    await store.recordAuditEvent(baseCfeInput({ content_text: 'first' }));
    await store.recordAuditEvent(baseCfeInput({ content_text: 'second' }));

    const rows = await store.query({});
    const tampered = rows.map((r) => ({ ...r }));
    tampered[0].content_text = 'TAMPERED';

    const result = verifyChain(tampered as unknown as ChainedEntry[]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/entry_hash mismatch/);

    const combined = await store.verifyIntegrity();
    expect(combined.chain.valid).toBe(true); // the REAL stored chain is untouched
    expect(combined.valid).toBe(true);
  });
});

// ── (c) anchoring — tail-truncation detection ───────────────────────────────────────────────────

describe('T-R4 (c): anchoring checkpoint detects tail-truncation', () => {
  it('createCheckpoint anchors the current head; verifyAnchoring is valid against an untouched store', async () => {
    const repo = new InMemoryAuditRepository();
    const checkpointRepo = new InMemoryAuditCheckpointRepository();
    const store = new AuditService(repo, checkpointRepo);

    expect(await store.createCheckpoint()).toBeNull(); // empty store — nothing to anchor yet

    await store.recordAuditEvent(baseCfeInput({ content_text: 'A' }));
    await store.recordAuditEvent(baseCfeInput({ content_text: 'B' }));
    await store.recordAuditEvent(baseCfeInput({ content_text: 'C' }));

    const checkpoint = await store.createCheckpoint();
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.sequence).toBe(3);
    expect(checkpoint!.entry_count).toBe(3);
    expect(checkpoint!.checkpoint_hash).toMatch(/^[0-9a-f]{64}$/);

    const result = await store.verifyAnchoring();
    expect(result.valid).toBe(true);
    expect(result.checkpoint?.id).toBe(checkpoint!.id);
  });

  it('verifyAnchoring is valid (vacuously) when no checkpoint has ever been taken', async () => {
    const repo = new InMemoryAuditRepository();
    const checkpointRepo = new InMemoryAuditCheckpointRepository();
    const store = new AuditService(repo, checkpointRepo);
    await store.recordAuditEvent(baseCfeInput());

    const result = await store.verifyAnchoring();
    expect(result.valid).toBe(true);
    expect(result.checkpoint).toBeNull();
  });

  it('DETECTS tail-truncation: dropping the last N entries after a checkpoint was taken fails verifyAnchoring', async () => {
    const fullRepo = new InMemoryAuditRepository();
    const checkpointRepo = new InMemoryAuditCheckpointRepository();
    const fullStore = new AuditService(fullRepo, checkpointRepo);

    // Seed 5 entries and anchor a checkpoint at the full head (sequence 5).
    await fullStore.recordAuditEvent(baseCfeInput({ content_text: '1' }));
    await fullStore.recordAuditEvent(baseCfeInput({ content_text: '2' }));
    await fullStore.recordAuditEvent(baseCfeInput({ content_text: '3' }));
    await fullStore.recordAuditEvent(baseCfeInput({ content_text: '4' }));
    await fullStore.recordAuditEvent(baseCfeInput({ content_text: '5' }));
    const checkpoint = await fullStore.createCheckpoint();
    expect(checkpoint!.sequence).toBe(5);
    expect(checkpoint!.entry_count).toBe(5);

    const allRows = await fullStore.query({});
    expect(allRows).toHaveLength(5);

    // Simulate an attacker (or a restore-from-stale-backup) truncating the TAIL: only the first 3
    // rows survive — rows 4 and 5 are gone, with nothing appended after them, so the hash-chain
    // links among the surviving 3 rows are perfectly intact (this is exactly the scenario
    // `verifyChain` alone cannot catch — see hash-chain.ts's documented limitation).
    const truncatedRepo = new InMemoryAuditRepository();
    for (const row of allRows.slice(0, 3)) {
      await truncatedRepo.append({ ...row } as AuditEntryRecord);
    }
    // Confirm the premise: the truncated chain's OWN hash-chain re-verification reports valid —
    // proving this truncation is invisible to verifyChain alone.
    const truncatedStore = new AuditService(truncatedRepo, checkpointRepo);
    expect((await truncatedStore.verifyStoredChain()).valid).toBe(true);

    // But anchoring against the checkpoint taken from the FULL (pre-truncation) store catches it.
    const anchoringResult = await truncatedStore.verifyAnchoring();
    expect(anchoringResult.valid).toBe(false);
    expect(anchoringResult.reason).toMatch(/tail truncation/);

    // The combined proof surface reflects the same verdict.
    const combined = await truncatedStore.verifyIntegrity();
    expect(combined.valid).toBe(false);
    expect(combined.chain.valid).toBe(true); // chain itself still looks fine in isolation
    expect(combined.anchoring.valid).toBe(false); // anchoring is what catches it
  });

  it('the standalone verifyAnchoring function flags a corrupted checkpoint record (its own checkpoint_hash no longer recomputes)', () => {
    const goodFields = { sequence: 3, head_entry_hash: 'a'.repeat(64), entry_count: 3, created_at: new Date().toISOString() };
    const goodCheckpoint: AuditCheckpoint = { id: 'chk-1', ...goodFields, checkpoint_hash: computeCheckpointHash(goodFields) };

    // Corrupt the checkpoint's own recorded entry_count without recomputing its hash — simulating
    // direct tampering of the checkpoint row itself (which the DB trigger separately blocks, but
    // this proves the application-level detection is real too, independent of the DB layer).
    const corrupted: AuditCheckpoint = { ...goodCheckpoint, entry_count: 999 };

    const result = verifyAnchoring(
      { currentEntries: [{ sequence: 3, entry_hash: 'a'.repeat(64) }], currentTail: { sequence: 3, entry_hash: 'a'.repeat(64) } },
      corrupted
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/checkpoint .* is corrupted/);
  });

  it('createCheckpoint/verifyAnchoring throw a clear error when no checkpoint repository was configured', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo); // no checkpoint repository passed
    await store.recordAuditEvent(baseCfeInput());

    await expect(store.createCheckpoint()).rejects.toThrow(/no AuditCheckpointRepository was configured/);
    await expect(store.verifyAnchoring()).rejects.toThrow(/no AuditCheckpointRepository was configured/);

    // verifyIntegrity degrades gracefully instead (anchoring reported vacuously valid) — it must
    // remain usable even for the many existing call sites that never wire a checkpoint repository.
    const combined = await store.verifyIntegrity();
    expect(combined.valid).toBe(true);
    expect(combined.anchoring.checkpoint).toBeNull();
  });
});

// ── (d) deeply frozen returned rows — both repositories ─────────────────────────────────────────

describe('T-R4 (d): returned audit rows are deeply frozen (in-memory AND Prisma-backed)', () => {
  it('InMemoryAuditRepository: nested classifier_data is frozen, not just the top-level row', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);
    const id = await store.recordAuditEvent(baseCfeInput());
    const entry = await store.getById(id);

    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry!.classifier_data)).toBe(true);
    const classifierData = entry!.classifier_data as TestClassifierData;
    const nested = classifierData.nested!;
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.deeper)).toBe(true);

    expect(() => {
      nested.deeper.push('c');
    }).toThrow();
    expect(() => {
      classifierData.newKey = 'x';
    }).toThrow();
  });

  it('PrismaAuditRepository: rows from query()/getById() are deeply frozen', async () => {
    const rawRow = {
      id: 'row-1',
      sequence: 1,
      user_id: 'rep-1',
      content_hash: 'hash1',
      risk_score: 10,
      outcome: 'PASS',
      classifier_data: { scores: { INCOME_CLAIM: 0.4 }, results: [{ tag: 'x' }] },
      role: Role.REP,
      created_at: new Date('2026-07-20T00:00:00.000Z'),
      prev_hash: null,
      entry_hash: 'b'.repeat(64),
      content_id: 'c-1',
      content_text: 'hello',
      channel: null,
      rule_version: '1.0.0',
      regulation: 'NONE',
      reviewer_id: null,
      reviewer_action: null,
    };
    const mockDelegate: AuditEntryPrismaDelegate = {
      create: async () => ({}),
      findMany: async () => [rawRow],
      findUnique: async () => rawRow,
      findFirst: async () => rawRow,
    };
    const repo = new PrismaAuditRepository({ auditEntry: mockDelegate });

    const byId = await repo.getById('row-1');
    expect(Object.isFrozen(byId)).toBe(true);
    expect(Object.isFrozen(byId!.classifier_data)).toBe(true);
    const classifierData = byId!.classifier_data as TestClassifierData;
    expect(Object.isFrozen(classifierData.results)).toBe(true);
    expect(Object.isFrozen(classifierData.results![0])).toBe(true);
    expect(() => {
      (byId as unknown as Record<string, unknown>).risk_score = 0;
    }).toThrow();
    expect(() => {
      classifierData.scores!.INCOME_CLAIM = 0;
    }).toThrow();

    const queried = await repo.query({});
    expect(queried).toHaveLength(1);
    expect(Object.isFrozen(queried[0])).toBe(true);
    expect(Object.isFrozen(queried[0].classifier_data)).toBe(true);
  });

  it('deepFreeze is idempotent and safe on already-frozen/primitive values', () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze(null)).toBeNull();
    const obj = deepFreeze({ a: Object.freeze({ b: 1 }) });
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.a)).toBe(true);
  });
});
