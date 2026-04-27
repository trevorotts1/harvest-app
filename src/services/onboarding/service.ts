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
  SOLUTION_NUMBER_PATTERN,
  ROLE_VISIBILITY,
  ValidationResult,
  findForbiddenTerms,
} from '../../types/onboarding';

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
    if (!solutionNumber || !SOLUTION_NUMBER_PATTERN.test(solutionNumber)) {
      return { valid: false, error: 'Solution number must be 6-8 digits' };
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
    return orgType === OrgType.PRIMERICA ? AccessTier.ORG_LINKED_FREE : AccessTier.PAID_EXTERNAL;
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

  determineAccessTier(commitmentScore: number, orgType: OrgType): AccessTier {
    if (commitmentScore >= 9) return AccessTier.ENTERPRISE;
    if (commitmentScore >= 7) return AccessTier.PAID_INDIVIDUAL;
    return orgType === OrgType.PRIMERICA ? AccessTier.ORG_LINKED_FREE : AccessTier.PAID_EXTERNAL;
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
