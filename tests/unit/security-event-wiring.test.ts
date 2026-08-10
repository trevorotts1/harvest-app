import { emitSecurityEvent } from '../../src/services/security/security-event';

/**
 * R-19 regression suite — default SecurityEvent-sink wiring.
 *
 * R-19: before this build, the module-level default sink in
 * `src/services/security/security-event.ts` was unconditionally an
 * `InMemorySecurityEventSink`, so in production every `emitSecurityEvent` call (login
 * success/failure, MFA, password-reset, session-revoke, rate-limit, privilege-escalation — the
 * §16.4 "every auth/session event written to SecurityEvent" stream) wrote only to the
 * process-local array and **0 SecurityEvent rows ever reached the DB**. Fail-open by design, so
 * sign-in was never blocked — the audit trail was just silently empty (the admin audit/security
 * viewer R-56 shows nothing).
 *
 * The fix applies the T-R5 convention the sibling security stores already use
 * (`createDefaultSessionActivityStore` in src/lib/auth/session-security.ts,
 * `createDefaultLoginHistoryStore` in src/services/security/credential-stuffing.ts): a lazily
 * defaulted sink that is process-local in-memory under `NODE_ENV=test` or a missing
 * `DATABASE_URL`, and the Prisma-backed sink everywhere else. Every existing test still calls
 * `setSecurityEventSink(new InMemorySecurityEventSink())` in its own `beforeEach`, so nothing
 * else changes behavior — these suites only pin down the DEFAULT path.
 *
 * Mirrors `tests/unit/shared-store.test.ts`'s "default store wiring (T-R5)" describe block: a
 * fresh `jest.isolateModules` import of the module so the (now lazy) default is chosen from a
 * virgin module state, never from a prior `setSecurityEventSink` call in this file.
 */
describe('R-19: default SecurityEvent sink wiring — test env never touches Postgres; prod defaults to Prisma-backed', () => {
  // `process.env.NODE_ENV` is typed read-only by @types/node — tests must assign through a
  // mutable-record cast (same convention the import-safety suites use to delete DATABASE_URL).
  const env = process.env as Record<string, string | undefined>;
  const saved = {
    nodeEnv: process.env.NODE_ENV,
    dbUrl: process.env.DATABASE_URL,
  };

  afterEach(() => {
    if (saved.nodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = saved.nodeEnv;
    if (saved.dbUrl === undefined) delete env.DATABASE_URL;
    else env.DATABASE_URL = saved.dbUrl;
  });

  function virginGetSink(): { get: () => unknown; emit: typeof emitSecurityEvent } {
    let get: (() => unknown) | undefined;
    let emit: typeof emitSecurityEvent | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../../src/services/security/security-event');
      get = mod.getSecurityEventSink as () => unknown;
      emit = mod.emitSecurityEvent as typeof emitSecurityEvent;
    });
    return { get: get!, emit: emit! };
  }

  test('a virgin import under NODE_ENV=test with DATABASE_URL SET defaults to the in-memory sink — emits and reads back, no Postgres', async () => {
    // The previously-broken shape of the bug: DATABASE_URL present (as in prod) but the sink
    // silently in-memory. In the TEST env the selector must STILL pick in-memory — a virgin
    // import must never reach for Postgres (would hang/throw on the unreachable URL).
    env.NODE_ENV = 'test';
    env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/harvest';

    const { get, emit } = virginGetSink();
    const sink = get() as { constructor: { name: string }; all: () => unknown[] };

    expect(sink.constructor.name).toBe('InMemorySecurityEventSink');
    await emit({ type: 'login_success', userId: 'user-1', severity: 'INFO' });
    const all = sink.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ user_id: 'user-1', type: 'login_success' });
  });

  test('a virgin import under NODE_ENV=production with DATABASE_URL SET defaults to the Prisma-backed sink', async () => {
    // The R-19 fix itself: in production, the default is the REAL sink that persists
    // SecurityEvent rows to the DB (feeds the admin audit/security viewer, R-56). The sink is
    // only CONSTRUCTED — never emitted into here, so no DB connection/query is made.
    env.NODE_ENV = 'production';
    env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/harvest';

    const { get } = virginGetSink();
    const sink = get() as { constructor: { name: string } };

    expect(sink.constructor.name).toBe('PrismaSecurityEventSink');
  });

  test('a virgin import without DATABASE_URL defaults to the in-memory sink regardless of NODE_ENV (local dev without a DB)', async () => {
    delete env.DATABASE_URL;
    env.NODE_ENV = 'development';

    const { get } = virginGetSink();
    const sink = get() as { constructor: { name: string } };

    expect(sink.constructor.name).toBe('InMemorySecurityEventSink');
  });
});
