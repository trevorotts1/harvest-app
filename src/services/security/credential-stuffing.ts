/**
 * Credential-stuffing defense (T-12, master-spec §16.4/§18.10):
 *   - "breached-password screening at set/reset time"
 *   - "anomaly scoring on login (new device/geo/velocity → step-up MFA or challenge)"
 *   - "CAPTCHA/turnstile-class challenge on suspicious bursts" (surfaced here as a
 *     `requiresChallenge` flag; rendering an actual CAPTCHA widget is a frontend concern outside
 *     this backend build unit's scope)
 *
 * This builds on T-04's existing timing-equalization work in src/lib/auth/options.ts (the dummy
 * bcrypt compare on the "no such user" path) — that defends against enumeration-by-timing; this
 * module defends against the credential-stuffing *volume* attack itself (reused breached
 * passwords, scripted login bursts, new-device/new-geo takeover attempts).
 *
 * `LoginHistoryStore` (below) was `InMemoryLoginHistoryStore`-only, which is process-local: on a
 * multi-instance deploy, each instance only ever saw *its own* slice of a user's login history, so
 * anomaly scoring (new-device/new-IP/velocity) could under-detect depending on which instance
 * happened to handle a given request. `PostgresLoginHistoryStore` (T-R5, launch-gate remediation)
 * is the cluster-wide default that closes this gap behind the same `LoginHistoryStore` interface.
 */

import { prisma } from '@/lib/prisma';

// ─────────────────────────────────────────────────────────────────────────
// Breached-password screening
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pluggable breached-password check. `StaticBreachedPasswordList` (below) is the default,
 * fully-offline implementation — no live service call, per this unit's "no live services/keys
 * needed" build constraint. A production deployment MAY swap in a k-anonymity range query against
 * a breach-corpus API (e.g. the HIBP Pwned Passwords range API, which never transmits the full
 * password or hash) by implementing this same interface; nothing else in this module or its
 * call-sites would need to change.
 */
export interface BreachedPasswordChecker {
  isBreached(password: string): Promise<boolean>;
}

/**
 * A small, offline list of extremely common breached/guessable passwords (the top entries that
 * recur across essentially every public credential-dump analysis — "password", "123456", etc.).
 * This is deliberately not exhaustive; it exists to fail closed on the most trivially-guessable
 * passwords without any network dependency. Matching is case-insensitive.
 */
const COMMON_BREACHED_PASSWORDS: ReadonlySet<string> = new Set(
  [
    'password',
    'password1',
    'password123',
    '123456',
    '123456789',
    '12345678',
    '1234567890',
    'qwerty',
    'qwerty123',
    'letmein',
    'admin123',
    'welcome1',
    'iloveyou',
    'abc123',
    '111111',
    '123123',
    'monkey',
    '1234567',
    'dragon',
    'sunshine',
    'master',
    'football',
    'baseball',
    'superman',
    'trustno1',
    'princess',
    'solo123',
    'starwars',
    'freedom',
    'whatever',
    'changeme',
    'passw0rd',
  ].map((p) => p.toLowerCase())
);

export class StaticBreachedPasswordList implements BreachedPasswordChecker {
  async isBreached(password: string): Promise<boolean> {
    return COMMON_BREACHED_PASSWORDS.has(password.toLowerCase());
  }
}

let activeBreachedPasswordChecker: BreachedPasswordChecker = new StaticBreachedPasswordList();

export function setBreachedPasswordChecker(checker: BreachedPasswordChecker): void {
  activeBreachedPasswordChecker = checker;
}

export function getBreachedPasswordChecker(): BreachedPasswordChecker {
  return activeBreachedPasswordChecker;
}

// ─────────────────────────────────────────────────────────────────────────
// Login anomaly scoring (new device / new "geo" proxy / velocity)
// ─────────────────────────────────────────────────────────────────────────

export interface LoginHistoryEntry {
  deviceFingerprintHash: string;
  ipHash: string;
  at: number; // ms epoch
  /**
   * Whether this attempt actually authenticated. "Known device/IP" recognition below only
   * considers `success` entries — otherwise an attacker could "train" their own fingerprint/IP
   * into looking recognized simply by making a handful of failed attempts before the real
   * credential-stuffing attempt, defeating the anomaly check it's supposed to feed. `failure`
   * entries still count toward velocity (a burst of failures IS the signal velocity looks for).
   */
  outcome: 'success' | 'failure';
}

/** Bounded per-user login history — enough to recognize "have we seen this device/IP before". */
export interface LoginHistoryStore {
  recent(userId: string, sinceMs: number, now?: number): Promise<LoginHistoryEntry[]>;
  record(userId: string, entry: LoginHistoryEntry): Promise<void>;
}

// Exported (T-R5) so `PostgresLoginHistoryStore` below can prune by the exact same window rather
// than duplicating the magic number.
export const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class InMemoryLoginHistoryStore implements LoginHistoryStore {
  private history = new Map<string, LoginHistoryEntry[]>();

  async recent(userId: string, sinceMs: number, now: number = Date.now()): Promise<LoginHistoryEntry[]> {
    const entries = this.history.get(userId) ?? [];
    return entries.filter((e) => e.at >= now - sinceMs);
  }

  async record(userId: string, entry: LoginHistoryEntry): Promise<void> {
    const entries = this.history.get(userId) ?? [];
    entries.push(entry);
    const cutoff = entry.at - HISTORY_RETENTION_MS;
    this.history.set(
      userId,
      entries.filter((e) => e.at >= cutoff)
    );
  }

  clear(): void {
    this.history.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Postgres-backed shared store (T-R5, launch-gate remediation, §16.4/§18.10). `record()` is a
// plain INSERT — atomic by construction, no read-then-write race to guard against (contrast
// `PostgresRateLimitStore`'s counter, which does need optimistic concurrency). The retention prune
// after each insert mirrors `InMemoryLoginHistoryStore.record`'s behavior exactly (same cutoff, same
// "relative to this entry's own `at`" semantics) so swapping stores never changes what a caller
// observes from `recent()`.
// ─────────────────────────────────────────────────────────────────────────

interface LoginHistoryRow {
  device_fingerprint_hash: string;
  ip_hash: string;
  at: Date;
  outcome: string;
}

interface LoginHistoryDelegate {
  findMany(args: { where: { user_id: string; at: { gte: Date } } }): Promise<LoginHistoryRow[]>;
  create(args: {
    data: { user_id: string; device_fingerprint_hash: string; ip_hash: string; at: Date; outcome: string };
  }): Promise<unknown>;
  deleteMany(args: { where: { user_id: string; at: { lt: Date } } }): Promise<{ count: number }>;
}

/**
 * Cluster-wide `LoginHistoryStore` backed by the `LoginHistoryRecord` table. Lazily bound to the
 * shared Prisma client (src/lib/prisma.ts) — never constructed at module scope; see
 * `createDefaultLoginHistoryStore` below.
 */
export class PostgresLoginHistoryStore implements LoginHistoryStore {
  constructor(
    private readonly db: { loginHistoryRecord: LoginHistoryDelegate } = prisma as unknown as {
      loginHistoryRecord: LoginHistoryDelegate;
    }
  ) {}

  async recent(userId: string, sinceMs: number, now: number = Date.now()): Promise<LoginHistoryEntry[]> {
    const rows = await this.db.loginHistoryRecord.findMany({
      where: { user_id: userId, at: { gte: new Date(now - sinceMs) } },
    });
    return rows.map((row) => ({
      deviceFingerprintHash: row.device_fingerprint_hash,
      ipHash: row.ip_hash,
      at: row.at.getTime(),
      outcome: row.outcome as LoginHistoryEntry['outcome'],
    }));
  }

  async record(userId: string, entry: LoginHistoryEntry): Promise<void> {
    await this.db.loginHistoryRecord.create({
      data: {
        user_id: userId,
        device_fingerprint_hash: entry.deviceFingerprintHash,
        ip_hash: entry.ipHash,
        at: new Date(entry.at),
        outcome: entry.outcome,
      },
    });
    await this.db.loginHistoryRecord.deleteMany({
      where: { user_id: userId, at: { lt: new Date(entry.at - HISTORY_RETENTION_MS) } },
    });
  }
}

/**
 * Chooses the default login-history store (T-R5): process-local in-memory for tests (no DB
 * needed — every existing test that cares about login history already calls
 * `setLoginHistoryStore` explicitly in `beforeEach`) and local dev without a `DATABASE_URL`; the
 * cluster-wide Postgres-backed store everywhere else.
 */
function createDefaultLoginHistoryStore(): LoginHistoryStore {
  if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) {
    return new InMemoryLoginHistoryStore();
  }
  return new PostgresLoginHistoryStore();
}

// T-R5: lazily defaulted on first access (never at module scope) — see
// `createDefaultLoginHistoryStore` above.
let activeLoginHistoryStore: LoginHistoryStore | undefined;

export function setLoginHistoryStore(store: LoginHistoryStore): void {
  activeLoginHistoryStore = store;
}

export function getLoginHistoryStore(): LoginHistoryStore {
  if (!activeLoginHistoryStore) activeLoginHistoryStore = createDefaultLoginHistoryStore();
  return activeLoginHistoryStore;
}

export interface AnomalyScoreInput {
  userId: string;
  deviceFingerprintHash: string;
  ipHash: string;
  now?: number;
}

export interface AnomalyScoreResult {
  /** True if this login shows any anomaly signal at all. */
  anomalous: boolean;
  /** True if the anomaly is strong enough to require a step-up/challenge before completing sign-in. */
  requiresChallenge: boolean;
  reasons: Array<'new_device' | 'new_ip' | 'velocity'>;
}

const VELOCITY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const VELOCITY_THRESHOLD = 4; // 4+ attempts (any outcome) in the window is a burst

/**
 * Scores a login attempt for anomaly signals using the account's own recent history — never a
 * live geo-IP service (offline, per this unit's test constraints). "new geo" is approximated by
 * "new IP hash never seen for this account before", which is the honest, documented proxy this
 * build uses in place of a real geo-IP lookup (see SPEC_DEVIATIONS).
 *
 * Does not itself write to history — callers record the attempt via `LoginHistoryStore.record`
 * once the outcome (success/failure) is known.
 */
export async function scoreLoginAttempt(input: AnomalyScoreInput): Promise<AnomalyScoreResult> {
  const now = input.now ?? Date.now();
  const store = getLoginHistoryStore();
  const history = await store.recent(input.userId, HISTORY_RETENTION_MS, now);
  const successfulHistory = history.filter((e) => e.outcome === 'success');

  const reasons: AnomalyScoreResult['reasons'] = [];

  const knownDevice = successfulHistory.some(
    (e) => e.deviceFingerprintHash === input.deviceFingerprintHash
  );
  if (!knownDevice && successfulHistory.length > 0) {
    reasons.push('new_device');
  }

  const knownIp = successfulHistory.some((e) => e.ipHash === input.ipHash);
  if (!knownIp && successfulHistory.length > 0) {
    reasons.push('new_ip');
  }

  const recentAttempts = history.filter((e) => e.at >= now - VELOCITY_WINDOW_MS);
  if (recentAttempts.length >= VELOCITY_THRESHOLD) {
    reasons.push('velocity');
  }

  const anomalous = reasons.length > 0;
  // A brand-new device AND a brand-new IP together (first-seen-everything, not just "no history
  // at all") or a velocity burst is what actually gates sign-in with a step-up/challenge; a lone
  // new-IP-from-a-known-device (e.g. mobile carrier NAT rotation) alone is logged but not gated,
  // to avoid punishing ordinary usage.
  const requiresChallenge =
    reasons.includes('velocity') || (reasons.includes('new_device') && reasons.includes('new_ip'));

  return { anomalous, requiresChallenge, reasons };
}
