import {
  OnboardingStep,
  OnboardingSession,
  Role,
  OrgType,
  AccessTier,
  ROLE_STEP_MAP,
  MIN_COMMITMENT_SCORE,
  ROLE_VISIBILITY,
  ValidationResult,
  findForbiddenTerms,
} from '../../types/onboarding';
// T-17 QC fix: `validateSolutionNumberFormat` used to check against this file's OWN
// `SOLUTION_NUMBER_PATTERN` (`/^\d{6,8}$/`, 6-8 digits) — a second, weaker, mismatched source of truth
// alongside the authoritative §6.3 7-digit rule below. Delegating directly to the wp01 module's own
// format check means there is exactly one place a solution number's format is decided; no route
// reachable through `OnboardingService` can accept a 6-digit or 8-digit value ever again.
import { checkSolutionNumberFormat } from './wp01/solution-number';
// T-19 QC CRITICAL fix: `determineAccessTier` below used to assign tier BY COMMITMENT SCORE — a
// second, spec-violating source of truth alongside the authoritative §6.7 rule in
// `wp01/access-tier.ts`. Delegating directly to that module's own assignment function means there
// is exactly one place a tier is ever decided; no caller reachable through `OnboardingService` can
// get a commitment-score-derived tier ever again, mirroring the `checkSolutionNumberFormat`
// delegation immediately above.
import { assignAccessTierFromSignals } from './wp01/access-tier';

// T-20 §6.10-1 / §6.7 — legacy retirement (finishing the T-17/T-19 delegation job). Two remaining
// weaker/contradicting methods were REMOVED from this legacy service so no reachable path can run
// them alongside the authoritative wp01 modules:
//   • `validateSevenWhysScore` — averaged a per-response numeric score against a threshold. This
//     directly CONTRADICTS the T-18 Seven Whys engine's invisible-resonance contract (§6.4, uiux
//     AC-5.1-4): the authoritative gate is `submitSevenWhysAnswer`'s hidden >70 resonance, rendered
//     only as a caring re-prompt and NEVER as a number. A second numeric gate here was a duplicate
//     source of truth AND a place the score could leak; the SEVEN_WHYS step no longer runs any
//     numeric gate in this service — the T-18 engine owns it end to end.
//   • `seedAccessTier` — assigned ENTERPRISE ($25,000/yr) purely by role (RVP/UPLINE), a tier path
//     §6.7 never describes (tier is "auth source + org context"; ENTERPRISE is admin-provisioning
//     only). It was dead code (no live caller) but a reachable weaker duplicate of
//     `assignAccessTier`; removing it leaves `assignAccessTierFromSignals` as the single tier source.

/** Loosely-typed onboarding step submission payload. Supports both the current snake_case wire
 *  shape and legacy camelCase property names some API routes/tests still submit (see
 *  `canProgressTo` below), and is deliberately exercised with malformed/wrong-typed values in
 *  tests (e.g. a non-boolean `gdpr_consent`) to prove the fail-closed checks below — every field
 *  is read as `unknown` and narrowed at the point of use, never trusted structurally. */
export interface OnboardingStepPayload {
  [key: string]: unknown;
}

export class OnboardingService {
  getStepsForRole(role: Role): OnboardingStep[] {
    return ROLE_STEP_MAP[role] ?? ROLE_STEP_MAP[Role.REP];
  }

  getRoleVisibility(role: Role) {
    return ROLE_VISIBILITY[role];
  }

  isPrimericaUser(orgType: OrgType): boolean {
    return orgType === OrgType.PRIMERICA;
  }

  validateSolutionNumberFormat(solutionNumber: string | null | undefined): ValidationResult {
    const { formatValid } = checkSolutionNumberFormat(solutionNumber);
    if (!formatValid) {
      return { valid: false, error: 'Solution number must be 7 digits (§6.3)' };
    }
    return { valid: true };
  }

  validateStep(
    session: OnboardingSession,
    step: OnboardingStep,
    data: OnboardingStepPayload
  ): ValidationResult {
    const forbidden = findForbiddenTerms(JSON.stringify(data));
    if (forbidden.length > 0) {
      return { valid: false, error: `Forbidden terms: ${forbidden.join(', ')}` };
    }

    if (step === OnboardingStep.ROLE_ORG_CONTEXT && session.org_type === OrgType.PRIMERICA) {
      return this.validateSolutionNumberFormat(data.solution_number as string | null | undefined);
    }

    // SEVEN_WHYS is DELIBERATELY not gated here anymore (T-20): the authoritative gate is the T-18
    // engine's invisible >70 resonance (§6.4), which never surfaces a number. No numeric score gate
    // lives in this legacy service — see the retirement note at the top of the file.

    if (step === OnboardingStep.INTENSITY) {
      // T-R36 fix: this read `data.intensity_data` (snake_case) only — but
      // `/api/onboarding/step/route.ts`'s own INTENSITY branch (and every real caller of this
      // route) has always sent `data.intensityData` (camelCase; see `OnboardingFlow.tsx`'s wire
      // shape / the route's own `data.intensityData` reads a few lines below its `validateStep`
      // call). No existing test called `validateStep` for this step directly, so this
      // field-name mismatch was latent — the route's own progression check meant to gate on it
      // silently always saw `undefined` and rejected as "Intensity data insufficient" the moment a
      // REAL persisted session reached this step (surfaced by T-R36's own end-to-end lifecycle
      // test). Fixed the same "accept the legacy shape too" way `canProgressTo` below already
      // handles `orgType`/`org_type`.
      const intensityData = (data.intensityData ?? data.intensity_data) as
        | { commitmentScore?: number }
        | null
        | undefined;
      if (!intensityData || (intensityData.commitmentScore as number) < MIN_COMMITMENT_SCORE) {
        return { valid: false, error: 'Intensity data insufficient' };
      }
    }

    // T-21R (§6.10-10): the GDPR consent step gate. `CONSENT_CAPTURE` is the LAST step in every
    // role's `ROLE_STEP_MAP` (types/onboarding.ts) — an explicit `gdpr_consent: true` in the
    // submitted payload is required to clear it; anything else (missing, false, truthy-but-not-`true`)
    // fails closed. This is the legacy `/api/onboarding/step` route's half of the completion
    // precondition — `evaluateConsentCompletionGate` (wp01/consent-gate.ts) is the pure decision this
    // mirrors, and `/api/onboarding/complete` enforces the same rule independently.
    if (step === OnboardingStep.CONSENT_CAPTURE) {
      if (data?.gdpr_consent !== true) {
        return { valid: false, error: 'GDPR consent is required to complete onboarding (§6.10-10)' };
      }
    }

    return { valid: true };
  }

  canProgressTo(step: OnboardingStep, data: OnboardingStepPayload): ValidationResult {
    // Legacy support for API routes/tests using different property names
    const orgType = data.orgType || data.org_type;
    const solutionNumber = data.solutionNumber || data.solution_number;
    
    if (step === OnboardingStep.ROLE_ORG_CONTEXT && orgType === OrgType.PRIMERICA) {
      return this.validateSolutionNumberFormat(solutionNumber as string | null | undefined);
    }
    return { valid: true };
  }

  getNextStep(session: OnboardingSession): OnboardingStep | null {
    const steps = this.getStepsForRole(session.role);
    const idx = steps.indexOf(session.current_step);
    return idx !== -1 && idx < steps.length - 1 ? steps[idx + 1] : null;
  }

  // T-19 QC CRITICAL fix (§6.7): this used to assign the returned tier BY COMMITMENT SCORE
  // (`>=9` -> ENTERPRISE $25,000/yr, `>=7` -> PAID_INDIVIDUAL $297/mo, else an org-based free tier)
  // — a payment-sensitive dual-source-of-truth defect §6.7 never describes: tier is assigned "from
  // auth source + org context", NEVER a self-reported commitment slider. A SPONSORED user (should
  // be FREE_ORG_LINKED / $0) who rated their own commitment >=9 was silently promoted to a
  // $25,000/yr ENTERPRISE tier by this function alone. `commitmentScore` is now IGNORED for tier
  // purposes — kept only as a parameter so this legacy entry point's call-site shape doesn't change
  // for `finalizeOnboarding` below — and this delegates to the SAME §6.7 `assignAccessTierFromSignals`
  // the live route (`/api/onboarding/complete/route.ts`) now calls directly. No caller of this
  // function, old or new, can ever get a commitment-score-derived tier again. `orgType ===
  // PRIMERICA` is treated as the "sponsor/org-linked" signal (this call site has no separate
  // sponsor-invite flag); `orgType === EXTERNAL` resolves to the "email_password, no sponsor" path
  // — the exact split `seedAccessTier` below already uses for its own free-tier branch.
  determineAccessTier(_commitmentScore: number, orgType: OrgType): AccessTier {
    return assignAccessTierFromSignals({
      authMethod: 'email_password',
      sponsorLinked: orgType === OrgType.PRIMERICA,
    });
  }

  meetsCommitmentThreshold(score: number): boolean {
    return score >= MIN_COMMITMENT_SCORE;
  }

  requiresSolutionNumber(orgType: OrgType): boolean {
    return orgType === OrgType.PRIMERICA;
  }

  finalizeOnboarding(session: OnboardingSession): { accessTier: AccessTier; commitmentScore: number } {
    const score = session.intensity_data?.commitmentScore || 0;
    return { accessTier: this.determineAccessTier(score, session.org_type), commitmentScore: score };
  }
}

export const onboardingService = new OnboardingService();
