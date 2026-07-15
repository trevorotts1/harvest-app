// Audit emission for licensing state changes (§16.5). The full immutable/signed audit store is
// T-10's build — this module's job is only to EMIT a complete, attributable event on every state
// change; LicensingService fires one LicensingAuditEvent (who/when/from/to/why) into every
// configured sink. InMemoryLicensingEventSink is provided for tests and for standalone use before
// a T-10-owned sink is wired in; a production sink implements the same LicensingEventSink
// interface against the immutable audit store.

import { LicensingAuditEvent } from '../../../types/licensing';

export interface LicensingEventSink {
  record(event: LicensingAuditEvent): Promise<void> | void;
}

/** In-memory sink for tests. Records are kept in insertion order. */
export class InMemoryLicensingEventSink implements LicensingEventSink {
  private events: LicensingAuditEvent[] = [];

  record(event: LicensingAuditEvent): void {
    this.events.push({ ...event });
  }

  /** Test helper: all recorded events. */
  all(): LicensingAuditEvent[] {
    return [...this.events];
  }

  /** Test helper: events for one user. */
  forUser(userId: string): LicensingAuditEvent[] {
    return this.events.filter((e) => e.user_id === userId);
  }

  /** Test helper: reset. */
  clear(): void {
    this.events = [];
  }
}
