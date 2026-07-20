// T-36 (§10.3 "a sender warm-up plan for campaigns") — the email warm-up ramp schedule + stage
// lifecycle (pure logic, no I/O). Two independent pure concerns live here:
//   1. `dailyVolumeCapForDay` — the ramp CURVE (how much volume is allowed on ramp-day N).
//   2. The stage transition table — NOT_STARTED -> RAMPING -> WARMED, with PAUSE/RESUME as a
//      side-branch from either active state, mirroring a2p-state-machine.ts's guarded-transition
//      shape exactly.

import { EmailWarmupStage } from '../../types/deliverability';

/**
 * A fixed 10-ramp-day curve (a standard email-warm-up length), expressed as the FRACTION of the
 * organization's chosen `target_daily_volume` allowed on that ramp day (day 0 = the first day
 * sending begins). Day index >= this table's length is WARMED — full target volume, uncapped by
 * this curve. Percentage-of-target (rather than a fixed absolute number) is deliberate: it lets one
 * curve serve every org regardless of how large their eventual steady-state volume is.
 */
const RAMP_FRACTIONS: readonly number[] = [0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.55, 0.7, 0.85];

export const EMAIL_WARMUP_RAMP_DAYS = RAMP_FRACTIONS.length;

/** True once `day` has advanced past the ramp curve — the plan should be WARMED, not RAMPING. */
export function isRampComplete(day: number): boolean {
  return day >= RAMP_FRACTIONS.length;
}

/**
 * The allowed send volume for a given ramp day, given the org's steady-state target. Fail-closed
 * on a non-positive target (0 volume allowed) or a negative day (treated as 0 cap, never
 * "unlimited"). Once the ramp is complete, the full target is returned (WARMED = no more curve).
 * A tiny target (e.g. 10/day) still gets at least 1/day once warm-up has actually started, so an
 * early fractional cap never floors to zero and silently blocks every send.
 */
export function dailyVolumeCapForDay(day: number, targetDailyVolume: number): number {
  if (targetDailyVolume <= 0) return 0;
  if (day < 0) return 0;
  if (isRampComplete(day)) return targetDailyVolume;
  return Math.max(1, Math.floor(targetDailyVolume * RAMP_FRACTIONS[day]));
}

// ─── Stage lifecycle ────────────────────────────────────────────────────────────────────────────

export type EmailWarmupAction = 'START' | 'PAUSE' | 'RESUME' | 'COMPLETE_RAMP';

const WARMUP_TRANSITIONS: Record<EmailWarmupStage, Partial<Record<EmailWarmupAction, EmailWarmupStage>>> = {
  NOT_STARTED: { START: 'RAMPING' },
  RAMPING: { PAUSE: 'PAUSED', COMPLETE_RAMP: 'WARMED' },
  WARMED: { PAUSE: 'PAUSED' },
  PAUSED: { RESUME: 'RAMPING' }, // the service layer immediately re-checks isRampComplete after a
  // RESUME and applies COMPLETE_RAMP too if the paused day was already past the ramp curve, so a
  // plan paused after reaching WARMED doesn't regress to "still ramping" on resume.
};

export interface WarmupTransitionSuccess {
  ok: true;
  from: EmailWarmupStage;
  to: EmailWarmupStage;
  action: EmailWarmupAction;
}
export interface WarmupTransitionFailure {
  ok: false;
  from: EmailWarmupStage;
  action: EmailWarmupAction;
  error: string;
}
export type WarmupTransitionResult = WarmupTransitionSuccess | WarmupTransitionFailure;

export function legalWarmupTargetState(from: EmailWarmupStage, action: EmailWarmupAction): EmailWarmupStage | null {
  return WARMUP_TRANSITIONS[from][action] ?? null;
}

export function legalWarmupActionsFrom(from: EmailWarmupStage): EmailWarmupAction[] {
  return Object.keys(WARMUP_TRANSITIONS[from]) as EmailWarmupAction[];
}

export function applyWarmupTransition(from: EmailWarmupStage, action: EmailWarmupAction): WarmupTransitionResult {
  const to = legalWarmupTargetState(from, action);
  if (!to) {
    const legal = legalWarmupActionsFrom(from);
    return {
      ok: false,
      from,
      action,
      error:
        `Illegal email warm-up transition: cannot apply "${action}" from stage "${from}". ` +
        (legal.length > 0 ? `Legal actions from "${from}": ${legal.join(', ')}.` : `"${from}" is a terminal stage for this action set.`),
    };
  }
  return { ok: true, from, to, action };
}

/**
 * The fail-closed capability query: a domain is only actively warming/warmed — i.e. eligible to
 * send at all, subject to its daily cap — in RAMPING or WARMED. NOT_STARTED and PAUSED (and
 * anything outside the known union) are NOT deliverable.
 */
export function isWarmupActive(stage: EmailWarmupStage): boolean {
  return stage === 'RAMPING' || stage === 'WARMED';
}

/** Today's date as a UTC yyyy-mm-dd string — the daily-counter reset key (timezone-independent, so
 *  the reset moment doesn't depend on which server/region processed the request). */
export function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
