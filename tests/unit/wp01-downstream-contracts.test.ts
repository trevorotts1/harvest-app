// WP01 §6.9 — downstream data contracts (event bus). Proves (d): the `user.onboarding_completed`
// event is emitted with the exact spec shape, and each downstream WP's projected contract carries
// the declared fields — all derived from the SAME emitted event, never assembled ad hoc per WP.

import { AccessTier, IntensitySetting, OnboardingStatus, Role } from '@prisma/client';

import {
  InMemoryOnboardingEventSink,
  buildOnboardingCompletedEvent,
  emitOnboardingCompleted,
  projectToWP02,
  projectToWP03,
  projectToWP04,
  projectToWP05,
  projectToWP06,
  projectToWP07,
  projectToWP08,
  projectToWP09,
  projectToWP10,
} from '../../src/services/onboarding/wp01/downstream-contracts';

const BASE_INPUT = {
  user_id: 'user-1',
  role: Role.REP,
  access_tier: AccessTier.FREE_ORG_LINKED,
  organization: ['org-1'],
  anchor_statement: 'I build so my children never have to wonder.',
  intensity_setting: IntensitySetting.MEDIUM,
};

describe('WP01 downstream contracts — §6.9', () => {
  describe('the base event — exact §6.9 shape', () => {
    test('buildOnboardingCompletedEvent produces exactly the six spec fields', () => {
      const event = buildOnboardingCompletedEvent(BASE_INPUT);
      expect(event).toEqual({
        event: 'user.onboarding_completed',
        user_id: 'user-1',
        role: Role.REP,
        access_tier: AccessTier.FREE_ORG_LINKED,
        organization: ['org-1'],
        anchor_statement: BASE_INPUT.anchor_statement,
        intensity_setting: IntensitySetting.MEDIUM,
      });
      expect(Object.keys(event).sort()).toEqual(
        ['access_tier', 'anchor_statement', 'event', 'intensity_setting', 'organization', 'role', 'user_id'].sort()
      );
    });

    test('organization is always an array, even for single-org membership (§6.8 multi-org as a set)', () => {
      const event = buildOnboardingCompletedEvent(BASE_INPUT);
      expect(Array.isArray(event.organization)).toBe(true);
    });
  });

  describe('emitOnboardingCompleted — publishes to the sink and returns the event', () => {
    test('publishes exactly one event with the built shape', async () => {
      const sink = new InMemoryOnboardingEventSink();
      const event = await emitOnboardingCompleted(sink, BASE_INPUT);
      expect(sink.events).toHaveLength(1);
      expect(sink.events[0]).toEqual(event);
      expect(event.event).toBe('user.onboarding_completed');
    });
  });

  // (d) Each downstream WP gets its declared fields, all derived from the SAME event.
  describe('per-WP projections — each declared field set from the §6.9 "Per-WP:" sentence', () => {
    const event = buildOnboardingCompletedEvent(BASE_INPUT);

    test('WP02 gets identity + sponsor seed', () => {
      const contract = projectToWP02(event, { sponsor_id: 'sponsor-1', onboarding_status: OnboardingStatus.GATED_COMPLETE });
      expect(contract).toEqual({
        user_id: 'user-1',
        role: Role.REP,
        organization: ['org-1'],
        onboarding_status: OnboardingStatus.GATED_COMPLETE,
        sponsor_id: 'sponsor-1',
      });
    });

    test('WP03 reads intensity_setting + solution_number', () => {
      const contract = projectToWP03(event, {
        onboarding_status: OnboardingStatus.GATED_COMPLETE,
        solution_number: '1234567',
      });
      expect(contract.intensity_setting).toBe(IntensitySetting.MEDIUM);
      expect(contract.solution_number).toBe('1234567');
      expect(contract.user_id).toBe('user-1');
    });

    test('WP03 solution_number is null for a non-Primerica user (never a fabricated value)', () => {
      const contract = projectToWP03(event, { onboarding_status: OnboardingStatus.GATED_COMPLETE, solution_number: null });
      expect(contract.solution_number).toBeNull();
    });

    test('WP04 is seeded with anchor_statement + intensity', () => {
      const contract = projectToWP04(event);
      expect(contract).toEqual({
        user_id: 'user-1',
        anchor_statement: BASE_INPUT.anchor_statement,
        intensity_setting: IntensitySetting.MEDIUM,
        role: Role.REP,
      });
    });

    test('WP05 uses first_name/organization/mobile_phone', () => {
      const contract = projectToWP05(event, { first_name: 'Tasha', mobile_phone: '+15551234567' });
      expect(contract).toEqual({
        user_id: 'user-1',
        first_name: 'Tasha',
        organization: ['org-1'],
        mobile_phone: '+15551234567',
        role: Role.REP,
      });
    });

    test('WP06 uses anchor_statement + org', () => {
      const contract = projectToWP06(event);
      expect(contract).toEqual({
        user_id: 'user-1',
        anchor_statement: BASE_INPUT.anchor_statement,
        organization: ['org-1'],
      });
    });

    test('WP07 uses anchor_statement + intensity', () => {
      const contract = projectToWP07(event);
      expect(contract).toEqual({
        user_id: 'user-1',
        anchor_statement: BASE_INPUT.anchor_statement,
        intensity_setting: IntensitySetting.MEDIUM,
      });
    });

    test('WP08 reads sponsor→downline graph seed + access_tier + role', () => {
      const contract = projectToWP08(event, { sponsor_id: 'sponsor-1' });
      expect(contract).toEqual({
        user_id: 'user-1',
        sponsor_id: 'sponsor-1',
        access_tier: AccessTier.FREE_ORG_LINKED,
        role: Role.REP,
      });
    });

    test('WP09 reads calendar_preferences/calendar_connected', () => {
      const calendarPreferences = { timezone: 'America/New_York', connected: true };
      const contract = projectToWP09(event, { calendar_preferences: calendarPreferences, calendar_connected: true });
      expect(contract).toEqual({
        user_id: 'user-1',
        calendar_preferences: calendarPreferences,
        calendar_connected: true,
        role: Role.REP,
        intensity_setting: IntensitySetting.MEDIUM,
      });
    });

    test('WP10 provisions per access_tier — exactly {user_id, access_tier}, the WP10 provisioning contract (§15.2)', () => {
      const contract = projectToWP10(event);
      expect(contract).toEqual({ user_id: 'user-1', access_tier: AccessTier.FREE_ORG_LINKED });
      expect(Object.keys(contract).sort()).toEqual(['access_tier', 'user_id']);
    });

    test('WP10 never receives a non-Prisma / legacy tier value — always a real AccessTier enum member', () => {
      const validTiers = new Set(Object.values(AccessTier));
      const contract = projectToWP10(event);
      expect(validTiers.has(contract.access_tier)).toBe(true);
    });
  });

  describe('a track with no Seven Whys anchor (upline/RVP tracks never run Flow C)', () => {
    test('anchor_statement defaults to empty string, not null/undefined — WP04/06/07 projections stay well-typed', () => {
      const event = buildOnboardingCompletedEvent({ ...BASE_INPUT, role: Role.UPLINE, anchor_statement: '' });
      expect(event.anchor_statement).toBe('');
      expect(projectToWP04(event).anchor_statement).toBe('');
      expect(projectToWP06(event).anchor_statement).toBe('');
      expect(projectToWP07(event).anchor_statement).toBe('');
    });
  });
});
