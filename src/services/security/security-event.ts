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
  | 'privilege_escalation_denied';

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
 * Module-level default sink used by real call-sites (src/lib/auth/options.ts, with-role.ts, the
 * new mfa/password-reset/session route handlers) so they don't each have to construct/import a
 * Prisma client directly. `setSecurityEventSink` lets tests swap in an
 * `InMemorySecurityEventSink` and inspect emitted events without touching a real database —
 * exactly the seam `jest.setup.ts`-style tests need, and how this module is proven in
 * tests/unit/security-event.test.ts and every scenario test that asserts "the right SecurityEvent
 * fired".
 */
let activeSink: SecurityEventSink = new InMemorySecurityEventSink();

export function setSecurityEventSink(sink: SecurityEventSink): void {
  activeSink = sink;
}

export function getSecurityEventSink(): SecurityEventSink {
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
    await activeSink.emit(input);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('SecurityEvent emit failed (non-fatal):', (error as Error).message);
  }
}
