import { CFEAuditEvent } from '../../../types/compliance';

/**
 * The CFE emits one immutable audit event per decision (§5.6). Durable, signed,
 * append-only persistence is owned by the audit trail (T-10); the CFE only
 * emits through this sink. Every decision — pass, flag, block, AND held —
 * emits exactly one event (AC §5.8-4: complete for every decision).
 */
export interface CFEAuditSink {
  emit(event: CFEAuditEvent): void;
}

/** Default sink: no-op. Production wiring injects the T-10-backed sink. */
export class NoopCFEAuditSink implements CFEAuditSink {
  emit(_event: CFEAuditEvent): void {
    /* intentionally empty — T-10 owns persistence */
  }
}

/** In-memory sink for tests and local dev; lets callers assert emission. */
export class InMemoryCFEAuditSink implements CFEAuditSink {
  readonly events: CFEAuditEvent[] = [];
  emit(event: CFEAuditEvent): void {
    this.events.push(event);
  }
  clear(): void {
    this.events.length = 0;
  }
  last(): CFEAuditEvent | undefined {
    return this.events[this.events.length - 1];
  }
}
