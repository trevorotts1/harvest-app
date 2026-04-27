import { OnboardingService } from '../../src/services/onboarding/service';
import { OnboardingStep, Role, OrgType, AccessTier, ROLE_VISIBILITY } from '../../src/types/onboarding';

describe('OnboardingService', () => {
  const service = new OnboardingService();

  describe('Organization gate', () => {
    test('should validate Primerica solution number format', () => {
      expect(service.validateSolutionNumberFormat('123456').valid).toBe(true);
      expect(service.validateSolutionNumberFormat('12345').valid).toBe(false);
      expect(service.validateSolutionNumberFormat('ABCDEF').valid).toBe(false);
    });

    test('isPrimericaUser returns correct values', () => {
      expect(service.isPrimericaUser(OrgType.PRIMERICA)).toBe(true);
      expect(service.isPrimericaUser(OrgType.NON_PRIMERICA)).toBe(false);
    });
  });

  describe('Access Tier seeding', () => {
    test('should seed ENTERPRISE for RVP/UPLINE', () => {
      expect(service.seedAccessTier(Role.RVP, OrgType.NON_PRIMERICA)).toBe(AccessTier.ENTERPRISE);
      expect(service.seedAccessTier(Role.UPLINE, OrgType.PRIMERICA)).toBe(AccessTier.ENTERPRISE);
    });

    test('should seed correct free tier based on OrgType', () => {
      expect(service.seedAccessTier(Role.REP, OrgType.PRIMERICA)).toBe(AccessTier.ORG_LINKED_FREE);
      expect(service.seedAccessTier(Role.REP, OrgType.NON_PRIMERICA)).toBe(AccessTier.PAID_EXTERNAL);
    });
  });

  describe('Seven Whys hard gate', () => {
    test('should validate Seven Whys score threshold', () => {
      const responsesPass = [{ score: 80 }, { score: 90 }];
      const responsesFail = [{ score: 50 }, { score: 60 }];
      expect(service.validateSevenWhysScore(responsesPass).valid).toBe(true);
      expect(service.validateSevenWhysScore(responsesFail).valid).toBe(false);
    });
  });

  describe('Role visibility', () => {
    test('should return correct visibility boundaries', () => {
      const rvpVisibility = service.getRoleVisibility(Role.RVP);
      expect(rvpVisibility).toEqual(ROLE_VISIBILITY[Role.RVP]);
      expect(rvpVisibility.canViewDownline).toBe(true);
      
      const repVisibility = service.getRoleVisibility(Role.REP);
      expect(repVisibility.canViewDownline).toBe(false);
    });
  });

  describe('Progression and business rules', () => {
    test('getNextStep follows role-specific order', () => {
      const mockSession = { role: Role.REP, current_step: OnboardingStep.REGISTER } as any;
      expect(service.getNextStep(mockSession)).toBe(OnboardingStep.ACCOUNT_TYPE);
    });
  });
});
