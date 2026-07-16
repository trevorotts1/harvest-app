import crypto from 'crypto';

/**
 * Session-hijack / takeover protections (T-12, master-spec §16.4/§18.10):
 *
 *   "session-hijack/takeover detection (device-fingerprint + IP-reputation change mid-session →
 *   re-challenge or revoke); a session-revocation control ('sign out everywhere') on the Me
 *   surface; idle timeout (30 min) and absolute session lifetime" (§16.4)
 *
 *   "a device-fingerprint or IP-reputation change mid-session forces re-challenge or session
 *   revocation; 'sign out everywhere' revokes all sessions; a suspected-takeover event escalates
 *   to the incident-response lifecycle (§16.7); the true owner is notified of new-device
 *   sign-ins" (§18.10)
 *
 * Deliberately pure/framework-decoupled — same design choice T-04 made for `StepUpState` in
 * mfa.ts ("not next-auth's Session type ... so this module (and its tests) stay decoupled from
 * the NextAuth request/response lifecycle"). `src/lib/auth/options.ts` and `with-role.ts` are the
 * thin glue that reads real request headers / the real session and calls into this module.
 */

/** §16.4 exact figure: "idle timeout (30 min)". */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * §16.4 calls for "absolute session lifetime" alongside the 30-minute idle timeout but does not
 * name a specific figure. 12 hours (one working shift) is this build's documented assumption —
 * long enough that a rep mid-shift is never forced to re-authenticate, short enough that a stolen
 * JWT has a hard ceiling regardless of activity. Also configured as `authOptions.session.maxAge`
 * (src/lib/auth/options.ts) so the JWT itself never outlives this window even if every other
 * check below were bypassed.
 */
export const ABSOLUTE_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

/**
 * How long a cleared step-up MFA challenge (`mfaVerifiedAt`) stays valid before a sensitive action
 * (§16.4's five: billing change, data export/delete, RBAC change, org switch) demands a fresh one.
 * Not spec-specified as an exact figure; 15 minutes is a documented, industry-typical step-up
 * revalidation window (see src/lib/auth/mfa.ts `requireStepUp`).
 */
export const STEP_UP_REVALIDATION_WINDOW_MS = 15 * 60 * 1000;

export interface FingerprintInput {
  userAgent: string | null;
  /** IP address — hashed inside this function; the raw value is never retained by the caller after this call. */
  ip: string | null;
  acceptLanguage?: string | null;
}

/**
 * Computes a stable hash binding a session to the device/network characteristics observed at
 * sign-in. Plain SHA-256 (not the keyed `hmacForMatch`) is correct here — unlike Contact
 * phone/email hashes, a fingerprint is not a secret being matched against a small guessable input
 * space that needs peppering; it is a change-detector for the *same* session's own later requests.
 */
export function computeDeviceFingerprint(input: FingerprintInput): string {
  const material = [input.userAgent ?? '', input.ip ?? '', input.acceptLanguage ?? ''].join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

/** One-way hash of a raw IP for `SecurityEvent.ip_hash` / login-history matching — never store the raw IP. */
export function hashIp(ip: string | null): string {
  return crypto.createHash('sha256').update(ip ?? 'unknown').digest('hex');
}

export interface SessionSecurityContext {
  /** Fingerprint bound to the session at sign-in (`computeDeviceFingerprint` at `authorize()` time). */
  fingerprintHash: string;
  /** Sign-in time, ms epoch — immutable for the JWT's life. */
  boundAt: number;
  /** `User.security_version` snapshotted into the JWT at sign-in. */
  securityVersionAtIssue: number;
}

export interface SessionSecurityCheck {
  /** The fingerprint computed from the *current* request. */
  currentFingerprintHash: string;
  now: number;
  /** The live `User.security_version` read from the database right now. */
  currentSecurityVersion: number;
  /**
   * Most recently observed *validated* activity, ms epoch (from `SessionActivityStore`, below —
   * deliberately NOT stored in the JWT itself: NextAuth's `jwt` callback re-runs on every silent
   * session decode, so anything written there on every call would re-stamp "now" before this
   * function ever saw a stale value, making idle-timeout unreachable). Callers pass `boundAt` here
   * for a session that has never been touched yet.
   */
  lastActivityAt: number;
}

export type SessionSecurityStatus =
  | { valid: true }
  | { valid: false; reason: 'idle_expired' | 'absolute_expired' | 'fingerprint_mismatch' | 'revoked' };

/**
 * The single evaluation point for "is this session still good": idle timeout, absolute lifetime,
 * fingerprint binding, and version-based revocation (covers both explicit "sign out everywhere"
 * and rotation-on-privilege-change, since both work by bumping `User.security_version`). Order
 * matters only for which `reason` is reported when multiple checks would fail simultaneously —
 * revocation is checked first because it is the most severe/deliberate signal (an operator or the
 * user themselves invalidated this session on purpose), then fingerprint (an active hijack
 * signal), then the two time-based expiries.
 */
export function evaluateSessionSecurity(
  context: SessionSecurityContext,
  check: SessionSecurityCheck
): SessionSecurityStatus {
  if (check.currentSecurityVersion !== context.securityVersionAtIssue) {
    return { valid: false, reason: 'revoked' };
  }

  if (check.currentFingerprintHash !== context.fingerprintHash) {
    return { valid: false, reason: 'fingerprint_mismatch' };
  }

  if (check.now - check.lastActivityAt > IDLE_TIMEOUT_MS) {
    return { valid: false, reason: 'idle_expired' };
  }

  if (check.now - context.boundAt > ABSOLUTE_SESSION_LIFETIME_MS) {
    return { valid: false, reason: 'absolute_expired' };
  }

  return { valid: true };
}

/** Whether a cleared step-up (`mfaVerifiedAt`) is still fresh enough to gate a §16.4 sensitive action. */
export function isStepUpFresh(mfaVerifiedAt: string | null, now: number = Date.now()): boolean {
  if (!mfaVerifiedAt) return false;
  const verifiedAtMs = Date.parse(mfaVerifiedAt);
  if (Number.isNaN(verifiedAtMs)) return false;
  return now - verifiedAtMs <= STEP_UP_REVALIDATION_WINDOW_MS;
}

// ─────────────────────────────────────────────────────────────────────────
// Session activity tracking (idle-timeout input) — deliberately external to the JWT; see the
// `lastActivityAt` doc comment on `SessionSecurityCheck` above for why.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A stable key for a single sign-in's activity bucket. `boundAt` (sign-in time, ms epoch) is
 * immutable for the JWT's life, so `userId:boundAt` uniquely identifies "this particular session"
 * without needing a dedicated random session id minted at sign-in and threaded through the token.
 */
export function sessionActivityKey(userId: string, boundAt: number): string {
  return `${userId}:${boundAt}`;
}

export interface SessionActivityStore {
  get(key: string): Promise<number | undefined>;
  touch(key: string, at: number): Promise<void>;
}

/** Process-local — same documented multi-instance caveat as `InMemoryRateLimitStore`. */
export class InMemorySessionActivityStore implements SessionActivityStore {
  private activity = new Map<string, number>();

  async get(key: string): Promise<number | undefined> {
    return this.activity.get(key);
  }

  async touch(key: string, at: number): Promise<void> {
    this.activity.set(key, at);
  }

  clear(): void {
    this.activity.clear();
  }
}

let activeSessionActivityStore: SessionActivityStore = new InMemorySessionActivityStore();

export function setSessionActivityStore(store: SessionActivityStore): void {
  activeSessionActivityStore = store;
}

export function getSessionActivityStore(): SessionActivityStore {
  return activeSessionActivityStore;
}

// ─────────────────────────────────────────────────────────────────────────
// Header/IP extraction — shared by `authorize()` (NextAuth's `RequestInternal.headers`, a plain
// object) and the API-route wrappers in with-role.ts (a real `Headers` instance on `NextRequest`).
// ─────────────────────────────────────────────────────────────────────────

export type HeaderSource = Headers | Record<string, unknown> | null | undefined;

export function extractHeader(headers: HeaderSource, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  const value = (headers as Record<string, unknown>)[name];
  if (Array.isArray(value)) return (value[0] as string) ?? null;
  return typeof value === 'string' ? value : null;
}

/** Best-effort client IP from standard proxy headers — never trusted for anything beyond fingerprinting/rate-limit keys. */
export function extractClientIp(headers: HeaderSource): string | null {
  const forwardedFor = extractHeader(headers, 'x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]!.trim();
  return extractHeader(headers, 'x-real-ip');
}
