// WP01 §6.3 — the onboarding tracks A / B / D, as state-machine SHELLS.
//
// This is the domain/state core of the tracks — the ordered step lists, their entry conditions, and
// the licensure hard-block wiring — NOT the cinematic UI (that is T-20). The three tracks:
//
//   - Flow A — Rep track (cinematic): vision splash → identity → role/org context → goals+intensity →
//     Seven Whys → sponsor matching. Emotional, one-thing-at-a-time.
//   - Flow B — Upline track (dense, boring-efficient, target < 7 min): identity + FINRA U4/license
//     validation → org/rank → calendar+defaults → FINRA disclosure (MUST clear to reach
//     gated_complete) → sponsor/upline setup.
//   - Flow D — RVP track: Flow B's regulated spine + org-sponsorship configuration + multi-team setup
//     + supervisory FINRA disclosures.
//
// R-01 (refinements catalog 2026-07-28) — the RVP no-pairing rule lives in pairing-policy.ts
// (`sponsorStepSkippedForRole`). Flow D (the RVP track) never carried a sponsor/upline step in its
// shell — the RVP's "org-sponsorship configuration" is their own downline org, not an upline
// pairing — and the rep track's sponsor-matching screen is skipped for an RVP via
// flow-model.ts's `repScreensForRole`. The pairing-policy module is the single role-keyed source
// of truth both surfaces consult, so the rule cannot drift between them.
//
// DUAL "loads upline steps in addition to rep steps" (§6.2): its track is the union of A and B (rep
// steps first, then the upline-only steps), so a DUAL user is ALSO subject to the licensure gate that
// the upline steps carry.
//
// THE LICENSURE HARD-BLOCK (§6.8 / §16.5 / §6.10-7, QC "invalid-license passage" critical failure):
// a regulated role cannot reach gated_complete on an invalid license. The licensure-gated step
// consumes the T-13 §16.5 state machine's `canPerformLicensedActivity` — only the LICENSED state
// clears it; UNLICENSED, PRE_LICENSING, and LICENSE_EXPIRED all hard-block and route the user to the
// compliance advisory queue (§6.8). This module does NOT re-implement the licensing rule — it calls
// T-13, so if the §16.5 machine changes, this gate follows.

import { Role } from '@prisma/client';

import {
  canPerformLicensedActivity,
  type LicensingState,
} from '@/services/compliance/licensing';
import { sponsorStepSkippedForRole } from '@/services/onboarding/wp01/pairing-policy';

export type OnboardingTrack = 'A' | 'B' | 'D' | 'ADMIN';

export type TrackStyle = 'cinematic' | 'dense' | 'minimal';

export interface TrackStep {
  key: string;
  label: string;
  /**
   * A licensure-gated step (FINRA U4 / state license validation, §6.3 Flow B/D). Reaching
   * gated_complete THROUGH this step requires a LICENSED status (§16.5) — see `evaluateStepGate`.
   */
  requiresLicensure?: boolean;
}

export interface TrackDefinition {
  track: OnboardingTrack;
  style: TrackStyle;
  /** Flow B's "< 7 min" density target (§6.3); undefined where no explicit target is specified. */
  targetMinutes?: number;
  steps: readonly TrackStep[];
}

const FINRA_LICENSURE_STEP: TrackStep = {
  key: 'finra_licensure',
  label: 'FINRA U4 / state license validation',
  requiresLicensure: true,
};

// T-21R (§6.10-10): the GDPR consent-capture step, shared by every track (ADMIN already carried it —
// see `ADMIN_STEPS` below — this closes the gap for Flow A/B/D). A single shared constant means the
// label can never drift between tracks, and `stepsForRole`'s DUAL union dedupes it by key exactly like
// `identity_capture` (see `tests/unit/wp01-tracks.test.ts`'s dedup assertion).
const CONSENT_CAPTURE_STEP: TrackStep = { key: 'consent_capture', label: 'GDPR consent capture' };

// ─── Flow A — Rep (cinematic) ───────────────────────────────────────────────────────────────────
const FLOW_A_STEPS: readonly TrackStep[] = [
  { key: 'vision_splash', label: 'Vision splash' },
  { key: 'identity_capture', label: 'Identity capture (name, photo, auth)' },
  { key: 'role_org_context', label: 'Role & organization context (the org gate)' },
  { key: 'goals_intensity', label: 'Goals & intensity dial' },
  { key: 'seven_whys', label: 'Seven Whys (Flow C)' },
  { key: 'sponsor_matching', label: 'Downline Sponsor matching' },
  CONSENT_CAPTURE_STEP,
];

// ─── Flow B — Upline (dense) ────────────────────────────────────────────────────────────────────
const FLOW_B_STEPS: readonly TrackStep[] = [
  { key: 'identity_capture', label: 'Identity capture' },
  FINRA_LICENSURE_STEP,
  { key: 'org_rank', label: 'Organization & rank' },
  { key: 'calendar_defaults', label: 'Calendar connect + closing preferences + team defaults' },
  { key: 'finra_disclosure', label: 'FINRA disclosure (must clear to complete)' },
  { key: 'sponsor_upline_setup', label: 'Sponsor / upline setup' },
  CONSENT_CAPTURE_STEP,
];

// ─── Flow D — RVP (dense, adds supervisory + org-sponsorship) ───────────────────────────────────
const FLOW_D_STEPS: readonly TrackStep[] = [
  { key: 'identity_capture', label: 'Identity capture' },
  FINRA_LICENSURE_STEP,
  { key: 'org_rank', label: 'Organization & rank' },
  { key: 'org_sponsorship_config', label: 'Org-sponsorship configuration' },
  { key: 'multi_team_setup', label: 'Multi-team management setup' },
  { key: 'supervisory_finra_disclosure', label: 'Supervisory-responsibility FINRA disclosures' },
  { key: 'calendar_defaults', label: 'Calendar connect + team defaults' },
  CONSENT_CAPTURE_STEP,
];

const ADMIN_STEPS: readonly TrackStep[] = [
  { key: 'identity_capture', label: 'Identity capture' },
  CONSENT_CAPTURE_STEP,
];

export const TRACKS: Record<OnboardingTrack, TrackDefinition> = {
  A: { track: 'A', style: 'cinematic', steps: FLOW_A_STEPS },
  B: { track: 'B', style: 'dense', targetMinutes: 7, steps: FLOW_B_STEPS },
  D: { track: 'D', style: 'dense', steps: FLOW_D_STEPS },
  ADMIN: { track: 'ADMIN', style: 'minimal', steps: ADMIN_STEPS },
};

/** The primary track for a role. DUAL has no single track — see `stepsForRole`. */
export function trackForRole(role: Role): OnboardingTrack {
  switch (role) {
    case Role.REP:
      return 'A';
    case Role.UPLINE:
      return 'B';
    case Role.RVP:
      return 'D';
    case Role.DUAL:
      // DUAL runs the rep track augmented with the upline steps — its own composite (see stepsForRole).
      return 'A';
    case Role.ADMIN:
      return 'ADMIN';
    default: {
      const _exhaustive: never = role;
      return 'A';
    }
  }
}

/**
 * The ordered steps a role actually runs. For DUAL (§6.2 "loads upline steps IN ADDITION TO rep
 * steps"), this is Flow A followed by the Flow B steps not already in A (deduped by key) — so DUAL
 * inherits Flow B's licensure-gated step and is therefore subject to the same hard-block.
 *
 * T-21R (§6.10-10): `consent_capture` is the shared TRAILING step on every track (Flow A/B/D each end
 * in it) — for DUAL specifically, appending Flow B's upline-only steps straight after the (already
 * consent_capture-terminated) Flow A list would push it into the middle of the merged union instead
 * of leaving it last. It's pulled out of the Flow A copy and re-appended after the upline-only steps
 * so DUAL's track — like every other role's — ends in the GDPR consent gate.
 */
export function stepsForRole(role: Role): readonly TrackStep[] {
  if (role !== Role.DUAL) {
    return TRACKS[trackForRole(role)].steps;
  }
  const repSteps = TRACKS.A.steps;
  const repKeys = new Set(repSteps.map((s) => s.key));
  const uplineOnly = TRACKS.B.steps.filter((s) => !repKeys.has(s.key));
  const repStepsWithoutTrailingConsent = repSteps.filter((s) => s.key !== CONSENT_CAPTURE_STEP.key);
  return [...repStepsWithoutTrailingConsent, ...uplineOnly, CONSENT_CAPTURE_STEP];
}

// ─── The licensure hard-block gate (T-13 §16.5 consumed here) ───────────────────────────────────

export const COMPLIANCE_ADVISORY_ROUTE = '/onboarding/compliance-advisory';

export interface StepGateContext {
  /** The T-13 verdict for this user (from `canPerformLicensedActivity` — only LICENSED is true). */
  licensed: boolean;
}

export type StepGateOutcome =
  | { allowed: true }
  | { allowed: false; reason: 'LICENSURE_REQUIRED'; route: string };

/**
 * Can a user clear a single step? A licensure-gated step hard-blocks unless the user is licensed
 * (§6.8, §16.5); the blocked outcome routes to the compliance advisory queue rather than allowing
 * passage. A non-gated step is always allowed here (its own validation lives elsewhere).
 */
export function evaluateStepGate(step: TrackStep, ctx: StepGateContext): StepGateOutcome {
  if (step.requiresLicensure && !ctx.licensed) {
    return { allowed: false, reason: 'LICENSURE_REQUIRED', route: COMPLIANCE_ADVISORY_ROUTE };
  }
  return { allowed: true };
}

/** True iff a role's track contains any licensure-gated step (REP/ADMIN: no; UPLINE/RVP/DUAL: yes). */
export function trackRequiresLicensure(role: Role): boolean {
  return stepsForRole(role).some((s) => s.requiresLicensure);
}

/**
 * Synchronous track-completion gate over an ALREADY-KNOWN §16.5 licensing state. A regulated-role
 * track (one with a licensure-gated step) can only reach gated_complete when the state clears T-13's
 * `canPerformLicensedActivity` (LICENSED); every other state hard-blocks to the compliance advisory
 * queue. A non-regulated track (REP/ADMIN) is unaffected by licensing here.
 */
export function evaluateTrackCompletion(role: Role, licensingState: LicensingState): StepGateOutcome {
  if (!trackRequiresLicensure(role)) {
    return { allowed: true };
  }
  return evaluateStepGate(FINRA_LICENSURE_STEP, {
    licensed: canPerformLicensedActivity(licensingState),
  });
}

/**
 * The async, service-backed variant WP01 uses at runtime: it reads the rep's EFFECTIVE licensing
 * state from the live T-13 `LicensingService` (strictest-state-governs for a multi-state rep, §16.5)
 * rather than a caller-supplied state. `gate` is any object exposing T-13's
 * `canPerformLicensedActivity(userId, jurisdiction?)` — `LicensingService` satisfies it directly.
 */
export interface LicensingGate {
  canPerformLicensedActivity(userId: string, jurisdiction?: string): Promise<boolean>;
}

export async function evaluateTrackCompletionAsync(
  role: Role,
  userId: string,
  gate: LicensingGate,
  jurisdiction?: string
): Promise<StepGateOutcome> {
  if (!trackRequiresLicensure(role)) {
    return { allowed: true };
  }
  const licensed = await gate.canPerformLicensedActivity(userId, jurisdiction);
  return evaluateStepGate(FINRA_LICENSURE_STEP, { licensed });
}

/**
 * R-01 — is this role's track REQUIRED to include a sponsor/upline-PAIRING step? True for REP
 * (Flow A's `sponsor_matching`) and UPLINE/DUAL (Flow B's `sponsor_upline_setup`); FALSE for RVP
 * (Flow D — an RVP owns their own organization and is never paired with anyone; its
 * `org_sponsorship_config` step is the RVP's OWN downline-org sponsorship, not an upline pairing)
 * and ADMIN (whose minimal track has no such step). Delegates to pairing-policy.ts's
 * `sponsorStepSkippedForRole` so the track shell and the flow model can never disagree with the
 * registration wizard. The key match is scoped to the two pairing steps by name — a substring
 * `'sponsor'` match would wrongly flag Flow D's `org_sponsorship_config`.
 */
export function trackRequiresSponsorMatching(role: Role): boolean {
  if (sponsorStepSkippedForRole(role)) return false;
  return stepsForRole(role).some((s) => s.key === 'sponsor_matching' || s.key === 'sponsor_upline_setup');
}
