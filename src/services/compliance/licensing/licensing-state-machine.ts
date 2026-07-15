// WP11 §16.5 — the state insurance licensing state machine (pure logic, no I/O).
//
// This file is the single source of truth for: which transitions are legal, the per-state
// content gate, and the capability query WP01/WP03/WP08 call to hard-block unlicensed reps from
// insurance/financial activities. Everything here is a pure function over LicensingState /
// LicensingAction — persistence and audit emission live in licensing-service.ts.

import {
  ContentGateLevel,
  LicensingAction,
  LicensingState,
  LICENSING_STATES,
  StateLicensingConfig,
  TransitionFailure,
  TransitionResult,
} from '../../../types/licensing';

/**
 * The legal transition table — §16.5's chain (`Unlicensed → Pre-Licensing → Licensed →
 * License Expired`) plus the renewal loop the spec's "renewal prompts" language implies
 * (License Expired -> Licensed). Every entry not present here is illegal:
 *   - No entry skips a required prior state (e.g. UNLICENSED cannot reach LICENSED directly —
 *     it must pass through PRE_LICENSING).
 *   - No entry regresses a rep who has ever been licensed back to UNLICENSED — expiry is a
 *     distinct terminal-ish state (LICENSE_EXPIRED), not a reset to never-started.
 *   - No entry lets PRE_LICENSING reach LICENSE_EXPIRED directly — you cannot expire a license
 *     you never obtained.
 */
const LICENSING_TRANSITIONS: Record<LicensingState, Partial<Record<LicensingAction, LicensingState>>> = {
  UNLICENSED: {
    START_PRE_LICENSING: 'PRE_LICENSING',
  },
  PRE_LICENSING: {
    OBTAIN_LICENSE: 'LICENSED',
  },
  LICENSED: {
    EXPIRE_LICENSE: 'LICENSE_EXPIRED',
  },
  LICENSE_EXPIRED: {
    RENEW_LICENSE: 'LICENSED',
  },
};

/** Returns the legal target state for (from, action), or null if the transition is illegal. */
export function legalTargetState(from: LicensingState, action: LicensingAction): LicensingState | null {
  return LICENSING_TRANSITIONS[from][action] ?? null;
}

/** The set of actions legal from a given state — used to build a helpful rejection message. */
export function legalActionsFrom(from: LicensingState): LicensingAction[] {
  return Object.keys(LICENSING_TRANSITIONS[from]) as LicensingAction[];
}

/**
 * Attempts a transition. Legal transitions succeed and return the new state; illegal
 * transitions are rejected — ok: false, the state is NOT changed, and the caller receives the
 * set of actions that ARE legal from the current state. This function never throws; guarded
 * transitions are expressed as a typed result, not exceptions, so callers cannot accidentally
 * skip the check with a try/catch that swallows the guard.
 */
export function applyTransition(from: LicensingState, action: LicensingAction): TransitionResult {
  const to = legalTargetState(from, action);
  if (!to) {
    const legal = legalActionsFrom(from);
    const failure: TransitionFailure = {
      ok: false,
      from,
      action,
      error:
        `Illegal licensing transition: cannot apply "${action}" from state "${from}". ` +
        (legal.length > 0
          ? `Legal actions from "${from}": ${legal.join(', ')}.`
          : `"${from}" is a terminal state for this action set.`),
    };
    return failure;
  }
  return { ok: true, from, to, action };
}

/**
 * The single safety-property query WP01/WP03/WP08 call to hard-block unlicensed reps from
 * insurance/financial activities: only the fully LICENSED state may perform a licensed-only
 * activity. Every other state — including LICENSE_EXPIRED, which §16.5 explicitly downgrades to
 * Pre-Licensing-equivalent restrictions — returns false. Fail-closed: an argument outside the
 * known LicensingState union also returns false (never silently permits).
 */
export function isLicensed(state: LicensingState): boolean {
  return state === 'LICENSED';
}

/** Alias of isLicensed — the exact name WP01/WP03/WP08 are documented to call. */
export function canPerformLicensedActivity(state: LicensingState): boolean {
  return isLicensed(state);
}

/**
 * Maps a state to §16.5's Gates clause verbatim:
 *   Unlicensed      -> no insurance recommendations (CFE hard-block)
 *   Pre-Licensing   -> education content only + exam nudges
 *   Licensed        -> full insurance features
 *   License Expired -> downgraded to Pre-Licensing restrictions + renewal prompts
 */
export function getContentGateLevel(state: LicensingState): ContentGateLevel {
  switch (state) {
    case 'UNLICENSED':
      return 'BLOCKED_NO_INSURANCE_CONTENT';
    case 'PRE_LICENSING':
    case 'LICENSE_EXPIRED':
      return 'EDUCATION_ONLY';
    case 'LICENSED':
      return 'FULL_INSURANCE_FEATURES';
    default: {
      // Fail-closed default for any value outside the known union (defensive; TS already
      // exhausts the union above).
      const _exhaustive: never = state;
      return 'BLOCKED_NO_INSURANCE_CONTENT';
    }
  }
}

/**
 * Strictness ranking, most restrictive first (§16.5 "the strictest state governs a multi-state
 * rep"). PRE_LICENSING and LICENSE_EXPIRED share a rank — they share a gate level — so which one
 * wins a tie is immaterial to the resulting capability.
 */
const STRICTNESS_RANK: Record<LicensingState, number> = {
  UNLICENSED: 0,
  PRE_LICENSING: 1,
  LICENSE_EXPIRED: 1,
  LICENSED: 2,
};

/** Returns whichever of a/b is the more restrictive (lower-capability) state. */
export function stricterOf(a: LicensingState, b: LicensingState): LicensingState {
  return STRICTNESS_RANK[a] <= STRICTNESS_RANK[b] ? a : b;
}

/**
 * Reduces a rep's per-state licensing states down to the single strictest one — the effective
 * status used whenever a check is not scoped to one specific jurisdiction (§16.5). A rep with no
 * jurisdiction records at all is UNLICENSED (fail-closed: absence of a license record never
 * defaults to permissive).
 */
export function strictestState(states: LicensingState[]): LicensingState {
  if (states.length === 0) {
    return 'UNLICENSED';
  }
  return states.reduce((acc, s) => stricterOf(acc, s));
}

/** Runtime guard — true iff the value is one of the four §16.5 states. */
export function isLicensingState(value: unknown): value is LicensingState {
  return typeof value === 'string' && (LICENSING_STATES as readonly string[]).includes(value);
}

// ─── Per-state parameterization (§16.5 "updates via config, not code") ───────────────────────

const DEFAULT_STATE_LICENSING_CONFIG: Omit<StateLicensingConfig, 'jurisdiction'> = {
  renewal_window_days: 60,
  requires_continuing_education: true,
};

/**
 * Per-jurisdiction overrides. Empty by default; a real regulatory change (e.g. a state that
 * requires a 45-day renewal window instead of the 60-day default) is a config edit here — or, in
 * production, to whatever JSON-config-file/DB row backs this table — never a code change to the
 * transition table above.
 */
const STATE_LICENSING_CONFIG: Record<string, Omit<StateLicensingConfig, 'jurisdiction'>> = {};

/** Returns the effective per-state config, falling back to the documented defaults. */
export function getStateLicensingConfig(jurisdiction: string): StateLicensingConfig {
  const override = STATE_LICENSING_CONFIG[jurisdiction];
  return { jurisdiction, ...DEFAULT_STATE_LICENSING_CONFIG, ...override };
}
