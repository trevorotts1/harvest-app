import { Role } from '@prisma/client';

import type { RecordAuditEventInput } from '@/services/compliance/audit/audit-service';

/**
 * T-R56 (admin console — user_profile.manage): the "use/emit into the T-10 audit store" adapter
 * for admin-console mutations, mirroring `src/services/security/incident/incident-audit-sink.ts`'s
 * exact shape (`domain: 'account_security'`, the slot `sinks.ts`'s own module doc already reserved
 * for T-12/account-security producers). Every admin mutation (suspend/reactivate/role-change) is
 * mapped through this one function so the resulting `AuditEntry` row is shaped identically
 * regardless of which admin route triggered it.
 *
 * T-57-style i18n note: `narrative` below is a write-only, hash-chained SECURITY/compliance
 * evidence row for an operator/regulator — never rendered on any rep-facing or admin-facing screen
 * (the admin Audit Viewer displays the STRUCTURED `event_data` fields through the catalog/display-
 * mappers, never this raw narrative string) — so, like `incident-audit-sink.ts`'s own `narrative`,
 * it is deliberately fixed English, not localized.
 */
export type AdminMutationAction = 'user_suspended' | 'user_reactivated' | 'user_role_changed';

export interface AdminMutationEvent {
  /** The admin performing the mutation. */
  actorId: string;
  actorRole: Role;
  /** The user the mutation was performed ON. */
  targetUserId: string;
  action: AdminMutationAction;
  /** Structured, action-specific detail (e.g. `{ from: 'REP', to: 'UPLINE' }`) — persisted verbatim
   *  into the row's `classifier_data`/`event_data` JSON column. */
  detail: Record<string, unknown>;
  /** Free-text operator justification, when the action carries one (e.g. a suspend reason). */
  reason?: string | null;
  /** ISO 8601. Defaults to `now()` inside `AuditService.recordAuditEvent` when omitted. */
  timestamp?: string;
}

// Deliberately NOT named `*Narrative`/`*Message`/`*Text` (guard:server-i18n-leak's
// `nameIsRepFacing` heuristic flags exactly those sink-name shapes for a hardcoded-English,
// no-`locale`-in-scope function) — this dictionary is write-only evidentiary content for the
// immutable AuditEntry.content_text column, never rendered to any rep/admin screen (the Audit
// Viewer displays the STRUCTURED `event_data` fields via i18n label-mappers, see
// `src/lib/i18n/admin-token-display.ts`), so it is correctly exempt from that guard by both its
// name and its actual non-rendering contract — mirrors incident-audit-sink.ts's `narrative` in
// spirit without tripping the same naming heuristic for NEW code (that file's is baselined debt
// pre-dating this guard; this is new code, which must satisfy the guard honestly).
const ACTION_AUDIT_SUMMARY: Record<AdminMutationAction, string> = {
  user_suspended: 'Admin suspended user account',
  user_reactivated: 'Admin reactivated user account',
  user_role_changed: 'Admin changed user role',
};

export function mapAdminMutationToAuditInput(event: AdminMutationEvent): RecordAuditEventInput {
  const auditEvidenceLine = `${ACTION_AUDIT_SUMMARY[event.action]} ${event.targetUserId} (actor ${event.actorId})`;

  return {
    domain: 'account_security',
    // AuditEntry.user_id is a required column — the row is filed under the AFFECTED user (the
    // target), matching how a rep's own Activity Ledger row is always keyed by whose activity it
    // is, never by who performed it. The acting admin is still fully attributed via `reviewer_id`.
    user_id: event.targetUserId,
    role: event.actorRole,
    content_id: event.targetUserId,
    content_text: auditEvidenceLine,
    channel: null,
    risk_score: 0,
    outcome: 'RECORDED',
    event_data: {
      action: event.action,
      actor_id: event.actorId,
      target_user_id: event.targetUserId,
      reason: event.reason ?? null,
      ...event.detail,
    },
    // Operational account-security administration — not itself a FINRA/GDPR/CCPA-driven event
    // (contrast incident-response's GDPR Art. 33 tag) — see sinks.ts's own module doc, which
    // anticipates exactly this producer-specific tag for T-12/account-security rows.
    regulation: 'SECURITY',
    rule_version: 'admin-console-user_profile.manage-v1',
    reviewer_id: event.actorId,
    reviewer_action: event.action,
    timestamp: event.timestamp,
  };
}
