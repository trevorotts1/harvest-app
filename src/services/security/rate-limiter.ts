/**
 * Rate limiting & progressive-lockout primitive (T-12, master-spec §16.4/§18.10).
 *
 * §16.4: "per-IP and per-account rate limits on auth endpoints (login, password reset, MFA
 * challenge, registration) and on data-rights and billing endpoints; progressive backoff and
 * temporary lockout after a threshold of failures; a global limiter protects the CFE and
 * agent-dispatch paths from abuse."
 * §18.10: "an account/IP exceeding auth or data-rights limits gets progressive backoff then
 * temporary lockout with a clear, non-enumerating message and a SecurityEvent; legitimate users
 * have an unlock/verify path."
 *
 * FAIL-CLOSED: if the backing store throws (e.g. a transient store outage), `check()` returns
 * `{ allowed: false, reason: 'store_error' }` — deny, never allow-through. A rate limiter that
 * fails open under load is worse than no rate limiter, because a store outage is exactly the
 * moment a credential-stuffing burst is most likely to be underway.
 *
 * Store abstraction: `RateLimitStore` is intentionally minimal (get/put a single counter record)
 * so a production deployment can swap in a shared store without changing `RateLimiter` at all.
 * `InMemoryRateLimitStore` is process-local — an honest, documented limitation for a multi-instance
 * deployment (see SPEC_DEVIATIONS in the T-12 build report) — and remains the default for tests/dev
 * (no DB required). `PostgresRateLimitStore` (T-R5, launch-gate remediation) is the cluster-wide,
 * production default: on a multi-instance/serverless (Vercel) deploy, every instance was hitting
 * its own in-memory Map, so a distributed attacker could multiply their effective attempt budget
 * by the instance count — the shared Postgres-backed store closes that gap by making every
 * instance read/write the same row. Neither swap is ever a source of allow-through-on-failure,
 * which is the property this file's tests hold both stores to.
 *
 * Cross-instance atomicity: `RateLimiter.check()`'s get→mutate→put sequence is a classic
 * read-modify-write — naively replayed against a shared store, two instances racing on the same
 * key would both read the same count and one increment would be lost. `RateLimitRecord.version` is
 * an optimistic-concurrency token that closes this gap without changing `check()`'s external
 * behavior: `PostgresRateLimitStore.put()` performs a single atomic conditional
 * `UPDATE ... WHERE key = ? AND version = ?` (or, for a brand-new key, an INSERT whose PK conflict
 * is the concurrency signal) and throws `RateLimitConflictError` if another writer already moved
 * the row; `check()` catches that and retries with a fresh read (bounded by `MAX_CAS_RETRIES`,
 * failing closed on exhaustion) instead of silently overwriting a lost update.
 * `InMemoryRateLimitStore` never throws `RateLimitConflictError`, so this retry loop is a no-op for
 * it — the in-memory-backed tests below run with identical timing/behavior to before T-R5.
 */

import { prisma } from '@/lib/prisma';

export interface RateLimitRecord {
  /** Attempts recorded in the current window. */
  count: number;
  /** When the current counting window started (ms epoch). */
  windowStart: number;
  /** How many times this key has tripped the threshold and been locked out. */
  violationCount: number;
  /** ms-epoch until which this key is locked out; 0/undefined if not currently locked. */
  lockedUntil?: number;
  /**
   * Optimistic-concurrency token (T-R5). Present only when the backing store supports CAS writes
   * (any store shared across multiple instances/processes, e.g. `PostgresRateLimitStore`);
   * `InMemoryRateLimitStore` leaves it `undefined` on every record and never conflicts, since a
   * single process has nothing to race against. Never read/set by call-sites — purely internal
   * plumbing between `RateLimiter` and the store.
   */
  version?: number;
}

export interface RateLimitStore {
  get(key: string): Promise<RateLimitRecord | undefined>;
  /**
   * Writes `record`. A store that is shared across multiple instances/processes MUST perform this
   * atomically with respect to `record.version` — i.e. only succeed if the stored version still
   * matches what `get()` returned when this `record` was computed — and throw
   * `RateLimitConflictError` otherwise, so `RateLimiter.check()` can retry with a fresh read
   * instead of overwriting a concurrent writer's update. `InMemoryRateLimitStore` has nothing to
   * race against and never throws this.
   */
  put(key: string, record: RateLimitRecord): Promise<void>;
  /** Clears a key entirely — called on a successful auth to reset the failure counter. */
  delete(key: string): Promise<void>;
}

/**
 * Thrown by a CAS-capable `RateLimitStore.put()` when a concurrent writer already moved the row
 * since this `record` was read — i.e. "retry me," not "the store is broken." `RateLimiter.check()`
 * catches this specifically (distinct from a genuine store outage) and retries with a fresh read;
 * it is never surfaced to callers of `check()`.
 */
export class RateLimitConflictError extends Error {
  constructor(key: string) {
    super(`RateLimitStore: concurrent write conflict on key "${key}" — retry with a fresh read.`);
    this.name = 'RateLimitConflictError';
  }
}

/** Process-local store. See the file-level doc comment for the multi-instance caveat. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private records = new Map<string, RateLimitRecord>();

  async get(key: string): Promise<RateLimitRecord | undefined> {
    const record = this.records.get(key);
    return record ? { ...record } : undefined;
  }

  async put(key: string, record: RateLimitRecord): Promise<void> {
    this.records.set(key, { ...record });
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  /** Test helper only. */
  clear(): void {
    this.records.clear();
  }
}

export interface RateLimitConfig {
  /** Attempts allowed within `windowMs` before the key is locked out. */
  maxAttempts: number;
  /** Rolling window in which attempts are counted. */
  windowMs: number;
  /** Lockout duration applied on the first violation. */
  baseLockoutMs: number;
  /** Doubled per repeated violation (exponential backoff), capped at this value. */
  maxLockoutMs: number;
}

export type RateLimitDeniedReason = 'locked_out' | 'threshold_exceeded' | 'store_error';

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: RateLimitDeniedReason; retryAfterMs: number };

/** §16.4 auth-endpoint defaults: 5 attempts / 5-minute window, 1-minute base lockout doubling to 1 hour. */
export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 5 * 60 * 1000,
  baseLockoutMs: 60 * 1000,
  maxLockoutMs: 60 * 60 * 1000,
};

/** MFA-verify is tighter — a correct TOTP code is only 10^6 possibilities and a low attempt budget matters. */
export const MFA_VERIFY_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 5 * 60 * 1000,
  baseLockoutMs: 2 * 60 * 1000,
  maxLockoutMs: 60 * 60 * 1000,
};

/** Password reset requests — looser (legitimate users retry), but still bounded against abuse/enumeration probing. */
export const PASSWORD_RESET_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 3,
  windowMs: 15 * 60 * 1000,
  baseLockoutMs: 5 * 60 * 1000,
  maxLockoutMs: 60 * 60 * 1000,
};

/**
 * Bound on the optimistic-concurrency retry loop in `RateLimiter.check()` (T-R5). Under realistic
 * contention (a handful of instances racing on one hot key) this converges in 1-2 iterations; this
 * cap exists only so sustained, pathological contention fails closed instead of spinning forever —
 * see `check()`'s final `denyOnStoreError` call below.
 */
const MAX_CAS_RETRIES = 20;

/** A tiny, randomized yield between CAS retries so a herd of colliding writers desynchronizes
 *  instead of retrying in lockstep. Not a real sleep under normal (uncontended) operation — this
 *  only ever runs when `store.put()` has actually thrown a conflict. */
function yieldToConcurrentWriter(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));
}

export class RateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly config: RateLimitConfig
  ) {}

  /**
   * Records one attempt against `key` and returns whether it is allowed. Always call this before
   * doing the expensive/sensitive work it guards (password compare, TOTP verify, reset-token
   * issuance) so a locked-out key never reaches that work at all.
   *
   * T-R5: the store may be shared across multiple instances/processes, so the get→mutate→put
   * sequence below is wrapped in a bounded optimistic-concurrency retry loop — see the
   * `RateLimitConflictError` doc comment. Against `InMemoryRateLimitStore` (which never throws it)
   * this loop always returns on its first iteration, identical to pre-T-R5 behavior.
   */
  async check(key: string, now: number = Date.now()): Promise<RateLimitResult> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      let record: RateLimitRecord | undefined;
      try {
        record = await this.store.get(key);
      } catch (error) {
        return this.denyOnStoreError(error);
      }

      if (record?.lockedUntil && now < record.lockedUntil) {
        return { allowed: false, reason: 'locked_out', retryAfterMs: record.lockedUntil - now };
      }

      // Fresh record, the counting window has rolled over, or a prior lockout has just now been
      // served (`lockedUntil` is in the past) — any of these starts a new counting window. The
      // lockout-just-served case matters even when the *original* window hasn't otherwise elapsed:
      // without it, the stale over-threshold `count` from the violation that caused the lockout
      // would still be sitting there, so the very next check after the lockout expires would
      // immediately re-trip another (doubled) lockout instead of granting a fresh set of attempts —
      // i.e. the account would stay effectively locked for the rest of the original window no
      // matter how long it had already served. `violationCount` is preserved either way, so a
      // repeat offender's *next* violation still gets the doubled backoff. `version` is preserved
      // too (T-R5) — this is still a write against whatever row `get()` just read, fresh window or
      // not, so the CAS check must be against that row's version, not treated as a brand-new key.
      const lockoutJustServed = Boolean(record?.lockedUntil && now >= record.lockedUntil);
      if (!record || lockoutJustServed || now - record.windowStart > this.config.windowMs) {
        record = { count: 0, windowStart: now, violationCount: record?.violationCount ?? 0, version: record?.version };
      }

      record.count += 1;

      if (record.count > this.config.maxAttempts) {
        record.violationCount += 1;
        const lockoutMs = Math.min(
          this.config.baseLockoutMs * 2 ** (record.violationCount - 1),
          this.config.maxLockoutMs
        );
        record.lockedUntil = now + lockoutMs;

        try {
          await this.store.put(key, record);
        } catch (error) {
          if (error instanceof RateLimitConflictError) {
            await yieldToConcurrentWriter();
            continue;
          }
          return this.denyOnStoreError(error);
        }

        return { allowed: false, reason: 'threshold_exceeded', retryAfterMs: lockoutMs };
      }

      try {
        await this.store.put(key, record);
      } catch (error) {
        if (error instanceof RateLimitConflictError) {
          await yieldToConcurrentWriter();
          continue;
        }
        return this.denyOnStoreError(error);
      }

      return { allowed: true };
    }

    // Sustained contention exhausted every retry — fail closed rather than risk a lost update
    // (the same posture as a genuine store outage: deny, never allow-through on uncertainty).
    return this.denyOnStoreError(
      new Error(`RateLimiter: exhausted ${MAX_CAS_RETRIES} optimistic-concurrency retries for key "${key}"`)
    );
  }

  /** Call on a successful, legitimate auth to clear the failure counter for `key`. */
  async reset(key: string): Promise<void> {
    try {
      await this.store.delete(key);
    } catch {
      // Best-effort: failing to clear a counter is not a security problem (fail-closed only
      // matters for *denying*, never for the cleanup path), so this is intentionally swallowed.
    }
  }

  private denyOnStoreError(error: unknown): RateLimitResult {
    // eslint-disable-next-line no-console
    console.error('RateLimiter store error — FAIL-CLOSED (denying):', (error as Error)?.message ?? error);
    return { allowed: false, reason: 'store_error', retryAfterMs: this.config.baseLockoutMs };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Postgres-backed shared store (T-R5) — the cluster-wide production default. Uses the existing
// Prisma/DATABASE_URL (no new infra, no new operator secret). Narrow delegate type (mirrors the
// `PrismaLike`/`AuditEntryPrismaDelegate` convention elsewhere in this codebase, e.g.
// src/services/agent-runtime/cost-killswitch/budget-store.ts) so this file depends on nothing more
// than the one model it touches.
// ─────────────────────────────────────────────────────────────────────────

interface RateLimitCounterRow {
  key: string;
  count: number;
  window_start: Date;
  violation_count: number;
  locked_until: Date | null;
  version: number;
}

interface RateLimitCounterDelegate {
  findUnique(args: { where: { key: string } }): Promise<RateLimitCounterRow | null>;
  create(args: { data: Omit<RateLimitCounterRow, 'locked_until'> & { locked_until: Date | null } }): Promise<unknown>;
  updateMany(args: {
    where: { key: string; version: number };
    data: {
      count: number;
      window_start: Date;
      violation_count: number;
      locked_until: Date | null;
      version: { increment: number };
    };
  }): Promise<{ count: number }>;
  deleteMany(args: { where: { key: string } }): Promise<{ count: number }>;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  // Prisma's error code for a unique/PK constraint violation (P2002) — see
  // https://www.prisma.io/docs/orm/reference/error-reference. Checked structurally rather than via
  // `instanceof PrismaClientKnownRequestError` so this file never needs to import that class just
  // to classify one error code.
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'P2002');
}

/**
 * Cluster-wide `RateLimitStore` backed by the `RateLimitCounter` table (see prisma/schema.prisma
 * and this file's header doc comment for the atomicity design). Lazily bound to the shared Prisma
 * client — see `createDefaultRateLimitStore()` below; never constructed at module scope.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  // Lazy default: the shared singleton (src/lib/prisma.ts), never constructed at module scope
  // here — same convention as PrismaBudgetKillSwitchStore
  // (src/services/agent-runtime/cost-killswitch/budget-store.ts). The class itself is likewise
  // never instantiated at module scope (see `createDefaultRateLimitStore` below) — only lazily, the
  // first time a request handler actually needs the default rate limiter.
  constructor(
    private readonly db: { rateLimitCounter: RateLimitCounterDelegate } = prisma as unknown as {
      rateLimitCounter: RateLimitCounterDelegate;
    }
  ) {}

  async get(key: string): Promise<RateLimitRecord | undefined> {
    const row = await this.db.rateLimitCounter.findUnique({ where: { key } });
    if (!row) return undefined;
    return {
      count: row.count,
      windowStart: row.window_start.getTime(),
      violationCount: row.violation_count,
      lockedUntil: row.locked_until ? row.locked_until.getTime() : undefined,
      version: row.version,
    };
  }

  async put(key: string, record: RateLimitRecord): Promise<void> {
    const shared = {
      count: record.count,
      window_start: new Date(record.windowStart),
      violation_count: record.violationCount,
      locked_until: record.lockedUntil ? new Date(record.lockedUntil) : null,
    };

    if (record.version === undefined) {
      // No version means `get()` returned nothing for this key — this is the first write. Insert;
      // if another instance already inserted the same key first, the table's own primary-key
      // constraint turns that race into a conflict (P2002) rather than a silent overwrite.
      try {
        await this.db.rateLimitCounter.create({ data: { key, version: 1, ...shared } });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) throw new RateLimitConflictError(key);
        throw error;
      }
      return;
    }

    // Conditional update: only succeeds if the row's version still matches what `get()` returned.
    // A single atomic UPDATE statement — Postgres itself serializes concurrent writers on this row,
    // so exactly one writer's conditional matches per generation; the other(s) get `count: 0` back.
    const result = await this.db.rateLimitCounter.updateMany({
      where: { key, version: record.version },
      data: { ...shared, version: { increment: 1 } },
    });
    if (result.count === 0) throw new RateLimitConflictError(key);
  }

  async delete(key: string): Promise<void> {
    // `deleteMany` (not `delete`) so clearing an already-cleared/never-existed key is a no-op
    // rather than a thrown "record not found" — `RateLimiter.reset()` already treats any store
    // error here as best-effort, but there is no reason to manufacture one.
    await this.db.rateLimitCounter.deleteMany({ where: { key } });
  }
}

/**
 * Chooses the default store for a given endpoint's rate limiter (T-R5): the process-local
 * in-memory store for tests (no DB available/needed — every existing test that cares about
 * rate-limiting already calls `setLoginRateLimitStore`/`setMfaVerifyRateLimitStore`/
 * `setPasswordResetRateLimitStore` explicitly in `beforeEach`, so this path is a safety net, not
 * the primary route, for those) and local dev without a `DATABASE_URL`; the cluster-wide
 * Postgres-backed store everywhere else (production, preview, CI-with-a-real-DB) — the whole point
 * of this build unit.
 */
function createDefaultRateLimitStore(): RateLimitStore {
  if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) {
    return new InMemoryRateLimitStore();
  }
  return new PostgresRateLimitStore();
}

// ─────────────────────────────────────────────────────────────────────────
// Named singletons for the three §16.4 auth endpoints this unit gates (login, MFA-verify,
// password-reset). Each endpoint's store is independently settable so tests can inject a
// throwing store (fail-closed proof) or reset state between cases without affecting the others;
// production code (options.ts, the mfa/password-reset route handlers) calls the getters directly
// rather than constructing its own `RateLimiter`, so every call-site shares one counter per key.
//
// T-R5: each store is lazily defaulted on first access (never at module scope — see
// `createDefaultRateLimitStore` above) rather than eagerly constructed here, so a test/dev
// environment (no `DATABASE_URL`) never constructs a `PostgresRateLimitStore` at all.
// ─────────────────────────────────────────────────────────────────────────

let loginRateLimitStore: RateLimitStore | undefined;
let mfaVerifyRateLimitStore: RateLimitStore | undefined;
let passwordResetRateLimitStore: RateLimitStore | undefined;

export function setLoginRateLimitStore(store: RateLimitStore): void {
  loginRateLimitStore = store;
}
export function getLoginRateLimiter(): RateLimiter {
  if (!loginRateLimitStore) loginRateLimitStore = createDefaultRateLimitStore();
  return new RateLimiter(loginRateLimitStore, LOGIN_RATE_LIMIT);
}

export function setMfaVerifyRateLimitStore(store: RateLimitStore): void {
  mfaVerifyRateLimitStore = store;
}
export function getMfaVerifyRateLimiter(): RateLimiter {
  if (!mfaVerifyRateLimitStore) mfaVerifyRateLimitStore = createDefaultRateLimitStore();
  return new RateLimiter(mfaVerifyRateLimitStore, MFA_VERIFY_RATE_LIMIT);
}

export function setPasswordResetRateLimitStore(store: RateLimitStore): void {
  passwordResetRateLimitStore = store;
}
export function getPasswordResetRateLimiter(): RateLimiter {
  if (!passwordResetRateLimitStore) passwordResetRateLimitStore = createDefaultRateLimitStore();
  return new RateLimiter(passwordResetRateLimitStore, PASSWORD_RESET_RATE_LIMIT);
}
