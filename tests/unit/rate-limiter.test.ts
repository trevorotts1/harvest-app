import {
  InMemoryRateLimitStore,
  RateLimiter,
  type RateLimitConfig,
  type RateLimitRecord,
  type RateLimitStore,
} from '../../src/services/security/rate-limiter';

const CONFIG: RateLimitConfig = {
  maxAttempts: 3,
  windowMs: 60_000,
  baseLockoutMs: 1_000,
  maxLockoutMs: 10_000,
};

class ThrowingRateLimitStore implements RateLimitStore {
  async get(): Promise<RateLimitRecord | undefined> {
    throw new Error('simulated store outage');
  }
  async put(): Promise<void> {
    throw new Error('simulated store outage');
  }
  async delete(): Promise<void> {
    throw new Error('simulated store outage');
  }
}

/**
 * Proves (T-12 build brief, PROVE item c): "rate limiter locks after N attempts + fail-closed on
 * store error." Every assertion here fails if the lockout/fail-closed logic is removed or
 * weakened — the point of these tests, per the build brief, is that they have teeth.
 */
describe('RateLimiter (§16.4/§18.10 rate limiting + progressive lockout)', () => {
  test('allows attempts under the threshold', async () => {
    const limiter = new RateLimiter(new InMemoryRateLimitStore(), CONFIG);
    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      const result = await limiter.check('key-a');
      expect(result.allowed).toBe(true);
    }
  });

  test('locks out after exceeding maxAttempts within the window', async () => {
    const limiter = new RateLimiter(new InMemoryRateLimitStore(), CONFIG);
    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      expect((await limiter.check('key-b')).allowed).toBe(true);
    }
    const blocked = await limiter.check('key-b');
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed) throw new Error('unreachable');
    expect(blocked.reason).toBe('threshold_exceeded');
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  test('remains locked for subsequent checks until the lockout window elapses', async () => {
    const store = new InMemoryRateLimitStore();
    const limiter = new RateLimiter(store, CONFIG);
    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      await limiter.check('key-c');
    }
    await limiter.check('key-c'); // trips the lockout

    const stillLocked = await limiter.check('key-c');
    expect(stillLocked.allowed).toBe(false);
    if (stillLocked.allowed) throw new Error('unreachable');
    expect(stillLocked.reason).toBe('locked_out');
  });

  test('progressive backoff: repeated violations double the lockout duration up to the cap', async () => {
    const store = new InMemoryRateLimitStore();
    const limiter = new RateLimiter(store, CONFIG);
    let now = 0;

    // First violation.
    for (let i = 0; i < CONFIG.maxAttempts; i++) await limiter.check('key-d', now);
    const firstViolation = await limiter.check('key-d', now);
    if (firstViolation.allowed) throw new Error('expected first violation to lock out');
    expect(firstViolation.retryAfterMs).toBe(CONFIG.baseLockoutMs); // 1_000

    // Advance past the first lockout, trip a second violation.
    now += CONFIG.baseLockoutMs + 1;
    for (let i = 0; i < CONFIG.maxAttempts; i++) await limiter.check('key-d', now);
    const secondViolation = await limiter.check('key-d', now);
    if (secondViolation.allowed) throw new Error('expected second violation to lock out');
    expect(secondViolation.retryAfterMs).toBe(CONFIG.baseLockoutMs * 2); // 2_000 — doubled

    // Advance past the second lockout, trip a third violation — still capped at maxLockoutMs.
    now += CONFIG.baseLockoutMs * 2 + 1;
    for (let i = 0; i < CONFIG.maxAttempts; i++) await limiter.check('key-d', now);
    const thirdViolation = await limiter.check('key-d', now);
    if (thirdViolation.allowed) throw new Error('expected third violation to lock out');
    expect(thirdViolation.retryAfterMs).toBe(CONFIG.baseLockoutMs * 4); // 4_000 — still under cap (10_000)
  });

  test('FAIL-CLOSED: a throwing store denies rather than allowing through', async () => {
    const limiter = new RateLimiter(new ThrowingRateLimitStore(), CONFIG);
    const result = await limiter.check('key-e');
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('unreachable');
    expect(result.reason).toBe('store_error');
  });

  test('reset() clears the counter so a successful auth is not penalized by prior failures', async () => {
    const store = new InMemoryRateLimitStore();
    const limiter = new RateLimiter(store, CONFIG);
    await limiter.check('key-f');
    await limiter.check('key-f');
    await limiter.reset('key-f');
    // Should behave as a fresh key — maxAttempts more checks all allowed.
    for (let i = 0; i < CONFIG.maxAttempts; i++) {
      expect((await limiter.check('key-f')).allowed).toBe(true);
    }
  });

  test('different keys are rate-limited independently (per-account vs per-IP)', async () => {
    const store = new InMemoryRateLimitStore();
    const limiter = new RateLimiter(store, CONFIG);
    for (let i = 0; i < CONFIG.maxAttempts + 1; i++) {
      await limiter.check('login:account:abc');
    }
    // A different key (e.g. a different IP) is unaffected by the first key's lockout.
    expect((await limiter.check('login:ip:xyz')).allowed).toBe(true);
  });
});
