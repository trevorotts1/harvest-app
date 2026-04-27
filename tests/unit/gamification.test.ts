import { momentumService } from '../../src/services/gamification/momentum.service';
import { celebrationService } from '../../src/services/gamification/celebration.service';
import { nudgeEngine } from '../../src/services/gamification/nudge.service';
import { goalCardService } from '../../src/services/gamification/goal-card.service';
import { CelebrationMilestone, NudgeType } from '../../src/types/gamification';

beforeEach(() => {
  momentumService._reset();
  celebrationService._reset();
  nudgeEngine._reset();
  goalCardService._reset();
});

describe('WP07 Gamification', () => {
  const userId = 'test-user-1';

  test('momentum starts at 0 for new user', () => {
    const score = momentumService.getMomentumScore(userId);
    expect(score.score).toBe(0);
    expect(score.streakDays).toBe(0);
    expect(score.activitiesToday).toBe(0);
    expect(score.daysSinceLastActivity).toBe(0);
  });

  test('activity updates momentum score', () => {
    const updated = momentumService.recordActivity(userId);
    // score = streakDays*2 + activitiesToday*5 - daysSinceLastActivity*10
    // = 0*2 + 1*5 - 0*10 = 5
    expect(updated.activitiesToday).toBe(1);
    expect(updated.score).toBe(5);
    expect(updated.lastActivityAt).not.toBeNull();

    // Second activity
    const updated2 = momentumService.recordActivity(userId);
    expect(updated2.activitiesToday).toBe(2);
    expect(updated2.score).toBe(10);
  });

  test('48h inactivity drops momentum', () => {
    // Build up some momentum first
    momentumService.updateMomentum(userId, { streakDays: 3, activitiesToday: 2 });

    // Simulate 5 days of inactivity
    const result = momentumService.simulateInactivity(userId, 5);
    // score = streakDays*2 + activitiesToday*5 - daysSinceLastActivity*10
    // = 3*2 + 2*5 - 5*10 = 6 + 10 - 50 = -34
    expect(result.score).toBeLessThan(0);
    expect(result.daysSinceLastActivity).toBe(5);
  });

  test('celebration triggers milestones', () => {
    // Set up a user with a 7-day streak
    momentumService.updateMomentum(userId, { streakDays: 7, activitiesToday: 1 });

    const milestones = celebrationService.checkMilestones(userId, momentumService.getMomentumScore(userId));
    expect(milestones).toContain(CelebrationMilestone.STREAK_7_DAYS);

    // Trigger the celebration
    const celebration = celebrationService.triggerCelebration(userId, CelebrationMilestone.STREAK_7_DAYS);
    expect(celebration.milestone).toBe(CelebrationMilestone.STREAK_7_DAYS);
    expect(celebration.message).toContain('7-day streak');

    // Should not re-trigger the same milestone
    const milestones2 = celebrationService.checkMilestones(userId, momentumService.getMomentumScore(userId));
    expect(milestones2).not.toContain(CelebrationMilestone.STREAK_7_DAYS);
  });

  test('anti-hoarder detection when too many celebrations accumulate', () => {
    // Add 11 celebrations to trigger hoarding
    for (let i = 0; i < 11; i++) {
      celebrationService.triggerCelebration(userId, CelebrationMilestone.FIRST_CONTACT);
    }
    expect(celebrationService.isHoarding(userId)).toBe(true);
  });

  test('nudge engine returns BELIEF_RESTORE when belief < 5', () => {
    const momentum = momentumService.getMomentumScore(userId);
    const nudge = nudgeEngine.getNudge(userId, 3, momentum);
    expect(nudge.type).toBe(NudgeType.BELIEF_RESTORE);
    expect(nudge.beliefScore).toBe(3);

    // When belief >= 5, should NOT return BELIEF_RESTORE
    const nudge2 = nudgeEngine.getNudge(userId, 7, momentum);
    expect(nudge2.type).not.toBe(NudgeType.BELIEF_RESTORE);
  });

  test('goal card CRUD', () => {
    // Create
    const created = goalCardService.updateGoalCard(userId, {
      primaryGoal: 'Close 10 deals',
      targetDate: '2026-12-31',
      commitmentLevel: 8,
      motivationStatement: 'Financial freedom for my family',
      progress: 0,
    });
    expect(created.primaryGoal).toBe('Close 10 deals');
    expect(created.commitmentLevel).toBe(8);

    // Read
    const read = goalCardService.getGoalCard(userId);
    expect(read).not.toBeNull();
    expect(read!.primaryGoal).toBe('Close 10 deals');

    // Update progress
    const updated = goalCardService.updateGoalCard(userId, { progress: 50 });
    expect(updated.progress).toBe(50);
    expect(updated.primaryGoal).toBe('Close 10 deals'); // preserved

    // Get progress
    const progress = goalCardService.getGoalProgress(userId);
    expect(progress).toBe(50);
  });
});