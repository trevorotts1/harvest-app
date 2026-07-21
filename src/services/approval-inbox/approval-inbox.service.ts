// T-33 — the Approval Inbox (master-spec §9.2; uiux §5.6/§4.3).
//
// Consumes the T-30 runtime seam verbatim (src/services/agent-runtime/index.ts's own header
// comment names this unit's contract): reads `DraftMessage` rows — each already carrying its CFE
// band/outcome from the ONE choke point in agent-runtime.ts (`cfe_outcome` / `cfe_risk_score` /
// `cfe_classifier_data` / `approval_state`) — and, on edit, re-enters the CFE by calling
// `ComplianceFilterEngine.evaluateContent` again before the item can be approved/sent. This module
// does NOT modify the CFE engine or the agent runtime; it only calls the engine's public
// `evaluateContent` entry point, exactly as agent-runtime.ts itself does.
//
// Three hard rules enforced here (master-spec §9.2/§9.9-2/§9.9-3):
//   1. NO BATCH APPROVE — `approveDraft`/`declineDraft`/`editDraft` each take exactly ONE draft id
//      (a `string`, never an array/plural field). There is no method on this service, and no route
//      built on top of it, that accepts more than one draft id per call. The route-level guard
//      (`approval-boundary.ts`) is the belt to this suspenders.
//   2. APPROVAL ALWAYS PRECEDES SEND — this service only ever transitions `approval_state`; it never
//      itself sends/publishes (that is WP05/The Shift's lane, downstream of this state).
//   3. EDIT RE-ENTERS THE CFE — `editDraft` is the ONLY way to change `body`, and it unconditionally
//      calls `evaluateContent` on the NEW text before persisting anything. A verdict that is held or
//      blocked HOLDS the item (`approval_state: 'HELD'`) — fail-closed, never approvable as-is. There
//      is no code path in this service that updates `body` without also calling the CFE.
//
// Ownership: every read/write is scoped to `(id, user_id)` — a draft belonging to a different rep is
// indistinguishable from a nonexistent one (`not_found`), never a 403 that would leak existence.
//
// T-R16 (uiux AC-5.6-5) — UX-COMPLETENESS ADDITION, layered on top of everything above, nothing
// removed or loosened: approving a CFE-FLAGGED (non-PASS) draft now REQUIRES a short justification,
// captured on `approveDraft`'s new optional `justification` argument and persisted onto the draft
// (`approval_justification`, additive/nullable column) plus a best-effort compliance-evidence
// AuditEntry (`recordFlaggedApprovalAudit`, mirroring `send-support.ts`'s `linkCfeAuditForSend`
// posture — the audit write is never itself a gate). A clean PASS approval is completely unaffected:
// no justification is required, requested, or stored for it. The PENDING-only approvability check
// above (rule 2's `not_approvable` refusal) is untouched — this is additive to the ALREADY-permitted
// flagged-approve path, never a widening or narrowing of the CFE gate itself.

import { PrismaClient, Role } from '@prisma/client';

import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { Channel, CFEVerdict, ContentLanguage } from '@/types/compliance';
import { CFE_RULE_VERSION } from '@/types/compliance';
import type { PersistedCfeOutcome, PersistedChannel } from '@/services/agent-runtime';
import {
  AuditService,
  PrismaAuditRepository,
  type AuditEntryPrismaDelegate,
} from '@/services/compliance/audit/audit-service';

export interface DraftMessageRow {
  id: string;
  user_id: string;
  contact_id: string;
  channel: PersistedChannel;
  body: string;
  cfe_outcome: PersistedCfeOutcome | null;
  cfe_risk_score: number | null;
  cfe_classifier_data: unknown;
  approval_state: string;
  approved_by: string | null;
  approved_at: Date | null;
  edited_after_approval: boolean;
  // T-R16 (uiux AC-5.6-5) — the rep's short justification, set ONLY when approving a CFE-FLAGGED
  // draft (never for a clean PASS approval, never for a HELD/blocked draft — that has no approve
  // path at all, AC-5.6-4).
  approval_justification: string | null;
  decline_reason: string | null;
  decline_note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContactNameRow {
  id: string;
  first_name: string;
  last_name: string;
}

/** Narrow, DI-mockable Prisma surface — same convention as every other service in this codebase
 *  (ContactFlagsPrismaClient, AgentRuntimeStore's PrismaLike, ...). */
export interface ApprovalInboxPrismaClient {
  draftMessage: {
    findMany(args: {
      where: { user_id: string; approval_state?: string | { in: string[] } };
      orderBy: { created_at: 'desc' };
    }): Promise<DraftMessageRow[]>;
    findFirst(args: { where: { id: string; user_id: string } }): Promise<DraftMessageRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<DraftMessageRow>;
  };
  contact: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; first_name: true; last_name: true };
    }): Promise<ContactNameRow[]>;
  };
  /** T-R16 — OPTIONAL — the append-only AuditEntry delegate `recordFlaggedApprovalAudit` uses to
   *  persist the compliance-evidence record for a flagged approve. Absent in fixtures that predate
   *  this build unit -> the audit write resolves best-effort to a no-op (never a crash, never a
   *  blocked approval — mirrors `send-support.ts`'s `linkCfeAuditForSend` posture exactly); present
   *  (real Prisma, or a test's in-memory store) -> the audit event is written. */
  auditEntry?: AuditEntryPrismaDelegate;
}

export const DECLINE_REASONS = ['not_my_voice', 'wrong_person', 'wrong_time', 'other'] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export interface InboxItem extends DraftMessageRow {
  contact: { firstName: string; lastName: string } | null;
}

export interface ListInboxOptions {
  /** Omitted = the default "awaiting attention" view (PENDING + HELD). A single explicit state
   *  narrows to exactly that state. 'ALL' returns every state (history view). */
  state?: 'PENDING' | 'APPROVED' | 'DECLINED' | 'HELD' | 'ALL';
}

export type ApproveResult =
  | { ok: true; draft: DraftMessageRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_approvable'; currentState: string }
  // T-R16 (uiux AC-5.6-5) — a FLAG-banded draft was submitted for approval with no (or blank)
  // justification. Distinct from `not_approvable`: the draft IS approvable in principle (it's
  // PENDING, not HELD) — this refusal is the UX-completeness requirement that a justification
  // accompany a flagged approve, never a widening OR narrowing of the CFE gate itself.
  | { ok: false; reason: 'justification_required' };

export type DeclineResult =
  | { ok: true; draft: DraftMessageRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid_reason' }
  | { ok: false; reason: 'not_declinable'; currentState: string };

export type EditResult =
  | { ok: true; draft: DraftMessageRow; verdict: CFEVerdict }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'empty_body' }
  | { ok: false; reason: 'terminal_state'; currentState: string };

const DEFAULT_AWAITING_STATES = ['PENDING', 'HELD'];

/** §5.4's own band→outcome mapping, mirrored here (agent-runtime.ts's private `bandToOutcome` is
 *  not exported — this is the same pure mapping, re-derived from the CFEVerdict the engine hands
 *  back, not a second source of truth for the banding rules themselves). */
function bandToOutcome(verdict: CFEVerdict): PersistedCfeOutcome {
  if (verdict.held || verdict.band === 'blocked') return 'BLOCK';
  if (verdict.band === 'review') return 'FLAG';
  return 'PASS';
}

/** PersistedChannel → the CFE's own Channel vocabulary, mirroring agent-runtime.ts's private
 *  `cfeChannelFor` (not exported) for the one other call site of `evaluateContent` in this codebase. */
function cfeChannelForPersisted(channel: PersistedChannel): Channel {
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

export class ApprovalInboxService {
  constructor(
    private prisma: ApprovalInboxPrismaClient = new PrismaClient() as unknown as ApprovalInboxPrismaClient,
    // Lazy default: constructing the engine touches no key (only a later `evaluateContent` call
    // does, and only inside `editDraft`, never at construction) — same build-safety convention
    // `AgentRuntime`'s own `deps.cfe ?? new ComplianceFilterEngine()` default follows.
    private cfe: ComplianceFilterEngine = new ComplianceFilterEngine()
  ) {}

  /** §9.2 — every agent-drafted item awaiting the rep's action, carrying its CFE band/risk. Scoped
   *  strictly to `userId` (never another rep's drafts). */
  async listInbox(userId: string, options: ListInboxOptions = {}): Promise<InboxItem[]> {
    const where =
      !options.state || options.state === undefined
        ? { user_id: userId, approval_state: { in: DEFAULT_AWAITING_STATES } }
        : options.state === 'ALL'
          ? { user_id: userId }
          : { user_id: userId, approval_state: options.state };

    const drafts = await this.prisma.draftMessage.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    if (drafts.length === 0) return [];

    const contactIds = Array.from(new Set(drafts.map((d) => d.contact_id)));
    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, first_name: true, last_name: true },
    });
    const contactById = new Map(contacts.map((c) => [c.id, c]));

    return drafts.map((d) => {
      const c = contactById.get(d.contact_id);
      return {
        ...d,
        contact: c ? { firstName: c.first_name, lastName: c.last_name } : null,
      };
    });
  }

  /**
   * §9.9-3/uiux AC-5.6-2 — approve EXACTLY ONE draft. Only a PENDING draft (i.e. one that already
   * carries a RELEASED CFE verdict — PASS or FLAG; agent-runtime.ts never sets PENDING for a
   * held/blocked verdict) is approvable. A HELD item — whether held because the CFE could not
   * decide or because it was banded `blocked` — is refused here with `not_approvable`, mirroring
   * the server-side 403 the uiux spec requires ("blocked items ... cannot be approved by any UI
   * path", AC-5.6-4). Already-APPROVED/DECLINED is refused too (no re-approval of a terminal item).
   *
   * T-R16 (uiux AC-5.6-5) — UX-COMPLETENESS ADDITION, not a CFE gate change: approving a
   * CFE-FLAGGED (non-PASS) draft REQUIRES a non-empty `justification`, refused with
   * `justification_required` otherwise. The justification is persisted onto the draft
   * (`approval_justification`, additive/nullable) and, best-effort, appended as a compliance-
   * evidence AuditEntry (`recordFlaggedApprovalAudit`) — mirroring `send-support.ts`'s
   * `linkCfeAuditForSend` posture: the audit write is never itself a gate on the approval. A clean
   * PASS approval is completely unaffected — no justification is required or stored for it.
   */
  async approveDraft(
    userId: string,
    draftId: string,
    justification?: string | null,
    role: Role = Role.REP
  ): Promise<ApproveResult> {
    const draft = await this.prisma.draftMessage.findFirst({ where: { id: draftId, user_id: userId } });
    if (!draft) return { ok: false, reason: 'not_found' };

    if (draft.approval_state !== 'PENDING') {
      return { ok: false, reason: 'not_approvable', currentState: draft.approval_state };
    }

    const isFlagged = draft.cfe_outcome === 'FLAG';
    const trimmedJustification = typeof justification === 'string' ? justification.trim() : '';
    if (isFlagged && trimmedJustification.length === 0) {
      return { ok: false, reason: 'justification_required' };
    }

    const updated = await this.prisma.draftMessage.update({
      where: { id: draftId },
      data: {
        approval_state: 'APPROVED',
        approved_by: userId,
        approved_at: new Date(),
        approval_justification: isFlagged ? trimmedJustification : null,
      },
    });

    if (isFlagged) {
      await this.recordFlaggedApprovalAudit(userId, draft, trimmedJustification, role);
    }

    return { ok: true, draft: updated };
  }

  /** T-R16 — best-effort compliance-evidence AuditEntry for a flagged approve (never a second CFE
   *  call, never a gate on the approval itself). Any failure — no `auditEntry` delegate wired into
   *  this narrow Prisma surface, a DB error — resolves silently; the caller's approval has already
   *  succeeded by the time this runs. Mirrors `send-support.ts`'s `linkCfeAuditForSend` exactly. */
  private async recordFlaggedApprovalAudit(
    userId: string,
    draft: DraftMessageRow,
    justification: string,
    role: Role
  ): Promise<void> {
    try {
      if (!this.prisma.auditEntry) return;
      const auditService = new AuditService(
        new PrismaAuditRepository(this.prisma as unknown as { auditEntry: AuditEntryPrismaDelegate })
      );
      await auditService.recordAuditEvent({
        domain: 'cfe',
        user_id: userId,
        role,
        content_id: draft.id,
        content_text: draft.body,
        channel: cfeChannelForPersisted(draft.channel),
        risk_score: draft.cfe_risk_score ?? 0,
        outcome: 'FLAG',
        event_data: { source: 'T_R16_FLAGGED_APPROVE', justification },
        regulation: 'NONE',
        rule_version: CFE_RULE_VERSION,
        reviewer_id: userId,
        reviewer_action: 'APPROVED_FLAGGED',
      });
    } catch {
      // Best-effort — see doc comment above.
    }
  }

  /** Decline/discard — the reason selector always intercepts (uiux AC-5.6-9). PENDING or HELD items
   *  may be declined (a HELD/blocked item's only actions are "use the rewrite" or discard). */
  async declineDraft(
    userId: string,
    draftId: string,
    reason: string,
    note?: string | null
  ): Promise<DeclineResult> {
    if (!DECLINE_REASONS.includes(reason as DeclineReason)) {
      return { ok: false, reason: 'invalid_reason' };
    }

    const draft = await this.prisma.draftMessage.findFirst({ where: { id: draftId, user_id: userId } });
    if (!draft) return { ok: false, reason: 'not_found' };

    if (draft.approval_state !== 'PENDING' && draft.approval_state !== 'HELD') {
      return { ok: false, reason: 'not_declinable', currentState: draft.approval_state };
    }

    const updated = await this.prisma.draftMessage.update({
      where: { id: draftId },
      data: { approval_state: 'DECLINED', decline_reason: reason, decline_note: note ?? null },
    });
    return { ok: true, draft: updated };
  }

  /**
   * THE HARD RULE: editing a draft's content RE-ENTERS THE CFE before it can be approved/sent.
   * There is exactly one call to `this.cfe.evaluateContent` on this path, and it happens BEFORE the
   * updated `body`/`approval_state` are ever persisted — a caller cannot observe an edited body that
   * hasn't already been re-evaluated. A verdict that is held or banded `blocked` sets
   * `approval_state: 'HELD'` (fail-closed) rather than `PENDING`, so a now-non-compliant edit can
   * never be approved. Terminal (DECLINED) drafts cannot be edited — start a new draft instead.
   *
   * T-53 (master-spec §17.5 / uiux §6.2) — THE COMPOSER'S PER-DRAFT LANGUAGE TOGGLE: this is the
   * one place a rep actually composes/revises a draft's text before it can send, so it is the real
   * doorway for `CFEInput.language`. `language` is optional and independent of the rep's own
   * workspace ("Me -> Language") preference — a rep can work the app in English and edit THIS draft
   * into Spanish (or vice-versa); omitting it keeps the pre-T-53 behavior byte-identical (defaults
   * to 'en' inside the engine). The route (`/api/approval-inbox/edit`) is the live call site that
   * lets a rep flip this per edit.
   */
  async editDraft(
    userId: string,
    draftId: string,
    newBody: string,
    role: Role = Role.REP,
    language?: ContentLanguage
  ): Promise<EditResult> {
    if (typeof newBody !== 'string' || newBody.trim().length === 0) {
      return { ok: false, reason: 'empty_body' };
    }

    const draft = await this.prisma.draftMessage.findFirst({ where: { id: draftId, user_id: userId } });
    if (!draft) return { ok: false, reason: 'not_found' };

    if (draft.approval_state === 'DECLINED') {
      return { ok: false, reason: 'terminal_state', currentState: draft.approval_state };
    }

    const wasApproved = draft.approval_state === 'APPROVED';

    // ── THE RE-ENTRY CALL — this is what "edit re-enters the CFE" means. Removing/skipping this
    //    call is exactly the mutation the T-33 test suite proves against. ──────────────────────────
    const verdict = await this.cfe.evaluateContent({
      content: newBody,
      channel: cfeChannelForPersisted(draft.channel),
      userContext: { user_id: userId, role, content_id: draftId },
      language,
    });

    const held = verdict.held || verdict.band === 'blocked';
    const nextApprovalState = held ? 'HELD' : 'PENDING';

    const updated = await this.prisma.draftMessage.update({
      where: { id: draftId },
      data: {
        body: newBody,
        cfe_outcome: bandToOutcome(verdict),
        cfe_risk_score: verdict.score,
        cfe_classifier_data: verdict.classifierResults,
        approval_state: nextApprovalState,
        edited_after_approval: wasApproved ? true : draft.edited_after_approval,
        // The prior approval covered the OLD text only; it is void the moment the text changes —
        // a fresh approval (against the NEW, re-checked text) is required regardless of outcome.
        approved_by: null,
        approved_at: null,
      },
    });

    return { ok: true, draft: updated, verdict };
  }
}
