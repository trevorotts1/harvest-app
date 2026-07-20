// T-38 (master-spec §10.4 TCPA consent ledger; §16.2 "Per-contact consent"; §16.3 "timestamped,
// versioned, revocable"). Uses the same plain-mock-Prisma-delegate pattern as
// `tests/unit/gdpr-consent.test.ts` — a real `MessagingConsentLedger` instance, a fake in-memory
// `ComplianceConsent` table (no real database).
//
// PROOF (c): automated messaging without a valid TCPA consent record is BLOCKED
// (`hasMessagingConsent` -> false); with a valid, current, `given: true` record it is allowed.
// Also proves the ledger is durable (persisted via the real `ComplianceConsent` table shape, not
// an in-process Map), versioned (each write increments), timestamped, and that a prior bug
// (`getHistory` returning only the latest record despite claiming "full version history") is
// fixed.

import {
  MessagingConsentLedger,
  MESSAGING_TCPA_CONSENT_TYPE,
  type MessagingConsentPrismaClient,
} from '../../src/services/compliance/messaging-consent/messaging-consent-ledger';

interface FakeRow {
  id: string;
  user_id: string;
  contact_id: string | null;
  consent_type: string;
  given: boolean;
  version: number;
  timestamp: Date;
}

function makeFakeLedgerClient() {
  const rows: FakeRow[] = [];
  let nextId = 0;

  const client: MessagingConsentPrismaClient = {
    complianceConsent: {
      create: jest.fn(async ({ data }) => {
        const row: FakeRow = { id: `cc-${nextId++}`, ...data };
        rows.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }) => {
        const matches = rows
          .filter((r) => r.contact_id === where.contact_id && r.consent_type === where.consent_type)
          .sort((a, b) => b.version - a.version);
        return matches[0] ?? null;
      }),
      findMany: jest.fn(async ({ where }) => {
        return rows
          .filter((r) => r.contact_id === where.contact_id && r.consent_type === where.consent_type)
          .sort((a, b) => b.version - a.version);
      }),
    },
  };

  return { client, rows };
}

describe('MessagingConsentLedger.captureConsent (§16.3 "versioned, timestamped" — PROOF c)', () => {
  test('the FIRST capture for a contact is version 1, persisted to the durable table', async () => {
    const { client, rows } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);

    const record = await ledger.captureConsent('rep-1', 'contact-1', true, { source: 'web_form' });

    expect(record.version).toBe(1);
    expect(record.given).toBe(true);
    expect(record.consent_type).toBe(MESSAGING_TCPA_CONSENT_TYPE);
    expect(typeof record.timestamp).toBe('string');
    expect(new Date(record.timestamp).toString()).not.toBe('Invalid Date');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 'rep-1', contact_id: 'contact-1', given: true, version: 1 });
  });

  test('a SECOND capture for the SAME contact durably increments the version (not process-local) — proves version survives across separate ledger instances', async () => {
    const { client } = makeFakeLedgerClient();

    const ledgerA = new MessagingConsentLedger(client);
    await ledgerA.captureConsent('rep-1', 'contact-1', true);

    // A brand-new ledger instance (simulating a fresh process/request) reads the durable table, not
    // an in-memory Map — this is exactly the T-38 fix over the pre-existing WP11 `ConsentManager`,
    // whose version number "did not survive a process restart".
    const ledgerB = new MessagingConsentLedger(client);
    const second = await ledgerB.captureConsent('rep-1', 'contact-1', false, { source: 'manual_entry' });

    expect(second.version).toBe(2);
  });

  test('capture is APPEND-ONLY: revoking after granting adds a NEW row rather than mutating the prior grant (auditable lineage)', async () => {
    const { client, rows } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);

    await ledger.captureConsent('rep-1', 'contact-1', true);
    await ledger.revokeConsent('rep-1', 'contact-1');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ given: true, version: 1 });
    expect(rows[1]).toMatchObject({ given: false, version: 2 });
  });
});

describe('MessagingConsentLedger.hasMessagingConsent (FAIL-CLOSED — PROOF c)', () => {
  test('no consent record at all -> false (BLOCKED)', async () => {
    const { client } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);
    expect(await ledger.hasMessagingConsent('never-consented-contact')).toBe(false);
  });

  test('a GRANTED, current consent record -> true (ALLOWED)', async () => {
    const { client } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);
    await ledger.captureConsent('rep-1', 'contact-1', true);
    expect(await ledger.hasMessagingConsent('contact-1')).toBe(true);
  });

  test('a REVOKED (latest given: false) consent record -> false (BLOCKED) even though an earlier grant exists', async () => {
    const { client } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);
    await ledger.captureConsent('rep-1', 'contact-1', true);
    await ledger.revokeConsent('rep-1', 'contact-1');
    expect(await ledger.hasMessagingConsent('contact-1')).toBe(false);
  });

  test('a DB read failure resolves to false (BLOCKED), never true — an unknown consent state must never resolve to "safe to send"', async () => {
    const client: MessagingConsentPrismaClient = {
      complianceConsent: {
        create: jest.fn(),
        findFirst: jest.fn(async () => {
          throw new Error('connection reset');
        }),
        findMany: jest.fn(),
      },
    };
    const ledger = new MessagingConsentLedger(client);
    expect(await ledger.hasMessagingConsent('any-contact')).toBe(false);
  });
});

describe('MessagingConsentLedger.getHistory (bug fix: FULL version history, not just the latest row)', () => {
  test('returns EVERY version for the contact, newest-first — not just the single latest record', async () => {
    const { client } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);

    await ledger.captureConsent('rep-1', 'contact-1', true, { source: 'web_form' });
    await ledger.revokeConsent('rep-1', 'contact-1');
    await ledger.captureConsent('rep-1', 'contact-1', true, { source: 'manual_entry' });

    const history = await ledger.getHistory('contact-1');

    // TEETH: the pre-fix implementation called findFirst (not findMany) and always returned an
    // array of length <= 1 regardless of how many grant/revoke events occurred. Three captures
    // above must yield THREE history rows, newest version first.
    expect(history).toHaveLength(3);
    expect(history.map((r) => r.version)).toEqual([3, 2, 1]);
    expect(history[0]).toMatchObject({ given: true, version: 3 });
    expect(history[1]).toMatchObject({ given: false, version: 2 });
    expect(history[2]).toMatchObject({ given: true, version: 1 });
  });

  test('an unknown contact returns an empty array, not an error', async () => {
    const { client } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);
    expect(await ledger.getHistory('never-heard-of-this-contact')).toEqual([]);
  });

  test('a DB read failure resolves to an empty array (fails closed to "no history", never throws)', async () => {
    const client: MessagingConsentPrismaClient = {
      complianceConsent: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    };
    const ledger = new MessagingConsentLedger(client);
    expect(await ledger.getHistory('any-contact')).toEqual([]);
  });
});
