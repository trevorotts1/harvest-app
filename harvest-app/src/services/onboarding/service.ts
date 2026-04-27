import {
  AccessTier,
  CalendarConnectionContract,
  calibrateIntensity,
  ConsentRecord,
  ConsentType,
  DownstreamContract,
  GoalCardData,
  INTENSITY_CALIBRATION,
  IntensityData,
  INVITE_EXPIRY_DAYS,
  LawfulBasis,
  MIN_COMMITMENT_SCORE,
  normalizeOrgType,
  OnboardingData,
  OnboardingSession,
  OnboardingStep,
  OrgGateDecision,
  OrgType,
  ROLE_VISIBILITY,
  Role,
  SEVEN_WHYS_MIN_RESPONSES,
  SevenWhysGateResult,
  SOLUTION_NUMBER_PATTERN,
  STEP_ORDER,
  UplineInvitationContract,
  ValidationResult,
  findForbiddenTerms,
} from '../../types/onboarding';

export class OnboardingService {
  getNextStep(currentStep: OnboardingStep): OnboardingStep | null {
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx === -1 || idx >= STEP_ORDER.length - 1) return null;
    return STEP_ORDER[idx + 1];
  }

  resolveOrgGate(orgTypeInput: OrgType | string): OrgGateDecision {
    const orgType = normalizeOrgType(orgTypeInput) ?? OrgType.EXTERNAL;
    const isPrimerica = orgType === OrgType.PRIMERICA;
    return {
      org_type: orgType,
      is_primerica: isPrimerica,
      requires_solution_number: isPrimerica,
      requires_finra_disclosure: isPrimerica,
      access_tier_seed: isPrimerica ? AccessTier.ORG_LINKED_FREE : AccessTier.PAID_EXTERNAL,
      blocked_steps: isPrimerica ? [] : [OnboardingStep.UPLINE_LINKAGE],
      enabled_downstream_packages: isPrimerica
        ? ['WP02', 'WP03', 'WP04', 'WP05', 'WP08', 'WP09', 'WP10']
        : ['WP02', 'WP04', 'WP05', 'WP09', 'WP10'],
    };
  }

  getRoleVisibility(role: Role) {
    return ROLE_VISIBILITY[role];
  }

  canRoleSeePrimericaOverlay(role: Role, orgType: OrgType | string): boolean {
    return this.resolveOrgGate(orgType).is_primerica && ROLE_VISIBILITY[role].can_access_primerica_overlay;
  }

  validateSolutionNumberFormat(solutionNumber?: string | null): ValidationResult {
    if (!solutionNumber) return { valid: false, error: 'Solution number is required' };
    if (!SOLUTION_NUMBER_PATTERN.test(solutionNumber)) {
      return { valid: false, error: 'Solution number must be 4-20 alphanumeric/dash characters' };
    }
    return { valid: true };
  }

  requiresSolutionNumber(orgType: OrgType | string): boolean {
    return this.resolveOrgGate(orgType).requires_solution_number;
  }

  validateOrgGate(data: Partial<OnboardingData>): ValidationResult {
    const orgType = normalizeOrgType(data.orgType);
    if (!orgType) return { valid: false, error: 'Organization type is required' };
    if (orgType === OrgType.PRIMERICA) return this.validateSolutionNumberFormat(data.solutionNumber);
    return { valid: true };
  }

  evaluateSevenWhys(sevenWhys: string[] | undefined, commitmentScore = 0): SevenWhysGateResult {
    const responseCount = sevenWhys?.filter((entry) => entry.trim().length > 0).length ?? 0;
    if (responseCount < SEVEN_WHYS_MIN_RESPONSES) {
      return {
        passed: false,
        response_count: responseCount,
        commitment_score: commitmentScore,
        error: `All ${SEVEN_WHYS_MIN_RESPONSES} Seven Whys responses are required`,
      };
    }
    if (commitmentScore < MIN_COMMITMENT_SCORE) {
      return {
        passed: false,
        response_count: responseCount,
        commitment_score: commitmentScore,
        error: `Commitment score must be at least ${MIN_COMMITMENT_SCORE}/10 to proceed`,
      };
    }
    return { passed: true, response_count: responseCount, commitment_score: commitmentScore };
  }

  validateGoalCard(goalCard?: GoalCardData): ValidationResult {
    if (!goalCard) return { valid: false, error: 'Goal commitment card is required' };
    const text = [goalCard.primaryGoal, goalCard.motivationStatement, goalCard.anchorStatement ?? ''].join(' ');
    const forbidden = findForbiddenTerms(text);
    if (forbidden.length > 0) return { valid: false, error: `Forbidden onboarding terms: ${forbidden.join(', ')}` };
    if (!goalCard.primaryGoal || !goalCard.targetDate || !goalCard.motivationStatement) {
      return { valid: false, error: 'Goal commitment card must include goal, target date, and motivation' };
    }
    return { valid: true };
  }

  calibrateIntensity(data: IntensityData) {
    const setting = data.intensitySetting ?? calibrateIntensity(data.commitmentScore, data.weeklyHours);
    return { setting, range: INTENSITY_CALIBRATION[setting] };
  }

  createUplineInvitation(input: Omit<UplineInvitationContract, 'invite_id' | 'created_at' | 'responded_at' | 'resend_count' | 'expires_at' | 'status'>): UplineInvitationContract {
    const created = new Date();
    const expires = new Date(created);
    expires.setDate(expires.getDate() + INVITE_EXPIRY_DAYS);
    return {
      ...input,
      invite_id: `invite_${created.getTime()}`,
      status: 'PENDING' as UplineInvitationContract['status'],
      created_at: created.toISOString(),
      responded_at: null,
      resend_count: 0,
      expires_at: expires.toISOString(),
    };
  }

  validateCalendarConnection(connection?: CalendarConnectionContract | null): ValidationResult {
    if (!connection) return { valid: true };
    if (!connection.timezone) return { valid: false, error: 'Calendar timezone is required' };
    if (connection.connected && connection.provider === 'none') {
      return { valid: false, error: 'Connected calendar must name a provider' };
    }
    return { valid: true };
  }

  requiredConsentRecords(userId: string): ConsentRecord[] {
    const now = new Date().toISOString();
    return [ConsentType.PROFILE, ConsentType.ONBOARDING].map((consentType) => ({
      consent_id: `${userId}_${consentType}`,
      user_id: userId,
      consent_type: consentType,
      lawful_basis: LawfulBasis.CONSENT,
      granted: true,
      granted_at: now,
      revoked_at: null,
      version: '1.0',
      regulations: ['GDPR', 'CCPA'],
    }));
  }

  hasRequiredConsent(records: ConsentRecord[] | undefined): boolean {
    if (!records) return false;
    return [ConsentType.PROFILE, ConsentType.ONBOARDING].every((required) =>
      records.some((record) => record.consent_type === required && record.granted && !record.revoked_at),
    );
  }

  getDownstreamContracts(): DownstreamContract[] {
    return [
      { package_id: 'WP02', fields: ['userId', 'orgType', 'role', 'accessTier'], description: 'Warm-market ingestion context' },
      { package_id: 'WP03', fields: ['orgType', 'solutionNumber', 'role'], description: 'Primerica overlay eligibility' },
      { package_id: 'WP04', fields: ['goalCard', 'intensityData', 'role', 'visibility'], description: 'Mission Control agent context' },
      { package_id: 'WP05', fields: ['role', 'orgType', 'consentRecords'], description: 'Messaging compliance and personalization context' },
      { package_id: 'WP09', fields: ['calendarConnection', 'uplineInvitation', 'role'], description: 'Calendar and upline linkage context' },
      { package_id: 'WP10', fields: ['accessTier', 'orgType'], description: 'Payment and entitlement seed context' },
    ];
  }

  canProgressTo(currentStep: OnboardingStep, data: Partial<OnboardingData>): ValidationResult {
    switch (currentStep) {
      case OnboardingStep.REGISTER:
      case OnboardingStep.ACCOUNT_TYPE:
        return this.validateOrgGate(data);
      case OnboardingStep.ROLE_SELECTION:
        return data.role ? { valid: true } : { valid: false, error: 'Role selection is required' };
      case OnboardingStep.SEVEN_WHYS: {
        const result = this.evaluateSevenWhys(data.sevenWhys, data.intensityData?.commitmentScore ?? 0);
        return result.passed ? { valid: true } : { valid: false, error: result.error };
      }
      case OnboardingStep.GOAL_CARD:
        return this.validateGoalCard(data.goalCard);
      case OnboardingStep.INTENSITY:
        if (!data.intensityData) return { valid: false, error: 'Intensity calibration is required' };
        return data.intensityData.commitmentScore >= MIN_COMMITMENT_SCORE
          ? { valid: true }
          : { valid: false, error: `Commitment score must be at least ${MIN_COMMITMENT_SCORE}/10 to complete onboarding` };
      case OnboardingStep.UPLINE_LINKAGE:
        return { valid: true };
      case OnboardingStep.CALENDAR_CONNECTION:
        return this.validateCalendarConnection(data.calendarConnection);
      case OnboardingStep.COMPLETE:
        return this.hasRequiredConsent(data.consentRecords)
          ? { valid: true }
          : { valid: false, error: 'Profile and onboarding consent are required before completion' };
      default:
        return { valid: false, error: `Unknown step: ${currentStep}` };
    }
  }

  determineAccessTier(commitmentScoreOrOrgType: number | OrgType | string): string {
    if (typeof commitmentScoreOrOrgType === 'number') {
      return commitmentScoreOrOrgType >= MIN_COMMITMENT_SCORE ? AccessTier.PAID_EXTERNAL : AccessTier.PAID_EXTERNAL;
    }
    return this.resolveOrgGate(commitmentScoreOrOrgType).access_tier_seed;
  }

  meetsCommitmentThreshold(commitmentScore: number): boolean {
    return commitmentScore >= MIN_COMMITMENT_SCORE;
  }

  finalizeOnboarding(session: OnboardingSession): { accessTier: string; commitmentScore: number; downstreamContracts: DownstreamContract[] } {
    const commitmentScore = session.intensityData?.commitmentScore ?? 0;
    const orgType = session.orgType ?? OrgType.EXTERNAL;
    const accessTier = this.determineAccessTier(orgType);
    return { accessTier, commitmentScore, downstreamContracts: this.getDownstreamContracts() };
  }
}

export const onboardingService = new OnboardingService();
