// T-41 (WP06 §11.5 "Scheduling, publishing & human review") — the Unified Content Queue's CRUD +
// state-machine layer. Six states exactly as spec'd: DRAFTING -> COMPLIANCE_CHECK -> READY_FOR_REVIEW
// -> SCHEDULED -> PUBLISHED, with BLOCKED reachable from DRAFTING/COMPLIANCE_CHECK (doctrine-guard or
// CFE non-release) or from READY_FOR_REVIEW (a rep decline). Ownership is scoped to (id, user_id)
// throughout — a content item belonging to a different rep is indistinguishable from nonexistent
// (`not_found`), never a 403 (§0.4 rule 4 pattern, mirrored from approval-inbox.service.ts).
//
// UNLIKE the Approval Inbox (uiux §5.6: "Batch operations do not exist by design... an 'approve all'
// affordance must never ship" — that rule governs WP04's per-contact outreach queue specifically,
// master-spec §8.5's "batch-blast is an architectural anti-pattern"), WP06's OWN spec explicitly
// requires bulk-approve here: §11.5 "The rep must review each post before scheduling (bulk-approve
// available once the rep trusts the voice; inline edits preserved in the audit trail)" and AC §11.8-4
// "the rep can bulk-approve a week". This service's `bulkApprove` is therefore intentionally NOT the
// same anti-pattern as an Approval-Inbox "approve all" — it operates on the rep's OWN weekly content
// batch (never per-contact outreach), and every item still passed its OWN individual CFE decision
// before it could reach READY_FOR_REVIEW; bulk-approve only batches the SCHEDULING step, never the
// compliance decision.

import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { CFEVerdict } from '@/types/compliance';
import type { CFEOutcome, ContentCategory, ContentQueueState, ContentType, PersonalizationTier, SocialPlatform } from '@prisma/client';
import { scanVocabulary } from './doctrine-guard';
import { DEFAULT_TIME_WINDOWS, nextAvailableWindowSlot, type TimeWindow } from './scheduling-windows';

export interface ContentItemRow {
  id: string;
  user_id: string;
  content_type: ContentType;
  category: ContentCategory | null;
  platform: SocialPlatform | null;
  launch_kit_id: string | null;
  launch_kit_piece_type: string | null;
  brief_id: string | null;
  template_id: string | null;
  personalization_tier: PersonalizationTier;
  headline: string | null;
  body: string;
  image_concept_prompt: string | null;
  cta: string | null;
  state: ContentQueueState;
  cfe_outcome: CFEOutcome | null;
  cfe_risk_score: number | null;
  cfe_classifier_data: unknown;
  vocab_clean: boolean;
  vocab_violations: unknown;
  doctrine_notes: unknown;
  scheduled_for: Date | null;
  published_at: Date | null;
  publish_attempts: number;
  publish_hold_reason: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  edited_after_approval: boolean;
  edit_history: unknown;
  decline_reason: string | null;
  model_used: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContentItemPrismaClient {
  contentItem: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, 'asc' | 'desc'>;
    }): Promise<ContentItemRow[]>;
    findFirst(args: { where: { id: string; user_id: string } }): Promise<ContentItemRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<ContentItemRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ContentItemRow>;
  };
}

export const DECLINE_REASONS = ['not_my_voice', 'off_brief', 'wrong_time', 'other'] as const;
export type ContentDeclineReason = (typeof DECLINE_REASONS)[number];

function cfeChannelForContentType(): 'SOCIAL' {
  // Every WP06 content form is public/rep-published content — the CFE's SOCIAL channel applies
  // uniformly (blog/email are also externally-visible published content, not per-contact outreach).
  return 'SOCIAL';
}

function bandToOutcome(verdict: CFEVerdict): CFEOutcome {
  if (verdict.held || verdict.band === 'blocked') return 'BLOCK';
  if (verdict.band === 'review') return 'FLAG';
  return 'PASS';
}

export interface CreateDraftInput {
  userId: string;
  contentType: ContentType;
  category?: ContentCategory | null;
  platform?: SocialPlatform | null;
  launchKitId?: string | null;
  launchKitPieceType?: string | null;
  briefId?: string | null;
  templateId?: string | null;
  personalizationTier?: PersonalizationTier;
  headline?: string | null;
  body: string;
  imageConceptPrompt?: string | null;
  cta?: string | null;
  vocabClean: boolean;
  vocabViolations?: unknown;
  doctrineNotes?: unknown;
  modelUsed?: string | null;
}

export type CreateDraftResult = { item: ContentItemRow; verdict: CFEVerdict | null };

export type ApproveResult =
  | { ok: true; item: ContentItemRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_ready'; currentState: ContentQueueState };

export type DeclineResult =
  | { ok: true; item: ContentItemRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid_reason' }
  | { ok: false; reason: 'terminal'; currentState: ContentQueueState };

export type EditResult =
  | { ok: true; item: ContentItemRow; verdict: CFEVerdict }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'empty_body' }
  | { ok: false; reason: 'terminal'; currentState: ContentQueueState };

export class ContentItemService {
  constructor(
    private prisma: ContentItemPrismaClient,
    // Lazy default (build-safe, §0.4): constructing the engine touches no key.
    private cfe: ComplianceFilterEngine = new ComplianceFilterEngine()
  ) {}

  /**
   * Persist ONE generated draft. §11.8-1/§0.4 rule 3 — the doctrine-guard result AND a fresh CFE
   * decision are BOTH required before an item can land anywhere but BLOCKED. A doctrine-dirty draft
   * (vocabClean=false) is blocked WITHOUT even consulting the CFE (nothing forbidden-vocabulary-
   * bearing is a candidate for release); a clean draft still must clear the CFE. This is the ONE
   * place a ContentItem is created — every caller (content-batch.service, launch-kit.service) goes
   * through this, so there is no code path that persists a queue item without this gate.
   */
  async createFromDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
    if (!input.vocabClean) {
      const item = await this.prisma.contentItem.create({
        data: {
          user_id: input.userId,
          content_type: input.contentType,
          category: input.category ?? null,
          platform: input.platform ?? null,
          launch_kit_id: input.launchKitId ?? null,
          launch_kit_piece_type: input.launchKitPieceType ?? null,
          brief_id: input.briefId ?? null,
          template_id: input.templateId ?? null,
          personalization_tier: input.personalizationTier ?? 'AUTOMATIC',
          headline: input.headline ?? null,
          body: input.body,
          image_concept_prompt: input.imageConceptPrompt ?? null,
          cta: input.cta ?? null,
          state: 'BLOCKED',
          vocab_clean: false,
          vocab_violations: input.vocabViolations ?? null,
          doctrine_notes: input.doctrineNotes ?? null,
          publish_hold_reason: 'DOCTRINE_VOCABULARY_VIOLATION',
          model_used: input.modelUsed ?? null,
        },
      });
      return { item, verdict: null };
    }

    // Transient COMPLIANCE_CHECK is not persisted as an intermediate row write — the CFE call is
    // synchronous and the item is created ALREADY carrying its post-check state (mirrors
    // agent-runtime.ts: the CFE decision happens before the row exists at all).
    const verdict = await this.cfe.evaluateContent({
      content: input.body,
      channel: cfeChannelForContentType(),
      userContext: { user_id: input.userId, role: 'REP' as never },
    });
    const held = verdict.held || verdict.band === 'blocked';
    const item = await this.prisma.contentItem.create({
      data: {
        user_id: input.userId,
        content_type: input.contentType,
        category: input.category ?? null,
        platform: input.platform ?? null,
        launch_kit_id: input.launchKitId ?? null,
        launch_kit_piece_type: input.launchKitPieceType ?? null,
        brief_id: input.briefId ?? null,
        template_id: input.templateId ?? null,
        personalization_tier: input.personalizationTier ?? 'AUTOMATIC',
        headline: input.headline ?? null,
        body: input.body,
        image_concept_prompt: input.imageConceptPrompt ?? null,
        cta: input.cta ?? null,
        state: held ? 'BLOCKED' : 'READY_FOR_REVIEW',
        cfe_outcome: bandToOutcome(verdict),
        cfe_risk_score: verdict.score,
        cfe_classifier_data: verdict.classifierResults,
        vocab_clean: true,
        publish_hold_reason: held ? `CFE_${verdict.heldReason ?? verdict.band}`.toUpperCase() : null,
        model_used: input.modelUsed ?? null,
      },
    });
    return { item, verdict };
  }

  async listQueue(userId: string, state?: ContentQueueState | 'ALL'): Promise<ContentItemRow[]> {
    const where = !state || state === 'ALL' ? { user_id: userId } : { user_id: userId, state };
    return this.prisma.contentItem.findMany({ where, orderBy: { created_at: 'desc' } });
  }

  async getItem(userId: string, id: string): Promise<ContentItemRow | null> {
    return this.prisma.contentItem.findFirst({ where: { id, user_id: userId } });
  }

  /** §11.5 approve = schedule for a specific time (there is no separate "approved" state in the
   *  spec's six — approval IS the READY_FOR_REVIEW -> SCHEDULED transition). Only a clean,
   *  CFE-released item (READY_FOR_REVIEW) is approvable. */
  async approveAndSchedule(userId: string, id: string, scheduledFor: Date): Promise<ApproveResult> {
    const item = await this.prisma.contentItem.findFirst({ where: { id, user_id: userId } });
    if (!item) return { ok: false, reason: 'not_found' };
    if (item.state !== 'READY_FOR_REVIEW') {
      return { ok: false, reason: 'not_ready', currentState: item.state };
    }
    const updated = await this.prisma.contentItem.update({
      where: { id },
      data: {
        state: 'SCHEDULED',
        scheduled_for: scheduledFor,
        approved_by: userId,
        approved_at: new Date(),
      },
    });
    return { ok: true, item: updated };
  }

  /** §11.8-4 "bulk-approve a week" — schedules every given READY_FOR_REVIEW item across the default
   *  (or caller-supplied) time-of-day windows (§11.5), starting from `from`. Each item still only
   *  reaches this method because it ALREADY individually cleared doctrine + the CFE at creation time
   *  — this batches the scheduling step only, never a compliance decision (see class header). */
  async bulkApprove(
    userId: string,
    ids: string[],
    from: Date,
    windows: TimeWindow[] = DEFAULT_TIME_WINDOWS
  ): Promise<{ approved: string[]; skipped: { id: string; reason: string }[] }> {
    const approved: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    let slotIndex = 0;
    for (const id of ids) {
      const scheduledFor = nextAvailableWindowSlot(from, slotIndex, windows);
      const result = await this.approveAndSchedule(userId, id, scheduledFor);
      if (result.ok) {
        approved.push(id);
        slotIndex++;
      } else {
        skipped.push({ id, reason: result.reason === 'not_found' ? 'not_found' : `not_ready:${result.currentState}` });
      }
    }
    return { approved, skipped };
  }

  /** A rep decline (never a batch — always exactly one item, mirroring approval-inbox.service.ts's
   *  own single-id decline convention). BLOCKED is the queue's only terminal "will not publish" state
   *  (§11.5 names six states with no separate "declined" state); `decline_reason` distinguishes a
   *  rep's own decline from a CFE/doctrine block. */
  async declineItem(userId: string, id: string, reason: string): Promise<DeclineResult> {
    if (!DECLINE_REASONS.includes(reason as ContentDeclineReason)) {
      return { ok: false, reason: 'invalid_reason' };
    }
    const item = await this.prisma.contentItem.findFirst({ where: { id, user_id: userId } });
    if (!item) return { ok: false, reason: 'not_found' };
    if (item.state === 'PUBLISHED') {
      return { ok: false, reason: 'terminal', currentState: item.state };
    }
    const updated = await this.prisma.contentItem.update({
      where: { id },
      data: { state: 'BLOCKED', decline_reason: reason, publish_hold_reason: 'REP_DECLINED' },
    });
    return { ok: true, item: updated };
  }

  /**
   * Inline edit — RE-ENTERS both the doctrine vocabulary scan and the CFE before the new text can be
   * approved (mirrors approval-inbox.service.ts's `editDraft`: the re-check happens BEFORE anything
   * persists, and a held/blocked verdict sets BLOCKED, never leaves the prior approval standing). The
   * audit trail (`edit_history`) preserves every prior body + who/when, per uiux §5.6 / AC §11.8-4
   * "inline edits preserved in the audit trail".
   */
  async editItem(userId: string, id: string, newBody: string, newHeadline?: string | null): Promise<EditResult> {
    if (typeof newBody !== 'string' || newBody.trim().length === 0) {
      return { ok: false, reason: 'empty_body' };
    }
    const item = await this.prisma.contentItem.findFirst({ where: { id, user_id: userId } });
    if (!item) return { ok: false, reason: 'not_found' };
    if (item.state === 'PUBLISHED') {
      return { ok: false, reason: 'terminal', currentState: item.state };
    }

    const wasApproved = item.state === 'SCHEDULED';
    const history = Array.isArray(item.edit_history) ? item.edit_history : [];
    const nextHistory = [
      ...history,
      { editedAt: new Date().toISOString(), editedBy: userId, previousBody: item.body, previousHeadline: item.headline },
    ];

    const vocab = scanVocabulary(newBody);
    if (!vocab.clean) {
      const updated = await this.prisma.contentItem.update({
        where: { id },
        data: {
          body: newBody,
          headline: newHeadline ?? item.headline,
          state: 'BLOCKED',
          vocab_clean: false,
          vocab_violations: vocab.violations,
          publish_hold_reason: 'DOCTRINE_VOCABULARY_VIOLATION',
          edited_after_approval: wasApproved ? true : item.edited_after_approval,
          edit_history: nextHistory,
          approved_by: null,
          approved_at: null,
        },
      });
      // A synthetic held-shaped verdict so callers have a uniform return shape; no CFE call was made
      // because the doctrine scan already disqualifies this text from release.
      const syntheticVerdict: CFEVerdict = {
        band: 'blocked',
        score: 100,
        classifierResults: [],
        held: true,
        released: false,
        reason: 'doctrine_vocabulary_violation',
        heldReason: null,
        safeHarbor: { injected: false, disclaimers: [] },
        httpStatus: 503,
        ruleVersion: 'n/a',
        auditEvent: undefined as never,
      };
      return { ok: true, item: updated, verdict: syntheticVerdict };
    }

    const verdict = await this.cfe.evaluateContent({
      content: newBody,
      channel: cfeChannelForContentType(),
      userContext: { user_id: userId, role: 'REP' as never, content_id: id },
    });
    const held = verdict.held || verdict.band === 'blocked';
    const updated = await this.prisma.contentItem.update({
      where: { id },
      data: {
        body: newBody,
        headline: newHeadline ?? item.headline,
        state: held ? 'BLOCKED' : 'READY_FOR_REVIEW',
        cfe_outcome: bandToOutcome(verdict),
        cfe_risk_score: verdict.score,
        cfe_classifier_data: verdict.classifierResults,
        vocab_clean: true,
        vocab_violations: null,
        publish_hold_reason: held ? `CFE_${verdict.heldReason ?? verdict.band}`.toUpperCase() : null,
        edited_after_approval: wasApproved ? true : item.edited_after_approval,
        edit_history: nextHistory,
        approved_by: null,
        approved_at: null,
      },
    });
    return { ok: true, item: updated, verdict };
  }
}
