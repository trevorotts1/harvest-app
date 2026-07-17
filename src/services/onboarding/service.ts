import {
  OnboardingStep,
  OnboardingSession,
  Role,
  OrgType,
  AccessTier,
  IntensitySetting,
  IntensityData,
  ROLE_STEP_MAP,
  SEVEN_WHYS_MIN_SCORE,
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

  validateSevenWhysScore(responses: any[]): ValidationResult {
    const total = responses.reduce((sum, r) => sum + (r.score || 0), 0) / (responses.length || 1);
    if (total <= SEVEN_WHYS_MIN_SCORE) {
      return { valid: false, error: `Score ${total} below gate threshold of ${SEVEN_WHYS_MIN_SCORE}` };
    }
    return { valid: true };
  }

  validateStep(
    session: OnboardingSession,
    step: OnboardingStep,
    data: any
  ): ValidationResult {
    const forbidden = findForbiddenTerms(JSON.stringify(data));
    if (forbidden.length > 0) {
      return { valid: false, error: `Forbidden terms: ${forbidden.join(', ')}` };
    }

    if (step === OnboardingStep.ROLE_ORG_CONTEXT && session.org_type === OrgType.PRIMERICA) {
      return this.validateSolutionNumberFormat(data.solution_number);
    }

    if (step === OnboardingStep.SEVEN_WHYS) {
      return this.validateSevenWhysScore(data.seven_whys || []);
    }

    if (step === OnboardingStep.INTENSITY) {
      if (!data.intensity_data || data.intensity_data.commitmentScore < MIN_COMMITMENT_SCORE) {
        return { valid: false, error: 'Intensity data insufficient' };
      }
    }

    return { valid: true };
  }

  seedAccessTier(role: Role, orgType: OrgType): AccessTier {
    if (role === Role.RVP || role === Role.UPLINE) return AccessTier.ENTERPRISE;
    return orgType === OrgType.PRIMERICA ? AccessTier.FREE_ORG_LINKED : AccessTier.FREE_PAID_EXTERNAL;
  }

  canProgressTo(step: OnboardingStep, data: any): ValidationResult {
    // Legacy support for API routes/tests using different property names
    const orgType = data.orgType || data.org_type;
    const solutionNumber = data.solutionNumber || data.solution_number;
    
    if (step === OnboardingStep.ROLE_ORG_CONTEXT && orgType === OrgType.PRIMERICA) {
      return this.validateSolutionNumberFormat(solutionNumber);
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
