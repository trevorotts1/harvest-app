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
 * so a production deployment can swap in a shared, TTL-aware store (Redis/Upstash — the natural
 * fit for a multi-instance Vercel deployment) without changing `RateLimiter` at all.
 * `InMemoryRateLimitStore` is the default and is what this module runs on today; it is
 * process-local, which is an honest, documented limitation for a multi-instance deployment (see
 * SPEC_DEVIATIONS in the T-12 build report) — but it is never a source of allow-through-on-failure,
 * which is the property this file's tests hold it to.
 */

export interface RateLimitRecord {
  /** Attempts recorded in the current window. */
  count: number;
  /** When the current counting window started (ms epoch). */
  windowStart: number;
  /** How many times this key has tripped the threshold and been locked out. */
  violationCount: number;
  /** ms-epoch until which this key is locked out; 0/undefined if not currently locked. */
  lockedUntil?: number;
}

export interface RateLimitStore {
  get(key: string): Promise<RateLimitRecord | undefined>;
  put(key: string, record: RateLimitRecord): Promise<void>;
  /** Clears a key entirely — called on a successful auth to reset the failure counter. */
  delete(key: string): Promise<void>;
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

export class RateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly config: RateLimitConfig
  ) {}

  /**
   * Records one attempt against `key` and returns whether it is allowed. Always call this before
   * doing the expensive/sensitive work it guards (password compare, TOTP verify, reset-token
   * issuance) so a locked-out key never reaches that work at all.
   */
  async check(key: string, now: number = Date.now()): Promise<RateLimitResult> {
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
    // repeat offender's *next* violation still gets the doubled backoff.
    const lockoutJustServed = Boolean(record?.lockedUntil && now >= record.lockedUntil);
    if (!record || lockoutJustServed || now - record.windowStart > this.config.windowMs) {
      record = { count: 0, windowStart: now, violationCount: record?.violationCount ?? 0 };
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
        return this.denyOnStoreError(error);
      }

      return { allowed: false, reason: 'threshold_exceeded', retryAfterMs: lockoutMs };
    }

    try {
      await this.store.put(key, record);
    } catch (error) {
      return this.denyOnStoreError(error);
    }

    return { allowed: true };
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
// Named singletons for the three §16.4 auth endpoints this unit gates (login, MFA-verify,
// password-reset). Each endpoint's store is independently settable so tests can inject a
// throwing store (fail-closed proof) or reset state between cases without affecting the others;
// production code (options.ts, the mfa/password-reset route handlers) calls the getters directly
// rather than constructing its own `RateLimiter`, so every call-site shares one counter per key.
// ─────────────────────────────────────────────────────────────────────────

let loginRateLimitStore: RateLimitStore = new InMemoryRateLimitStore();
let mfaVerifyRateLimitStore: RateLimitStore = new InMemoryRateLimitStore();
let passwordResetRateLimitStore: RateLimitStore = new InMemoryRateLimitStore();

export function setLoginRateLimitStore(store: RateLimitStore): void {
  loginRateLimitStore = store;
}
export function getLoginRateLimiter(): RateLimiter {
  return new RateLimiter(loginRateLimitStore, LOGIN_RATE_LIMIT);
}

export function setMfaVerifyRateLimitStore(store: RateLimitStore): void {
  mfaVerifyRateLimitStore = store;
}
export function getMfaVerifyRateLimiter(): RateLimiter {
  return new RateLimiter(mfaVerifyRateLimitStore, MFA_VERIFY_RATE_LIMIT);
}

export function setPasswordResetRateLimitStore(store: RateLimitStore): void {
  passwordResetRateLimitStore = store;
}
export function getPasswordResetRateLimiter(): RateLimiter {
  return new RateLimiter(passwordResetRateLimitStore, PASSWORD_RESET_RATE_LIMIT);
}
