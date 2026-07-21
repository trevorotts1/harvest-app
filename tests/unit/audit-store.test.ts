import { Role } from '@prisma/client';
import {
  AuditService,
  InMemoryAuditRepository,
  ActivityLedgerService,
  ActivityLedgerAccessDeniedError,
  DurableCFEAuditSink,
  DurableLicensingEventSink,
  DurableDataRightsAuditSink,
  createDurableAuditSinks,
  verifyChain,
  deriveRegulationTag,
  type AuditEntryRecord,
  type DownlineScopeResolver,
  type RecordAuditEventInput,
  type ChainedEntry,
} from '@/services/compliance/audit';
import type { CFEAuditEvent } from '@/types/compliance';
import type { LicensingAuditEvent } from '@/types/licensing';
import type { DataRightsAuditEvent } from '@/services/compliance/data-rights/audit-emit';

/** Flushes pending microtasks — used after a synchronous `emit()` on a Durable*Sink that
 *  fire-and-forgets its persistence promise. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
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
    event_data: { classifier_scores: { INCOME_CLAIM: 0.1 } },
    regulation: 'FINRA',
    rule_version: '1.0.0',
    ...overrides,
  };
}

describe('AuditService.recordAuditEvent — append + hash-chain ordering (proof a)', () => {
  it('appends entries with contiguous sequence numbers and a correctly linked hash chain', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);

    const id1 = await store.recordAuditEvent(baseCfeInput({ content_text: 'first' }));
    const id2 = await store.recordAuditEvent(baseCfeInput({ content_text: 'second' }));
    const id3 = await store.recordAuditEvent(baseCfeInput({ content_text: 'third' }));

    const rows = await store.query({});
    expect(rows.map((r) => r.id)).toEqual([id1, id2, id3]);
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3]);

    // genesis
    expect(rows[0].prev_hash).toBeNull();
    // each row's prev_hash chains to the previous row's entry_hash
    expect(rows[1].prev_hash).toBe(rows[0].entry_hash);
    expect(rows[2].prev_hash).toBe(rows[1].entry_hash);

    // every entry_hash is a 64-char hex SHA-256 digest and unique per row
    for (const row of rows) {
      expect(row.entry_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(rows.map((r) => r.entry_hash)).size).toBe(3);

    const verification = await store.verifyStoredChain();
    expect(verification.valid).toBe(true);
  });

  it('getChainHead reflects the most recent append', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);
    expect(await store.getChainHead()).toBeNull();

    await store.recordAuditEvent(baseCfeInput());
    const head1 = await store.getChainHead();
    expect(head1?.sequence).toBe(1);

    await store.recordAuditEvent(baseCfeInput());
    const head2 = await store.getChainHead();
    expect(head2?.sequence).toBe(2);
    expect(head2?.entry_hash).not.toBe(head1?.entry_hash);
  });
});

describe('hash chain tamper evidence — mutation and deletion detection (proof b)', () => {
  it('detects a mutated entry (content changed after being written)', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);

    await store.recordAuditEvent(baseCfeInput({ content_text: 'A' }));
    await store.recordAuditEvent(baseCfeInput({ content_text: 'B' }));
    await store.recordAuditEvent(baseCfeInput({ content_text: 'C' }));

    const rows = await store.query({});
    expect((await store.verifyStoredChain()).valid).toBe(true);

    // Simulate an attacker mutating a row's content directly in storage (bypassing the
    // application's append-only API entirely — the only way to "edit" a row, since no update
    // API exists). We clone (Object.freeze prevents in-place mutation of the real returned
    // objects) so this exercises verifyChain's detection logic against tampered content.
    const tampered = rows.map((r) => ({ ...r }));
    tampered[1].content_text = 'TAMPERED — this was never the original content';
    tampered[1].risk_score = 999;

    const result = verifyChain(tampered as unknown as ChainedEntry[]);
    expect(result.valid).toBe(false);
    expect(result.brokenEntryId).toBe(rows[1].id);
    expect(result.reason).toMatch(/entry_hash mismatch/);
  });

  it('detects a deleted entry (a middle row removed from the chain)', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);

    await store.recordAuditEvent(baseCfeInput({ content_text: 'A' }));
    await store.recordAuditEvent(baseCfeInput({ content_text: 'B' }));
    await store.recordAuditEvent(baseCfeInput({ content_text: 'C' }));

    const rows = await store.query({});
    expect((await store.verifyStoredChain()).valid).toBe(true);

    // Simulate a deleted row: remove the middle entry (row B) from the set handed to
    // verifyChain — analogous to a row vanishing from the underlying table.
    const withDeletion = [rows[0], rows[2]];
    const result = verifyChain(withDeletion as unknown as ChainedEntry[]);

    expect(result.valid).toBe(false);
    // Detected either via the sequence gap (1 -> 3, skipping 2) or the broken prev_hash link —
    // both are checked; either is an acceptable, correct detection.
    expect(result.reason).toMatch(/sequence gap|prev_hash mismatch/);
    expect(result.brokenEntryId).toBe(rows[2].id);
  });

  it('a chain with no tampering verifies valid, and an untouched single-entry chain is valid', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);
    await store.recordAuditEvent(baseCfeInput());
    expect((await store.verifyStoredChain()).valid).toBe(true);
  });
});

describe('append-only enforcement — no update/delete API exists (proof c)', () => {
  it('AuditRepository and AuditService expose no update or delete method', () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);

    expect((repo as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((repo as unknown as Record<string, unknown>).remove).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).remove).toBeUndefined();
  });

  it('append() throws rather than overwrites when an id is reused', async () => {
    const repo = new InMemoryAuditRepository();
    const entry: AuditEntryRecord = {
      id: 'fixed-id-1',
      sequence: 1,
      user_id: 'rep-1',
      content_hash: 'hash1',
      risk_score: 0,
      outcome: 'PASS',
      classifier_data: {},
      role: Role.REP,
      created_at: new Date().toISOString(),
      prev_hash: null,
      entry_hash: 'a'.repeat(64),
    };
    await repo.append(entry);
    await expect(repo.append({ ...entry, content_hash: 'hash2' })).rejects.toThrow(
      /already exists|append-only/i
    );
  });

  it('a fetched entry is frozen — attempting to mutate it throws', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);
    const id = await store.recordAuditEvent(baseCfeInput());
    const entry = await store.getById(id);
    expect(entry).not.toBeNull();
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (entry as unknown as Record<string, unknown>).risk_score = 999;
    }).toThrow();
    // Confirm the throw actually prevented the mutation (didn't silently no-op then throw for an
    // unrelated reason) by re-fetching and checking it's unchanged.
    const refetched = await store.getById(id);
    expect(refetched?.risk_score).toBe(entry!.risk_score);
  });
});

describe('Activity Ledger — RBAC-scoped read (proof d)', () => {
  async function seedStore() {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);
    await store.recordAuditEvent(baseCfeInput({ user_id: 'rep-A', content_text: 'rep A draft 1' }));
    await store.recordAuditEvent(baseCfeInput({ user_id: 'rep-A', content_text: 'rep A draft 2' }));
    await store.recordAuditEvent(baseCfeInput({ user_id: 'rep-B', content_text: 'rep B draft 1' }));
    return { repo, store };
  }

  it('a rep sees their own Activity Ledger', async () => {
    const { repo } = await seedStore();
    const ledger = new ActivityLedgerService(repo);
    const rows = await ledger.listActivity({ id: 'rep-A', role: Role.REP });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.user_id === 'rep-A')).toBe(true);
  });

  it('a rep CANNOT read another rep\'s Activity Ledger', async () => {
    const { repo } = await seedStore();
    const ledger = new ActivityLedgerService(repo);
    await expect(
      ledger.listActivity({ id: 'rep-A', role: Role.REP }, { targetUserId: 'rep-B' })
    ).rejects.toThrow(ActivityLedgerAccessDeniedError);
  });

  it('an upline is denied cross-rep access by default (fail-closed with no scope resolver wired)', async () => {
    const { repo } = await seedStore();
    const ledger = new ActivityLedgerService(repo); // default OWN_ONLY_SCOPE_RESOLVER
    await expect(
      ledger.listActivity({ id: 'upline-1', role: Role.UPLINE }, { targetUserId: 'rep-B' })
    ).rejects.toThrow(ActivityLedgerAccessDeniedError);
  });

  it('an upline CAN read a team member\'s ledger once a real scope resolver grants it (§16.6 "team")', async () => {
    const { repo } = await seedStore();
    const teamResolver: DownlineScopeResolver = {
      async resolveVisibleUserIds() {
        return ['rep-B'];
      },
    };
    const ledger = new ActivityLedgerService(repo, teamResolver);
    const rows = await ledger.listActivity({ id: 'upline-1', role: Role.UPLINE }, { targetUserId: 'rep-B' });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('rep-B');
  });

  it('an upline still cannot read a rep NOT in their resolved team scope', async () => {
    const { repo } = await seedStore();
    const teamResolver: DownlineScopeResolver = {
      async resolveVisibleUserIds() {
        return ['someone-else'];
      },
    };
    const ledger = new ActivityLedgerService(repo, teamResolver);
    await expect(
      ledger.listActivity({ id: 'upline-1', role: Role.UPLINE }, { targetUserId: 'rep-B' })
    ).rejects.toThrow(ActivityLedgerAccessDeniedError);
  });

  it('an rvp reads org-wide via a resolver returning ALL', async () => {
    const { repo } = await seedStore();
    const orgWideResolver: DownlineScopeResolver = {
      async resolveVisibleUserIds() {
        return 'ALL';
      },
    };
    const ledger = new ActivityLedgerService(repo, orgWideResolver);
    const rows = await ledger.listActivity({ id: 'rvp-1', role: Role.RVP }, { targetUserId: 'rep-B' });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('rep-B');
  });

  it('admin has full access with no resolver needed (§16.6 row 4 "admin: full")', async () => {
    const { repo } = await seedStore();
    const ledger = new ActivityLedgerService(repo); // no resolver wired at all
    const rowsA = await ledger.listActivity({ id: 'admin-1', role: Role.ADMIN }, { targetUserId: 'rep-A' });
    const rowsB = await ledger.listActivity({ id: 'admin-1', role: Role.ADMIN }, { targetUserId: 'rep-B' });
    expect(rowsA).toHaveLength(2);
    expect(rowsB).toHaveLength(1);
  });

  it('listVisibleActivity gives an elevated role their own entries even with no team wired (never a hard error)', async () => {
    const { repo } = await seedStore();
    const ledger = new ActivityLedgerService(repo);
    await repo.append({
      id: 'upline-own-entry',
      sequence: (await repo.getChainTail())!.sequence + 1,
      user_id: 'upline-1',
      content_hash: 'h',
      risk_score: 0,
      outcome: 'RECORDED',
      classifier_data: {},
      role: Role.UPLINE,
      created_at: new Date().toISOString(),
      prev_hash: (await repo.getChainTail())!.entry_hash,
      entry_hash: 'b'.repeat(64),
    });
    const rows = await ledger.listVisibleActivity({ id: 'upline-1', role: Role.UPLINE });
    expect(rows.some((r) => r.id === 'upline-own-entry')).toBe(true);
  });
});

describe('FINRA-tagged entries are retained and structurally unremovable (proof e)', () => {
  it('a FINRA-regulated entry persists across further activity and cannot be removed via any API', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);

    const finraId = await store.recordAuditEvent(
      baseCfeInput({ user_id: 'rep-finra', content_text: 'insurance recommendation copy', regulation: 'FINRA' })
    );
    // more activity happens after the FINRA row is written
    await store.recordAuditEvent(baseCfeInput({ user_id: 'rep-finra', content_text: 'unrelated later draft' }));
    await store.recordAuditEvent(baseCfeInput({ user_id: 'other-rep', content_text: 'someone else entirely' }));

    const finraRows = await store.query({ user_id: 'rep-finra' });
    const finraRow = finraRows.find((r) => r.id === finraId);
    expect(finraRow).toBeDefined();
    expect(finraRow!.regulation).toBe('FINRA');

    // No API exists to remove it — re-affirms proof (c) specifically in the FINRA context.
    expect((repo as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((store as unknown as Record<string, unknown>).delete).toBeUndefined();

    // Still present, byte-for-byte, after further activity and a full chain re-verification.
    const stillThere = await store.getById(finraId);
    expect(stillThere?.content_text).toBe('insurance recommendation copy');
    expect((await store.verifyStoredChain()).valid).toBe(true);
  });

  it('deriveRegulationTag always prefers FINRA when present, regardless of what else applies', () => {
    expect(deriveRegulationTag(['STATE_INSURANCE', 'FINRA'])).toBe('FINRA');
    expect(deriveRegulationTag(['FINRA'])).toBe('FINRA');
    expect(deriveRegulationTag(['TCPA', 'CAN_SPAM'])).toBe('TCPA,CAN_SPAM');
    expect(deriveRegulationTag([])).toBe('NONE');
    expect(deriveRegulationTag(undefined)).toBe('NONE');
  });
});

describe('Durable*Sink adapters — CFE/licensing/data-rights funnel into the unified store', () => {
  it('DurableCFEAuditSink persists a CFEAuditEvent, preserving the FINRA tag over other regulations', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);
    const sink = new DurableCFEAuditSink(store);

    const event: CFEAuditEvent = {
      content_id: 'c-1',
      content_text: 'Hidden Earnings example copy',
      content_hash: 'h1',
      channel: 'SMS',
      user_id: 'rep-1',
      role: Role.REP,
      band: 'review',
      outcome: 'FLAG',
      risk_score: 45,
      held: false,
      held_reason: null,
      classifier_results: [],
      classifiers_triggered: ['INCOME_CLAIM'],
      safe_harbor_injected: true,
      safe_harbor_disclaimers: ['Individual results vary.'],
      regulation: ['STATE_INSURANCE', 'FINRA'],
      rule_version: '1.0.0',
      timestamp: new Date().toISOString(),
    };

    sink.emit(event);
    await flush();

    const rows = await store.query({ user_id: 'rep-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('FLAG');
    expect(rows[0].regulation).toBe('FINRA');
    expect(rows[0].content_hash).toBe('h1');
  });

  it('DurableLicensingEventSink persists a LicensingAuditEvent as a RECORDED, STATE_INSURANCE row', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);
    const sink = new DurableLicensingEventSink(store);

    const event: LicensingAuditEvent = {
      id: 'lic-1',
      user_id: 'rep-2',
      jurisdiction: 'CA',
      from_state: 'PRE_LICENSING',
      to_state: 'LICENSED',
      action: 'OBTAIN_LICENSE',
      actor_id: 'rep-2',
      actor_role: 'REP',
      reason: 'passed state exam',
      occurred_at: new Date().toISOString(),
    };

    await sink.record(event);

    const rows = await store.query({ user_id: 'rep-2' });
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('RECORDED');
    expect(rows[0].regulation).toBe('STATE_INSURANCE');
    expect(rows[0].content_text).toMatch(/PRE_LICENSING -> LICENSED/);
  });

  it('DurableDataRightsAuditSink persists a DataRightsAuditEvent as a RECORDED, GDPR row', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);
    const sink = new DurableDataRightsAuditSink(store);

    const event: DataRightsAuditEvent = {
      type: 'deletion.completed',
      user_id: 'rep-3',
      actor_id: 'rep-3',
      timestamp: new Date().toISOString(),
      detail: { retained_fields: ['AuditEntry:abc-123'] },
    };

    await sink.record(event);

    const rows = await store.query({ user_id: 'rep-3' });
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('RECORDED');
    expect(rows[0].regulation).toBe('GDPR');
  });

  it('createDurableAuditSinks wires all three producers into one shared, hash-chained store', async () => {
    const repo = new InMemoryAuditRepository();
    const store = new AuditService(repo);
    const { cfeSink, licensingSink, dataRightsSink } = createDurableAuditSinks(store);

    cfeSink.emit({
      content_id: null,
      content_text: 'x',
      content_hash: 'h',
      channel: 'EMAIL',
      user_id: 'u1',
      role: Role.REP,
      band: 'clear',
      outcome: 'PASS',
      risk_score: 0,
      held: false,
      held_reason: null,
      classifier_results: [],
      classifiers_triggered: [],
      safe_harbor_injected: false,
      safe_harbor_disclaimers: [],
      regulation: [],
      rule_version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
    await flush();

    await licensingSink.record({
      id: 'lic-2',
      user_id: 'u2',
      jurisdiction: 'TX',
      from_state: 'UNLICENSED',
      to_state: 'PRE_LICENSING',
      action: 'START_PRE_LICENSING',
      actor_id: 'u2',
      occurred_at: new Date().toISOString(),
    });

    await dataRightsSink.record({
      type: 'export.completed',
      user_id: 'u3',
      actor_id: 'u3',
      timestamp: new Date().toISOString(),
      detail: {},
    });

    const all = await store.query({});
    expect(all).toHaveLength(3);
    expect(new Set(all.map((r) => r.user_id))).toEqual(new Set(['u1', 'u2', 'u3']));
    // All three landed in the SAME hash chain — one event stream (§17.8).
    expect((await store.verifyStoredChain()).valid).toBe(true);
    expect(all.map((r) => r.sequence).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});
