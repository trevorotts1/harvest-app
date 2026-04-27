import {
  OnboardingStep,
  OnboardingData,
  OnboardingSession,
  STEP_ORDER,
  MIN_COMMITMENT_SCORE,
} from '../../types/onboarding';

export class OnboardingService {
  /**
   * Get the next step after the current one.
   * Returns null if already at COMPLETE.
   */
  getNextStep(currentStep: OnboardingStep): OnboardingStep | null {
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx === -1 || idx >= STEP_ORDER.length - 1) {
      return null;
    }
    return STEP_ORDER[idx + 1];
  }

  /**
   * Validate that a step transition is allowed.
   * Enforces the state machine order and business rules.
   */
  canProgressTo(currentStep: OnboardingStep, data: Partial<OnboardingData>): { valid: boolean; error?: string } {
    switch (currentStep) {
      case OnboardingStep.REGISTER: {
        // If org_type is PRIMERICA, solution_number must be provided
        if (data.orgType === 'PRIMERICA' && !data.solutionNumber) {
          return { valid: false, error: 'Solution number is required for Primerica representatives' };
        }
        return { valid: true };
      }

      case OnboardingStep.ACCOUNT_TYPE: {
        // org_type must be set to proceed from ACCOUNT_TYPE
        if (!data.orgType) {
          return { valid: false, error: 'Organization type is required' };
        }
        return { valid: true };
      }

      case OnboardingStep.SEVEN_WHYS: {
        // Seven Whys progression gate: commitment_score must meet threshold
        if (
          data.intensityData &&
          data.intensityData.commitmentScore < MIN_COMMITMENT_SCORE
        ) {
          return {
            valid: false,
            error: `Commitment score must be at least ${MIN_COMMITMENT_SCORE}/10 to proceed`,
          };
        }
        // sevenWhys must be provided
        if (!data.sevenWhys || data.sevenWhys.length === 0) {
          return { valid: false, error: 'Seven Whys data is required' };
        }
        return { valid: true };
      }

      case OnboardingStep.GOAL_CARD: {
        // goalCard must be provided
        if (!data.goalCard) {
          return { valid: false, error: 'Goal commitment card is required' };
        }
        return { valid: true };
      }

      case OnboardingStep.INTENSITY: {
        // commitment_score must meet threshold
        if (
          data.intensityData &&
          data.intensityData.commitmentScore < MIN_COMMITMENT_SCORE
        ) {
          return {
            valid: false,
            error: `Commitment score must be at least ${MIN_COMMITMENT_SCORE}/10 to complete onboarding`,
          };
        }
        return { valid: true };
      }

      case OnboardingStep.COMPLETE:
        return { valid: false, error: 'Onboarding already completed' };

      default:
        return { valid: false, error: `Unknown step: ${currentStep}` };
    }
  }

  /**
   * Determine access tier from onboarding data.
   * Maps commitment score ranges to tiers.
   */
  determineAccessTier(commitmentScore: number): string {
    if (commitmentScore >= 9) return 'ELITE';
    if (commitmentScore >= 7) return 'PRO';
    if (commitmentScore >= 5) return 'ESSENTIAL';
    return 'FREE';
  }

  /**
   * Check if solution_number field should be shown for the given org type.
   */
  requiresSolutionNumber(orgType: string): boolean {
    return orgType === 'PRIMERICA';
  }

  /**
   * Check if onboarding data meets the minimum commitment threshold.
   */
  meetsCommitmentThreshold(commitmentScore: number): boolean {
    return commitmentScore >= MIN_COMMITMENT_SCORE;
  }

  /**
   * Finalize onboarding: sets the access tier based on commitment score.
   * Returns the computed access tier.
   */
  finalizeOnboarding(session: OnboardingSession): { accessTier: string; commitmentScore: number } {
    const commitmentScore = session.intensityData?.commitmentScore ?? 0;
    const accessTier = this.determineAccessTier(commitmentScore);
    return { accessTier, commitmentScore };
  }
}

export const onboardingService = new OnboardingService();