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
//
// T-R17 (remediation of a T-38 QC finding, §9.2 — consent-version race): additionally proves (a)
// the multi-key orderBy (`version` desc, `timestamp` desc, `id` desc) is what makes "current
// consent" deterministic even when two rows share a version. Unlike an earlier draft of this file
// (QC FAIL 7.5), the fake client's `findFirst` / `findMany` below do NOT hardcode their own
// comparator — they destructure `args.orderBy` and sort by EXACTLY those keys, in that order, via
// `sortByOrderBy`. That means these tests exercise the REAL orderBy the ledger sends, not a
// pre-baked substitute: if production ever regresses to `orderBy: [{version:'desc'}]` alone (the
// exact bug T-R17 fixes), the fake stops applying the `timestamp`/`id` tiebreaks too, and the
// T-R17(a) "two rows share a version" tests below go RED instead of staying green. A dedicated
// assertion (T-R17(e)) additionally pins the ledger's `captureConsent` read, `hasMessagingConsent`,
// and `getHistory` calls to the real, imported `CURRENT_CONSENT_ORDER_BY` constant, so a revert is
// caught even before the sort behavior is exercised. Also proves (b) the fake `create` enforces
// the SAME semantics as the DB `@@unique([contact_id, consent_type, version])` added alongside
// this fix — including Postgres's NULL-is-distinct default, so a `contact_id: null` row (the WP11
// onboarding-consent shape) never collides with another `contact_id: null` row — and that
// `captureConsent`'s bounded retry recovers a real race instead of throwing it at the caller.

import {
  MessagingConsentLedger,
  MESSAGING_TCPA_CONSENT_TYPE,
  CURRENT_CONSENT_ORDER_BY,
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

/** A fake Prisma unique-constraint violation, matching the duck-typed shape
 *  `messaging-consent-ledger.ts`'s `isUniqueConstraintViolation` checks for (`err.code === 'P2002'`
 *  — the same convention as `src/services/agent-runtime/store.ts`). */
class FakeUniqueConstraintError extends Error {
  code = 'P2002';
  constructor() {
    super('Unique constraint failed on the fields: (`contact_id`,`consent_type`,`version`)');
  }
}

/** The exact shape `messaging-consent-ledger.ts`'s `MessagingConsentPrismaClient` declares for
 *  `orderBy` — a list of single-key clauses applied in order, each breaking ties left by the ones
 *  before it. */
type ConsentOrderBy = Array<{ version: 'desc' } | { timestamp: 'desc' } | { id: 'desc' }>;

/** Sorts rows using ONLY the keys present in `orderBy`, in the order given — a faithful model of
 *  Prisma's multi-key `orderBy` semantics, driven entirely by what the CALLER passes, not a
 *  hardcoded pre-baked comparator. This is the crux of the T-R17 QC fix: previously this fake
 *  ignored `args.orderBy` outright and always applied its own full version/timestamp/id
 *  comparator, so reverting the ledger's real orderBy to `[{version:'desc'}]` alone was invisible
 *  to every test in this file. Now, if the ledger sends fewer/different keys, this sort resolves
 *  ties using ONLY those keys too — reproducing the exact non-determinism T-R17 exists to fix. */
function sortByOrderBy(rows: FakeRow[], orderBy: ConsentOrderBy): FakeRow[] {
  // Fake ids are `cc-<N>`; compare the numeric suffix (not lexicographically — "cc-10" < "cc-2"
  // as strings, which would misrepresent a real DB primary key's total order once N reaches double
  // digits) so an `id` clause behaves like a real, monotonic absolute tiebreak.
  const idNum = (id: string) => Number(id.split('-')[1]);
  const valueOf = (row: FakeRow, key: string): number => {
    if (key === 'version') return row.version;
    if (key === 'timestamp') return row.timestamp.getTime();
    if (key === 'id') return idNum(row.id);
    throw new Error(`sortByOrderBy: unsupported orderBy key "${key}"`);
  };
  return [...rows].sort((a, b) => {
    for (const clause of orderBy) {
      const [key, direction] = Object.entries(clause)[0] as [string, 'asc' | 'desc'];
      const diff = valueOf(a, key) - valueOf(b, key);
      if (diff !== 0) return direction === 'desc' ? -diff : diff;
    }
    // Exhausted every key the CALLER provided without finding a difference: a genuine tie under
    // THIS orderBy (e.g. a version-only orderBy comparing two same-version rows). Stable sort
    // leaves these in whatever order they arrived — exactly the DB-implementation-detail ambiguity
    // a real Postgres `ORDER BY version DESC` (no further tiebreak) would also leave undefined.
    return 0;
  });
}

function makeFakeLedgerClient() {
  const rows: FakeRow[] = [];
  let nextId = 0;

  const client: MessagingConsentPrismaClient = {
    complianceConsent: {
      create: jest.fn(async ({ data }) => {
        // Model the DB `@@unique([contact_id, consent_type, version])`: Postgres's default
        // NULL-is-distinct semantics mean this NEVER fires for `contact_id: null` (WP11's shape) —
        // only a real, matching, non-null contact_id collides.
        if (
          data.contact_id !== null &&
          rows.some(
            (r) =>
              r.contact_id === data.contact_id &&
              r.consent_type === data.consent_type &&
              r.version === data.version
          )
        ) {
          throw new FakeUniqueConstraintError();
        }
        const row: FakeRow = { id: `cc-${nextId++}`, ...data };
        rows.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where, orderBy }) => {
        const matches = sortByOrderBy(
          rows.filter((r) => r.contact_id === where.contact_id && r.consent_type === where.consent_type),
          orderBy
        );
        return matches[0] ?? null;
      }),
      findMany: jest.fn(async ({ where, orderBy }) => {
        return sortByOrderBy(
          rows.filter((r) => r.contact_id === where.contact_id && r.consent_type === where.consent_type),
          orderBy
        );
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

// ═══════════════════════════════════════════════════════════════════════
// T-R17 — remediation of a T-38 QC finding (§9.2): consent-version race.
// ═══════════════════════════════════════════════════════════════════════

describe('T-R17 (a): deterministic ordering when two rows share a version', () => {
  test('hasMessagingConsent picks the row with the LATER timestamp, not whichever the DB scan happens to return first', async () => {
    const { client, rows } = makeFakeLedgerClient();

    // Both rows share version 1 (the exact race this unit fixes: two concurrent captureConsent
    // calls both computing "next version = 1" before either write was visible to the other). The
    // stale grant is pushed into the backing array FIRST; the TRUE latest event, by real
    // wall-clock time — a revoke — is pushed SECOND.
    rows.push({
      id: 'cc-0',
      user_id: 'rep-1',
      contact_id: 'contact-race',
      consent_type: MESSAGING_TCPA_CONSENT_TYPE,
      given: true, // the stale grant — earlier in real time, and FIRST in array/insertion order
      version: 1,
      timestamp: new Date('2026-07-20T10:00:00.000Z'),
    });
    rows.push({
      id: 'cc-1',
      user_id: 'rep-1',
      contact_id: 'contact-race',
      consent_type: MESSAGING_TCPA_CONSENT_TYPE,
      given: false, // the real latest event: a revoke — later in real time, SECOND in array order
      version: 1,
      timestamp: new Date('2026-07-20T10:00:05.000Z'),
    });

    // TEETH, made concrete: a version-ONLY comparator (the pre-fix `orderBy: {version:'desc'}`,
    // with no tiebreak) sorts these two tied rows by array order alone — a JS stable sort leaves
    // ties exactly where they started — and would surface the STALE grant as "current".
    const naiveVersionOnlySort = [...rows].sort((a, b) => b.version - a.version);
    expect(naiveVersionOnlySort[0]).toMatchObject({ given: true }); // the WRONG "current" row

    // The REAL ledger, using the actual multi-key orderBy, must NOT reproduce that wrong answer.
    const ledger = new MessagingConsentLedger(client);
    expect(await ledger.hasMessagingConsent('contact-race')).toBe(false);
  });

  test('a true tie (same version AND same timestamp) still resolves deterministically via the id tiebreak, regardless of array/scan order', async () => {
    const tiedTimestamp = new Date('2026-07-20T10:00:00.000Z');
    const rowLow: FakeRow = {
      id: 'cc-0',
      user_id: 'rep-1',
      contact_id: 'contact-tie',
      consent_type: MESSAGING_TCPA_CONSENT_TYPE,
      given: true,
      version: 1,
      timestamp: tiedTimestamp,
    };
    const rowHigh: FakeRow = {
      id: 'cc-1',
      user_id: 'rep-1',
      contact_id: 'contact-tie',
      consent_type: MESSAGING_TCPA_CONSENT_TYPE,
      given: false,
      version: 1,
      timestamp: tiedTimestamp,
    };

    // Same two rows, opposite array order — a real DB gives no scan-order guarantee for ties, so
    // "current consent" must not depend on which order the two rows happen to come back in.
    const { client: clientA } = makeFakeLedgerClient();
    clientA.complianceConsent.findFirst = jest.fn(async ({ where, orderBy }) => {
      const matches = [rowLow, rowHigh].filter(
        (r) => r.contact_id === where.contact_id && r.consent_type === where.consent_type
      );
      return sortByOrderBy(matches, orderBy)[0] ?? null;
    });

    const { client: clientB } = makeFakeLedgerClient();
    clientB.complianceConsent.findFirst = jest.fn(async ({ where, orderBy }) => {
      const matches = [rowHigh, rowLow].filter(
        (r) => r.contact_id === where.contact_id && r.consent_type === where.consent_type
      );
      return sortByOrderBy(matches, orderBy)[0] ?? null;
    });

    const ledgerA = new MessagingConsentLedger(clientA);
    const ledgerB = new MessagingConsentLedger(clientB);

    const resultA = await ledgerA.hasMessagingConsent('contact-tie');
    const resultB = await ledgerB.hasMessagingConsent('contact-tie');

    // Both orderings must agree — `id desc` (cc-1 > cc-0) always wins, independent of array order.
    expect(resultA).toBe(resultB);
    expect(resultA).toBe(false); // rowHigh (cc-1, given: false) is the deterministic "current" row
  });
});

describe('T-R17 (b): the per-contact DB unique prevents a duplicate (contact_id, consent_type, version)', () => {
  test('a raw duplicate create for the SAME non-null contact_id + consent_type + version is rejected (models the DB @@unique)', async () => {
    const { client } = makeFakeLedgerClient();

    await client.complianceConsent.create({
      data: {
        user_id: 'rep-1',
        contact_id: 'contact-dupe',
        consent_type: MESSAGING_TCPA_CONSENT_TYPE,
        given: true,
        version: 1,
        timestamp: new Date(),
      },
    });

    await expect(
      client.complianceConsent.create({
        data: {
          user_id: 'rep-1',
          contact_id: 'contact-dupe',
          consent_type: MESSAGING_TCPA_CONSENT_TYPE,
          given: true,
          version: 1, // SAME (contact_id, consent_type, version) tuple — must be rejected
          timestamp: new Date(),
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('captureConsent RECOVERS from a real version race: a stale read that would have collided retries and lands on the correct next version', async () => {
    const { client, rows } = makeFakeLedgerClient();

    // Simulate the race directly: a concurrent writer's version-1 row is already durably
    // committed, but THIS call's first read is stale (as if it ran just before that commit became
    // visible) and sees nothing yet.
    rows.push({
      id: 'cc-0',
      user_id: 'rep-2',
      contact_id: 'contact-race-2',
      consent_type: MESSAGING_TCPA_CONSENT_TYPE,
      given: true,
      version: 1,
      timestamp: new Date('2026-07-20T10:00:00.000Z'),
    });

    let findFirstCalls = 0;
    const realFindFirst = client.complianceConsent.findFirst;
    client.complianceConsent.findFirst = jest.fn(async (args) => {
      findFirstCalls += 1;
      if (findFirstCalls === 1) return null; // stale: the concurrent writer's row isn't visible yet
      return (realFindFirst as typeof client.complianceConsent.findFirst)(args);
    });

    const ledger = new MessagingConsentLedger(client);
    const record = await ledger.captureConsent('rep-2', 'contact-race-2', false, { source: 'api' });

    // TEETH: without the DB @@unique + retry, this stale first read would have computed
    // version = 1 and either silently duplicated the pre-existing version-1 row (the exact T-38 QC
    // finding) or thrown outright. With the fix, the first create() attempt collides (P2002), the
    // ledger retries, its SECOND read sees the real current state, and the call still succeeds —
    // landing on version 2, never a second version-1 row.
    expect(record.version).toBe(2);
    expect(rows.filter((r) => r.contact_id === 'contact-race-2')).toHaveLength(2);
    expect(rows.filter((r) => r.contact_id === 'contact-race-2' && r.version === 1)).toHaveLength(1);
    expect(client.complianceConsent.create).toHaveBeenCalledTimes(2); // 1 collision + 1 success
  });

  test('a non-collision error is NOT swallowed/retried — only P2002 triggers a retry', async () => {
    const { client } = makeFakeLedgerClient();
    client.complianceConsent.create = jest.fn(async () => {
      throw new Error('connection reset');
    });

    const ledger = new MessagingConsentLedger(client);
    await expect(ledger.captureConsent('rep-1', 'contact-1', true)).rejects.toThrow('connection reset');
    expect(client.complianceConsent.create).toHaveBeenCalledTimes(1); // no retry loop for a non-race error
  });
});

describe('T-R17 (c): WP11 onboarding consent (contact_id = null) is NOT constrained by the new unique — regression guard', () => {
  test('multiple contact_id:null rows sharing the SAME consent_type + version coexist (Postgres NULL-is-distinct) — the real WP11 shape', async () => {
    const { client, rows } = makeFakeLedgerClient();

    // This is exactly what src/lib/onboarding/gdpr-consent.ts's grantGdprConsent/revokeGdprConsent
    // write: contact_id is never set (-> NULL), and version is never set either (-> the schema
    // default, 1, on EVERY row — WP11's real versioning lives in ConsentManager's in-process Map,
    // not this column). Multiple grant/revoke events for the SAME user therefore already produce
    // multiple (contact_id: null, consent_type: 'gdpr', version: 1) rows today, and must go on
    // doing so after this migration.
    const gdprRowShape = {
      user_id: 'user-onboarding-1',
      contact_id: null as unknown as string, // cast only to satisfy the per-contact-typed fake signature
      consent_type: 'gdpr',
      given: true,
      version: 1,
      timestamp: new Date(),
    };

    await client.complianceConsent.create({ data: gdprRowShape });
    await client.complianceConsent.create({ data: { ...gdprRowShape, given: false } }); // revoke
    await client.complianceConsent.create({ data: { ...gdprRowShape, given: true } }); // re-grant

    // TEETH: if the unique constraint were a plain `@@unique` WITHOUT Postgres's NULL-distinct
    // default (or modeled wrong in this fake), the second create above would have thrown P2002 —
    // it must not. All three rows persist.
    expect(rows.filter((r) => r.contact_id === null && r.consent_type === 'gdpr')).toHaveLength(3);
  });

  test('a null-contact row and a real-contact row never collide with each other even at the same version', async () => {
    const { client, rows } = makeFakeLedgerClient();

    await client.complianceConsent.create({
      data: {
        user_id: 'user-1',
        contact_id: null as unknown as string,
        consent_type: MESSAGING_TCPA_CONSENT_TYPE,
        given: true,
        version: 1,
        timestamp: new Date(),
      },
    });

    // Same consent_type, same version, but a REAL contact_id — must succeed; the null row above is
    // not "using up" version 1 for this (or any) contact.
    await expect(
      client.complianceConsent.create({
        data: {
          user_id: 'user-1',
          contact_id: 'contact-real',
          consent_type: MESSAGING_TCPA_CONSENT_TYPE,
          given: true,
          version: 1,
          timestamp: new Date(),
        },
      })
    ).resolves.toMatchObject({ version: 1 });

    expect(rows).toHaveLength(2);
  });
});

describe('T-R17 (d): hasMessagingConsent is still fail-closed after the ordering change', () => {
  test('no record -> false; a read failure -> false; only a confirmed given:true current record -> true', async () => {
    const { client } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);

    expect(await ledger.hasMessagingConsent('contact-none')).toBe(false);

    await ledger.captureConsent('rep-1', 'contact-yes', true);
    expect(await ledger.hasMessagingConsent('contact-yes')).toBe(true);

    await ledger.revokeConsent('rep-1', 'contact-yes');
    expect(await ledger.hasMessagingConsent('contact-yes')).toBe(false);

    const failingClient: MessagingConsentPrismaClient = {
      complianceConsent: {
        create: jest.fn(),
        findFirst: jest.fn(async () => {
          throw new Error('pool exhausted');
        }),
        findMany: jest.fn(),
      },
    };
    expect(await new MessagingConsentLedger(failingClient).hasMessagingConsent('contact-x')).toBe(false);
  });
});

describe('T-R17 (e): every read path sends the EXACT, real CURRENT_CONSENT_ORDER_BY — not a substitute', () => {
  // These assertions pin the ledger's actual `orderBy` argument (imported straight from
  // `messaging-consent-ledger.ts`, not re-typed here) on all three call sites that read "current
  // consent". A revert to `orderBy: [{version:'desc'}]` (or dropping/reordering any key) fails
  // these directly — independent of, and in addition to, the sort-behavior teeth in T-R17(a) above.

  test('captureConsent\'s pre-write "what is the current version" read uses CURRENT_CONSENT_ORDER_BY', async () => {
    const { client } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);

    await ledger.captureConsent('rep-1', 'contact-1', true);

    expect(client.complianceConsent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: CURRENT_CONSENT_ORDER_BY })
    );
  });

  test('hasMessagingConsent\'s lookup uses CURRENT_CONSENT_ORDER_BY', async () => {
    const { client } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);

    await ledger.hasMessagingConsent('contact-1');

    expect(client.complianceConsent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: CURRENT_CONSENT_ORDER_BY })
    );
  });

  test('getHistory\'s findMany uses CURRENT_CONSENT_ORDER_BY', async () => {
    const { client } = makeFakeLedgerClient();
    const ledger = new MessagingConsentLedger(client);

    await ledger.getHistory('contact-1');

    expect(client.complianceConsent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: CURRENT_CONSENT_ORDER_BY })
    );
  });
});
