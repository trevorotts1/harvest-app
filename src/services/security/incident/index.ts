// T-15, master-spec §16.7 — breach notification & incident response. Public entry point.
//
// Consumers:
//   - Production wiring: `setSecurityEventSink(new IncidentDetectingSecurityEventSink(realSink,
//     incidentService))` connects T-12's SecurityEvent stream into detection.
//   - `new IncidentService(repository, [new DurableIncidentAuditSink(auditService)])` wires the
//     dedicated append-only incident log AND a mirrored copy into T-10's hash-chained audit store.
//   - Any ADMIN/RVP-facing surface calls `IncidentService.listBreachWatchlist` /
//     `listUntriagedBreachIncidents` for the fail-safe views, and `triage`/`contain`/`notify`/
//     `resolve` to drive the runbook.

export * from '../../../types/incident';
export * from './incident-state-machine';
export * from './incident-classifier';
export * from './gdpr-clock';
export * from './incident-repository';
export * from './incident-projection';
export * from './incident-service';
export * from './incident-audit-sink';
export * from './security-event-bridge';
