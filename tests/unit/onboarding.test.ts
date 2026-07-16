import { OnboardingService } from '../../src/services/onboarding/service';
import { OnboardingStep, Role, OrgType, AccessTier, ROLE_VISIBILITY } from '../../src/types/onboarding';

describe('OnboardingService', () => {
  const service = new OnboardingService();

  describe('Organization gate', () => {
    // T-17 QC fix: this test used to assert `'123456'` (6 digits) is VALID, encoding the legacy
    // `SOLUTION_NUMBER_PATTERN = /^\d{6,8}$/` (6-8 digits) that `validateSolutionNumberFormat` used to
    // check against — a weaker, mismatched rule alongside the authoritative §6.3 7-digit format
    // (`SOLUTION_NUMBER_FORMAT = /^\d{7}$/` in `wp01/solution-number.ts`). A legacy test asserting a
    // spec violation is corrected here (not preserved) now that `validateSolutionNumberFormat`
    // delegates to the authoritative 7-digit check: 6-digit and 8-digit are now REJECTED, and only the
    // spec-correct 7-digit format is accepted.
    test('should validate Primerica solution number format (§6.3: 7 digits, not 6-8)', () => {
      expect(service.validateSolutionNumberFormat('1234567').valid).toBe(true); // 7 digits: valid
      expect(service.validateSolutionNumberFormat('123456').valid).toBe(false); // 6 digits: REJECTED
      expect(service.validateSolutionNumberFormat('12345678').valid).toBe(false); // 8 digits: REJECTED
      expect(service.validateSolutionNumberFormat('12345').valid).toBe(false);
      expect(service.validateSolutionNumberFormat('ABCDEF').valid).toBe(false);
    });

    test('isPrimericaUser returns correct values', () => {
      expect(service.isPrimericaUser(OrgType.PRIMERICA)).toBe(true);
      expect(service.isPrimericaUser(OrgType.EXTERNAL)).toBe(false);
    });
  });

  describe('Access Tier seeding', () => {
    test('should seed ENTERPRISE for RVP/UPLINE', () => {
      expect(service.seedAccessTier(Role.RVP, OrgType.EXTERNAL)).toBe(AccessTier.ENTERPRISE);
      expect(service.seedAccessTier(Role.UPLINE, OrgType.PRIMERICA)).toBe(AccessTier.ENTERPRISE);
    });

    test('should seed correct free tier based on OrgType', () => {
      expect(service.seedAccessTier(Role.REP, OrgType.PRIMERICA)).toBe(AccessTier.FREE_ORG_LINKED);
      expect(service.seedAccessTier(Role.REP, OrgType.EXTERNAL)).toBe(AccessTier.FREE_PAID_EXTERNAL);
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

  // T-17 QC fix: closes the dual-source-of-truth defect — a live route (`/api/onboarding/step`)
  // reaches `OnboardingService.validateStep`/`validateSolutionNumberFormat` and used to accept a
  // 6-digit or 8-digit "solution number" via the legacy `SOLUTION_NUMBER_PATTERN`. These tests exercise
  // the EXACT functions that route delegates to (§17.1/§6.3), proving no path reachable through
  // `OnboardingService` accepts anything but the spec 7-digit format.
  describe('legacy route path — validateStep (what /api/onboarding/step/route.ts calls) now rejects 6/8-digit solution numbers (T-17)', () => {
    const baseSession = {
      role: Role.REP,
      org_type: OrgType.PRIMERICA,
      current_step: OnboardingStep.ROLE_ORG_CONTEXT,
    } as any;

    test('6-digit solution number is REJECTED at the ROLE_ORG_CONTEXT step', () => {
      const result = service.validateStep(baseSession, OnboardingStep.ROLE_ORG_CONTEXT, {
        solution_number: '123456',
      });
      expect(result.valid).toBe(false);
    });

    test('8-digit solution number is REJECTED at the ROLE_ORG_CONTEXT step', () => {
      const result = service.validateStep(baseSession, OnboardingStep.ROLE_ORG_CONTEXT, {
        solution_number: '12345678',
      });
      expect(result.valid).toBe(false);
    });

    test('the spec-correct 7-digit solution number is ACCEPTED at the ROLE_ORG_CONTEXT step', () => {
      const result = service.validateStep(baseSession, OnboardingStep.ROLE_ORG_CONTEXT, {
        solution_number: '1234567',
      });
      expect(result.valid).toBe(true);
    });

    // canProgressTo is the other legacy-support entry point (accepts camelCase `solutionNumber`); it
    // must reject 6/8-digit too, since it delegates to the same validateSolutionNumberFormat.
    test('canProgressTo also rejects a 6-digit / 8-digit solutionNumber and accepts 7-digit', () => {
      expect(
        service.canProgressTo(OnboardingStep.ROLE_ORG_CONTEXT, {
          orgType: OrgType.PRIMERICA,
          solutionNumber: '123456',
        }).valid
      ).toBe(false);
      expect(
        service.canProgressTo(OnboardingStep.ROLE_ORG_CONTEXT, {
          orgType: OrgType.PRIMERICA,
          solutionNumber: '12345678',
        }).valid
      ).toBe(false);
      expect(
        service.canProgressTo(OnboardingStep.ROLE_ORG_CONTEXT, {
          orgType: OrgType.PRIMERICA,
          solutionNumber: '1234567',
        }).valid
      ).toBe(true);
    });
  });

  // T-17 QC fix: closes the enum-mismatch defect — `determineAccessTier` used to branch on/return the
  // legacy local `OrgType`/`AccessTier` (`NON_PRIMERICA`, `ORG_LINKED_FREE`, `PAID_EXTERNAL`) which do
  // not exist on the canonical Prisma enums. It now returns REAL Prisma `AccessTier` values and
  // branches on the REAL Prisma `OrgType`, for its caller `/api/onboarding/complete/route.ts`.
  describe('determineAccessTier returns real Prisma AccessTier values (T-17)', () => {
    test('low commitment score: FREE_ORG_LINKED for Primerica, FREE_PAID_EXTERNAL for external', () => {
      expect(service.determineAccessTier(3, OrgType.PRIMERICA)).toBe(AccessTier.FREE_ORG_LINKED);
      expect(service.determineAccessTier(3, OrgType.EXTERNAL)).toBe(AccessTier.FREE_PAID_EXTERNAL);
    });

    test('mid commitment score (7-8): PAID_INDIVIDUAL regardless of org type', () => {
      expect(service.determineAccessTier(7, OrgType.PRIMERICA)).toBe(AccessTier.PAID_INDIVIDUAL);
      expect(service.determineAccessTier(8, OrgType.EXTERNAL)).toBe(AccessTier.PAID_INDIVIDUAL);
    });

    test('high commitment score (>=9): ENTERPRISE regardless of org type', () => {
      expect(service.determineAccessTier(9, OrgType.PRIMERICA)).toBe(AccessTier.ENTERPRISE);
      expect(service.determineAccessTier(10, OrgType.EXTERNAL)).toBe(AccessTier.ENTERPRISE);
    });
  });
});
