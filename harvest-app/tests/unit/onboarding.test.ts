import { OnboardingService } from '../../src/services/onboarding/service';
import {
  AccessTier,
  ConsentType,
  LawfulBasis,
  OnboardingStep,
  OrgType,
  Role,
} from '../../src/types/onboarding';

describe('OnboardingService', () => {
  const service = new OnboardingService();
  const sevenWhys = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];

  describe('Organization gate: Primerica vs non-Primerica', () => {
    test('requires solution_number for Primerica users', () => {
      const result = service.canProgressTo(OnboardingStep.REGISTER, { orgType: OrgType.PRIMERICA });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Solution number');
    });

    test('validates solution number by format only', () => {
      expect(service.validateSolutionNumberFormat('SN-12345').valid).toBe(true);
      expect(service.validateSolutionNumberFormat('bad space').valid).toBe(false);
    });

    test('does not require solution_number for non-Primerica users', () => {
      const result = service.canProgressTo(OnboardingStep.REGISTER, { orgType: OrgType.EXTERNAL });
      expect(result.valid).toBe(true);
      expect(service.resolveOrgGate(OrgType.EXTERNAL).access_tier_seed).toBe(AccessTier.PAID_EXTERNAL);
    });

    test('Primerica gate seeds org-linked free access and enables Primerica packages', () => {
      const gate = service.resolveOrgGate(OrgType.PRIMERICA);
      expect(gate.requires_solution_number).toBe(true);
      expect(gate.access_tier_seed).toBe(AccessTier.ORG_LINKED_FREE);
      expect(gate.enabled_downstream_packages).toContain('WP03');
    });
  });

  describe('Role architecture and visibility', () => {
    test('external users cannot see Primerica overlay', () => {
      expect(service.getRoleVisibility(Role.EXTERNAL).can_access_primerica_overlay).toBe(false);
      expect(service.canRoleSeePrimericaOverlay(Role.EXTERNAL, OrgType.PRIMERICA)).toBe(false);
    });

    test('dual-role users get rep and upline surfaces', () => {
      const visibility = service.getRoleVisibility(Role.DUAL);
      expect(visibility.can_view_downline).toBe(true);
      expect(visibility.can_approve_flagged_content).toBe(true);
      expect(visibility.visible_profile_fields).toContain('rep_surface');
      expect(visibility.visible_profile_fields).toContain('upline_surface');
    });

    test('role selection is required for role step', () => {
      expect(service.canProgressTo(OnboardingStep.ROLE_SELECTION, {}).valid).toBe(false);
      expect(service.canProgressTo(OnboardingStep.ROLE_SELECTION, { role: Role.REP }).valid).toBe(true);
    });
  });

  describe('Seven Whys progression gate', () => {
    test('requires all seven responses', () => {
      const result = service.evaluateSevenWhys(['one'], 8);
      expect(result.passed).toBe(false);
      expect(result.error).toContain('7');
    });

    test('blocks progression below commitment threshold', () => {
      const result = service.canProgressTo(OnboardingStep.SEVEN_WHYS, {
        sevenWhys,
        intensityData: { commitmentScore: 3, weeklyHours: 10, riskTolerance: 'MEDIUM', supportNeeds: [] },
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('5');
    });

    test('allows progression when Seven Whys and threshold are complete', () => {
      const result = service.canProgressTo(OnboardingStep.SEVEN_WHYS, {
        sevenWhys,
        intensityData: { commitmentScore: 7, weeklyHours: 20, riskTolerance: 'HIGH', supportNeeds: [] },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('Goal Card and intensity calibration', () => {
    test('rejects forbidden sales terms in onboarding language', () => {
      const result = service.validateGoalCard({
        primaryGoal: 'Get more guaranteed income',
        targetDate: '2026-12-31',
        commitmentLevel: 8,
        motivationStatement: 'Freedom',
      });
      expect(result.valid).toBe(false);
    });

    test('accepts valid Goal Commitment Card seed data', () => {
      const result = service.canProgressTo(OnboardingStep.GOAL_CARD, {
        goalCard: {
          primaryGoal: 'Build a service-focused team',
          targetDate: '2026-12-31',
          commitmentLevel: 8,
          motivationStatement: 'Create stability for my family',
        },
      });
      expect(result.valid).toBe(true);
    });

    test('calibrates intensity for 2 Hour CEO mode', () => {
      expect(service.calibrateIntensity({ commitmentScore: 9, weeklyHours: 8, riskTolerance: 'HIGH', supportNeeds: [] }).setting).toBe('INTENSIVE');
      expect(service.calibrateIntensity({ commitmentScore: 6, weeklyHours: 10, riskTolerance: 'MEDIUM', supportNeeds: [] }).setting).toBe('STANDARD');
      expect(service.calibrateIntensity({ commitmentScore: 4, weeklyHours: 4, riskTolerance: 'LOW', supportNeeds: [] }).setting).toBe('CASUAL');
    });
  });

  describe('Upline, calendar, consent, and downstream contracts', () => {
    test('creates upline invitation contract', () => {
      const invite = service.createUplineInvitation({
        sponsor_id: 'upline-1',
        sponsor_email: 'upline@example.com',
        sponsor_name: 'Upline',
        sponsor_role: Role.UPLINE,
        recipient_email: 'rep@example.com',
        recipient_role: Role.REP,
        org_type: OrgType.PRIMERICA,
      });
      expect(invite.status).toBe('PENDING');
      expect(invite.resend_count).toBe(0);
    });

    test('validates calendar connection contract', () => {
      expect(service.validateCalendarConnection({
        user_id: 'user-1',
        provider: 'google',
        connected: true,
        connected_at: new Date().toISOString(),
        timezone: 'America/Chicago',
        visibility_rules: ['SHOW_FREE_BUSY'],
      }).valid).toBe(true);
    });

    test('requires WP11 consent before completion', () => {
      expect(service.canProgressTo(OnboardingStep.COMPLETE, { consentRecords: [] }).valid).toBe(false);
      const records = service.requiredConsentRecords('user-1');
      expect(records.map((record) => record.consent_type)).toEqual([ConsentType.PROFILE, ConsentType.ONBOARDING]);
      expect(records.every((record) => record.lawful_basis === LawfulBasis.CONSENT)).toBe(true);
      expect(service.canProgressTo(OnboardingStep.COMPLETE, { consentRecords: records }).valid).toBe(true);
    });

    test('defines downstream contracts without implementing downstream packages', () => {
      const contracts = service.getDownstreamContracts();
      expect(contracts.map((contract) => contract.package_id)).toEqual(['WP02', 'WP03', 'WP04', 'WP05', 'WP09', 'WP10']);
    });
  });

  describe('Step progression and completion', () => {
    test('follows correct step order', () => {
      expect(service.getNextStep(OnboardingStep.REGISTER)).toBe(OnboardingStep.ACCOUNT_TYPE);
      expect(service.getNextStep(OnboardingStep.ACCOUNT_TYPE)).toBe(OnboardingStep.ROLE_SELECTION);
      expect(service.getNextStep(OnboardingStep.CALENDAR_CONNECTION)).toBe(OnboardingStep.COMPLETE);
      expect(service.getNextStep(OnboardingStep.COMPLETE)).toBeNull();
    });

    test('finalizes onboarding with org-derived access tier and downstream contracts', () => {
      const result = service.finalizeOnboarding({
        id: 'session-1',
        userId: 'user-1',
        currentStep: OnboardingStep.INTENSITY,
        orgType: OrgType.PRIMERICA,
        role: Role.REP,
        solutionNumber: 'SN-12345',
        sevenWhys,
        goalCard: {
          primaryGoal: 'Build a service-focused team',
          targetDate: '2026-12-31',
          commitmentLevel: 8,
          motivationStatement: 'Freedom',
        },
        intensityData: { commitmentScore: 8, weeklyHours: 12, riskTolerance: 'MEDIUM', supportNeeds: [] },
        consentRecords: service.requiredConsentRecords('user-1'),
        accessTier: null,
        completed: false,
        createdAt: new Date(),
      });
      expect(result.accessTier).toBe(AccessTier.ORG_LINKED_FREE);
      expect(result.downstreamContracts).toHaveLength(6);
    });
  });
});
