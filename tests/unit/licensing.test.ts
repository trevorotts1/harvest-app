import {
  applyTransition,
  canPerformLicensedActivity,
  getContentGateLevel,
  isLicensed,
  isLicensingState,
  legalActionsFrom,
  stricterOf,
  strictestState,
} from '../../src/services/compliance/licensing/licensing-state-machine';
import {
  InMemoryLicensingRepository,
  PrismaLicensingRepository,
  type LicensingRecordPrismaRow,
} from '../../src/services/compliance/licensing/licensing-repository';
import { InMemoryLicensingEventSink } from '../../src/services/compliance/licensing/licensing-audit';
import { LicensingService } from '../../src/services/compliance/licensing/licensing-service';
import { LicensingState } from '../../src/types/licensing';

describe('licensing state machine — pure transitions (§16.5)', () => {
  test('UNLICENSED -> PRE_LICENSING is legal (START_PRE_LICENSING)', () => {
    const result = applyTransition('UNLICENSED', 'START_PRE_LICENSING');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe('PRE_LICENSING');
  });

  test('PRE_LICENSING -> LICENSED is legal (OBTAIN_LICENSE)', () => {
    const result = applyTransition('PRE_LICENSING', 'OBTAIN_LICENSE');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe('LICENSED');
  });

  test('LICENSED -> LICENSE_EXPIRED is legal (EXPIRE_LICENSE)', () => {
    const result = applyTransition('LICENSED', 'EXPIRE_LICENSE');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe('LICENSE_EXPIRED');
  });

  test('LICENSE_EXPIRED -> LICENSED is legal (RENEW_LICENSE, the renewal loop)', () => {
    const result = applyTransition('LICENSE_EXPIRED', 'RENEW_LICENSE');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe('LICENSED');
  });

  // (b) Illegal transitions are rejected — cannot skip the required prior state.
  test('UNLICENSED cannot jump straight to LICENSED (must pass through PRE_LICENSING)', () => {
    const result = applyTransition('UNLICENSED', 'OBTAIN_LICENSE');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Illegal licensing transition/);
      expect(result.error).toMatch(/START_PRE_LICENSING/); // tells the caller what IS legal
    }
  });

  test('UNLICENSED cannot expire a license it never had', () => {
    const result = applyTransition('UNLICENSED', 'EXPIRE_LICENSE');
    expect(result.ok).toBe(false);
  });

  test('PRE_LICENSING cannot expire directly (must become LICENSED first)', () => {
    const result = applyTransition('PRE_LICENSING', 'EXPIRE_LICENSE');
    expect(result.ok).toBe(false);
  });

  test('PRE_LICENSING cannot renew (nothing to renew yet)', () => {
    const result = applyTransition('PRE_LICENSING', 'RENEW_LICENSE');
    expect(result.ok).toBe(false);
  });

  test('LICENSED cannot re-run START_PRE_LICENSING or OBTAIN_LICENSE', () => {
    expect(applyTransition('LICENSED', 'START_PRE_LICENSING').ok).toBe(false);
    expect(applyTransition('LICENSED', 'OBTAIN_LICENSE').ok).toBe(false);
  });

  test('LICENSE_EXPIRED cannot be re-started as if never begun, and cannot re-obtain', () => {
    expect(applyTransition('LICENSE_EXPIRED', 'START_PRE_LICENSING').ok).toBe(false);
    expect(applyTransition('LICENSE_EXPIRED', 'OBTAIN_LICENSE').ok).toBe(false);
  });

  test('an illegal transition never mutates the reported from-state', () => {
    const result = applyTransition('UNLICENSED', 'OBTAIN_LICENSE');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.from).toBe('UNLICENSED');
  });

  test('legalActionsFrom enumerates exactly the legal action for each state', () => {
    expect(legalActionsFrom('UNLICENSED')).toEqual(['START_PRE_LICENSING']);
    expect(legalActionsFrom('PRE_LICENSING')).toEqual(['OBTAIN_LICENSE']);
    expect(legalActionsFrom('LICENSED')).toEqual(['EXPIRE_LICENSE']);
    expect(legalActionsFrom('LICENSE_EXPIRED')).toEqual(['RENEW_LICENSE']);
  });

  test('isLicensingState recognizes only the four §16.5 states', () => {
    expect(isLicensingState('LICENSED')).toBe(true);
    expect(isLicensingState('SUSPENDED')).toBe(false);
    expect(isLicensingState(42)).toBe(false);
  });
});

describe('licensing capability gating — the safety property (§16.5)', () => {
  // (d) A licensed state permits the licensed-only capability.
  test('LICENSED permits the licensed-only capability', () => {
    expect(canPerformLicensedActivity('LICENSED')).toBe(true);
    expect(isLicensed('LICENSED')).toBe(true);
  });

  // (c) An unlicensed/lapsed state correctly BLOCKS the licensed-only capability.
  test('UNLICENSED blocks the licensed-only capability', () => {
    expect(canPerformLicensedActivity('UNLICENSED')).toBe(false);
  });

  test('PRE_LICENSING blocks the licensed-only capability (education-only tier)', () => {
    expect(canPerformLicensedActivity('PRE_LICENSING')).toBe(false);
  });

  test('LICENSE_EXPIRED (lapsed) blocks the licensed-only capability', () => {
    expect(canPerformLicensedActivity('LICENSE_EXPIRED')).toBe(false);
  });

  // This test states, and would fail, the exact regression it guards: if gating were inverted
  // (blocking LICENSED and permitting everything else) or removed (returning true always), the
  // set of states that pass must be the singleton {LICENSED} — not zero, not all four.
  test('exactly one of the four states permits the capability — LICENSED, and only LICENSED', () => {
    const permitted = (['UNLICENSED', 'PRE_LICENSING', 'LICENSED', 'LICENSE_EXPIRED'] as LicensingState[]).filter(
      canPerformLicensedActivity
    );
    expect(permitted).toEqual(['LICENSED']);
  });

  test('content gate levels match §16.5 verbatim', () => {
    expect(getContentGateLevel('UNLICENSED')).toBe('BLOCKED_NO_INSURANCE_CONTENT');
    expect(getContentGateLevel('PRE_LICENSING')).toBe('EDUCATION_ONLY');
    expect(getContentGateLevel('LICENSED')).toBe('FULL_INSURANCE_FEATURES');
    expect(getContentGateLevel('LICENSE_EXPIRED')).toBe('EDUCATION_ONLY'); // "downgraded to Pre-Licensing restrictions"
  });
});

describe('multi-state / jurisdiction — strictest state governs (§16.5)', () => {
  test('stricterOf picks the more restrictive of two states', () => {
    expect(stricterOf('LICENSED', 'UNLICENSED')).toBe('UNLICENSED');
    expect(stricterOf('LICENSED', 'PRE_LICENSING')).toBe('PRE_LICENSING');
    expect(stricterOf('PRE_LICENSING', 'LICENSE_EXPIRED')).toBe('PRE_LICENSING'); // same tier, either is fine
  });

  test('strictestState of an empty set is UNLICENSED (fail-closed default)', () => {
    expect(strictestState([])).toBe('UNLICENSED');
  });

  test('a multi-state rep licensed in TX but unlicensed in CA is governed by CA (strictest)', () => {
    expect(strictestState(['LICENSED', 'UNLICENSED'])).toBe('UNLICENSED');
  });

  test('a multi-state rep licensed in TX and expired in CA is governed by the expired/education tier', () => {
    expect(strictestState(['LICENSED', 'LICENSE_EXPIRED'])).toBe('LICENSE_EXPIRED');
  });

  test('a rep fully licensed in every held jurisdiction is LICENSED overall', () => {
    expect(strictestState(['LICENSED', 'LICENSED'])).toBe('LICENSED');
  });
});

describe('LicensingService — stateful transitions, per-jurisdiction records, and audit emission', () => {
  function makeService() {
    const repo = new InMemoryLicensingRepository();
    const sink = new InMemoryLicensingEventSink();
    const service = new LicensingService(repo, [sink]);
    return { repo, sink, service };
  }

  test('a rep with no record is UNLICENSED by fail-closed default', async () => {
    const { service } = makeService();
    expect(await service.getEffectiveState('rep-1', 'TX')).toBe('UNLICENSED');
    expect(await service.canPerformLicensedActivity('rep-1', 'TX')).toBe(false);
  });

  test('(a) legal transitions succeed end-to-end and persist the new state', async () => {
    const { service } = makeService();
    const step1 = await service.applyTransition('rep-1', 'TX', 'START_PRE_LICENSING', { actor_id: 'rep-1' });
    expect(step1.ok).toBe(true);
    expect(await service.getEffectiveState('rep-1', 'TX')).toBe('PRE_LICENSING');

    const step2 = await service.applyTransition('rep-1', 'TX', 'OBTAIN_LICENSE', {
      actor_id: 'compliance-officer-9',
      actor_role: 'ADMIN',
      reason: 'TX state exam passed; license issued',
    });
    expect(step2.ok).toBe(true);
    expect(await service.getEffectiveState('rep-1', 'TX')).toBe('LICENSED');
  });

  // (b) Illegal transitions are rejected end-to-end — no side effect on record or audit trail.
  test('(b) an illegal transition is rejected, leaves the record unchanged, and emits no audit event', async () => {
    const { service, repo, sink } = makeService();
    await service.applyTransition('rep-1', 'TX', 'START_PRE_LICENSING', { actor_id: 'rep-1' });

    const before = await repo.get('rep-1', 'TX');
    // PRE_LICENSING has no legal RENEW_LICENSE action — nothing to renew yet.
    const illegal = await service.applyTransition('rep-1', 'TX', 'RENEW_LICENSE', {
      actor_id: 'rep-1',
    });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error).toMatch(/Illegal licensing transition/);

    const after = await repo.get('rep-1', 'TX');
    expect(after).toEqual(before); // record untouched by the rejected attempt
    expect(sink.forUser('rep-1')).toHaveLength(1); // only the earlier legal transition was recorded
  });

  test('cannot jump a fresh rep straight to LICENSED (no PRE_LICENSING record yet)', async () => {
    const { service } = makeService();
    const result = await service.applyTransition('rep-2', 'CA', 'OBTAIN_LICENSE', { actor_id: 'rep-2' });
    expect(result.ok).toBe(false);
    expect(await service.getEffectiveState('rep-2', 'CA')).toBe('UNLICENSED');
  });

  // (c) An unlicensed/lapsed state correctly BLOCKS a licensed-only capability check.
  test('(c) an EXPIRED rep is blocked from the licensed-only capability in that jurisdiction', async () => {
    const { service } = makeService();
    await service.applyTransition('rep-3', 'TX', 'START_PRE_LICENSING', { actor_id: 'rep-3' });
    await service.applyTransition('rep-3', 'TX', 'OBTAIN_LICENSE', { actor_id: 'rep-3' });
    await service.applyTransition('rep-3', 'TX', 'EXPIRE_LICENSE', { actor_id: 'system-renewal-job', actor_role: 'ADMIN' });

    expect(await service.getEffectiveState('rep-3', 'TX')).toBe('LICENSE_EXPIRED');
    expect(await service.canPerformLicensedActivity('rep-3', 'TX')).toBe(false);
  });

  // (d) A licensed state permits the licensed-only capability, end-to-end through the service.
  test('(d) a LICENSED rep is permitted the licensed-only capability in that jurisdiction', async () => {
    const { service } = makeService();
    await service.applyTransition('rep-4', 'TX', 'START_PRE_LICENSING', { actor_id: 'rep-4' });
    await service.applyTransition('rep-4', 'TX', 'OBTAIN_LICENSE', { actor_id: 'rep-4' });

    expect(await service.canPerformLicensedActivity('rep-4', 'TX')).toBe(true);
  });

  test('audit events record who/when/from/to/action for every legal transition (T-10 hook)', async () => {
    const { service, sink } = makeService();
    await service.applyTransition('rep-5', 'TX', 'START_PRE_LICENSING', {
      actor_id: 'rep-5',
      actor_role: 'REP',
      reason: 'Enrolled in PFSU pre-licensing coursework',
    });

    const events = sink.forUser('rep-5');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      user_id: 'rep-5',
      jurisdiction: 'TX',
      from_state: 'UNLICENSED',
      to_state: 'PRE_LICENSING',
      action: 'START_PRE_LICENSING',
      actor_id: 'rep-5',
      actor_role: 'REP',
      reason: 'Enrolled in PFSU pre-licensing coursework',
    });
    expect(typeof events[0].occurred_at).toBe('string');
    expect(new Date(events[0].occurred_at).toString()).not.toBe('Invalid Date');
  });

  test('a multi-state rep: LICENSED in TX, never touched CA — CA is unlicensed by fail-closed default', async () => {
    const { service } = makeService();
    await service.applyTransition('rep-6', 'TX', 'START_PRE_LICENSING', { actor_id: 'rep-6' });
    await service.applyTransition('rep-6', 'TX', 'OBTAIN_LICENSE', { actor_id: 'rep-6' });

    // Scoped to TX: licensed and permitted.
    expect(await service.getEffectiveState('rep-6', 'TX')).toBe('LICENSED');
    expect(await service.canPerformLicensedActivity('rep-6', 'TX')).toBe(true);

    // Scoped to CA (never touched there — no record at all): unlicensed and blocked.
    expect(await service.getEffectiveState('rep-6', 'CA')).toBe('UNLICENSED');
    expect(await service.canPerformLicensedActivity('rep-6', 'CA')).toBe(false);
  });

  test('a multi-state rep actually holding records in two states: unscoped state is governed by the stricter one', async () => {
    const { service } = makeService();
    // TX: fully licensed.
    await service.applyTransition('rep-6b', 'TX', 'START_PRE_LICENSING', { actor_id: 'rep-6b' });
    await service.applyTransition('rep-6b', 'TX', 'OBTAIN_LICENSE', { actor_id: 'rep-6b' });
    // CA: only started pre-licensing — the stricter of the two jurisdictions.
    await service.applyTransition('rep-6b', 'CA', 'START_PRE_LICENSING', { actor_id: 'rep-6b' });

    expect(await service.getEffectiveState('rep-6b', 'TX')).toBe('LICENSED');
    expect(await service.getEffectiveState('rep-6b', 'CA')).toBe('PRE_LICENSING');

    // Unscoped (no jurisdiction argument): strictest-state-governs (§16.5) -> PRE_LICENSING, not
    // LICENSED — the CA record drags the overall/no-jurisdiction-specified check down.
    expect(await service.getEffectiveState('rep-6b')).toBe('PRE_LICENSING');
    expect(await service.canPerformLicensedActivity('rep-6b')).toBe(false);
  });

  test('getLicensedJurisdictions feeds the CFE UserContext.licensed_states integration point', async () => {
    const { service } = makeService();
    await service.applyTransition('rep-7', 'TX', 'START_PRE_LICENSING', { actor_id: 'rep-7' });
    await service.applyTransition('rep-7', 'TX', 'OBTAIN_LICENSE', { actor_id: 'rep-7' });
    await service.applyTransition('rep-7', 'CA', 'START_PRE_LICENSING', { actor_id: 'rep-7' });

    const licensedStates = await service.getLicensedJurisdictions('rep-7');
    expect(licensedStates).toEqual(['TX']); // CA is still PRE_LICENSING — not yet in the list
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// T-29R — PrismaLicensingRepository: the production repository this build unit adds so
// `LicensingService.getLicensedJurisdictions()` has a real backing store (previously only
// `InMemoryLicensingRepository` existed — see this module's own doc comment on "a future DB
// swap"). Exercised against a narrow mock `licensingRecord` delegate (no live DB), mirroring
// `PrismaAuditRepository`'s own untested-directly-but-thin-mapping shape.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('T-29R — PrismaLicensingRepository (the production LicensingRepository backing)', () => {
  function makeMockDelegate() {
    const rows = new Map<string, LicensingRecordPrismaRow>();
    const key = (userId: string, jurisdiction: string) => `${userId}::${jurisdiction}`;

    const delegate = {
      findUnique: async ({ where }: { where: { user_id_jurisdiction: { user_id: string; jurisdiction: string } } }) =>
        rows.get(key(where.user_id_jurisdiction.user_id, where.user_id_jurisdiction.jurisdiction)) ?? null,
      findMany: async ({ where }: { where: { user_id: string } }) =>
        [...rows.values()].filter((r) => r.user_id === where.user_id),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { user_id_jurisdiction: { user_id: string; jurisdiction: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const k = key(where.user_id_jurisdiction.user_id, where.user_id_jurisdiction.jurisdiction);
        const existing = rows.get(k);
        const now = new Date();
        const next: LicensingRecordPrismaRow = existing
          ? { ...existing, ...update, updated_at: now }
          : {
              id: 'row-1',
              user_id: where.user_id_jurisdiction.user_id,
              jurisdiction: where.user_id_jurisdiction.jurisdiction,
              state: 'UNLICENSED',
              license_number: null,
              issued_at: null,
              expires_at: null,
              created_at: now,
              updated_at: now,
              ...create,
            };
        rows.set(k, next);
        return next;
      },
    };
    return { delegate, rows };
  }

  test('get() returns null for a jurisdiction with no record (the fail-closed "no record = UNLICENSED" default is LicensingService\'s job, not this repository, which just reflects what is on file)', async () => {
    const { delegate } = makeMockDelegate();
    const repo = new PrismaLicensingRepository({ licensingRecord: delegate });
    expect(await repo.get('rep-1', 'TX')).toBeNull();
  });

  test('upsert() then get() round-trips a record, mapping Prisma Dates to ISO strings', async () => {
    const { delegate } = makeMockDelegate();
    const repo = new PrismaLicensingRepository({ licensingRecord: delegate });

    await repo.upsert({
      id: 'rec-1',
      user_id: 'rep-1',
      jurisdiction: 'TX',
      state: 'LICENSED',
      license_number: 'IBA-123',
      issued_at: '2026-01-01T00:00:00.000Z',
      expires_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const record = await repo.get('rep-1', 'TX');
    expect(record).not.toBeNull();
    expect(record!.state).toBe('LICENSED');
    expect(record!.license_number).toBe('IBA-123');
    expect(typeof record!.created_at).toBe('string');
    expect(new Date(record!.created_at).toString()).not.toBe('Invalid Date');
  });

  test('getAllForUser() returns every jurisdiction on file for that user, and none for another user', async () => {
    const { delegate } = makeMockDelegate();
    const repo = new PrismaLicensingRepository({ licensingRecord: delegate });

    await repo.upsert({
      id: 'rec-tx',
      user_id: 'rep-1',
      jurisdiction: 'TX',
      state: 'LICENSED',
      license_number: null,
      issued_at: null,
      expires_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    await repo.upsert({
      id: 'rec-ca',
      user_id: 'rep-1',
      jurisdiction: 'CA',
      state: 'PRE_LICENSING',
      license_number: null,
      issued_at: null,
      expires_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const forRep1 = await repo.getAllForUser('rep-1');
    expect(forRep1.map((r) => r.jurisdiction).sort()).toEqual(['CA', 'TX']);

    const forSomeoneElse = await repo.getAllForUser('rep-2');
    expect(forSomeoneElse).toEqual([]);
  });

  test('a real LicensingService wired to PrismaLicensingRepository resolves getLicensedJurisdictions() end to end', async () => {
    const { delegate } = makeMockDelegate();
    const repo = new PrismaLicensingRepository({ licensingRecord: delegate });
    const service = new LicensingService(repo);

    await service.applyTransition('rep-9', 'TX', 'START_PRE_LICENSING', { actor_id: 'rep-9' });
    await service.applyTransition('rep-9', 'TX', 'OBTAIN_LICENSE', { actor_id: 'rep-9' });

    expect(await service.getLicensedJurisdictions('rep-9')).toEqual(['TX']);
  });
});
