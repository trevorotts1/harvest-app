/**
 * SecurityEvent emission (T-12, master-spec §16.4/§16.7). `SecurityEvent` (prisma/schema.prisma)
 * is the append-only account-security & incident telemetry stream T-15's incident-response
 * lifecycle (§16.7) reads from — "every auth/session event written to SecurityEvent" (§16.4).
 *
 * Follows the same narrow-Prisma-delegate + constructor-injection pattern already established by
 * src/services/compliance/audit/audit-service.ts (`InMemoryAuditRepository`) and
 * src/services/compliance/data-rights/data-rights.ts (`DataRightsPrismaClient`): a minimal
 * interface easy to satisfy with an in-memory fake in tests, and a thin Prisma-backed
 * implementation for real runtime use. No update/delete method is exposed anywhere in this file —
 * append-only by construction, mirroring the model's own doc comment ("no update path is exposed
 * by design").
 */

import { prisma } from '@/lib/prisma';

/**
 * The illustrative type vocabulary from the SecurityEvent model's doc comment, extended with the
 * additional event classes this unit's build brief calls for ("MFA enroll/verify/fail, session
 * anomaly", "privilege-escalation attempts ... logs a SecurityEvent", §18.10). `SecurityEvent.type`
 * is a plain `String` column specifically so this vocabulary can grow without a migration (schema
 * header note: "regulatory/config-shaped vocabularies ... editable without a migration") — this
 * union is the documented, single source of truth for which strings the app actually emits.
 */
export type SecurityEventType =
  | 'login_success'
  | 'login_failure'
  | 'mfa_challenge'
  | 'mfa_enrolled'
  | 'mfa_verify_failed'
  | 'password_reset'
  | 'session_revoked'
  | 'rate_limited'
  | 'suspected_takeover'
  | 'breach_incident'
  | 'privilege_escalation_denied'
  // T-R56 (admin console — user_profile.manage): a sign-in attempt against an admin-suspended
  // account, blocked at the same point (post-password-verification) as every other authorize()
  // failure — see src/lib/auth/options.ts.
  | 'account_suspended'
  // T-R76 (password-reset email delivery): the transactional-email send failed after the reset
  // token was issued — recorded with the token revoked so the failure can be surfaced in the
  // security viewer without ever revealing the account's existence via the request's response.
  | 'password_reset_delivery_failed';

export type SecurityEventSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface SecurityEventInput {
  /** Nullable for platform-level events (e.g. a rate-limit hit keyed only by IP, no known user). */
  userId?: string | null;
  type: SecurityEventType;
  /** Already-hashed — this module never accepts or logs a raw IP (§0.4 secret/PII hygiene). */
  ipHash?: string | null;
  /** Already-hashed — never a raw device fingerprint. */
  deviceFingerprintHash?: string | null;
  severity?: SecurityEventSeverity;
}

export interface SecurityEventRecord {
  id: string;
  user_id: string | null;
  type: string;
  ip_hash: string | null;
  device_fingerprint_hash: string | null;
  severity: SecurityEventSeverity;
  created_at: string;
}

/** Narrow Prisma delegate shape — enough surface to satisfy with a plain mock in tests. */
export interface SecurityEventPrismaClient {
  securityEvent: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; created_at: Date }>;
  };
}

export interface SecurityEventSink {
  emit(input: SecurityEventInput): Promise<SecurityEventRecord>;
}

/** In-memory sink for tests — mirrors `InMemoryAuditRepository`'s shape and test-helper methods. */
export class InMemorySecurityEventSink implements SecurityEventSink {
  private events: SecurityEventRecord[] = [];

  async emit(input: SecurityEventInput): Promise<SecurityEventRecord> {
    const record: SecurityEventRecord = {
      id: crypto.randomUUID(),
      user_id: input.userId ?? null,
      type: input.type,
      ip_hash: input.ipHash ?? null,
      device_fingerprint_hash: input.deviceFingerprintHash ?? null,
      severity: input.severity ?? 'INFO',
      created_at: new Date().toISOString(),
    };
    this.events.push(record);
    return record;
  }

  all(): SecurityEventRecord[] {
    return [...this.events];
  }

  ofType(type: SecurityEventType): SecurityEventRecord[] {
    return this.events.filter((e) => e.type === type);
  }

  clear(): void {
    this.events = [];
  }
}

/** Real, Prisma-backed sink (`prisma.securityEvent.create`) for production wiring. */
export class PrismaSecurityEventSink implements SecurityEventSink {
  constructor(private readonly prisma: SecurityEventPrismaClient) {}

  async emit(input: SecurityEventInput): Promise<SecurityEventRecord> {
    const created = await this.prisma.securityEvent.create({
      data: {
        user_id: input.userId ?? null,
        type: input.type,
        ip_hash: input.ipHash ?? null,
        device_fingerprint_hash: input.deviceFingerprintHash ?? null,
        severity: input.severity ?? 'INFO',
      },
    });
    return {
      id: created.id,
      user_id: input.userId ?? null,
      type: input.type,
      ip_hash: input.ipHash ?? null,
      device_fingerprint_hash: input.deviceFingerprintHash ?? null,
      severity: input.severity ?? 'INFO',
      created_at: created.created_at.toISOString(),
    };
  }
}

/**
 * Chooses the default SecurityEvent sink (R-19, T-R5 pattern — mirrors
 * `createDefaultSessionActivityStore` in src/lib/auth/session-security.ts and
 * `createDefaultLoginHistoryStore` in src/services/security/credential-stuffing.ts exactly):
 * process-local in-memory for tests and local dev without a `DATABASE_URL`; the Prisma-backed
 * sink everywhere else.
 *
 * R-19: before this, the module-level default was unconditionally `InMemorySecurityEventSink`, so
 * in production every `emitSecurityEvent` call (login success/failure, MFA, password-reset,
 * session-revoke, rate-limit, privilege-escalation — the §16.4 "every auth/session event written
 * to SecurityEvent" stream) wrote only to the process-local array and **0 SecurityEvent rows ever
 * reached the DB** — the admin audit/security viewer (R-56) saw an empty table. Fail-open by
 * design (a SecurityEvent write must never block the security decision that triggered it, §0.4 /
 * `emitSecurityEvent`'s own doc comment), so this never gated sign-in — it just silently starved
 * the audit trail. With the Prisma-backed default, prod events persist; tests still swap in
 * `InMemorySecurityEventSink` via `setSecurityEventSink` exactly as before (every existing
 * security-event test's `beforeEach` does this).
 */
function createDefaultSecurityEventSink(): SecurityEventSink {
  if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) {
    return new InMemorySecurityEventSink();
  }
  return new PrismaSecurityEventSink(
    prisma.securityEvent as unknown as SecurityEventPrismaClient
  );
}

// R-19: lazily defaulted on first access (never at module scope) — same T-R5 convention as
// `createDefaultSessionActivityStore` / `createDefaultLoginHistoryStore` above. A module-scope
// default would construct the Prisma-backed sink at import time even under `NODE_ENV=test`.
let activeSink: SecurityEventSink | undefined;

export function setSecurityEventSink(sink: SecurityEventSink): void {
  activeSink = sink;
}

export function getSecurityEventSink(): SecurityEventSink {
  if (!activeSink) activeSink = createDefaultSecurityEventSink();
  return activeSink;
}

/**
 * Convenience emit against the currently-active sink. FAIL-OPEN by design (unlike the rate
 * limiter): a SecurityEvent write failure must never itself block or corrupt the security decision
 * that triggered it (e.g. a DB blip must not additionally prevent a legitimate sign-in) — it is
 * logged to stderr instead so an operational issue is still visible. This mirrors the CFE audit
 * sink's own posture (durable persistence is a downstream concern, not a gate).
 */
export async function emitSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    // R-19: through the lazy getter (never the raw `activeSink`) so the first emission in a
    // virgin process also instantiates the correct default — same T-R5 convention as
    // `getSessionActivityStore`/`getLoginHistoryStore`'s callers.
    await getSecurityEventSink().emit(input);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('SecurityEvent emit failed (non-fatal):', (error as Error).message);
  }
}
