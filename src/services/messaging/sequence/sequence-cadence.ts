// T-39 (WP05 §10.2 "The outreach sequence — doctrine-safe, supersedes the baseline NLP close") —
// the PURE cadence definitions: sequence types, their multi-touch schedules, and the doctrine arc
// each touch plays. No I/O, no Prisma, no keys, no send — just the deterministic "when + on what
// channel + in what phase" a sequence's steps are laid out on, so the arc is one testable table.
//
// The arc (§10.2), enforced as the ONLY phases a step may carry: warm open → genuine social proof
// (the rep's own relationship) → reflected qualities ("seems like", never "you are") → soft ask
// ("no worries if not") → a specific, low-pressure next step. The baseline's manipulative "NLP
// close" / presupposition / embedded-command / double-bind framing is RETIRED — the close is an
// honest invitation, and nothing in this module (or the templates that reference these phases) may
// reintroduce it.

import { MessageChannel } from '@prisma/client';

/** §10.2 sequence types. RE_ENGAGEMENT is "custom" — the caller may override its intervals. */
export type SequenceType = 'FAST_TRACK' | 'STANDARD' | 'NURTURE' | 'RE_ENGAGEMENT';

export const SEQUENCE_TYPES: readonly SequenceType[] = ['FAST_TRACK', 'STANDARD', 'NURTURE', 'RE_ENGAGEMENT'];

/** The doctrine arc phases (§10.2). This is a closed set — a step is always exactly one of these. */
export type CadencePhase = 'warm_open' | 'social_proof' | 'reflected_qualities' | 'soft_ask' | 'next_step';

export const CADENCE_PHASES: readonly CadencePhase[] = [
  'warm_open',
  'social_proof',
  'reflected_qualities',
  'soft_ask',
  'next_step',
];

/** One touch in a cadence template: how many days after enrollment it fires, on what channel, and
 *  which phase of the doctrine arc it plays. */
export interface CadenceStepTemplate {
  offsetDays: number;
  channel: MessageChannel;
  phase: CadencePhase;
}

/**
 * The cadence tables. First touch is ALWAYS the rep's own-number composer handoff (SMS_HANDOFF, a
 * real blue bubble — §10.1); later automated touches use the platform number / email. Every arc runs
 * warm_open → … → next_step and never loops back to a harder ask.
 */
export const CADENCE_TEMPLATES: Record<SequenceType, { totalDays: number; steps: CadenceStepTemplate[] }> = {
  // Fast Track — 5 days, 3 touches.
  FAST_TRACK: {
    totalDays: 5,
    steps: [
      { offsetDays: 0, channel: MessageChannel.SMS_HANDOFF, phase: 'warm_open' },
      { offsetDays: 2, channel: MessageChannel.SMS_PLATFORM, phase: 'reflected_qualities' },
      { offsetDays: 5, channel: MessageChannel.EMAIL, phase: 'next_step' },
    ],
  },
  // Standard — 14 days, 4 touches.
  STANDARD: {
    totalDays: 14,
    steps: [
      { offsetDays: 0, channel: MessageChannel.SMS_HANDOFF, phase: 'warm_open' },
      { offsetDays: 3, channel: MessageChannel.SMS_PLATFORM, phase: 'social_proof' },
      { offsetDays: 7, channel: MessageChannel.EMAIL, phase: 'soft_ask' },
      { offsetDays: 14, channel: MessageChannel.SMS_PLATFORM, phase: 'next_step' },
    ],
  },
  // Nurture — 30 days, 4 touches (slow, non-harassing).
  NURTURE: {
    totalDays: 30,
    steps: [
      { offsetDays: 0, channel: MessageChannel.SMS_HANDOFF, phase: 'warm_open' },
      { offsetDays: 7, channel: MessageChannel.EMAIL, phase: 'social_proof' },
      { offsetDays: 18, channel: MessageChannel.SMS_PLATFORM, phase: 'reflected_qualities' },
      { offsetDays: 30, channel: MessageChannel.EMAIL, phase: 'next_step' },
    ],
  },
  // Re-engagement — custom; a light default of 2 touches the caller may override via `intervalDays`.
  RE_ENGAGEMENT: {
    totalDays: 7,
    steps: [
      { offsetDays: 0, channel: MessageChannel.SMS_PLATFORM, phase: 'warm_open' },
      { offsetDays: 7, channel: MessageChannel.EMAIL, phase: 'next_step' },
    ],
  },
};

export interface ScheduledCadenceStep extends CadenceStepTemplate {
  stepIndex: number;
  scheduledAt: Date;
}

/**
 * Materialize a cadence template into concrete step schedules starting at `startAt`. `intervalDays`
 * (RE_ENGAGEMENT's "custom" knob) overrides the per-step offsets when supplied and long enough. Pure
 * and deterministic — the sequence service persists exactly what this returns.
 */
export function buildSchedule(
  type: SequenceType,
  startAt: Date,
  intervalDays?: number[]
): ScheduledCadenceStep[] {
  const template = CADENCE_TEMPLATES[type];
  return template.steps.map((step, i) => {
    const offset = intervalDays && intervalDays.length > i ? intervalDays[i] : step.offsetDays;
    const scheduledAt = new Date(startAt.getTime() + offset * 24 * 60 * 60 * 1000);
    return { ...step, offsetDays: offset, stepIndex: i, scheduledAt };
  });
}

export function isSequenceType(value: unknown): value is SequenceType {
  return typeof value === 'string' && (SEQUENCE_TYPES as readonly string[]).includes(value);
}
