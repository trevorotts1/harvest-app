// T-34 (master-spec §9.7-§9.8, uiux §5.3) — shared view types for the learning-state / two-ratios
// API surface and The Shift ritual. Kept separate from the service files (same convention as
// src/types/harvest-method.ts) so the frontend can import types without pulling in Prisma.

import type { LearningStateStatus, RatioCardView } from '@/services/learning-state/ratios';

export type { LearningStateStatus, RatioCardView };

export interface LearningStateView {
  agentRatio: RatioCardView;
  fieldTrainerRatio: RatioCardView;
  computedAt: string;
}

export type ShiftPhase = 'OPEN' | 'WORK' | 'CLOSE' | 'DONE';
export type ShiftMode = 'STANDARD' | 'SHORT';

export type ShiftCardType =
  | 'APPROVE_DRAFT'
  | 'RESPOND_FLAGGED'
  | 'CONFIRM_APPOINTMENT'
  | 'LOG_INTRODUCTION'
  | 'MARK_ATTENDANCE';

export interface ShiftQueueCard {
  id: string;
  type: ShiftCardType;
  title: string;
  detail: string;
  estimateMinutes: number;
  /** The linked DraftMessage's CFE outcome ('PASS' | 'FLAG' | 'BLOCK'), or `null` for card types
   * that aren't backed by a DraftMessage at all (CONFIRM_APPOINTMENT / LOG_INTRODUCTION /
   * MARK_ATTENDANCE). Carried through so the Work-phase card can show the compliance band and
   * fail closed on a non-PASS draft instead of rendering the same one-tap Approve a clean draft
   * gets (T-34 QC fix — mirrors T-32's Mission Control fail-closed-queue-approve fix). Optional
   * (not just nullable) so that pre-existing card fixtures elsewhere (e.g. the generic
   * AC-5.3-1/AC-5.3-2 one-card-at-a-time / no-alarm-timer fixtures in shift-ui.test.ts, which
   * don't care about compliance state at all) keep compiling unchanged — WorkPhase's own
   * fail-closed gate treats "absent" the same as anything other than a literal `'PASS'`. */
  cfeOutcome?: string | null;
  /** T-R13 (uiux §5.3 "approve-with-inline-edit ... embedded full-width", §4.2/§4.3) — present only
   * for APPROVE_DRAFT / RESPOND_FLAGGED cards (the ones backed by a real DraftMessage): the extra
   * shape `DraftApprovalCard` needs to embed T-33's `ApprovalInboxItem` component directly in the
   * Work-phase card, replacing the old deep-link-to-`/inbox` stopgap. `undefined` for
   * CONFIRM_APPOINTMENT / LOG_INTRODUCTION / MARK_ATTENDANCE, which have no DraftMessage to embed
   * at all — and for any pre-existing fixture that predates this field (keeps compiling unchanged,
   * same optionality rationale as `cfeOutcome` above). */
  draft?: {
    contactId: string;
    contact: { firstName: string; lastName: string } | null;
    channel: string;
    cfeRiskScore: number | null;
    /** The DraftMessage's OWN `approval_state` ('PENDING' | 'HELD' at this point in the stack —
     * APPROVED/DECLINED drafts never reach `buildCandidateStack` in the first place). This is what
     * `ApprovalInboxItem`'s own fail-closed render gate (`isHeld`) checks — NOT `cfeOutcome` — so
     * embedding the real component preserves ITS rule (HELD/blocked is never one-tap-approvable by
     * any UI path) rather than reintroducing a second, divergent one. */
    approvalState: string;
    createdAt: string;
  };
}

export interface ShiftStateView {
  phase: ShiftPhase;
  mode: ShiftMode;
  stackPosition: number;
  /** The live card stack, already reordered per skip semantics (uiux §5.3). Empty once every card
   * is actioned or the queue started empty. */
  stack: ShiftQueueCard[];
  elapsedSeconds: number;
  /** The rep's own planned target for this shift (STANDARD = 30 min, SHORT = 10 min, uiux §5.3) —
   * used ONLY to celebrate an early finish; never to alarm or flag overtime. */
  targetSeconds: number;
  streakCount: number;
  graceDayUsed: boolean;
  graceDayAvailable: boolean;
  /** §5.3 "Grace day": true only on the Open phase when yesterday broke the streak AND a grace day
   * is still available this week — surfaced automatically, never requiring the rep to ask. */
  graceDayOffer: boolean;
  reflectionText: string | null;
  /** §5.3 Open: "briefing recap (3 lines max)". */
  briefingLines: string[];
  /** §5.3 Open: "one motivational line tied to the anchor statement". */
  motivationalLine: string;
  /** §5.3 Close: recap counts (approvals, confirmations, logs). */
  recap: { approvals: number; confirmations: number; logs: number } | null;
  isEmpty: boolean;
}

export type ShiftCardAction = 'APPROVE' | 'DECLINE' | 'SKIP' | 'CONFIRM' | 'LOG';
