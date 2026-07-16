import {
  BreachClass,
  IncidentEventRecord,
  IncidentLifecycleState,
  IncidentSeverity,
  IncidentSnapshot,
  NotifyPayload,
} from '../../../types/incident';
import { computeGdprClock, isClockApplicable } from './gdpr-clock';

const KIND_TO_STATE: Record<IncidentEventRecord['kind'], IncidentLifecycleState> = {
  DECLARED: 'DETECTED',
  TRIAGED: 'TRIAGED',
  CONTAINED: 'CONTAINED',
  NOTIFIED: 'NOTIFIED',
  RESOLVED: 'RESOLVED',
};

interface DeclaredPayloadShape {
  correlationKey: string;
  userId: string | null;
  severity: IncidentSeverity;
  breachClass: BreachClass;
  evidenceEventIds: string[];
}

interface TriagedPayloadShape {
  breachClassDecision?: BreachClass;
  severityOverride?: IncidentSeverity;
}

/**
 * Folds an incident's ordered append-only event log into the current read-model (build-brief item
 * 4: "current state is a projection, never a stored mutable column" — see types/incident.ts's
 * module doc for the full rationale). `events` MUST be sorted ascending by `sequence` — both
 * `InMemoryIncidentRepository.getEvents` and `PrismaIncidentRepository.getEvents` already
 * guarantee that ordering.
 */
export function projectIncident(incidentId: string, events: IncidentEventRecord[]): IncidentSnapshot {
  if (events.length === 0 || events[0].kind !== 'DECLARED') {
    throw new Error(`projectIncident: incident '${incidentId}' has no DECLARED event to project from`);
  }

  const declared = events[0];
  const declaredPayload = declared.payload as unknown as DeclaredPayloadShape;

  let severity = declaredPayload.severity;
  let breachClass = declaredPayload.breachClass;
  let lifecycleState: IncidentLifecycleState = 'DETECTED';
  let triagedAt: string | null = null;
  let containedAt: string | null = null;
  let notifiedAt: string | null = null;
  let resolvedAt: string | null = null;
  let notification: NotifyPayload | null = null;

  for (const event of events) {
    lifecycleState = KIND_TO_STATE[event.kind];

    if (event.kind === 'TRIAGED') {
      triagedAt = event.occurred_at;
      const payload = event.payload as unknown as TriagedPayloadShape;
      if (payload.breachClassDecision) breachClass = payload.breachClassDecision;
      if (payload.severityOverride) severity = payload.severityOverride;
    } else if (event.kind === 'CONTAINED') {
      containedAt = event.occurred_at;
    } else if (event.kind === 'NOTIFIED') {
      notifiedAt = event.occurred_at;
      notification = event.payload as unknown as NotifyPayload;
    } else if (event.kind === 'RESOLVED') {
      resolvedAt = event.occurred_at;
    }
  }

  const gdprClock = computeGdprClock({
    breachClass,
    clockStartedAt: declared.occurred_at,
    notifiedAt,
    resolvedAt,
  });

  // The fail-safe (build-brief item 2): still clock-applicable AND nobody has triaged it yet.
  const needsTriage = isClockApplicable(breachClass) && lifecycleState === 'DETECTED';

  return {
    id: incidentId,
    correlationKey: declaredPayload.correlationKey,
    userId: declaredPayload.userId,
    severity,
    lifecycleState,
    breachClass,
    declaredAt: declared.occurred_at,
    triagedAt,
    containedAt,
    notifiedAt,
    resolvedAt,
    evidenceEventIds: declaredPayload.evidenceEventIds,
    notification,
    gdprClock,
    needsTriage,
    events,
  };
}
