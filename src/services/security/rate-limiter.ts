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
 * Store abstraction: `RateLimitStore` is intentionally minimal (one atomic read-transition-write
 * primitive plus a delete) so a production deployment can swap in a shared store without changing
 * `RateLimiter` at all. `InMemoryRateLimitStore` is process-local — an honest, documented
 * limitation for a multi-instance deployment (see SPEC_DEVIATIONS in the T-12 build report) — and
 * remains the default for tests/dev (no DB required). `PostgresRateLimitStore` (T-R5, launch-gate
 * remediation) is the cluster-wide, production default: on a multi-instance/serverless (Vercel)
 * deploy, every instance was hitting its own in-memory Map, so a distributed attacker could
 * multiply their effective attempt budget by the instance count — the shared Postgres-backed store
 * closes that gap by making every instance read/write the same row. Neither swap is ever a source
 * of allow-through-on-failure, which is the property this file's tests hold both stores to.
 *
 * Atomicity (T-R20 hardening): every `check()` call performs exactly ONE store operation —
 * `RateLimitStore.atomicUpdate(key, transition)` — where `transition` is a pure, synchronous
 * function computing "what should the new record be, and is this hit allowed" from whatever the
 * store considers "current" for `key`. `RateLimiter` itself never reads a record, mutates it in its
 * own scope, and writes it back as two separate *awaited* store calls — that shape (`get()` ...
 * business logic ... `put()`) is exactly what T-R20 removes, because any two separate `await`s
 * around a shared mutable key are a lost-update hazard even within a single Node process: `await`
 * always yields to the microtask queue, so N concurrent `check()` calls on the same key can all
 * read the SAME stale count before any of them writes, each independently compute "count + 1", and
 * each overwrite the others — losing every increment but one and letting a burst sail past
 * `maxAttempts` with zero denials. (Reproduced pre-fix: 20 concurrent `check()` calls against a
 * limit of 3 came back 20-for-20 allowed, with a persisted count of 1.) Folding the entire
 * read-transition-write into one store call closes this: `InMemoryRateLimitStore.atomicUpdate()`
 * has no `await` anywhere in its body, so it runs to completion in a single synchronous span of the
 * event loop — no other `check()` call can observe or mutate the key in between, by construction,
 * not by luck. `PostgresRateLimitStore.atomicUpdate()` performs the equivalent read-transition-write
 * as a single method call too; internally it retries against Postgres's own row-level atomicity (an
 * optimistic-concurrency `version` token: a single atomic conditional `UPDATE ... WHERE key = ? AND
 * version = ?`, or an INSERT whose PK conflict is the concurrency signal for a brand-new key) —
 * bounded by `MAX_CAS_RETRIES`, failing closed on exhaustion rather than ever risking a lost update.
 * That retry loop is now entirely `PostgresRateLimitStore`'s own internal concern:
 * `RateLimiter.check()` has no awareness of retries, conflicts, or CAS at all post-T-R20 — it calls
 * `atomicUpdate()` once and fails closed on whatever error (if any) comes out.
 *
 * This file's atomicity is per-key, per-store. The SHARED-store-across-instances concern (every
 * serverless instance racing on the same Postgres row) is T-R5's job, already covered above and
 * orthogonal to T-R20: T-R20 is about a single `atomicUpdate()` call never losing a concurrent
 * increment, regardless of how many stores/instances are or aren't sharing state underneath it.
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
   * Optimistic-concurrency token, internal to `PostgresRateLimitStore` (T-R5/T-R20). Present only
   * when the backing store performs its own CAS writes; `InMemoryRateLimitStore` leaves it
   * `undefined` on every record, since its atomicity comes from having no `await` in its critical
   * section at all — not from version-checking. Never read/set by call-sites — purely internal
   * plumbing between `PostgresRateLimitStore` and its own retry loop.
   */
  version?: number;
}

/**
 * A pure, synchronous function from "whatever the store currently has for this key" to "what
 * should be persisted" — a store may invoke this as many times as it needs (e.g. once per internal
 * retry against a concurrently-modified row), but it must never do so with two different callers'
 * views of "current" interleaved. Returning the exact `current` reference unchanged signals "no
 * state actually changed" (e.g. still locked out) — a store MAY use that to skip its write.
 */
export type RateLimitTransition = (current: RateLimitRecord | undefined) => RateLimitRecord;

export interface RateLimitStore {
  /**
   * Atomically reads the current record for `key`, applies `transition` to it, persists whatever
   * `transition` returns, and resolves to that same record — as ONE indivisible operation from any
   * other `atomicUpdate` call's point of view, no matter how many are racing on the same `key`. A
   * store MUST guarantee no concurrent `atomicUpdate` call for the same `key` can read a value, or
   * land a write, in between this call's own read and write.
   */
  atomicUpdate(key: string, transition: RateLimitTransition): Promise<RateLimitRecord>;
  /** Clears a key entirely — called on a successful auth to reset the failure counter. */
  delete(key: string): Promise<void>;
}

/**
 * Thrown internally by `PostgresRateLimitStore.atomicUpdate()` when a concurrent writer already
 * moved the row since this attempt's read — i.e. "retry me," not "the store is broken." Caught and
 * retried within `atomicUpdate()` itself (bounded by `MAX_CAS_RETRIES`); never escapes to
 * `RateLimiter.check()`, which has no notion of CAS conflicts at all post-T-R20 — any error out of
 * `atomicUpdate()` is treated uniformly as fail-closed.
 */
class RateLimitConflictError extends Error {
  constructor(key: string) {
    super(`RateLimitStore: concurrent write conflict on key "${key}" — retry with a fresh read.`);
    this.name = 'RateLimitConflictError';
  }
}

/**
 * Process-local store. See the file-level doc comment for the multi-instance caveat and for how
 * this store achieves atomicity (T-R20): `atomicUpdate()` has no `await` in its body.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private records = new Map<string, RateLimitRecord>();

  async atomicUpdate(key: string, transition: RateLimitTransition): Promise<RateLimitRecord> {
    // No `await` anywhere below: the read, the (pure, synchronous) `transition`, and the write all
    // execute within one synchronous span of the event loop. However many `check()` calls are
    // racing on `key` (e.g. via Promise.all), each one's ENTIRE read-transition-write runs to
    // completion before the next one even starts — there is no yield point in between for another
    // call to interleave. This is what actually closes the lost-update hazard, not merely "JS is
    // single-threaded" (which alone does NOT protect two separate *awaited* store calls with
    // caller-side logic sandwiched between them — see the file header).
    const current = this.records.get(key);
    const currentSnapshot = current ? { ...current } : undefined;
    const next = transition(currentSnapshot);
    this.records.set(key, { ...next });
    return next;
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  /** Test helper only: inspect a key's persisted record without going through `RateLimiter`. */
  peek(key: string): RateLimitRecord | undefined {
    const record = this.records.get(key);
    return record ? { ...record } : undefined;
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
 * The entire §16.4 policy — window rollover, progressive lockout, threshold enforcement — as one
 * pure function, shared verbatim by every `RateLimitStore.atomicUpdate()` implementation. Given the
 * same `(current, now, config)` it always computes the same `(next record, RateLimitResult)`
 * regardless of which store calls it, which is what guarantees `InMemoryRateLimitStore` and
 * `PostgresRateLimitStore` can never drift apart on semantics (see the "exact semantics preserved"
 * tests) — swapping the store changes nothing about the policy itself.
 */
function applyRateLimitTransition(
  current: RateLimitRecord | undefined,
  now: number,
  config: RateLimitConfig
): { next: RateLimitRecord; result: RateLimitResult } {
  if (current?.lockedUntil && now < current.lockedUntil) {
    // Still locked out: return `current` BY REFERENCE, unchanged — the signal a store can use to
    // skip the write entirely (nothing new to persist, and repeated probes during a lockout
    // shouldn't churn the store on every hit).
    return {
      next: current,
      result: { allowed: false, reason: 'locked_out', retryAfterMs: current.lockedUntil - now },
    };
  }

  // Fresh record, the counting window has rolled over, or a prior lockout has just now been served
  // (`lockedUntil` is in the past) — any of these starts a new counting window. The
  // lockout-just-served case matters even when the *original* window hasn't otherwise elapsed:
  // without it, the stale over-threshold `count` from the violation that caused the lockout would
  // still be sitting there, so the very next check after the lockout expires would immediately
  // re-trip another (doubled) lockout instead of granting a fresh set of attempts — i.e. the
  // account would stay effectively locked for the rest of the original window no matter how long it
  // had already served. `violationCount` is preserved either way, so a repeat offender's *next*
  // violation still gets the doubled backoff. `version` is preserved too — a store that uses it
  // (`PostgresRateLimitStore`) is still writing against whatever row it just read, fresh window or
  // not, so its CAS check must be against that row's version, not treated as a brand-new key.
  const lockoutJustServed = Boolean(current?.lockedUntil && now >= current.lockedUntil);
  const record: RateLimitRecord =
    !current || lockoutJustServed || now - current.windowStart > config.windowMs
      ? { count: 0, windowStart: now, violationCount: current?.violationCount ?? 0, version: current?.version }
      : { ...current };

  record.count += 1;

  if (record.count > config.maxAttempts) {
    record.violationCount += 1;
    const lockoutMs = Math.min(config.baseLockoutMs * 2 ** (record.violationCount - 1), config.maxLockoutMs);
    record.lockedUntil = now + lockoutMs;
    return { next: record, result: { allowed: false, reason: 'threshold_exceeded', retryAfterMs: lockoutMs } };
  }

  return { next: record, result: { allowed: true } };
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
   * T-R20: this performs exactly ONE store operation — `store.atomicUpdate()`, the atomic
   * read-transition-write itself; `check()` supplies only the (pure, synchronous) §16.4 policy via
   * `applyRateLimitTransition` and trusts the store to apply it without losing a concurrent update.
   * Any error out of `atomicUpdate()` (a genuine store outage, or a store's own retry budget
   * exhausted under sustained contention) is treated identically: fail closed.
   */
  async check(key: string, now: number = Date.now()): Promise<RateLimitResult> {
    let result: RateLimitResult | undefined;
    try {
      await this.store.atomicUpdate(key, (current) => {
        const transition = applyRateLimitTransition(current, now, this.config);
        result = transition.result;
        return transition.next;
      });
    } catch (error) {
      return this.denyOnStoreError(error);
    }
    return result as RateLimitResult;
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

function rowToRecord(row: RateLimitCounterRow): RateLimitRecord {
  return {
    count: row.count,
    windowStart: row.window_start.getTime(),
    violationCount: row.violation_count,
    lockedUntil: row.locked_until ? row.locked_until.getTime() : undefined,
    version: row.version,
  };
}

/**
 * Bound on `PostgresRateLimitStore.atomicUpdate()`'s internal optimistic-concurrency retry loop
 * (T-R5/T-R20). Under realistic contention (a handful of instances racing on one hot key) this
 * converges in 1-2 iterations; this cap exists only so sustained, pathological contention fails
 * closed instead of spinning forever.
 */
const MAX_CAS_RETRIES = 20;

/** A tiny, randomized yield between CAS retries so a herd of colliding writers desynchronizes
 *  instead of retrying in lockstep. Not a real sleep under normal (uncontended) operation — this
 *  only ever runs when a write has actually conflicted with a concurrent writer. */
function yieldToConcurrentWriter(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));
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

  /**
   * One atomic read-transition-write per hit (T-R20): reads the row, hands it to `transition`, and
   * persists whatever comes back via a single conditional write — the write only succeeds if
   * nothing else has moved the row since the read (a version-guarded `UPDATE`, or the row's own
   * primary key for a brand-new insert), so no update is ever silently lost. On a conflict this
   * retries with a completely fresh read (never reuses stale state); sustained conflict past
   * `MAX_CAS_RETRIES` throws, which `RateLimiter.check()` treats as a store error and fails closed —
   * never spins forever, never allows through.
   */
  async atomicUpdate(key: string, transition: RateLimitTransition): Promise<RateLimitRecord> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const row = await this.db.rateLimitCounter.findUnique({ where: { key } });
      const current = row ? rowToRecord(row) : undefined;
      const next = transition(current);

      if (next === current) {
        // `transition` declined to change anything (e.g. still locked out) — nothing to persist,
        // and nothing that could conflict, so we're done.
        return next;
      }

      const shared = {
        count: next.count,
        window_start: new Date(next.windowStart),
        violation_count: next.violationCount,
        locked_until: next.lockedUntil ? new Date(next.lockedUntil) : null,
      };

      try {
        if (next.version === undefined) {
          // No version means the read above found nothing for this key — this is the first write.
          // Insert; if another instance already inserted the same key first, the table's own
          // primary-key constraint turns that race into a conflict (P2002) rather than a silent
          // overwrite.
          await this.db.rateLimitCounter.create({ data: { key, version: 1, ...shared } });
        } else {
          // Conditional update: only succeeds if the row's version still matches what was just
          // read. A single atomic UPDATE statement — Postgres itself serializes concurrent writers
          // on this row, so exactly one writer's conditional matches per generation.
          const result = await this.db.rateLimitCounter.updateMany({
            where: { key, version: next.version },
            data: { ...shared, version: { increment: 1 } },
          });
          if (result.count === 0) throw new RateLimitConflictError(key);
        }
        return next;
      } catch (error) {
        if (isUniqueConstraintViolation(error) || error instanceof RateLimitConflictError) {
          await yieldToConcurrentWriter();
          continue;
        }
        throw error;
      }
    }

    // Sustained contention exhausted every retry — fail closed rather than risk a lost update (the
    // caller's `denyOnStoreError` gives this the same posture as a genuine store outage: deny,
    // never allow-through on uncertainty).
    throw new Error(`PostgresRateLimitStore: exhausted ${MAX_CAS_RETRIES} optimistic-concurrency retries for key "${key}"`);
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
