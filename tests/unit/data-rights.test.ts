import { DataRightsService } from '../../src/services/compliance/data-rights/data-rights';
import { LegalHoldService, InMemoryLegalHoldRepository } from '../../src/services/compliance/data-rights/legal-hold';
import { InMemoryDataRightsAuditSink } from '../../src/services/compliance/data-rights/audit-emit';
import { RetentionService } from '../../src/services/compliance/data-rights/retention';
import { enforceMinimization, isMinimized, allowlistFor } from '../../src/services/compliance/data-rights/minimization';
import { RETENTION_SCHEDULE } from '../../src/types/data-rights';

// ─────────────────────────────────────────────────────────────────────────
// Mock Prisma delegate (T-11 uses the same constructor-injection pattern as
// src/services/warm-market/contact.service.ts / tests/unit/warm-market.test.ts).
// ─────────────────────────────────────────────────────────────────────────

interface Row {
  [key: string]: unknown;
}

function makeMockPrisma(seed: {
  user?: Row;
  contacts?: Row[];
  auditEntries?: Row[];
  deletion?: Row;
  export?: Row;
}): any {
  const users = new Map<string, Row>();
  if (seed.user) users.set(seed.user.id as string, { ...seed.user });

  let contacts: Row[] = seed.contacts ? seed.contacts.map((c) => ({ ...c })) : [];
  const auditEntries: Row[] = seed.auditEntries ? seed.auditEntries.map((a) => ({ ...a })) : [];

  const deletions = new Map<string, Row>();
  if (seed.deletion) deletions.set(seed.deletion.id as string, { ...seed.deletion });

  const exports = new Map<string, Row>();
  if (seed.export) exports.set(seed.export.id as string, { ...seed.export });

  const userUpdate = jest.fn(async ({ where, data }: any) => {
    const existing = users.get(where.id) ?? {};
    const updated = { ...existing, ...data };
    users.set(where.id, updated);
    return updated;
  });

  const contactUpdateMany = jest.fn(async ({ where, data }: any) => {
    let count = 0;
    contacts = contacts.map((c) => {
      if (c.user_id === where.user_id) {
        count++;
        return { ...c, ...data };
      }
      return c;
    });
    return { count };
  });

  const auditEntryDelete = jest.fn();
  const auditEntryDeleteMany = jest.fn();

  const userDataDeletionUpdate = jest.fn(async ({ where, data }: any) => {
    const existing = deletions.get(where.id) ?? {};
    const updated = { ...existing, ...data };
    deletions.set(where.id, updated);
    return updated;
  });

  const userDataExportUpdate = jest.fn(async ({ where, data }: any) => {
    const existing = exports.get(where.id) ?? {};
    const updated = { ...existing, ...data };
    exports.set(where.id, updated);
    return updated;
  });

  // Typed loosely (`as any` at the call site below) — mirrors the mock-Prisma convention already
  // established in tests/unit/warm-market.test.ts, which avoids fighting structural typing on a
  // deliberately-narrow, test-only mock shape (and lets `auditEntry.delete`/`deleteMany` exist on
  // the mock purely so proof test (b) can assert they are never called, even though the real
  // DataRightsPrismaClient contract has no such methods).
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.get(where.id) ?? null),
      update: userUpdate,
    },
    contact: {
      findMany: jest.fn(async ({ where }: any) => contacts.filter((c) => c.user_id === where.user_id)),
      updateMany: contactUpdateMany,
    },
    auditEntry: {
      findMany: jest.fn(async ({ where }: any) =>
        auditEntries.filter((a) => a.user_id === where.user_id && a.regulation === where.regulation)
      ),
      delete: auditEntryDelete,
      deleteMany: auditEntryDeleteMany,
    },
    userDataDeletion: {
      create: jest.fn(async ({ data }: any) => {
        deletions.set(data.id, { ...data });
        return { ...data };
      }),
      update: userDataDeletionUpdate,
      findUnique: jest.fn(async ({ where }: any) => deletions.get(where.id) ?? null),
    },
    userDataExport: {
      create: jest.fn(async ({ data }: any) => {
        exports.set(data.id, { ...data });
        return { ...data };
      }),
      update: userDataExportUpdate,
      findUnique: jest.fn(async ({ where }: any) => exports.get(where.id) ?? null),
    },
  };

  return prisma;
}

const BASE_USER: Row = {
  id: 'user-1',
  email: 'real.rep@example.com',
  name: 'Real Rep Name',
  phone: '+15555550100',
  solution_number: 'SN-12345',
  anchor_statement: 'My anchor statement, verbatim.',
  calendar_preferences: { tz: 'America/New_York' },
  mfa_methods: ['totp'],
};

const BASE_CONTACTS: Row[] = [
  {
    id: 'contact-1',
    user_id: 'user-1',
    first_name: 'Jane',
    last_name: 'Doe',
    phone: '+15555550101',
    email: 'jane.doe@example.com',
    notes: 'Met at church picnic.',
    phone_hash: 'hash-phone-1',
    email_hash: 'hash-email-1',
  },
];

const PENDING_DELETION: Row = {
  id: 'del-1',
  user_id: 'user-1',
  status: 'PENDING',
  anonymized_fields: [],
  retained_fields: [],
  requested_at: new Date('2026-06-01T00:00:00Z'),
  completed_at: null,
};

describe('T-11 Data Rights — deletion (proofs a, b, c)', () => {
  let legalHoldRepo: InMemoryLegalHoldRepository;
  let auditSink: InMemoryDataRightsAuditSink;
  let legalHold: LegalHoldService;

  beforeEach(() => {
    legalHoldRepo = new InMemoryLegalHoldRepository();
    auditSink = new InMemoryDataRightsAuditSink();
    legalHold = new LegalHoldService(legalHoldRepo, auditSink);
  });

  // ── (a) deletion removes PII fields ──────────────────────────────────
  test('(a) processDeletion scrubs User and Contact PII fields and marks the request COMPLETED', async () => {
    const prisma = makeMockPrisma({ user: BASE_USER, contacts: BASE_CONTACTS, deletion: PENDING_DELETION });
    const service = new DataRightsService(prisma, legalHold, auditSink);

    const { record, certificate } = await service.processDeletion('del-1', 'user-1');

    expect(record.status).toBe('COMPLETED');

    // User PII scrubbed
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    const userUpdateData = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(userUpdateData.email).not.toBe(BASE_USER.email);
    expect(userUpdateData.email).toMatch(/^deleted-user-1@/);
    expect(userUpdateData.name).toBe('Deleted User');
    expect(userUpdateData.phone).toBeNull();
    expect(userUpdateData.solution_number).toBeNull();
    expect(userUpdateData.anchor_statement).toBeNull();

    // Contact PII scrubbed
    expect(prisma.contact.updateMany).toHaveBeenCalledTimes(1);
    const contactUpdateData = (prisma.contact.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(contactUpdateData.first_name).toBe('Deleted');
    expect(contactUpdateData.phone).toBeNull();
    expect(contactUpdateData.email).toBeNull();
    expect(contactUpdateData.notes).toBeNull();

    expect(certificate.deleted_fields).toContain('User.email');
    expect(certificate.deleted_fields).toContain('Contact.first_name');
    expect(certificate.status).toBe('COMPLETED');

    // Audit emitted
    expect(auditSink.ofType('deletion.completed')).toHaveLength(1);
  });

  // ── (b) FINRA carve-out preserved ────────────────────────────────────
  test('(b) processDeletion preserves FINRA-tagged AuditEntry rows while still scrubbing ordinary PII', async () => {
    const auditEntries: Row[] = [
      { id: 'ae-1', user_id: 'user-1', regulation: 'FINRA', content_hash: 'hash-1', created_at: new Date() },
      { id: 'ae-2', user_id: 'user-1', regulation: 'FINRA', content_hash: 'hash-2', created_at: new Date() },
    ];
    const prisma = makeMockPrisma({
      user: BASE_USER,
      contacts: BASE_CONTACTS,
      auditEntries,
      deletion: PENDING_DELETION,
    });
    const service = new DataRightsService(prisma, legalHold, auditSink);

    const { certificate } = await service.processDeletion('del-1', 'user-1');

    // The carve-out set is documented as retained...
    expect(certificate.retained_records).toHaveLength(2);
    expect(certificate.retained_records.map((r) => r.ref)).toEqual(
      expect.arrayContaining(['AuditEntry:ae-1', 'AuditEntry:ae-2'])
    );
    expect(certificate.retained_records[0].reason).toMatch(/FINRA/);

    // ...and it was only ever *read*, never deleted. If a future change wired AuditEntry into the
    // deletion path's delete/deleteMany calls, these assertions would fail — that is the point:
    // the carve-out is proved by absence of any delete call, not merely by the certificate text.
    expect(prisma.auditEntry.delete).not.toHaveBeenCalled();
    expect(prisma.auditEntry.deleteMany).not.toHaveBeenCalled();
    expect(prisma.auditEntry.findMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1', regulation: 'FINRA' },
    });

    // AND ordinary PII was still removed in the same run — the split the certificate must document.
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(certificate.deleted_fields.length).toBeGreaterThan(0);
    expect(certificate.status).toBe('COMPLETED');
  });

  // ── (c) legal hold blocks deletion ───────────────────────────────────
  test('(c) processDeletion is BLOCKED (HELD) when an active legal hold exists — no PII is touched', async () => {
    await legalHold.placeHold({
      user_id: 'user-1',
      reason: 'FINRA regulatory inquiry — active litigation hold',
      placed_by: 'admin-1',
      placed_by_role: 'ADMIN',
    });

    const prisma = makeMockPrisma({ user: BASE_USER, contacts: BASE_CONTACTS, deletion: PENDING_DELETION });
    const service = new DataRightsService(prisma, legalHold, auditSink);

    const { record, certificate } = await service.processDeletion('del-1', 'user-1');

    expect(record.status).toBe('HELD');
    expect(certificate.status).toBe('HELD');
    expect(certificate.legal_hold?.reason).toMatch(/FINRA regulatory inquiry/);
    expect(certificate.deleted_fields).toHaveLength(0);
    expect(certificate.retained_records).toHaveLength(0);

    // Nothing PII-related was ever touched — if the hold check were removed or bypassed, these
    // would all have been called, and this test would fail.
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
    expect(prisma.contact.updateMany).not.toHaveBeenCalled();

    expect(auditSink.ofType('deletion.held')).toHaveLength(1);
  });

  test('deletion proceeds normally once the hold is lifted', async () => {
    const hold = await legalHold.placeHold({
      user_id: 'user-1',
      reason: 'temporary hold',
      placed_by: 'admin-1',
      placed_by_role: 'ADMIN',
    });

    const prisma = makeMockPrisma({ user: BASE_USER, contacts: BASE_CONTACTS, deletion: PENDING_DELETION });
    const service = new DataRightsService(prisma, legalHold, auditSink);

    // Still held.
    const blocked = await service.processDeletion('del-1', 'user-1');
    expect(blocked.record.status).toBe('HELD');

    await legalHold.liftHold({
      hold_id: hold.id,
      user_id: 'user-1',
      lifted_by: 'admin-1',
      lifted_by_role: 'ADMIN',
    });

    // Re-request against a fresh PENDING row (a HELD deletion isn't silently retried in place).
    const prisma2 = makeMockPrisma({
      user: BASE_USER,
      contacts: BASE_CONTACTS,
      deletion: { ...PENDING_DELETION, id: 'del-2' },
    });
    const service2 = new DataRightsService(prisma2, legalHold, auditSink);
    const proceeded = await service2.processDeletion('del-2', 'user-1');
    expect(proceeded.record.status).toBe('COMPLETED');
  });

  test('a REP cannot place a legal hold (RBAC deny) — only ADMIN/RVP manage data_rights', async () => {
    await expect(
      legalHold.placeHold({
        user_id: 'user-1',
        reason: 'attempted self-hold',
        placed_by: 'rep-1',
        placed_by_role: 'REP',
      })
    ).rejects.toThrow(/RBAC/);
  });

  test('requestDeletion creates a PENDING row and emits deletion.requested', async () => {
    const prisma = makeMockPrisma({ user: BASE_USER, contacts: BASE_CONTACTS });
    const service = new DataRightsService(prisma, legalHold, auditSink);

    const record = await service.requestDeletion({ user_id: 'user-1', requested_by: 'user-1' });
    expect(record.status).toBe('PENDING');
    expect(auditSink.ofType('deletion.requested')).toHaveLength(1);
  });
});

describe('T-11 Data Rights — export', () => {
  test('processExport produces valid JSON within the 5-minute SLA', async () => {
    const prisma = makeMockPrisma({
      user: BASE_USER,
      contacts: BASE_CONTACTS,
      export: { id: 'exp-1', user_id: 'user-1', status: 'PENDING', expires_at: new Date(), created_at: new Date() },
    });
    const legalHold = new LegalHoldService(new InMemoryLegalHoldRepository());
    const service = new DataRightsService(prisma, legalHold);

    const { record, payload, sla_deadline } = await service.processExport('exp-1', 'json');
    expect(record.status).toBe('COMPLETED');
    expect(() => JSON.parse(payload)).not.toThrow();
    const parsed = JSON.parse(payload);
    expect(parsed.user.id).toBe('user-1');
    expect(new Date(sla_deadline).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  test('processExport produces valid CSV', async () => {
    const prisma = makeMockPrisma({
      user: BASE_USER,
      contacts: BASE_CONTACTS,
      export: { id: 'exp-2', user_id: 'user-1', status: 'PENDING', expires_at: new Date(), created_at: new Date() },
    });
    const legalHold = new LegalHoldService(new InMemoryLegalHoldRepository());
    const service = new DataRightsService(prisma, legalHold);

    const { payload } = await service.processExport('exp-2', 'csv');
    const lines = payload.trim().split('\n');
    expect(lines).toHaveLength(2); // header + one data row

    // RFC 4180-aware field extraction (every field is quoted, so a regex over quoted spans
    // correctly ignores commas embedded *inside* a field, unlike a naive `line.split(',')`).
    const fieldsOf = (line: string) => line.match(/"(?:[^"]|"")*"/g) ?? [];
    const headerFields = fieldsOf(lines[0]);
    const rowFields = fieldsOf(lines[1]);
    expect(headerFields.length).toBe(rowFields.length);
    expect(headerFields.length).toBeGreaterThan(0);

    // The nested `contacts` array survives as a single, round-trippable JSON field.
    const contactsColumnIndex = headerFields.findIndex((f) => f === '"contacts"');
    expect(contactsColumnIndex).toBeGreaterThanOrEqual(0);
    const rawField = rowFields[contactsColumnIndex];
    const unquoted = rawField.slice(1, -1).replace(/""/g, '"');
    expect(() => JSON.parse(unquoted)).not.toThrow();
    expect(JSON.parse(unquoted)[0].first_name).toBe('Jane');
  });
});

describe('T-11 Data Rights — retention schedules (proof d)', () => {
  const retention = new RetentionService();
  const NOW = new Date('2026-07-15T00:00:00Z');

  test('(d) agent logs older than 12 months are identified as past retention', () => {
    const thirteenMonthsAgo = new Date('2025-06-01T00:00:00Z');
    const past = retention.findPastRetention(
      'AGENT_LOGS',
      [{ id: 'run-1', referenceDate: thirteenMonthsAgo }],
      NOW
    );
    expect(past).toHaveLength(1);
    expect(past[0].action).toBe('anonymize');
  });

  test('(d) agent logs younger than 12 months are NOT past retention', () => {
    const oneMonthAgo = new Date('2026-06-15T00:00:00Z');
    const past = retention.findPastRetention('AGENT_LOGS', [{ id: 'run-2', referenceDate: oneMonthAgo }], NOW);
    expect(past).toHaveLength(0);
  });

  test('(d) deleted-user data past the 30-day purge window is identified', () => {
    const fortyDaysAgo = new Date('2026-06-05T00:00:00Z');
    const past = retention.findPastRetention(
      'DELETED_USER_DATA',
      [{ id: 'del-old', referenceDate: fortyDaysAgo }],
      NOW
    );
    expect(past).toHaveLength(1);
    expect(past[0].action).toBe('purge');
  });

  test('the FINRA archive category is flagged as the carve-out and uses a 7-year window, not the ordinary 30/90/365-day windows', () => {
    const rule = RETENTION_SCHEDULE.FINRA_COMMUNICATIONS_ARCHIVE;
    expect(rule.isCarveOut).toBe(true);
    expect(rule.retentionPeriodDays).toBe(365 * 7);

    // A FINRA record from 2 years ago is nowhere near its own 7-year archive window...
    const twoYearsAgo = new Date('2024-07-15T00:00:00Z');
    const stillWithin = retention.findPastRetention(
      'FINRA_COMMUNICATIONS_ARCHIVE',
      [{ id: 'ae-recent', referenceDate: twoYearsAgo }],
      NOW
    );
    expect(stillWithin).toHaveLength(0);

    // ...but a record from 8 years ago is past even the FINRA archive's own long clock (this is
    // orthogonal to GDPR/CCPA deletion, which never purges this category regardless of age).
    const eightYearsAgo = new Date('2018-07-15T00:00:00Z');
    const pastArchive = retention.findPastRetention(
      'FINRA_COMMUNICATIONS_ARCHIVE',
      [{ id: 'ae-ancient', referenceDate: eightYearsAgo }],
      NOW
    );
    expect(pastArchive).toHaveLength(1);
    expect(pastArchive[0].action).toBe('retain_in_segregated_archive');
  });

  test('other three categories are not marked as the carve-out', () => {
    expect(RETENTION_SCHEDULE.ACTIVE_USER_DATA.isCarveOut).toBe(false);
    expect(RETENTION_SCHEDULE.DELETED_USER_DATA.isCarveOut).toBe(false);
    expect(RETENTION_SCHEDULE.AGENT_LOGS.isCarveOut).toBe(false);
  });
});

describe('T-11 Data Rights — data minimization', () => {
  test('signup payload with over-collected fields is stripped to the allowlist', () => {
    const raw = {
      email: 'rep@example.com',
      name: 'Rep Name',
      phone: '+15555550100',
      role: 'rep',
      org_type: 'primerica',
      upline_id: 'upline-1',
      gdpr_consent: true,
      // over-collection: none of this is needed for onboarding and must be dropped
      ssn: '123-45-6789',
      annual_income: 250000,
      marketing_tracking_id: 'ga-123',
    };

    const { minimized, droppedFields } = enforceMinimization('signup', raw);

    expect(droppedFields.sort()).toEqual(['annual_income', 'marketing_tracking_id', 'ssn']);
    expect(minimized).not.toHaveProperty('ssn');
    expect(minimized).not.toHaveProperty('annual_income');
    expect((minimized as any).email).toBe('rep@example.com');
    expect(isMinimized('signup', minimized as Record<string, unknown>)).toBe(true);
  });

  test('contact_import payload drops fields outside the allowlist (e.g. accidental notes-field PII dump)', () => {
    const raw = {
      first_name: 'Jane',
      last_name: 'Doe',
      phone: '+15555550101',
      email: 'jane@example.com',
      relationship_type: 'friend',
      source: 'manual',
      import_batch_id: 'batch-1',
      social_security_number: '987-65-4321',
    };
    const { droppedFields } = enforceMinimization('contact_import', raw);
    expect(droppedFields).toEqual(['social_security_number']);
  });

  test('isMinimized flags a payload that still carries a disallowed field', () => {
    expect(isMinimized('signup', { email: 'a@b.com', extra_field: 'nope' })).toBe(false);
  });

  test('allowlistFor exposes the surface allowlist for documentation/introspection', () => {
    expect(allowlistFor('agent_log_capture')).toContain('agent_key');
    expect(allowlistFor('agent_log_capture')).not.toContain('raw_prompt_text');
  });
});
