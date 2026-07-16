import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';

import { can } from '../../../lib/auth/rbac-matrix';
import {
  ContainPayload,
  DeclaredIncidentPayload,
  IncidentActor,
  IncidentEventRecord,
  IncidentSnapshot,
  NotifyPayload,
  ResolvePayload,
  TriagePayload,
} from '../../../types/incident';
import { applyIncidentTransition, assertNotifyBeforeResolve } from './incident-state-machine';
import { isClockApplicable } from './gdpr-clock';
import { IncidentRepository } from './incident-repository';
import { projectIncident } from './incident-projection';

/**
 * IncidentService — the stateful entry point for T-15's incident-response runbook (§16.7,
 * build-brief items 2-4). Every mutation goes through the append-only `IncidentRepository`
 * (never an update/delete) and is mirrored to every injected `IncidentEventSink` (e.g.
 * `./incident-audit-sink.ts`'s durable T-10 mirror). RBAC is enforced with `can(role,
 * 'incident_response', action)` from `src/lib/auth/rbac-matrix.ts` — the authoritative §16.6
 * matrix, extended with the `incident_response` resource (RVP/ADMIN only; see that file's comment
 * for why REP/UPLINE/DUAL are excluded) — exactly the "use can(role, resource, action) /
 * requireCapability" contract the build brief calls for.
 */

export interface IncidentEventSink {
  record(event: IncidentEventRecord): Promise<void>;
}

/** Thrown by every RBAC-gated method below when the caller's role is not RVP/ADMIN. */
export class IncidentAuthorizationError extends Error {
  constructor(
    public readonly role: Role,
    public readonly action: 'read' | 'manage'
  ) {
    super(
      `RBAC: role '${role}' is not permitted to '${action}' on 'incident_response' (§16.6/§16.7) — ` +
        `incident detection/read is ADMIN/RVP only; regular reps (and upline/dual) cannot manage incidents.`
    );
    this.name = 'IncidentAuthorizationError';
  }
}

function assertCapability(role: Role, action: 'read' | 'manage'): void {
  if (!can(role, 'incident_response', action)) {
    throw new IncidentAuthorizationError(role, action);
  }
}

export interface DeclareIncidentInput {
  correlationKey: string;
  userId: string | null;
  severity: DeclaredIncidentPayload['severity'];
  breachClass: DeclaredIncidentPayload['breachClass'];
  score: number;
  evidenceEventIds: string[];
  reason: string;
  source: DeclaredIncidentPayload['source'];
  occurredAt?: string;
  /**
   * Present ONLY for a human-triggered manual declare (§16.7 item 1's non-SecurityEvent sources:
   * error-tracking alerts, CFE/audit anomalies, provider status). Omitted for the automated
   * correlation-engine path (`./security-event-bridge.ts`) — detection itself is a sensor, not a
   * privileged action (exactly like the CFE's own decisions are never RBAC-gated), so it is never
   * denied for lack of role. A manual declare IS a privileged action and is gated identically to
   * every mutation below.
   */
  actor?: IncidentActor;
}

export class IncidentService {
  constructor(
    private readonly repository: IncidentRepository,
    private readonly sinks: IncidentEventSink[] = []
  ) {}

  private async emit(event: IncidentEventRecord): Promise<void> {
    await this.repository.append(event);
    await Promise.all(this.sinks.map((sink) => sink.record(event)));
  }

  private async loadEvents(incidentId: string): Promise<IncidentEventRecord[]> {
    const events = await this.repository.getEvents(incidentId);
    if (events.length === 0) {
      throw new Error(`IncidentService: no incident found with id '${incidentId}'`);
    }
    return events;
  }

  /**
   * Opens a new incident (the DECLARED event — sequence 1). Never RBAC-gated for the automated
   * detection path (`input.actor` omitted); gated for a manual declare (`input.actor` supplied).
   */
  async declare(input: DeclareIncidentInput): Promise<IncidentSnapshot> {
    if (input.actor) {
      assertCapability(input.actor.role, 'manage');
    }

    const incidentId = randomUUID();
    const event: IncidentEventRecord = {
      id: randomUUID(),
      incident_id: incidentId,
      sequence: 1,
      kind: 'DECLARED',
      actor_id: input.actor?.actorId ?? null,
      actor_role: input.actor?.role ?? null,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      payload: {
        correlationKey: input.correlationKey,
        userId: input.userId,
        severity: input.severity,
        breachClass: input.breachClass,
        score: input.score,
        evidenceEventIds: input.evidenceEventIds,
        reason: input.reason,
        source: input.source,
      },
    };
    await this.emit(event);
    return this.getIncident(incidentId);
  }

  /** Internal read (no RBAC) — used by every gated method below once the caller has already
   *  cleared the capability check, and by the security-event-bridge's idempotency lookup, which
   *  (like `declare`'s automated path) is the detection sensor itself, not an end-user action. */
  async getIncident(incidentId: string): Promise<IncidentSnapshot> {
    const events = await this.loadEvents(incidentId);
    return projectIncident(incidentId, events);
  }

  private async projectAll(): Promise<IncidentSnapshot[]> {
    const ids = await this.repository.listIncidentIds();
    return Promise.all(ids.map((id) => this.getIncident(id)));
  }

  /** Read-gated (ADMIN/RVP only) view of one incident. */
  async getIncidentAs(actor: IncidentActor, incidentId: string): Promise<IncidentSnapshot> {
    assertCapability(actor.role, 'read');
    return this.getIncident(incidentId);
  }

  /** Read-gated (ADMIN/RVP only) view of every incident. */
  async listIncidents(actor: IncidentActor): Promise<IncidentSnapshot[]> {
    assertCapability(actor.role, 'read');
    return this.projectAll();
  }

  /**
   * Fail-safe watchlist (build-brief item 2): every incident whose GDPR clock is still applicable
   * and not yet CLOSED — regardless of lifecycle state. Nothing here filters by lifecycleState, so
   * an un-triaged breach never disappears from it.
   */
  async listBreachWatchlist(actor: IncidentActor): Promise<IncidentSnapshot[]> {
    assertCapability(actor.role, 'read');
    const all = await this.projectAll();
    return all.filter((s) => s.gdprClock.applicable && s.gdprClock.status !== 'CLOSED');
  }

  /**
   * The fail-safe's sharpest edge (build-brief item 2's "an un-triaged breach-class incident must
   * be visibly flagged, never silently dropped"): every breach-class incident nobody has triaged
   * yet. Read-gated like every other view — but never itself the reason a flagged incident goes
   * unseen, since ADMIN/RVP are exactly who owns the IR lifecycle (§16.7 "owned by the operator").
   */
  async listUntriagedBreachIncidents(actor: IncidentActor): Promise<IncidentSnapshot[]> {
    assertCapability(actor.role, 'read');
    const all = await this.projectAll();
    return all.filter((s) => s.needsTriage);
  }

  /**
   * Idempotency lookup for the correlation engine (`./security-event-bridge.ts`): is there
   * already an open (non-RESOLVED) incident for this correlation key? Not RBAC-gated — internal
   * wiring, not an end-user action, exactly like `declare`'s automated path.
   */
  async findOpenByCorrelationKey(correlationKey: string): Promise<string | null> {
    const all = await this.projectAll();
    const open = all.find((s) => s.correlationKey === correlationKey && s.lifecycleState !== 'RESOLVED');
    return open?.id ?? null;
  }

  async triage(actor: IncidentActor, incidentId: string, payload: TriagePayload): Promise<IncidentSnapshot> {
    assertCapability(actor.role, 'manage');
    const snapshot = await this.getIncident(incidentId);
    const result = applyIncidentTransition(snapshot.lifecycleState, 'TRIAGE');
    if (!result.ok) throw new Error(result.error);

    await this.emit({
      id: randomUUID(),
      incident_id: incidentId,
      sequence: snapshot.events.length + 1,
      kind: 'TRIAGED',
      actor_id: actor.actorId,
      actor_role: actor.role,
      occurred_at: new Date().toISOString(),
      payload: { ...payload },
    });
    return this.getIncident(incidentId);
  }

  async contain(actor: IncidentActor, incidentId: string, payload: ContainPayload): Promise<IncidentSnapshot> {
    assertCapability(actor.role, 'manage');
    const snapshot = await this.getIncident(incidentId);
    const result = applyIncidentTransition(snapshot.lifecycleState, 'CONTAIN');
    if (!result.ok) throw new Error(result.error);

    await this.emit({
      id: randomUUID(),
      incident_id: incidentId,
      sequence: snapshot.events.length + 1,
      kind: 'CONTAINED',
      actor_id: actor.actorId,
      actor_role: actor.role,
      occurred_at: new Date().toISOString(),
      payload: { ...payload },
    });
    return this.getIncident(incidentId);
  }

  async notify(actor: IncidentActor, incidentId: string, payload: NotifyPayload): Promise<IncidentSnapshot> {
    assertCapability(actor.role, 'manage');
    const snapshot = await this.getIncident(incidentId);
    const result = applyIncidentTransition(snapshot.lifecycleState, 'NOTIFY');
    if (!result.ok) throw new Error(result.error);

    await this.emit({
      id: randomUUID(),
      incident_id: incidentId,
      sequence: snapshot.events.length + 1,
      kind: 'NOTIFIED',
      actor_id: actor.actorId,
      actor_role: actor.role,
      occurred_at: new Date().toISOString(),
      payload: { ...payload },
    });
    return this.getIncident(incidentId);
  }

  async resolve(actor: IncidentActor, incidentId: string, payload: ResolvePayload): Promise<IncidentSnapshot> {
    assertCapability(actor.role, 'manage');
    const snapshot = await this.getIncident(incidentId);
    const result = applyIncidentTransition(snapshot.lifecycleState, 'RESOLVE');
    if (!result.ok) throw new Error(result.error);

    const guardError = assertNotifyBeforeResolve(snapshot.lifecycleState, isClockApplicable(snapshot.breachClass));
    if (guardError) throw new Error(guardError);

    await this.emit({
      id: randomUUID(),
      incident_id: incidentId,
      sequence: snapshot.events.length + 1,
      kind: 'RESOLVED',
      actor_id: actor.actorId,
      actor_role: actor.role,
      occurred_at: new Date().toISOString(),
      payload: { ...payload },
    });
    return this.getIncident(incidentId);
  }
}
