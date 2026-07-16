import { Role } from '@prisma/client';

/**
 * Incident response & breach notification (T-15, master-spec §16.7 "Breach notification &
 * incident response (NEW — the flagged gap)"). This module is the shared type vocabulary for the
 * whole unit: correlation/classification (./incident-classifier.ts, build-brief items 1/5), the
 * GDPR Art. 33 72-hour clock (./gdpr-clock.ts, item 2), the runbook lifecycle state machine
 * (./incident-state-machine.ts, item 3), and the append-only event log + projection
 * (./incident-repository.ts, ./incident-projection.ts, item 4).
 *
 * Design choice — ONE append-only ledger per incident, not a mutable "Incident" header row plus a
 * separate "BreachNotification" table: every fact about an incident (it was declared, triaged,
 * contained, notified, resolved) is its own immutable `IncidentEventRecord`. "Current state"
 * (severity, lifecycle position, breach classification, the GDPR clock, the notification detail)
 * is always a *projection* folded from that ordered log (./incident-projection.ts), never a column
 * that gets UPDATEd in place. This mirrors the posture T-10's `AuditRepository` and T-13's
 * `LicensingStateEvent` already take (append/query only — no update/delete method exists on
 * either interface) — and is deliberately the stronger of the two options the build brief allows
 * ("use/emit into the T-10 audit store where appropriate, OR a dedicated append-only incident
 * log"): this unit does both (a dedicated `IncidentEvent` log here, AND a mirrored emission into
 * T-10's hash-chained store via `./incident-audit-sink.ts`) rather than picking just one.
 */

// ─── Severity (§16.7 item 1: "Every incident gets a severity (SEV-1…SEV-4) and an incident
// record") ───────────────────────────────────────────────────────────────────────────────────────

export const INCIDENT_SEVERITIES = ['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

// ─── Runbook lifecycle (§16.7 items 1-5, condensed to the build brief's five-state chain:
// "detected → triaged → contained → notified → resolved") ─────────────────────────────────────

export const INCIDENT_LIFECYCLE_STATES = [
  'DETECTED',
  'TRIAGED',
  'CONTAINED',
  'NOTIFIED',
  'RESOLVED',
] as const;
export type IncidentLifecycleState = (typeof INCIDENT_LIFECYCLE_STATES)[number];

export const INCIDENT_ACTIONS = ['TRIAGE', 'CONTAIN', 'NOTIFY', 'RESOLVE'] as const;
export type IncidentAction = (typeof INCIDENT_ACTIONS)[number];

// ─── GDPR Art. 33 breach classification ────────────────────────────────────────────────────────

/**
 * Fail-toward-caution (§18.1's classifier-disagreement doctrine — "low confidence → treat as the
 * higher risk band" — applied here to breach classification): only `NOT_PERSONAL_DATA`, an
 * explicit and triaged human ruling, stops the GDPR clock. `SUSPECTED_PERSONAL_DATA_BREACH` (the
 * correlation engine's default guess when a specific user is implicated) and `UNDETERMINED` (a
 * correlated cluster with no identified user — e.g. IP-only noise) both keep the clock running
 * exactly like `CONFIRMED_PERSONAL_DATA_BREACH` — "we don't yet know" is never silently treated as
 * "assume no personal data was involved."
 */
export type BreachClass =
  | 'SUSPECTED_PERSONAL_DATA_BREACH'
  | 'CONFIRMED_PERSONAL_DATA_BREACH'
  | 'UNDETERMINED'
  | 'NOT_PERSONAL_DATA';

export type GdprClockStatus = 'NOT_APPLICABLE' | 'OPEN' | 'NOTIFIED' | 'CLOSED';

export interface GdprClock {
  applicable: boolean;
  status: GdprClockStatus;
  clockStartedAt: string | null;
  deadline: string | null;
  elapsedMs: number | null;
  remainingMs: number | null;
  overDeadline: boolean;
  /** >= 48h elapsed (two-thirds of the 72h window) with the clock still OPEN — surfaced
   *  separately from a hard `overDeadline` breach per build-brief item 2's "surface which
   *  incidents are approaching/over deadline." */
  approachingDeadline: boolean;
}

// ─── Append-only event log ──────────────────────────────────────────────────────────────────────

export type IncidentEventKind = 'DECLARED' | 'TRIAGED' | 'CONTAINED' | 'NOTIFIED' | 'RESOLVED';

export interface IncidentEventRecord {
  id: string;
  incident_id: string;
  /** Monotonic per-incident append order (mirrors `AuditEntryRecord.sequence`) — assigned by
   *  `IncidentService`, never by the caller. */
  sequence: number;
  kind: IncidentEventKind;
  /** `null` for a system-declared incident (the correlation engine — §16.7 item 1's automated
   *  "Detect" source). Every human-performed action (triage/contain/notify/resolve, or a manual
   *  declare from a non-SecurityEvent source) carries a real actor. */
  actor_id: string | null;
  actor_role: Role | null;
  /** ISO 8601. For the DECLARED event this is the GDPR "becoming aware" instant — see
   *  incident-classifier.ts's module doc for why that is the moment the correlation threshold was
   *  first crossed, not the time the surrounding batch happened to finish. */
  occurred_at: string;
  payload: Record<string, unknown>;
}

// ─── Declare-time classification result (produced by ./incident-classifier.ts) ─────────────────

export interface DeclaredIncidentPayload {
  correlationKey: string;
  userId: string | null;
  severity: IncidentSeverity;
  breachClass: BreachClass;
  score: number;
  evidenceEventIds: string[];
  reason: string;
  source: 'security_event_correlation' | 'manual';
}

// ─── Triage/contain/notify/resolve payloads ────────────────────────────────────────────────────

export interface TriagePayload {
  notes: string;
  /** Triage's one legitimate way to move a breach class off SUSPECTED/UNDETERMINED — a human
   *  ruling, never automatic. Omit to leave the declare-time classification standing (still
   *  clock-worthy) while merely recording that a human has now looked at it. */
  breachClassDecision?: BreachClass;
  severityOverride?: IncidentSeverity;
}

export interface ContainPayload {
  /** e.g. 'revoked_sessions', 'rotated_secret:STRIPE_WEBHOOK_SECRET' (by NAME only, never a
   *  value — §0.4), 'kill_switch:outreach' (§4.5). */
  actions: string[];
  notes: string;
}

export interface NotifyPayload {
  /** Who was told — regulator/subprocessor/affected-user categories, never raw contact PII on
   *  this record (§0.4/§16.3). */
  notifiedParties: string[];
  dataCategories: string[];
  method: string;
  templateId?: string;
  notes: string;
}

export interface ResolvePayload {
  rootCause: string;
  remediationItems: string[];
  notes: string;
}

// ─── Actor context every mutating IncidentService call takes ──────────────────────────────────

export interface IncidentActor {
  actorId: string;
  role: Role;
}

// ─── The projected read-model (folded from the append-only log, ./incident-projection.ts) ──────

export interface IncidentSnapshot {
  id: string;
  correlationKey: string;
  userId: string | null;
  severity: IncidentSeverity;
  lifecycleState: IncidentLifecycleState;
  breachClass: BreachClass;
  declaredAt: string;
  triagedAt: string | null;
  containedAt: string | null;
  notifiedAt: string | null;
  resolvedAt: string | null;
  evidenceEventIds: string[];
  notification: NotifyPayload | null;
  gdprClock: GdprClock;
  /** The fail-safe flag (build brief item 2): true iff this incident is still clock-applicable
   *  AND nobody has triaged it yet. Every listing surface (`listIncidents`,
   *  `listUntriagedBreachIncidents`, `listBreachWatchlist`) can include an incident with this flag
   *  set — none of them filters it out. */
  needsTriage: boolean;
  events: IncidentEventRecord[];
}
