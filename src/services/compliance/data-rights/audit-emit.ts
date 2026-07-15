/**
 * Data-rights audit emission (T-11, master-spec §16.3/§5.6).
 *
 * The full immutable, cryptographically signed, append-only audit *store* is T-10's deliverable.
 * This module only defines the emit-side contract data-rights events go through, plus a couple of
 * lightweight sinks so this unit is independently testable without T-10's store existing yet.
 * Production wiring plugs a T-10-backed sink in here; nothing about that swap touches the
 * data-rights service logic (it only ever calls `sink.record(...)`).
 */

export type DataRightsAuditEventType =
  | 'export.requested'
  | 'export.completed'
  | 'deletion.requested'
  | 'deletion.held' // blocked by an active legal hold
  | 'deletion.completed'
  | 'deletion.failed'
  | 'legal_hold.placed'
  | 'legal_hold.lifted'
  | 'rectification.requested'
  | 'rectification.completed';

export interface DataRightsAuditEvent {
  type: DataRightsAuditEventType;
  user_id: string;
  actor_id: string; // who performed the action (may equal user_id for self-service)
  timestamp: string; // ISO 8601
  detail: Record<string, unknown>;
}

export interface DataRightsAuditSink {
  record(event: DataRightsAuditEvent): Promise<void>;
}

/** Test/dev sink — keeps every emitted event in memory for assertions. */
export class InMemoryDataRightsAuditSink implements DataRightsAuditSink {
  private events: DataRightsAuditEvent[] = [];

  async record(event: DataRightsAuditEvent): Promise<void> {
    this.events.push(event);
  }

  all(): DataRightsAuditEvent[] {
    return [...this.events];
  }

  ofType(type: DataRightsAuditEventType): DataRightsAuditEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  clear(): void {
    this.events = [];
  }
}

function buildEvent(
  type: DataRightsAuditEventType,
  user_id: string,
  actor_id: string,
  detail: Record<string, unknown>
): DataRightsAuditEvent {
  return { type, user_id, actor_id, timestamp: new Date().toISOString(), detail };
}

export { buildEvent as buildDataRightsAuditEvent };
