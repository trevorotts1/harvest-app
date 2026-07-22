// T-09 (master-spec §5.5 AC-5 "48-hour SLA escalation"; §8.7.1 Flag-Queue SLA; the WP11 §5.3
// PRE_GENERATION constraint "48-hour escalation rule: flagged content unreviewed for 48 hours
// escalates to compliance officer"). The SCHEDULED sweep that ages unreviewed FLAG items past their
// 48h SLA and escalates them to `Organization.compliance_contact_id`.
//
// Package-free, directly-unit-testable HANDLER LOGIC (same separation-of-concerns convention as
// scheduled-dispatch.ts): the Inngest `{ cron: ... }` wrapper lives in
// adjudication-inngest-functions.ts (imports the `inngest` package, so it is NOT reachable from
// Jest); this file is proven directly against in-memory stores.
//
// FAIL-CLOSED (§5.2, the non-negotiable behavior): escalation HOLDS the item — it NEVER clears or
// approves it. Both outcomes leave the underlying DraftMessage `HELD`, never APPROVED:
//   • compliance contact present → queue `ESCALATED`, contact notified, draft HELD.
//   • NO compliance contact (un-escalatable) → queue `HELD`, draft HELD — it STAYS held, never
//     auto-cleared just because there was no one to escalate to.
// Every escalation/hold is written to the immutable AuditEntry. Infra failure is a graceful no-op
// (the next hourly tick retries), exactly like runScheduledDispatch.

import { Role } from '@prisma/client';

import { CFE_RULE_VERSION } from '@/types/compliance';
import type { Channel } from '@/types/compliance';
import {
  AuditService,
  PrismaAuditRepository,
  type AuditEntryPrismaDelegate,
} from '@/services/compliance/audit/audit-service';

// ── Inngest function config (package-free constants; the real registration is in
//    adjudication-inngest-functions.ts) ───────────────────────────────────────────────────────────
export const SLA_ESCALATION_FUNCTION_ID = 'compliance-sla-escalation' as const;
/** Hourly liveness tick — the 48h deadline lives on each queue row (`sla_deadline_at`), so an hourly
 *  sweep is a catch-up mechanism (a skipped hour is retried next hour), not the cadence itself. */
export const SLA_ESCALATION_CRON = '0 * * * *' as const;

/** The FLAG-queue review SLA (§8.7.1). Also the source of each row's `sla_deadline_at`. */
export const SLA_WINDOW_MS = 48 * 60 * 60 * 1000;

// ── The enumeration boundary (DI-mockable; same narrow-store convention as scheduled-dispatch.ts) ──

export interface OverdueQueueRow {
  queueId: string;
  draftId: string | null;
  repId: string | null;
  riskScore: number | null;
}

export interface DraftAuditContext {
  id: string;
  user_id: string;
  body: string;
  channel: string;
  cfe_risk_score: number | null;
}

export interface SlaEscalationStore {
  /** Still-PENDING queue rows whose 48h `sla_deadline_at` has passed. */
  listOverdueRows(now: Date): Promise<OverdueQueueRow[]>;
  /** The escalation target for this rep's org (§5.5) — `Organization.compliance_contact_id`, or null
   *  if the rep has no org / the org has no compliance contact configured (the un-escalatable case). */
  resolveComplianceContactId(repId: string): Promise<string | null>;
  /** Draft context for the audit record; null if the draft has since vanished. */
  getDraftForAudit(draftId: string): Promise<DraftAuditContext | null>;
  /** Compliance-contact present: queue → ESCALATED (with contact + timestamp), draft → HELD. */
  markEscalated(queueId: string, draftId: string | null, contactId: string, now: Date): Promise<void>;
  /** No compliance-contact: queue → HELD, draft → HELD. STAYS held — never auto-cleared. */
  markHeldNoContact(queueId: string, draftId: string | null, now: Date): Promise<void>;
}

// ── Narrow Prisma delegate shape (only what the real store touches) ───────────────────────────────

interface SlaPrismaLike {
  complianceReviewQueue: {
    findMany(args: { where: Record<string, unknown> }): Promise<
      { id: string; draft_id: string | null; rep_id: string | null; risk_score: number | null }[]
    >;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  draftMessage: {
    findFirst(args: { where: Record<string, unknown> }): Promise<DraftAuditContext | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  user: {
    findUnique(args: { where: { id: string }; select: Record<string, unknown> }): Promise<{ organization_id: string | null } | null>;
  };
  organization: {
    findUnique(args: { where: { id: string }; select: Record<string, unknown> }): Promise<{ compliance_contact_id: string | null } | null>;
  };
}

export class PrismaSlaEscalationStore implements SlaEscalationStore {
  constructor(private db: SlaPrismaLike) {}

  async listOverdueRows(now: Date): Promise<OverdueQueueRow[]> {
    const rows = await this.db.complianceReviewQueue.findMany({
      where: { status: 'PENDING', sla_deadline_at: { lte: now } },
    });
    return rows.map((r) => ({ queueId: r.id, draftId: r.draft_id, repId: r.rep_id, riskScore: r.risk_score }));
  }

  async resolveComplianceContactId(repId: string): Promise<string | null> {
    const rep = await this.db.user.findUnique({ where: { id: repId }, select: { organization_id: true } });
    if (!rep?.organization_id) return null;
    const org = await this.db.organization.findUnique({
      where: { id: rep.organization_id },
      select: { compliance_contact_id: true },
    });
    return org?.compliance_contact_id ?? null;
  }

  async getDraftForAudit(draftId: string): Promise<DraftAuditContext | null> {
    return this.db.draftMessage.findFirst({ where: { id: draftId } });
  }

  async markEscalated(queueId: string, draftId: string | null, contactId: string, now: Date): Promise<void> {
    await this.db.complianceReviewQueue.update({
      where: { id: queueId },
      data: { status: 'ESCALATED', escalated_at: now, escalated_to_contact_id: contactId },
    });
    // hold + notify (§5.5): the draft is held so it cannot be self-approved while escalated.
    if (draftId) {
      await this.db.draftMessage.update({ where: { id: draftId }, data: { approval_state: 'HELD' } });
    }
  }

  async markHeldNoContact(queueId: string, draftId: string | null, now: Date): Promise<void> {
    await this.db.complianceReviewQueue.update({
      where: { id: queueId },
      data: { status: 'HELD', escalated_at: now },
    });
    if (draftId) {
      await this.db.draftMessage.update({ where: { id: draftId }, data: { approval_state: 'HELD' } });
    }
  }
}

// ── Notify seam (§5.5 "notify") ────────────────────────────────────────────────────────────────────

export interface ComplianceEscalationAlert {
  kind: 'sla_escalation';
  queueId: string;
  draftId: string | null;
  repId: string | null;
  complianceContactId: string;
}

export type AlertComplianceContactFn = (alert: ComplianceEscalationAlert) => void | Promise<void>;

/** Default notify sink: a structured log line — the seam a real deployment wires to email/Slack. */
export const defaultAlertComplianceContact: AlertComplianceContactFn = (alert) => {
  // eslint-disable-next-line no-console
  console.error('[compliance][sla-escalation] escalated to compliance contact:', JSON.stringify(alert));
};

// ── The sweep ───────────────────────────────────────────────────────────────────────────────────

export interface SlaEscalationDeps {
  store: SlaEscalationStore;
  /** The immutable audit store (T-10). Default = a Prisma-backed AuditService over `prismaForAudit`. */
  audit?: AuditService;
  /** Only needed to build the default `audit` — a Prisma client with the `auditEntry` delegate. */
  prismaForAudit?: { auditEntry: AuditEntryPrismaDelegate };
  alertComplianceContact?: AlertComplianceContactFn;
  clock?: () => Date;
}

export interface SlaEscalationResult {
  ok: boolean;
  considered: number;
  escalated: number;
  held: number;
  skippedReason?: string;
}

function cfeChannel(channel: string): Channel {
  switch (channel) {
    case 'EMAIL':
      return 'EMAIL';
    case 'SOCIAL_DM':
      return 'SOCIAL';
    default:
      return 'SMS';
  }
}

/**
 * The 48h SLA sweep. Fail-safe: an unreachable DB / any enumeration error logs and returns a clean
 * no-op (the next hourly tick retries) — it never throws across this boundary. Fail-CLOSED: every
 * overdue item ends HELD (escalated-and-held, or held-with-no-contact); NONE is ever auto-cleared.
 */
export async function runSlaEscalationSweep(deps: SlaEscalationDeps): Promise<SlaEscalationResult> {
  const clock = deps.clock ?? (() => new Date());
  const alert = deps.alertComplianceContact ?? defaultAlertComplianceContact;

  let audit = deps.audit;
  if (!audit) {
    if (!deps.prismaForAudit) {
      // eslint-disable-next-line no-console
      console.error('[compliance][sla-escalation] no audit store supplied; no-op.');
      return { ok: false, considered: 0, escalated: 0, held: 0, skippedReason: 'no_audit_store' };
    }
    audit = new AuditService(new PrismaAuditRepository(deps.prismaForAudit));
  }

  try {
    const now = clock();
    const overdue = await deps.store.listOverdueRows(now);
    let escalated = 0;
    let held = 0;

    for (const row of overdue) {
      const contactId = row.repId ? await deps.store.resolveComplianceContactId(row.repId) : null;
      const draft = row.draftId ? await deps.store.getDraftForAudit(row.draftId) : null;

      if (contactId) {
        await deps.store.markEscalated(row.queueId, row.draftId, contactId, now);
        await recordSlaAudit(audit, draft, row, 'SLA_ESCALATED_TO_COMPLIANCE_CONTACT', { escalated_to_contact_id: contactId });
        await alert({ kind: 'sla_escalation', queueId: row.queueId, draftId: row.draftId, repId: row.repId, complianceContactId: contactId });
        escalated += 1;
      } else {
        // FAIL-CLOSED: un-escalatable → stays HELD, never auto-cleared (§5.2).
        await deps.store.markHeldNoContact(row.queueId, row.draftId, now);
        await recordSlaAudit(audit, draft, row, 'SLA_HELD_NO_COMPLIANCE_CONTACT', { reason: 'no_compliance_contact' });
        held += 1;
      }
    }

    return { ok: true, considered: overdue.length, escalated, held };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[compliance][sla-escalation] infra unavailable this pass; graceful no-op.', err);
    return { ok: false, considered: 0, escalated: 0, held: 0, skippedReason: 'infra_unavailable' };
  }
}

// T-57 RG8 (i18n; server-i18n-leak) — PERMANENT-EXEMPT (`SERVER_I18N_LEAK_BASELINE.json`,
// `content_text: [SLA escalation for queue`). This `content_text` fallback (used only when there is
// no real `draft.body` to audit against) writes into `AuditService.recordAuditEvent`'s durable,
// hash-chained COMPLIANCE audit log (§5.7) — confirmed by grep that NO `.tsx` anywhere in this
// codebase ever reads/renders `AuditEvent.content_text` (it is a write-only evidentiary record for
// a compliance-officer/regulator audit trail, never a rep-facing surface). Never localize: audit
// records must stay in the language the SYSTEM records events in (auditability/consistency of the
// evidentiary trail), not the acting rep's UI locale — mirrors `audit/sinks.ts`'s and
// `incident-audit-sink.ts`'s own PERMANENT-EXEMPT narratives (same class, same rationale).
async function recordSlaAudit(
  audit: AuditService,
  draft: DraftAuditContext | null,
  row: OverdueQueueRow,
  reviewerAction: string,
  extra: Record<string, unknown>
): Promise<void> {
  await audit.recordAuditEvent({
    domain: 'cfe',
    user_id: draft?.user_id ?? row.repId ?? 'unknown',
    role: Role.REP,
    content_id: row.draftId,
    content_text: draft?.body ?? `[SLA escalation for queue ${row.queueId}]`,
    channel: draft ? cfeChannel(draft.channel) : null,
    risk_score: draft?.cfe_risk_score ?? row.riskScore ?? 0,
    outcome: 'FLAG',
    event_data: { source: 'T09_SLA_ESCALATION', queue_id: row.queueId, sla_hours: 48, ...extra },
    regulation: 'FINRA',
    rule_version: CFE_RULE_VERSION,
    reviewer_id: null,
    reviewer_action: reviewerAction,
  });
}
