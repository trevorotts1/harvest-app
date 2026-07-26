// T-09 (master-spec §5.5 CFE adjudication + human loop). THE UPLINE ADJUDICATION PATH (AC-3b) — the
// missing half of the §8.7.1 "Flag (11–70): Hold in queue; route for Upline / Principal review"
// pipeline. It wires the previously-unused `ComplianceReviewQueue` / `ComplianceUplineReview` models
// so a FLAG-banded, PENDING DraftMessage on ORG-GATED content (the drafting rep has an upline within
// an org) becomes ACTIONABLE by that rep's UPLINE — not merely visible read-only.
//
// It CONSUMES, and never rebuilds/weakens, the already-built pieces:
//   • the CFE band on the draft (agent-runtime is the one choke point that set it);
//   • the §16.6 `compliance_audit.approve` grant (UPLINE/RVP/ADMIN) — checked at the route layer;
//   • the immutable, hash-chained AuditService (T-10) — every queue entry AND every decision is
//     appended there (§8.7.1 "linked to the original classification record");
//   • the Claude-only, fail-safe `AdjudicationAdvisor` (AC-2 Sonnet 5 / AC-7 Opus 4.8) — ADVISORY.
//
// FAIL-CLOSED TEETH (§5.2, non-negotiable): a HELD or BLOCK draft is NEVER approvable — not by the
// rep (existing `approveDraft`/Shift/Today refusals, untouched) and NOT by an upline here either.
// `adjudicate('APPROVE')` requires `approval_state === 'PENDING' && cfe_outcome === 'FLAG'`; anything
// else is refused. An edit (`MODIFY`) unconditionally re-enters the CFE before persisting and can
// only ever land PENDING (clear/flag) or HELD (held/blocked) — it never auto-approves.
//
// STRICT ORG-SCOPING (§16.6 / §17.1): every read/write is scoped to the upline's OWN downline
// (UPLINE = direct downline by `upline_id`; RVP/ADMIN = their whole org). A queue row whose rep is
// outside that scope is indistinguishable from a nonexistent one (`not_found` → the route's 404),
// never a 403 that would leak its existence cross-org.

import { Role } from '@prisma/client';

import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { Channel, ClassifierResult, VocabularyMode } from '@/types/compliance';
import { CFE_RULE_VERSION } from '@/types/compliance';
import {
  AuditService,
  PrismaAuditRepository,
  type AuditEntryPrismaDelegate,
} from '@/services/compliance/audit/audit-service';
import { getVocabularyMode } from '@/services/compliance/config/vocabulary-mode';

import { AdjudicationAdvisor } from './adjudication-advisor';
import { coerceClassifierResults } from './escalation-triggers';

// ── Row shapes (narrow, mirrors the DI-mockable-delegate convention across this codebase) ──────────

export interface AdjudicationDraftRow {
  id: string;
  user_id: string;
  contact_id: string;
  channel: string;
  body: string;
  cfe_outcome: string | null;
  cfe_risk_score: number | null;
  cfe_classifier_data: unknown;
  approval_state: string;
}

export interface ReviewQueueRow {
  id: string;
  audit_entry_id: string;
  status: string;
  upline_id: string;
  draft_id: string | null;
  rep_id: string | null;
  risk_score: number | null;
  recommended_action: string | null;
  suggested_rewrite: string | null;
  recommendation_model: string | null;
  escalation_reason: string | null;
  sla_deadline_at: Date | null;
  escalated_at: Date | null;
  escalated_to_contact_id: string | null;
  created_at: Date;
}

export interface AdjudicationContactRow {
  id: string;
  first_name: string;
  last_name: string;
}

/** Narrow Prisma surface — DI-mockable (same convention as ApprovalInboxPrismaClient / RosterPrismaClient). */
export interface CfeAdjudicationPrismaClient {
  draftMessage: {
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<AdjudicationDraftRow[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<AdjudicationDraftRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AdjudicationDraftRow>;
  };
  complianceReviewQueue: {
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<ReviewQueueRow[]>;
    findFirst(args: { where: Record<string, unknown> }): Promise<ReviewQueueRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<ReviewQueueRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ReviewQueueRow>;
  };
  complianceUplineReview: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  user: {
    findMany(args: { where: Record<string, unknown>; select?: Record<string, unknown> }): Promise<{ id: string }[]>;
  };
  contact: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; first_name: true; last_name: true };
    }): Promise<AdjudicationContactRow[]>;
  };
  auditEntry: AuditEntryPrismaDelegate;
}

export interface UplineActor {
  id: string;
  role: Role;
  organizationId: string | null;
}

export type AdjudicationAction = 'APPROVE' | 'REJECT' | 'MODIFY';

export interface QueueItem {
  queueId: string;
  draftId: string;
  repId: string;
  status: string;
  channel: string;
  body: string;
  cfeOutcome: string | null;
  riskScore: number | null;
  classifierResults: ClassifierResult[];
  recommendedAction: string | null;
  suggestedRewrite: string | null;
  recommendationModel: string | null;
  escalationReason: string | null;
  slaDeadlineAt: string | null;
  createdAt: string;
  contact: { firstName: string; lastName: string } | null;
}

// T-R51 (OBSERVE variant) — §0.5 doctrine-vocabulary observability, surfaced read-only on the same
// compliance-review page uplines already use for FLAG adjudication (see the module doc's own
// "STRICT ORG-SCOPING" note — this reuses that exact scope, never wider). Deliberately minimal:
// term + count + last-seen + which rep + which band, NOT the raw message body — this is a
// frequency/refinement tool for the operator, not a second copy of the adjudication queue.
export interface VocabularyTermStat {
  forbidden: string;
  count: number;
  lastSeenAt: string;
}

export interface VocabularyObservabilityEvent {
  auditEntryId: string;
  repId: string;
  band: string;
  matchedTerms: string[];
  occurredAt: string;
}

export interface VocabularyObservability {
  /** The `CFE_VOCABULARY_MODE` this read reflects. The vocabulary block itself is identical in
   *  both modes — 'block' mode simply has nothing to show here (no violation ever gets its
   *  observability fields populated in that mode; see `engine.ts`'s `buildVerdict`). */
  mode: VocabularyMode;
  totalCatches: number;
  byTerm: VocabularyTermStat[];
  recentEvents: VocabularyObservabilityEvent[];
}

export type AdjudicateResult =
  | { ok: true; action: AdjudicationAction; draftId: string; approvalState: string; auditEntryId: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_adjudicable'; currentState: string; cfeOutcome: string | null }
  | { ok: false; reason: 'empty_body' }
  | { ok: false; reason: 'invalid_action' };

/** ORG-GATED roles are scoped org-wide (§16.6 row 4 "rvp=org-wide, admin=full"); everyone else gets
 *  their direct downline (`upline_id`). Mirrors team-calendar/dashboard.service.ts `resolveTeamMemberIds`
 *  — re-implemented locally so foundational WP11 compliance does not depend on WP09 team-calendar. */
const ORG_WIDE_ROLES: readonly Role[] = [Role.RVP, Role.ADMIN];

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export class CfeAdjudicationService {
  private readonly prisma: CfeAdjudicationPrismaClient;
  private readonly cfe: ComplianceFilterEngine;
  private readonly advisor: AdjudicationAdvisor;
  private readonly audit: AuditService;
  private readonly clock: () => Date;

  constructor(deps: {
    prisma: CfeAdjudicationPrismaClient;
    cfe?: ComplianceFilterEngine;
    advisor?: AdjudicationAdvisor;
    clock?: () => Date;
  }) {
    this.prisma = deps.prisma;
    // Lazy defaults — no key read at construction (build-safety rule).
    this.cfe = deps.cfe ?? new ComplianceFilterEngine();
    this.advisor = deps.advisor ?? new AdjudicationAdvisor({ cfe: this.cfe });
    this.audit = new AuditService(
      new PrismaAuditRepository(this.prisma as unknown as { auditEntry: AuditEntryPrismaDelegate })
    );
    this.clock = deps.clock ?? (() => new Date());
  }

  /** §16.6 row 4 — an UPLINE/DUAL sees their direct downline; RVP/ADMIN see their whole org. Never
   *  cross-org (an RVP/ADMIN with no org resolves to an EMPTY scope — fail-closed, not org-wide). */
  private async resolveDownlineRepIds(upline: UplineActor): Promise<string[]> {
    if (ORG_WIDE_ROLES.includes(upline.role)) {
      if (!upline.organizationId) return [];
      const rows = await this.prisma.user.findMany({
        where: { organization_id: upline.organizationId, id: { not: upline.id } },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    const rows = await this.prisma.user.findMany({ where: { upline_id: upline.id }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /**
   * §5.5 AC-3b / §8.7.1 — the upline's actionable review queue. Resolves the upline's org-scoped
   * downline, lazily materializes a `ComplianceReviewQueue` row (+ its immutable "entered review"
   * AuditEntry + the ADVISORY Sonnet/Opus recommendation) for every FLAG-banded PENDING draft that
   * doesn't yet have one, then returns the enriched, actionable rows. A rep outside the upline's
   * scope simply never appears — no cross-org leak.
   */
  async listUplineQueue(upline: UplineActor): Promise<QueueItem[]> {
    const repIds = await this.resolveDownlineRepIds(upline);
    if (repIds.length === 0) return [];

    // The org-gated FLAG drafts still awaiting a decision.
    const flaggedDrafts = await this.prisma.draftMessage.findMany({
      where: { user_id: { in: repIds }, approval_state: 'PENDING', cfe_outcome: 'FLAG' },
      orderBy: { created_at: 'desc' },
    });

    for (const draft of flaggedDrafts) {
      await this.ensureQueueEntry(upline, draft);
    }

    // Read back every actionable queue row for this upline's scope (PENDING or SLA-ESCALATED — an
    // escalated item is still awaiting a human and remains visible; terminal decisions drop out).
    const rows = await this.prisma.complianceReviewQueue.findMany({
      where: { rep_id: { in: repIds }, status: { in: ['PENDING', 'ESCALATED'] } },
      orderBy: { created_at: 'desc' },
    });
    if (rows.length === 0) return [];

    const draftIds = rows.map((r) => r.draft_id).filter((d): d is string => !!d);
    const drafts = await this.prisma.draftMessage.findMany({ where: { id: { in: draftIds } } });
    const draftById = new Map(drafts.map((d) => [d.id, d]));

    const contactIds = Array.from(new Set(drafts.map((d) => d.contact_id)));
    const contacts =
      contactIds.length > 0
        ? await this.prisma.contact.findMany({
            where: { id: { in: contactIds } },
            select: { id: true, first_name: true, last_name: true },
          })
        : [];
    const contactById = new Map(contacts.map((c) => [c.id, c]));

    const items: QueueItem[] = [];
    for (const row of rows) {
      if (!row.draft_id) continue;
      const draft = draftById.get(row.draft_id);
      if (!draft) continue;
      const c = contactById.get(draft.contact_id);
      items.push({
        queueId: row.id,
        draftId: row.draft_id,
        repId: row.rep_id ?? draft.user_id,
        status: row.status,
        channel: draft.channel,
        body: draft.body,
        cfeOutcome: draft.cfe_outcome,
        riskScore: row.risk_score ?? draft.cfe_risk_score,
        classifierResults: coerceClassifierResults(draft.cfe_classifier_data),
        recommendedAction: row.recommended_action,
        suggestedRewrite: row.suggested_rewrite,
        recommendationModel: row.recommendation_model,
        escalationReason: row.escalation_reason,
        slaDeadlineAt: row.sla_deadline_at ? row.sla_deadline_at.toISOString() : null,
        createdAt: row.created_at.toISOString(),
        contact: c ? { firstName: c.first_name, lastName: c.last_name } : null,
      });
    }
    return items;
  }

  /**
   * T-R51 (OBSERVE variant) — §0.5 doctrine-vocabulary observability for the upline's downline
   * (SAME org-scoping as `listUplineQueue`, deliberately reused via `resolveDownlineRepIds`: an
   * upline sees their direct downline's catches, RVP/ADMIN see their whole org — never wider).
   *
   * Reads through the EXISTING durable audit mechanism (`AuditService.query`, T-10) — no new
   * table, no new query path into Postgres. Every CFE decision for these reps is already there;
   * this filters, in-memory, for the ones carrying a T-R51 `vocabulary_violations` record (which
   * `engine.ts` only ever attaches when `CFE_VOCABULARY_MODE==='observe'`, the default) and
   * aggregates by term. Additive and read-only: this method never touches a block/release
   * decision — those are long since final by the time an AuditEntry exists.
   *
   * KNOWN MVP SCALING LIMIT (deferred, see T-R51 build report): this scans every audit row for the
   * scoped reps and filters client-side, matching this file's own `listUplineQueue` convention. On
   * a very large audit table a dedicated indexed query (or a materialized per-term counter) would
   * be needed instead; acceptable for the operator's stated "MVP to dogfood" scope.
   */
  async listVocabularyObservability(upline: UplineActor): Promise<VocabularyObservability> {
    const mode = getVocabularyMode();
    const repIds = await this.resolveDownlineRepIds(upline);
    if (repIds.length === 0) {
      return { mode, totalCatches: 0, byTerm: [], recentEvents: [] };
    }

    const rows = await this.audit.query({ user_ids: repIds });
    // Newest first — term aggregation is order-independent, but this makes "first time we see a
    // term while scanning" equal to "most recently seen," and caps `recentEvents` to the newest.
    const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const termCounts = new Map<string, { count: number; lastSeenAt: string }>();
    const recentEvents: VocabularyObservabilityEvent[] = [];
    let totalCatches = 0;

    for (const row of sorted) {
      const data = (row.classifier_data ?? {}) as Record<string, unknown>;
      const rawViolations = Array.isArray(data.vocabulary_violations) ? data.vocabulary_violations : [];
      const matchedTerms = rawViolations
        .map((entry) =>
          entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).forbidden === 'string'
            ? ((entry as Record<string, unknown>).forbidden as string)
            : null
        )
        .filter((t): t is string => !!t);
      if (matchedTerms.length === 0) continue;

      totalCatches += 1;
      for (const term of matchedTerms) {
        const existing = termCounts.get(term);
        if (existing) {
          existing.count += 1;
        } else {
          termCounts.set(term, { count: 1, lastSeenAt: row.created_at });
        }
      }

      if (recentEvents.length < 50) {
        recentEvents.push({
          auditEntryId: row.id,
          repId: row.user_id,
          band: typeof data.band === 'string' ? data.band : 'blocked',
          matchedTerms,
          occurredAt: row.created_at,
        });
      }
    }

    const byTerm: VocabularyTermStat[] = Array.from(termCounts.entries())
      .map(([forbidden, v]) => ({ forbidden, count: v.count, lastSeenAt: v.lastSeenAt }))
      .sort((a, b) => b.count - a.count);

    return { mode, totalCatches, byTerm, recentEvents };
  }

  /** Idempotent per-draft: creates the queue row (+ entry AuditEntry + ADVISORY recommendation) the
   *  first time a flagged draft is seen; a subsequent read finds it already present and no-ops. */
  private async ensureQueueEntry(upline: UplineActor, draft: AdjudicationDraftRow): Promise<void> {
    const existing = await this.prisma.complianceReviewQueue.findFirst({ where: { draft_id: draft.id } });
    if (existing) return;

    const now = this.clock();
    // §8.7.1 — the immutable "entered upline review" evidence, linked to the classification record.
    const auditEntryId = await this.audit.recordAuditEvent({
      domain: 'cfe',
      user_id: draft.user_id,
      role: Role.REP,
      content_id: draft.id,
      content_text: draft.body,
      channel: this.cfeChannel(draft.channel),
      risk_score: draft.cfe_risk_score ?? 0,
      outcome: 'FLAG',
      event_data: { source: 'T09_ENTERED_UPLINE_REVIEW', upline_id: upline.id },
      regulation: 'FINRA',
      rule_version: CFE_RULE_VERSION,
      reviewer_id: null,
      reviewer_action: 'QUEUED_FOR_UPLINE_REVIEW',
    });

    const row = await this.prisma.complianceReviewQueue.create({
      data: {
        audit_entry_id: auditEntryId,
        status: 'PENDING',
        upline_id: upline.id,
        draft_id: draft.id,
        rep_id: draft.user_id,
        risk_score: draft.cfe_risk_score ?? null,
        sla_deadline_at: new Date(now.getTime() + FORTY_EIGHT_HOURS_MS),
      },
    });

    // AC-2 / AC-7 — the Claude-only, fail-safe ADVISORY recommendation. Best-effort: a null result
    // (no key, kill-switch denial, model/parse error, or a rewrite that didn't itself clear the CFE)
    // simply leaves the recommendation absent — NEVER an auto-clear, NEVER blocks the queue entry.
    try {
      const rec = await this.advisor.recommend({
        content: draft.body,
        channel: this.cfeChannel(draft.channel),
        userId: draft.user_id,
        role: Role.REP,
        classifierResults: coerceClassifierResults(draft.cfe_classifier_data),
        riskScore: draft.cfe_risk_score ?? 0,
      });
      if (rec) {
        await this.prisma.complianceReviewQueue.update({
          where: { id: row.id },
          data: {
            recommended_action: rec.recommendedAction,
            suggested_rewrite: rec.suggestedRewrite,
            recommendation_model: rec.model,
            escalation_reason: rec.escalationReason,
          },
        });
      }
    } catch {
      // Advisory is never a gate — a failure here is absorbed (recommendation stays absent).
    }
  }

  /**
   * §5.5 AC-3b — an UPLINE adjudicates ONE flagged item. Org-scoped (a rep outside the upline's
   * scope → `not_found`, never a leak), fail-closed (HELD/BLOCK never approvable), and every
   * decision is written BOTH as a `ComplianceUplineReview` row AND an immutable AuditEntry.
   *
   * NOTE: RBAC (`compliance_audit.approve`) is enforced at the route boundary (`withOnboardingGate`
   * + `hasCapability`) before this runs — this service is the org-scope + fail-closed + audit layer.
   */
  async adjudicate(
    upline: UplineActor,
    args: { queueId?: string; draftId?: string; action: AdjudicationAction; feedback?: string | null; newBody?: string | null }
  ): Promise<AdjudicateResult> {
    if (args.action !== 'APPROVE' && args.action !== 'REJECT' && args.action !== 'MODIFY') {
      return { ok: false, reason: 'invalid_action' };
    }

    // Resolve the upline's org scope FIRST, then find the queue row WITHIN it — a row outside scope
    // is indistinguishable from a nonexistent one (404, not a leaky 403).
    const repIds = await this.resolveDownlineRepIds(upline);
    const where: Record<string, unknown> = { rep_id: { in: repIds } };
    if (args.queueId) where.id = args.queueId;
    else if (args.draftId) where.draft_id = args.draftId;
    else return { ok: false, reason: 'not_found' };

    const queueRow = repIds.length === 0 ? null : await this.prisma.complianceReviewQueue.findFirst({ where });
    if (!queueRow || !queueRow.draft_id) return { ok: false, reason: 'not_found' };

    const draft = await this.prisma.draftMessage.findFirst({ where: { id: queueRow.draft_id } });
    // Belt: the draft must still belong to a rep inside scope (defends against a stale/tampered row).
    if (!draft || !repIds.includes(draft.user_id)) return { ok: false, reason: 'not_found' };

    if (args.action === 'APPROVE') return this.doApprove(upline, queueRow, draft, args.feedback ?? null);
    if (args.action === 'REJECT') return this.doReject(upline, queueRow, draft, args.feedback ?? null);
    return this.doModify(upline, queueRow, draft, args.newBody ?? '', args.feedback ?? null);
  }

  private async doApprove(
    upline: UplineActor,
    queueRow: ReviewQueueRow,
    draft: AdjudicationDraftRow,
    feedback: string | null
  ): Promise<AdjudicateResult> {
    // FAIL-CLOSED TEETH: a HELD draft (a blocked verdict or a fail-closed hold — `approval_state`
    // is never PENDING for those) and a BLOCK `cfe_outcome` are UNCONDITIONALLY refused — no human,
    // upline included, can approve them (§5.2). A PENDING draft that is FLAG (the principal-review
    // case) or PASS (e.g. a prior MODIFY cleaned it) is approvable; already-terminal is refused.
    const approvableOutcome = draft.cfe_outcome === 'FLAG' || draft.cfe_outcome === 'PASS';
    if (draft.approval_state !== 'PENDING' || !approvableOutcome) {
      return { ok: false, reason: 'not_adjudicable', currentState: draft.approval_state, cfeOutcome: draft.cfe_outcome };
    }

    await this.prisma.draftMessage.update({
      where: { id: draft.id },
      data: { approval_state: 'APPROVED', approved_by: upline.id, approved_at: this.clock() },
    });
    const auditEntryId = await this.recordDecision(upline, queueRow, draft, 'APPROVE', feedback, 'APPROVED_BY_UPLINE');
    await this.prisma.complianceReviewQueue.update({ where: { id: queueRow.id }, data: { status: 'APPROVED' } });
    return { ok: true, action: 'APPROVE', draftId: draft.id, approvalState: 'APPROVED', auditEntryId };
  }

  private async doReject(
    upline: UplineActor,
    queueRow: ReviewQueueRow,
    draft: AdjudicationDraftRow,
    feedback: string | null
  ): Promise<AdjudicateResult> {
    if (draft.approval_state === 'APPROVED' || draft.approval_state === 'DECLINED') {
      return { ok: false, reason: 'not_adjudicable', currentState: draft.approval_state, cfeOutcome: draft.cfe_outcome };
    }
    await this.prisma.draftMessage.update({
      where: { id: draft.id },
      data: { approval_state: 'DECLINED', decline_reason: 'other', decline_note: feedback },
    });
    const auditEntryId = await this.recordDecision(upline, queueRow, draft, 'REJECT', feedback, 'REJECTED_BY_UPLINE');
    await this.prisma.complianceReviewQueue.update({ where: { id: queueRow.id }, data: { status: 'REJECTED' } });
    return { ok: true, action: 'REJECT', draftId: draft.id, approvalState: 'DECLINED', auditEntryId };
  }

  /** MODIFY = edit-and-re-check. The edited body UNCONDITIONALLY re-enters the CFE before it is
   *  persisted (AC-4 "edit re-enters CFE, no bypass"): a held/blocked verdict lands the draft HELD
   *  (fail-closed), a clear/flag verdict lands it PENDING — it NEVER auto-approves. A follow-up
   *  APPROVE (on the now-PENDING FLAG draft) is a separate, explicit decision. */
  private async doModify(
    upline: UplineActor,
    queueRow: ReviewQueueRow,
    draft: AdjudicationDraftRow,
    newBody: string,
    feedback: string | null
  ): Promise<AdjudicateResult> {
    if (draft.approval_state === 'APPROVED' || draft.approval_state === 'DECLINED') {
      return { ok: false, reason: 'not_adjudicable', currentState: draft.approval_state, cfeOutcome: draft.cfe_outcome };
    }
    if (typeof newBody !== 'string' || newBody.trim().length === 0) {
      return { ok: false, reason: 'empty_body' };
    }

    const verdict = await this.cfe.evaluateContent({
      content: newBody,
      channel: this.cfeChannel(draft.channel),
      userContext: { user_id: draft.user_id, role: Role.REP, content_id: draft.id },
    });
    const held = verdict.held || verdict.band === 'blocked';
    const nextState = held ? 'HELD' : 'PENDING';
    const nextOutcome = held ? 'BLOCK' : verdict.band === 'review' ? 'FLAG' : 'PASS';

    await this.prisma.draftMessage.update({
      where: { id: draft.id },
      data: {
        body: newBody,
        cfe_outcome: nextOutcome,
        cfe_risk_score: verdict.score,
        cfe_classifier_data: verdict.classifierResults,
        approval_state: nextState,
        approved_by: null,
        approved_at: null,
      },
    });
    const auditEntryId = await this.recordDecision(upline, queueRow, draft, 'MODIFY', feedback, 'MODIFIED_BY_UPLINE');
    await this.prisma.complianceReviewQueue.update({ where: { id: queueRow.id }, data: { status: 'MODIFIED' } });
    return { ok: true, action: 'MODIFY', draftId: draft.id, approvalState: nextState, auditEntryId };
  }

  /** §8.7.1 — one immutable AuditEntry per decision + the `ComplianceUplineReview` decision row. */
  private async recordDecision(
    upline: UplineActor,
    queueRow: ReviewQueueRow,
    draft: AdjudicationDraftRow,
    action: AdjudicationAction,
    feedback: string | null,
    reviewerAction: string
  ): Promise<string> {
    const auditEntryId = await this.audit.recordAuditEvent({
      domain: 'cfe',
      user_id: draft.user_id,
      role: upline.role,
      content_id: draft.id,
      content_text: draft.body,
      channel: this.cfeChannel(draft.channel),
      risk_score: draft.cfe_risk_score ?? 0,
      outcome: 'FLAG',
      event_data: { source: 'T09_UPLINE_ADJUDICATION', action, upline_id: upline.id, queue_id: queueRow.id, feedback: feedback ?? undefined },
      regulation: 'FINRA',
      rule_version: CFE_RULE_VERSION,
      reviewer_id: upline.id,
      reviewer_action: reviewerAction,
    });
    await this.prisma.complianceUplineReview.create({
      data: {
        audit_entry_id: auditEntryId,
        queue_id: queueRow.id,
        draft_id: draft.id,
        reviewer_id: upline.id,
        action,
        feedback: feedback ?? null,
      },
    });
    return auditEntryId;
  }

  /** PersistedChannel → the CFE's `Channel` vocabulary (mirrors ApprovalInboxService's own mapping). */
  private cfeChannel(channel: string): Channel {
    switch (channel) {
      case 'EMAIL':
        return 'EMAIL';
      case 'SOCIAL_DM':
        return 'SOCIAL';
      case 'SMS_HANDOFF':
      case 'SMS_PLATFORM':
      case 'IN_APP':
      default:
        return 'SMS';
    }
  }
}
