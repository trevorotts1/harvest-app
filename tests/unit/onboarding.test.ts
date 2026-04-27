import { OnboardingService } from '../../src/services/onboarding/service';
import { OnboardingStep } from '../../src/types/onboarding';

describe('OnboardingService', () => {
  const service = new OnboardingService();

  describe('Organization gate: Primerica vs non-Primerica', () => {
    test('should require solution_number for Primerica users', () => {
      const result = service.canProgressTo(OnboardingStep.REGISTER, {
        orgType: 'PRIMERICA',
        solutionNumber: undefined,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Solution number');
    });

    test('should allow Primerica users with solution_number', () => {
      const result = service.canProgressTo(OnboardingStep.REGISTER, {
        orgType: 'PRIMERICA',
        solutionNumber: 'SN-12345',
      });
      expect(result.valid).toBe(true);
    });

    test('should NOT require solution_number for non-Primerica users', () => {
      const result = service.canProgressTo(OnboardingStep.REGISTER, {
        orgType: 'EXTERNAL',
        solutionNumber: undefined,
      });
      expect(result.valid).toBe(true);
    });

    test('requiresSolutionNumber returns true for PRIMERICA', () => {
      expect(service.requiresSolutionNumber('PRIMERICA')).toBe(true);
    });

    test('requiresSolutionNumber returns false for EXTERNAL', () => {
      expect(service.requiresSolutionNumber('EXTERNAL')).toBe(false);
    });
  });

  describe('Seven Whys progression gate', () => {
    test('should block progression when commitment_score is below 5', () => {
      const result = service.canProgressTo(OnboardingStep.SEVEN_WHYS, {
        sevenWhys: ['Why 1', 'Why 2'],
        intensityData: {
          commitmentScore: 3,
          weeklyHours: 10,
          riskTolerance: 'MEDIUM',
          supportNeeds: [],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('5');
    });

    test('should allow progression when commitment_score meets threshold', () => {
      const result = service.canProgressTo(OnboardingStep.SEVEN_WHYS, {
        sevenWhys: ['Why 1', 'Why 2'],
        intensityData: {
          commitmentScore: 7,
          weeklyHours: 20,
          riskTolerance: 'HIGH',
          supportNeeds: [],
        },
      });
      expect(result.valid).toBe(true);
    });

    test('should block when sevenWhys is empty', () => {
      const result = service.canProgressTo(OnboardingStep.SEVEN_WHYS, {
        sevenWhys: [],
      });
      expect(result.valid).toBe(false);
    });

    test('should block when sevenWhys is not provided', () => {
      const result = service.canProgressTo(OnboardingStep.SEVEN_WHYS, {});
      expect(result.valid).toBe(false);
    });

    test('should allow progression at exactly threshold (5)', () => {
      const result = service.canProgressTo(OnboardingStep.SEVEN_WHYS, {
        sevenWhys: ['Why 1'],
        intensityData: {
          commitmentScore: 5,
          weeklyHours: 15,
          riskTolerance: 'MEDIUM',
          supportNeeds: [],
        },
      });
      expect(result.valid).toBe(true);
    });

    test('meetsCommitmentThreshold returns correct values', () => {
      expect(service.meetsCommitmentThreshold(4)).toBe(false);
      expect(service.meetsCommitmentThreshold(5)).toBe(true);
      expect(service.meetsCommitmentThreshold(8)).toBe(true);
    });
  });

  describe('Onboarding completion and access tier', () => {
    const makeSession = (commitmentScore: number) => ({
      id: 'session-1',
      userId: 'user-1',
      currentStep: OnboardingStep.INTENSITY,
      sevenWhys: ['Why 1', 'Why 2'],
      goalCard: {
        primaryGoal: 'Build a team',
        targetDate: '2026-12-31',
        commitmentLevel: 8,
        motivationStatement: 'Freedom',
      },
      intensityData: {
        commitmentScore,
        weeklyHours: 20,
        riskTolerance: 'HIGH' as const,
        supportNeeds: [],
      },
      completed: false,
      createdAt: new Date(),
    });

    test('should assign ELITE tier for commitment_score 9+', () => {
      const session = makeSession(9);
      const result = service.finalizeOnboarding(session);
      expect(result.accessTier).toBe('ELITE');
    });

    test('should assign PRO tier for commitment_score 7-8', () => {
      const session = makeSession(7);
      const result = service.finalizeOnboarding(session);
      expect(result.accessTier).toBe('PRO');
    });

    test('should assign ESSENTIAL tier for commitment_score 5-6', () => {
      const session = makeSession(5);
      const result = service.finalizeOnboarding(session);
      expect(result.accessTier).toBe('ESSENTIAL');
    });

    test('should assign FREE tier for commitment_score below 5', () => {
      const session = makeSession(3);
      const result = service.finalizeOnboarding(session);
      expect(result.accessTier).toBe('FREE');
    });

    test('determineAccessTier maps all score ranges correctly', () => {
      expect(service.determineAccessTier(10)).toBe('ELITE');
      expect(service.determineAccessTier(9)).toBe('ELITE');
      expect(service.determineAccessTier(8)).toBe('PRO');
      expect(service.determineAccessTier(7)).toBe('PRO');
      expect(service.determineAccessTier(6)).toBe('ESSENTIAL');
      expect(service.determineAccessTier(5)).toBe('ESSENTIAL');
      expect(service.determineAccessTier(4)).toBe('FREE');
      expect(service.determineAccessTier(0)).toBe('FREE');
    });
  });

  describe('Step progression state machine', () => {
    test('should follow correct step order', () => {
      expect(service.getNextStep(OnboardingStep.REGISTER)).toBe(OnboardingStep.ACCOUNT_TYPE);
      expect(service.getNextStep(OnboardingStep.ACCOUNT_TYPE)).toBe(OnboardingStep.SEVEN_WHYS);
      expect(service.getNextStep(OnboardingStep.SEVEN_WHYS)).toBe(OnboardingStep.GOAL_CARD);
      expect(service.getNextStep(OnboardingStep.GOAL_CARD)).toBe(OnboardingStep.INTENSITY);
      expect(service.getNextStep(OnboardingStep.INTENSITY)).toBe(OnboardingStep.COMPLETE);
      expect(service.getNextStep(OnboardingStep.COMPLETE)).toBeNull();
    });
  });

  describe('Goal Card step validation', () => {
    test('should require goalCard data', () => {
      const result = service.canProgressTo(OnboardingStep.GOAL_CARD, {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Goal');
    });

    test('should allow with goalCard provided', () => {
      const result = service.canProgressTo(OnboardingStep.GOAL_CARD, {
        goalCard: {
          primaryGoal: 'Build a team',
          targetDate: '2026-12-31',
          commitmentLevel: 8,
          motivationStatement: 'Freedom',
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('INTENSITY step validation', () => {
    test('should block if commitment_score below threshold', () => {
      const result = service.canProgressTo(OnboardingStep.INTENSITY, {
        intensityData: {
          commitmentScore: 2,
          weeklyHours: 5,
          riskTolerance: 'LOW',
          supportNeeds: [],
        },
      });
      expect(result.valid).toBe(false);
    });

    test('should allow if commitment_score meets threshold', () => {
      const result = service.canProgressTo(OnboardingStep.INTENSITY, {
        intensityData: {
          commitmentScore: 6,
          weeklyHours: 15,
          riskTolerance: 'MEDIUM',
          supportNeeds: [],
        },
      });
      expect(result.valid).toBe(true);
    });
  });
});