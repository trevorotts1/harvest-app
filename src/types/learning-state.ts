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
