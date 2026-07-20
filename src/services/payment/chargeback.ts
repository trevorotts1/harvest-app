// WP10 — Chargeback / dispute handling (§15.5 / §15.7-8; qc-checklist WP10 checkpoint 8).
//
// "On `charge.dispute.created`, set `status = disputed`, suspend AI outbound + messaging (read
// access maintained), alert support, submit evidence from the audit trail within Stripe's
// deadline." Outbound suspension is enforced by the entitlement gate (a DISPUTED subscription → the
// `disputed` phase → outbound denied, read retained — entitlement.ts). This module owns the state
// transition, the alert, and the EVIDENCE PACK assembled FROM THE AUDIT TRAIL.
//
// The evidence pack READS the existing compliance audit trail (§5.6) — it does NOT modify the audit
// service (an existing compliance/runtime service, off-limits per the additive rule). It depends on
// a narrow read-only `BillingAuditReader` so the assembly is unit-testable and the production wiring
// adapts the real `PrismaAuditRepository`.

import type { BillingNotification, BillingNotificationSink } from './notifications';

/** A single audit-trail row relevant to a disputed transaction's evidence. */
export interface AuditEvidenceRow {
  id: string;
  created_at: string;
  content_text: string;
  regulation: string;
  outcome: string;
}

/** Read-only view over the compliance audit trail (§5.6) — adapts `PrismaAuditRepository` in prod. */
export interface BillingAuditReader {
  queryUserAuditEntries(userId: string): Promise<AuditEvidenceRow[]>;
}

export interface ChargebackEvidencePack {
  user_id: string;
  dispute_id: string;
  generated_at: string;
  /** Ordered audit-trail rows constituting the evidence (§15.5 "evidence from the audit trail"). */
  entries: AuditEvidenceRow[];
  entry_count: number;
  /** A short human summary for the support agent submitting to Stripe. */
  summary: string;
}

/** Assemble the evidence pack from the user's audit-trail entries. Pure. */
export function assembleChargebackEvidencePack(
  userId: string,
  disputeId: string,
  entries: AuditEvidenceRow[],
  nowIso: string = new Date().toISOString()
): ChargebackEvidencePack {
  const sorted = [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    user_id: userId,
    dispute_id: disputeId,
    generated_at: nowIso,
    entries: sorted,
    entry_count: sorted.length,
    summary:
      `Evidence pack for dispute ${disputeId}: ${sorted.length} audit-trail entr` +
      `${sorted.length === 1 ? 'y' : 'ies'} for user ${userId}. Outbound messaging suspended; read ` +
      `access retained (§15.5).`,
  };
}

export interface DisputeStore {
  /** Set the user's live subscription to DISPUTED (idempotent). Returns whether a row was updated. */
  markSubscriptionDisputed(userId: string): Promise<boolean>;
}

export interface HandleDisputeInput {
  userId: string;
  disputeId: string;
  store: DisputeStore;
  auditReader: BillingAuditReader;
  sink: BillingNotificationSink;
  /** Support's user id to alert, if resolvable. */
  supportUserId?: string | null;
  nowIso?: string;
}

export interface HandleDisputeResult {
  transitioned: boolean;
  evidencePack: ChargebackEvidencePack;
}

/**
 * The full `charge.dispute.created` handler: DISPUTED status (→ outbound suspended, read retained
 * via the entitlement gate), a support alert, and the audit-trail evidence pack. The read-only
 * evidence read never mutates the audit trail.
 */
export async function handleDisputeCreated(input: HandleDisputeInput): Promise<HandleDisputeResult> {
  const { userId, disputeId, store, auditReader, sink, supportUserId, nowIso } = input;

  const transitioned = await store.markSubscriptionDisputed(userId);

  const entries = await auditReader.queryUserAuditEntries(userId);
  const evidencePack = assembleChargebackEvidencePack(userId, disputeId, entries, nowIso);

  const alert: BillingNotification = {
    type: 'chargeback_outbound_suspended',
    recipientRole: 'rvp',
    recipientUserId: supportUserId ?? userId,
    subjectUserId: userId,
    context: { dispute_id: disputeId, evidence_entries: evidencePack.entry_count },
  };
  await sink.notify(alert);

  return { transitioned, evidencePack };
}
