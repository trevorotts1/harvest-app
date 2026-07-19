/**
 * Deliverability provisioning audit emission (T-36, master-spec §10.3/SC5).
 *
 * The full immutable, cryptographically signed, append-only audit *store* is T-10's deliverable
 * (src/services/compliance/audit). This module only defines the emit-side contract every A2P
 * brand/campaign/number transition and email-warmup/auth-check goes through, plus an in-memory
 * sink so this unit is independently testable without touching T-10's store — the exact pattern
 * src/services/compliance/data-rights/audit-emit.ts already established for T-11. Production
 * wiring plugs a T-10-backed sink in here (mapping each `DeliverabilityAuditEvent` onto an
 * `AuditService.recordAuditEvent` call with `outcome: 'RECORDED'`, mirroring
 * `mapDataRightsEventToAuditInput` / `mapLicensingEventToAuditInput` in
 * src/services/compliance/audit/sinks.ts); nothing about that swap touches a2p-service.ts or
 * email-deliverability-service.ts, which only ever call `sink.record(...)`.
 */

import { DeliverabilityAuditEvent, DeliverabilityAuditEventType } from '../../types/deliverability';

export interface DeliverabilityAuditSink {
  record(event: DeliverabilityAuditEvent): Promise<void>;
}

/** Default sink: no-op. Production wiring injects the T-10-backed sink described above. */
export class NoopDeliverabilityAuditSink implements DeliverabilityAuditSink {
  async record(_event: DeliverabilityAuditEvent): Promise<void> {
    /* intentionally empty — T-10 owns durable persistence */
  }
}

/** Test/dev sink — keeps every emitted event in memory for assertions. */
export class InMemoryDeliverabilityAuditSink implements DeliverabilityAuditSink {
  private events: DeliverabilityAuditEvent[] = [];

  async record(event: DeliverabilityAuditEvent): Promise<void> {
    this.events.push(event);
  }

  all(): DeliverabilityAuditEvent[] {
    return [...this.events];
  }

  ofType(type: DeliverabilityAuditEventType): DeliverabilityAuditEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  clear(): void {
    this.events = [];
  }
}

export function buildDeliverabilityAuditEvent(
  type: DeliverabilityAuditEventType,
  organization_id: string,
  actor_id: string,
  detail: Record<string, unknown>
): DeliverabilityAuditEvent {
  return { type, organization_id, actor_id, timestamp: new Date().toISOString(), detail };
}
