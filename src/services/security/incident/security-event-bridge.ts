import type {
  SecurityEventInput,
  SecurityEventRecord,
  SecurityEventSink,
} from '../security-event';
import { classifySecurityEvents } from './incident-classifier';
import { IncidentService } from './incident-service';

/**
 * Wires T-12's existing SecurityEvent emissions into detection (build-brief item 5) WITHOUT
 * touching `src/services/security/security-event.ts` at all: this is a plain decorator
 * implementing the exact same `SecurityEventSink` interface T-12 already defines, so production
 * wiring is only ever `setSecurityEventSink(new IncidentDetectingSecurityEventSink(realSink,
 * incidentService))` — a call-site change, not a T-12-internals change.
 *
 * T-12's own tests construct `InMemorySecurityEventSink` directly (see
 * tests/unit/security-event.test.ts's `beforeEach`) and never go through this class, so they are
 * completely unaffected by this file existing — proven by the full suite run in the T-15 build
 * report (T-12's suites still pass unmodified).
 */
export class IncidentDetectingSecurityEventSink implements SecurityEventSink {
  private buffer: SecurityEventRecord[] = [];

  constructor(
    private readonly inner: SecurityEventSink,
    private readonly incidents: IncidentService,
    private readonly options: { maxBufferSize?: number } = {}
  ) {}

  async emit(input: SecurityEventInput): Promise<SecurityEventRecord> {
    const record = await this.inner.emit(input);

    this.buffer.push(record);
    const max = this.options.maxBufferSize ?? 500;
    if (this.buffer.length > max) this.buffer.shift();

    await this.runDetection();
    return record;
  }

  /**
   * Re-classifies the whole rolling buffer on every emission and declares any newly-crossing
   * cluster. Idempotent via `IncidentService.findOpenByCorrelationKey`: a correlation key that
   * already has an open (non-RESOLVED) incident is never re-declared, no matter how many more
   * matching SecurityEvents arrive while it's being worked.
   */
  private async runDetection(): Promise<void> {
    const results = classifySecurityEvents(this.buffer);
    for (const result of results) {
      if (!result.declared) continue;

      const existing = await this.incidents.findOpenByCorrelationKey(result.correlationKey);
      if (existing) continue;

      await this.incidents.declare({
        correlationKey: result.correlationKey,
        userId: result.userId,
        severity: result.severity!,
        breachClass: result.breachClass!,
        score: result.score,
        evidenceEventIds: result.evidenceEventIds,
        reason: result.reason,
        source: 'security_event_correlation',
        occurredAt: result.declaredAt ?? undefined,
      });
    }
  }

  /** Test/inspection helper — not part of `SecurityEventSink`. */
  bufferedEvents(): SecurityEventRecord[] {
    return [...this.buffer];
  }
}
