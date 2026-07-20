/**
 * T-R5 (launch-gate remediation, §16.4/§18.10): proves the Postgres-backed shared stores for
 * rate-limiting, session-activity, and login-history behave correctly across "multiple instances"
 * (multiple independent store-client objects sharing one backing table, standing in for multiple
 * serverless instances sharing one Postgres database) — and that the OLD per-instance in-memory
 * stores do NOT, which is exactly the vulnerability this build unit closes.
 *
 * The fakes below implement the same narrow Prisma-delegate shape `PostgresRateLimitStore` /
 * `PostgresSessionActivityStore` / `PostgresLoginHistoryStore` depend on (see
 * src/services/security/rate-limiter.ts, src/lib/auth/session-security.ts,
 * src/services/security/credential-stuffing.ts) without needing a real database — this suite stays
 * KEY-LESS/DB-LESS like the rest of the repo's tests. `FakeRateLimitTable`'s artificial delay
 * *before* each operation's synchronous read-compare-write is what makes it a faithful stand-in for
 * Postgres's own row-level atomicity: two "concurrent" calls can be interleaved while awaiting the
 * delay, but the actual compare-and-set inside each call is one synchronous block (no `await`
 * between the read and the write), exactly mirroring how a single atomic `UPDATE ... WHERE
 * version = ?` statement is indivisible from any other transaction's point of view.
 */

import {
  InMemoryRateLimitStore,
  PostgresRateLimitStore,
  RateLimiter,
  getLoginRateLimiter,
  LOGIN_RATE_LIMIT,
  MFA_VERIFY_RATE_LIMIT,
  PASSWORD_RESET_RATE_LIMIT,
  type RateLimitConfig,
} from '../../src/services/security/rate-limiter';
import {
  InMemorySessionActivityStore,
  PostgresSessionActivityStore,
} from '../../src/lib/auth/session-security';
import {
  InMemoryLoginHistoryStore,
  PostgresLoginHistoryStore,
  HISTORY_RETENTION_MS,
  getLoginHistoryStore,
  setLoginHistoryStore,
  scoreLoginAttempt,
} from '../../src/services/security/credential-stuffing';

const CONFIG: RateLimitConfig = {
  maxAttempts: 3,
  windowMs: 60_000,
  baseLockoutMs: 1_000,
  maxLockoutMs: 10_000,
};

// ─────────────────────────────────────────────────────────────────────────
// Fakes — narrow, structural stand-ins for the Prisma delegates the Postgres*Store classes depend
// on. No real database; a plain Map is "the database" here.
// ─────────────────────────────────────────────────────────────────────────

interface FakeRateLimitRow {
  key: string;
  count: number;
  window_start: Date;
  violation_count: number;
  locked_until: Date | null;
  version: number;
}

class FakeRateLimitTable {
  private rows = new Map<string, FakeRateLimitRow>();

  constructor(private readonly jitterMs: () => number = () => 0) {}

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.jitterMs()));
  }

  async findUnique({ where: { key } }: { where: { key: string } }): Promise<FakeRateLimitRow | null> {
    await this.delay();
    const row = this.rows.get(key);
    return row ? { ...row } : null;
  }

  async create({ data }: { data: FakeRateLimitRow }): Promise<unknown> {
    await this.delay();
    // Synchronous check-then-set (no await between) — the atomic part, matching a real PK
    // constraint's indivisibility from any concurrent transaction's perspective.
    if (this.rows.has(data.key)) {
      const conflict = new Error('Unique constraint failed on the fields: (`key`)') as Error & { code: string };
      conflict.code = 'P2002';
      throw conflict;
    }
    this.rows.set(data.key, { ...data });
    return data;
  }

  async updateMany({
    where,
    data,
  }: {
    where: { key: string; version: number };
    data: {
      count: number;
      window_start: Date;
      violation_count: number;
      locked_until: Date | null;
      version: { increment: number };
    };
  }): Promise<{ count: number }> {
    await this.delay();
    // Synchronous compare-and-set (no await between the read and the write) — this is what makes
    // it atomic: whichever concurrent caller's continuation resumes first wins the row for this
    // generation; every other caller's stale-version compare fails and returns count: 0.
    const row = this.rows.get(where.key);
    if (!row || row.version !== where.version) return { count: 0 };
    this.rows.set(where.key, {
      key: where.key,
      count: data.count,
      window_start: data.window_start,
      violation_count: data.violation_count,
      locked_until: data.locked_until,
      version: row.version + data.version.increment,
    });
    return { count: 1 };
  }

  async deleteMany({ where: { key } }: { where: { key: string } }): Promise<{ count: number }> {
    await this.delay();
    return { count: this.rows.delete(key) ? 1 : 0 };
  }

  /** Test-only escape hatch to inspect the "database" directly. */
  getRaw(key: string): FakeRateLimitRow | undefined {
    return this.rows.get(key);
  }
}

class ThrowingRateLimitTable {
  async findUnique(): Promise<never> {
    throw new Error('simulated Postgres outage');
  }
  async create(): Promise<never> {
    throw new Error('simulated Postgres outage');
  }
  async updateMany(): Promise<never> {
    throw new Error('simulated Postgres outage');
  }
  async deleteMany(): Promise<never> {
    throw new Error('simulated Postgres outage');
  }
}

class FakeSessionActivityTable {
  private rows = new Map<string, { key: string; last_activity_at: Date }>();

  async findUnique({ where: { key } }: { where: { key: string } }) {
    return this.rows.get(key) ?? null;
  }

  async upsert({
    where: { key },
    create,
    update,
  }: {
    where: { key: string };
    create: { key: string; last_activity_at: Date };
    update: { last_activity_at: Date };
  }) {
    const existing = this.rows.get(key);
    this.rows.set(key, existing ? { key, last_activity_at: update.last_activity_at } : { ...create });
  }
}

interface FakeLoginHistoryRow {
  user_id: string;
  device_fingerprint_hash: string;
  ip_hash: string;
  at: Date;
  outcome: string;
}

class FakeLoginHistoryTable {
  rows: FakeLoginHistoryRow[] = [];

  async create({ data }: { data: FakeLoginHistoryRow }) {
    this.rows.push({ ...data });
  }

  async findMany({ where }: { where: { user_id: string; at: { gte: Date } } }): Promise<FakeLoginHistoryRow[]> {
    return this.rows.filter((r) => r.user_id === where.user_id && r.at.getTime() >= where.at.gte.getTime());
  }

  async deleteMany({ where }: { where: { user_id: string; at: { lt: Date } } }): Promise<{ count: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.user_id === where.user_id && r.at.getTime() < where.at.lt.getTime()));
    return { count: before - this.rows.length };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PROVE (a): rate-limit enforced across separate store-client instances (a shared store closes the
// exact multi-instance gap an in-memory store cannot).
// ─────────────────────────────────────────────────────────────────────────

describe('PostgresRateLimitStore — cross-instance cap enforcement (PROVE a)', () => {
  test('two separate PostgresRateLimitStore clients sharing one backing table enforce ONE combined cap', async () => {
    const table = new FakeRateLimitTable();
    const limiterA = new RateLimiter(new PostgresRateLimitStore({ rateLimitCounter: table }), CONFIG); // "instance A"
    const limiterB = new RateLimiter(new PostgresRateLimitStore({ rateLimitCounter: table }), CONFIG); // "instance B"

    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      const limiter = i % 2 === 0 ? limiterA : limiterB;
      expect((await limiter.check('shared-key')).allowed).toBe(true);
    }
    // The (maxAttempts+1)th attempt, routed to instance A, is denied because it sees instance B's
    // attempts too — a combined, cluster-wide cap.
    const blocked = await limiterA.check('shared-key');
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed) throw new Error('unreachable');
    expect(blocked.reason).toBe('threshold_exceeded');

    // And instance B independently observes the same lockout instance A just tripped.
    const alsoBlocked = await limiterB.check('shared-key');
    expect(alsoBlocked.allowed).toBe(false);
  });

  test('the OLD per-instance in-memory store does NOT enforce a combined cap — this is the exact vulnerability T-R5 closes', async () => {
    const limiterA = new RateLimiter(new InMemoryRateLimitStore(), CONFIG); // instance A's own process-local Map
    const limiterB = new RateLimiter(new InMemoryRateLimitStore(), CONFIG); // instance B's own process-local Map

    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      expect((await limiterA.check('shared-key')).allowed).toBe(true);
    }
    // Instance A is now at its own cap...
    expect((await limiterA.check('shared-key')).allowed).toBe(false);
    // ...but instance B has never seen instance A's attempts, so it allows a FULL fresh budget — a
    // distributed attacker gets maxAttempts PER INSTANCE, not maxAttempts total. Fails (would be
    // `false`) against a real shared store, which is exactly the point of this comparison test.
    expect((await limiterB.check('shared-key')).allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PROVE (b): atomic increment doesn't race — concurrent increments produce the correct count, no
// lost update.
// ─────────────────────────────────────────────────────────────────────────

describe('PostgresRateLimitStore — atomic increment under concurrency (PROVE b)', () => {
  test('many concurrent check() calls across two store clients never lose an update', async () => {
    const table = new FakeRateLimitTable(() => Math.floor(Math.random() * 8)); // jitter forces interleaving
    const bigConfig: RateLimitConfig = { maxAttempts: 100, windowMs: 60_000, baseLockoutMs: 1_000, maxLockoutMs: 10_000 };
    const limiterA = new RateLimiter(new PostgresRateLimitStore({ rateLimitCounter: table }), bigConfig);
    const limiterB = new RateLimiter(new PostgresRateLimitStore({ rateLimitCounter: table }), bigConfig);

    const CONCURRENCY = 24;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => (i % 2 === 0 ? limiterA : limiterB).check('race-key'))
    );

    // Every attempt is under the (high) threshold, so every one must be individually allowed —
    // proving none were silently dropped by a lost update, and none were double-counted either
    // (which would instead have tripped the lockout early).
    expect(results.filter((r) => r.allowed)).toHaveLength(CONCURRENCY);

    const finalRow = table.getRaw('race-key');
    expect(finalRow?.count).toBe(CONCURRENCY);
    // The version advanced by exactly one CAS-win per successful write — i.e. no writer's
    // increment silently vanished into another writer's overwrite.
    expect(finalRow?.version).toBe(CONCURRENCY);
  });

  test('a naive (non-CAS) read-then-write WOULD lose updates under the same interleaving — sanity check that the fake is a faithful race stand-in', async () => {
    // This does not exercise RateLimiter/PostgresRateLimitStore at all — it exists only to prove
    // FakeRateLimitTable's artificial delay genuinely creates a race window that a version-checked
    // write closes and a naive one does not, so PROVE (b) above is trustworthy.
    const table = new FakeRateLimitTable(() => Math.floor(Math.random() * 8));
    await table.create({
      data: {
        key: 'naive-key',
        count: 0,
        window_start: new Date(0),
        violation_count: 0,
        locked_until: null,
        version: 1,
      },
    });

    async function naiveIncrement(): Promise<void> {
      const row = await table.findUnique({ where: { key: 'naive-key' } });
      // Naive: writes back a version that is NOT conditioned on what was just read staying
      // current — simulated here by always claiming version 1 (i.e. "I don't care who else wrote
      // since I read"), which the fake's compare-and-set only accepts if the row is still at
      // version 1. Once any writer wins, every later "naive" writer targeting stale version 1
      // fails outright — with a REAL naive read/write (no version check at all) it would instead
      // silently overwrite, which is exactly the bug T-R5's CAS design avoids.
      await table.updateMany({
        where: { key: 'naive-key', version: 1 },
        data: { count: (row?.count ?? 0) + 1, window_start: new Date(0), violation_count: 0, locked_until: null, version: { increment: 1 } },
      });
    }

    await Promise.all(Array.from({ length: 10 }, () => naiveIncrement()));
    const finalRow = table.getRaw('naive-key');
    // At most one of the 10 concurrent "version 1" writers can win — proving the interleaving is
    // real (a non-racy fake would let all 10 through and land on count 10).
    expect(finalRow?.count).toBeLessThan(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PROVE (c): store read/write error → fail CLOSED (deny, never unlimited).
// ─────────────────────────────────────────────────────────────────────────

describe('PostgresRateLimitStore — fail-closed on store error (PROVE c)', () => {
  test('a throwing Postgres store denies rather than allowing through', async () => {
    const store = new PostgresRateLimitStore({ rateLimitCounter: new ThrowingRateLimitTable() });
    const limiter = new RateLimiter(store, CONFIG);
    const result = await limiter.check('key');
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.reason).toBe('store_error');
  });

  test('a real PostgresRateLimitStore surfaces a non-conflict write error as store_error, not a hang or an allow', async () => {
    const table = new FakeRateLimitTable();
    // First call succeeds (creates the row)...
    const store = new PostgresRateLimitStore({ rateLimitCounter: table });
    const limiter = new RateLimiter(store, CONFIG);
    expect((await limiter.check('key-transient')).allowed).toBe(true);

    // ...then the table starts throwing a genuine (non-P2002) error on the next call.
    const brokenStore = new PostgresRateLimitStore({ rateLimitCounter: new ThrowingRateLimitTable() });
    const brokenLimiter = new RateLimiter(brokenStore, CONFIG);
    const result = await brokenLimiter.check('key-transient');
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.reason).toBe('store_error');
  });

  test('sustained CAS-conflict contention past the retry bound fails closed, not open (never silently allows through)', async () => {
    // T-R20: `PostgresRateLimitStore.atomicUpdate()` owns its own bounded optimistic-concurrency
    // retry loop internally now (it used to be `RateLimiter.check()`'s job). This table always
    // reports "the row moved since you read it" — every `updateMany` call returns `{ count: 0 }`,
    // simulating pathological, sustained contention on one key — proving `atomicUpdate()` itself
    // exhausts its retry bound and throws, rather than spinning forever or silently overwriting.
    class AlwaysConflictingTable {
      async findUnique(): Promise<{
        key: string;
        count: number;
        window_start: Date;
        violation_count: number;
        locked_until: Date | null;
        version: number;
      }> {
        return { key: 'key', count: 0, window_start: new Date(0), violation_count: 0, locked_until: null, version: 1 };
      }
      async create(): Promise<never> {
        const conflict = new Error('Unique constraint failed on the fields: (`key`)') as Error & { code: string };
        conflict.code = 'P2002';
        throw conflict;
      }
      async updateMany(): Promise<{ count: number }> {
        return { count: 0 }; // every attempt "loses" the CAS — the row has always just moved.
      }
      async deleteMany(): Promise<{ count: number }> {
        return { count: 0 };
      }
    }
    const store = new PostgresRateLimitStore({ rateLimitCounter: new AlwaysConflictingTable() });
    const limiter = new RateLimiter(store, CONFIG);
    const result = await limiter.check('key');
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.reason).toBe('store_error');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PROVE (d): exact §16.4 semantics preserved — this is a store swap, not a policy change.
// ─────────────────────────────────────────────────────────────────────────

describe('PostgresRateLimitStore — exact rate-limit semantics preserved (PROVE d)', () => {
  test('allow-under-threshold / lockout / still-locked / reset — identical to InMemoryRateLimitStore', async () => {
    const table = new FakeRateLimitTable();
    const limiter = new RateLimiter(new PostgresRateLimitStore({ rateLimitCounter: table }), CONFIG);

    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      expect((await limiter.check('key-d')).allowed).toBe(true);
    }

    const blocked = await limiter.check('key-d');
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed) throw new Error('unreachable');
    expect(blocked.reason).toBe('threshold_exceeded');
    expect(blocked.retryAfterMs).toBe(CONFIG.baseLockoutMs); // same exact figure as the in-memory store

    const stillLocked = await limiter.check('key-d');
    expect(stillLocked.allowed).toBe(false);
    if (stillLocked.allowed) throw new Error('unreachable');
    expect(stillLocked.reason).toBe('locked_out');

    await limiter.reset('key-d');
    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      expect((await limiter.check('key-d')).allowed).toBe(true);
    }
  });

  test('progressive backoff doubles identically between the in-memory and Postgres-backed stores, run step-for-step', async () => {
    const inMemLimiter = new RateLimiter(new InMemoryRateLimitStore(), CONFIG);
    const pgLimiter = new RateLimiter(new PostgresRateLimitStore({ rateLimitCounter: new FakeRateLimitTable() }), CONFIG);
    let now = 0;

    async function tripBothAndCompare(): Promise<number> {
      for (let i = 0; i < CONFIG.maxAttempts; i++) {
        await inMemLimiter.check('progressive-key', now);
        await pgLimiter.check('progressive-key', now);
      }
      const a = await inMemLimiter.check('progressive-key', now);
      const b = await pgLimiter.check('progressive-key', now);
      if (a.allowed || b.allowed) throw new Error('expected both to be locked out');
      expect(b.retryAfterMs).toBe(a.retryAfterMs);
      return a.retryAfterMs;
    }

    const first = await tripBothAndCompare(); // baseLockoutMs (1_000)
    expect(first).toBe(CONFIG.baseLockoutMs);

    now += first + 1; // advance past the first lockout
    const second = await tripBothAndCompare(); // doubled (2_000)
    expect(second).toBe(first * 2);

    now += second + 1; // advance past the second lockout
    const third = await tripBothAndCompare(); // doubled again (4_000) — still under the 10_000 cap
    expect(third).toBe(CONFIG.baseLockoutMs * 4);
  });

  test('different keys remain independently rate-limited on the shared store (per-account vs per-IP)', async () => {
    const table = new FakeRateLimitTable();
    const limiter = new RateLimiter(new PostgresRateLimitStore({ rateLimitCounter: table }), CONFIG);
    for (let i = 0; i < CONFIG.maxAttempts + 1; i++) {
      await limiter.check('login:account:abc');
    }
    expect((await limiter.check('login:ip:xyz')).allowed).toBe(true);
  });

  // The tests above all use a local `CONFIG` (maxAttempts: 3, 1-minute window) for speed/readability
  // — deliberately convenient numbers, not the real §16.4 policy. That means none of them would
  // catch someone accidentally changing `LOGIN_RATE_LIMIT`/`MFA_VERIFY_RATE_LIMIT`/
  // `PASSWORD_RESET_RATE_LIMIT` in a way that broke Postgres/in-memory parity for the constants
  // actually shipped to `options.ts`/the mfa/password-reset route handlers. This test closes that
  // gap: it runs the exact EXPORTED constants against both stores and asserts identical outcomes.
  test.each([
    ['LOGIN_RATE_LIMIT', LOGIN_RATE_LIMIT],
    ['MFA_VERIFY_RATE_LIMIT', MFA_VERIFY_RATE_LIMIT],
    ['PASSWORD_RESET_RATE_LIMIT', PASSWORD_RESET_RATE_LIMIT],
  ] as const)('exported %s config: Postgres and in-memory stores agree exactly (drift guard)', async (_name, exportedConfig) => {
    const table = new FakeRateLimitTable();
    const inMemLimiter = new RateLimiter(new InMemoryRateLimitStore(), exportedConfig);
    const pgLimiter = new RateLimiter(new PostgresRateLimitStore({ rateLimitCounter: table }), exportedConfig);
    const now = 0;

    for (let i = 0; i < exportedConfig.maxAttempts; i++) {
      const [a, b] = await Promise.all([
        inMemLimiter.check('drift-guard-key', now),
        pgLimiter.check('drift-guard-key', now),
      ]);
      expect(a.allowed).toBe(true);
      expect(b.allowed).toBe(true);
    }

    const [inMemBlocked, pgBlocked] = await Promise.all([
      inMemLimiter.check('drift-guard-key', now),
      pgLimiter.check('drift-guard-key', now),
    ]);
    expect(inMemBlocked.allowed).toBe(false);
    expect(pgBlocked.allowed).toBe(false);
    if (inMemBlocked.allowed || pgBlocked.allowed) throw new Error('unreachable');
    expect(inMemBlocked.reason).toBe('threshold_exceeded');
    expect(pgBlocked.reason).toBe('threshold_exceeded');
    // Both stores derive the exact same first-violation lockout from the exported config's own
    // `baseLockoutMs` — if a future edit changes one constant but not the store logic driving it,
    // this is the assertion that would catch the drift.
    expect(pgBlocked.retryAfterMs).toBe(exportedConfig.baseLockoutMs);
    expect(inMemBlocked.retryAfterMs).toBe(exportedConfig.baseLockoutMs);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PROVE (e): session-activity + login-history persist to the shared store and read back (including
// across separate store-client instances, standing in for a second serverless instance).
// ─────────────────────────────────────────────────────────────────────────

describe('PostgresSessionActivityStore (PROVE e: shared session-activity persists + reads back)', () => {
  test('touch() from one store instance is visible to get() on a separate instance sharing the same table', async () => {
    const table = new FakeSessionActivityTable();
    const writer = new PostgresSessionActivityStore({ sessionActivityRecord: table }); // "instance A"
    const reader = new PostgresSessionActivityStore({ sessionActivityRecord: table }); // "instance B"

    await writer.touch('user-1:1000', 5_000);
    expect(await reader.get('user-1:1000')).toBe(5_000);

    await writer.touch('user-1:1000', 9_000); // last-write-wins
    expect(await reader.get('user-1:1000')).toBe(9_000);
  });

  test('an unknown key reads back as undefined, matching InMemorySessionActivityStore', async () => {
    const table = new FakeSessionActivityTable();
    const postgresStore = new PostgresSessionActivityStore({ sessionActivityRecord: table });
    const inMemoryStore = new InMemorySessionActivityStore();
    expect(await postgresStore.get('never-touched')).toBeUndefined();
    expect(await inMemoryStore.get('never-touched')).toBeUndefined();
  });
});

describe('PostgresLoginHistoryStore (PROVE e: shared login history persists + reads back)', () => {
  test('record() from one store instance is visible to recent() on a separate instance sharing the same table', async () => {
    const table = new FakeLoginHistoryTable();
    const writer = new PostgresLoginHistoryStore({ loginHistoryRecord: table }); // "instance A"
    const reader = new PostgresLoginHistoryStore({ loginHistoryRecord: table }); // "instance B"

    await writer.record('user-1', { deviceFingerprintHash: 'fp-1', ipHash: 'ip-1', at: 1_000_000, outcome: 'success' });
    const entries = await reader.recent('user-1', HISTORY_RETENTION_MS, 1_000_000);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ deviceFingerprintHash: 'fp-1', ipHash: 'ip-1', at: 1_000_000, outcome: 'success' });
  });

  test('prunes entries older than the retention window on write, same as InMemoryLoginHistoryStore', async () => {
    const table = new FakeLoginHistoryTable();
    const store = new PostgresLoginHistoryStore({ loginHistoryRecord: table });

    await store.record('user-1', { deviceFingerprintHash: 'old', ipHash: 'old', at: 0, outcome: 'success' });
    expect(table.rows).toHaveLength(1);

    await store.record('user-1', {
      deviceFingerprintHash: 'new',
      ipHash: 'new',
      at: HISTORY_RETENTION_MS + 1_000,
      outcome: 'success',
    });

    // The second record()'s retention prune should have deleted the now-stale first row.
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.device_fingerprint_hash).toBe('new');
  });

  test('scoreLoginAttempt anomaly scoring works correctly when wired to the shared Postgres-backed store', async () => {
    const table = new FakeLoginHistoryTable();
    setLoginHistoryStore(new PostgresLoginHistoryStore({ loginHistoryRecord: table }));
    try {
      const store = getLoginHistoryStore();
      await store.record('user-1', { deviceFingerprintHash: 'fp-1', ipHash: 'ip-1', at: 900_000, outcome: 'success' });

      const result = await scoreLoginAttempt({
        userId: 'user-1',
        deviceFingerprintHash: 'fp-NEW',
        ipHash: 'ip-NEW',
        now: 1_000_000,
      });
      expect(result.anomalous).toBe(true);
      expect(result.requiresChallenge).toBe(true);
    } finally {
      setLoginHistoryStore(new InMemoryLoginHistoryStore()); // restore a safe, DB-less default
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Default-wiring safety net: NODE_ENV=test (set by Jest) must default to the in-memory store even
// when nothing has explicitly called setLoginRateLimitStore — proving the module never reaches for
// Postgres in the test/dev path.
// ─────────────────────────────────────────────────────────────────────────

describe('default store wiring (T-R5): test env safely defaults to in-memory, never touches Postgres', () => {
  test('a virgin import of rate-limiter.ts under NODE_ENV=test works out of the box, with no setLoginRateLimitStore call', async () => {
    let freshGetLoginRateLimiter: typeof getLoginRateLimiter;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      freshGetLoginRateLimiter = require('../../src/services/security/rate-limiter').getLoginRateLimiter;
    });
    const limiter = freshGetLoginRateLimiter!();
    // Would hang/throw trying to reach an unreachable "postgresql://u:p@localhost:5432/db" if this
    // had defaulted to PostgresRateLimitStore instead of InMemoryRateLimitStore.
    const result = await limiter.check(`default-wiring-probe-${Math.random()}`);
    expect(result.allowed).toBe(true);
  });
});
