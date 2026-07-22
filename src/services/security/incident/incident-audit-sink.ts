import { Role } from '@prisma/client';

import {
  AuditService,
  type RecordAuditEventInput,
} from '../../compliance/audit/audit-service';
import { IncidentEventRecord } from '../../../types/incident';
import type { IncidentEventSink } from './incident-service';

/**
 * Mirrors every incident lifecycle event into T-10's immutable, hash-chained audit store
 * (`domain: 'account_security'` — the exact slot `src/services/compliance/audit/sinks.ts`'s
 * module doc already reserved: "A future T-12 account-security sink follows the exact same shape
 * ... once SecurityEvent exists to adapt from"). Deliberately implemented in its OWN file rather
 * than by editing `sinks.ts` or `audit-service.ts` — this build never touches a T-10-owned file;
 * the only thing it depends on is `AuditService.recordAuditEvent`, the one public integration
 * contract §5.7 names.
 *
 * This is the "use/emit into the T-10 audit store" half of build-brief item 4's either/or —
 * `./incident-repository.ts`'s dedicated `IncidentEvent` log is the other half. Wiring both in
 * (`new IncidentService(repo, [new DurableIncidentAuditSink(auditService)])`) gives every incident
 * record BOTH a fast, incident-shaped operational store AND a cryptographically hash-chained,
 * tamper-evident copy — belt-and-suspenders evidentiary durability for a breach record, which is
 * exactly the kind of evidence a regulator or auditor will ask to see reproduced (§16.1
 * "attribution ... immutability").
 *
 * T-57 RG8 (i18n; server-i18n-leak) — `narrative` (below) is PERMANENT-EXEMPT
 * (`SERVER_I18N_LEAK_BASELINE.json`, `narrative: (system-detected via SecurityEvent correlation)`).
 * It feeds ONLY this durable, hash-chained SECURITY audit log (`domain: 'account_security'`) —
 * confirmed by grep that no `.tsx` anywhere renders `AuditEvent.content_text`/`narrative`; this is
 * a write-only security/incident-response evidentiary record for an operator/regulator (§16.7),
 * never a rep-facing surface. Never localize: a breach/incident record's language must stay fixed
 * for evidentiary consistency, not follow whichever operator's locale happened to be active.
 */
export function mapIncidentEventToAuditInput(event: IncidentEventRecord): RecordAuditEventInput {
  const subjectUserId = (event.payload as { userId?: string | null }).userId ?? null;
  const narrative =
    `Incident ${event.incident_id}: ${event.kind}` +
    (event.actor_id ? ` by ${event.actor_id}` : ' (system-detected via SecurityEvent correlation)');

  return {
    domain: 'account_security',
    // AuditEntry.user_id is a required column (§5.7's normalized shape) — fall back to the
    // acting operator, then to the literal 'system' for a fully automated, no-known-user
    // detection (e.g. an IP-only credential-stuffing cluster with no identified data subject).
    user_id: subjectUserId ?? event.actor_id ?? 'system',
    // System-declared events carry no actor_role; incident response is operator-owned (§16.7 "owned
    // by the operator with an on-call rotation") so ADMIN is the fitting default attribution,
    // never REP — mirrors sinks.ts's own coerceRole default-role convention for domains whose
    // event shape doesn't always carry a real Role.
    role: event.actor_role ?? Role.ADMIN,
    content_id: event.incident_id,
    content_text: narrative,
    channel: null,
    risk_score: 0,
    outcome: 'RECORDED',
    event_data: {
      incident_event_id: event.id,
      sequence: event.sequence,
      kind: event.kind,
      ...event.payload,
    },
    // The incident-response lifecycle's regulatory anchor is GDPR Art. 33 (§16.7 item 4) — the
    // tag the data-rights legal-hold carve-out and every other GDPR-relevant row already uses.
    regulation: 'GDPR',
    rule_version: 'incident-response-§16.7-v1',
    reviewer_id: event.actor_id,
    reviewer_action: event.kind,
    timestamp: event.occurred_at,
  };
}

/** Durable `IncidentEventSink` — plug into `IncidentService`'s `sinks` constructor argument in
 *  production wiring, alongside (not instead of) the dedicated `IncidentRepository`. */
export class DurableIncidentAuditSink implements IncidentEventSink {
  constructor(private readonly store: AuditService) {}

  async record(event: IncidentEventRecord): Promise<void> {
    await this.store.recordAuditEvent(mapIncidentEventToAuditInput(event));
  }
}
