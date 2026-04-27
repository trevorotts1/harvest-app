import { Celebration, CelebrationMilestone, GoalCommitmentCard, MomentumScore } from '../../types/gamification';

const celebrations = new Map<string, Celebration[]>();

const MILESTONE_MESSAGES: Record<CelebrationMilestone, string> = {
  [CelebrationMilestone.FIRST_CONTACT]: '🎉 You made your first contact! The journey begins.',
  [CelebrationMilestone.FIRST_APPOINTMENT]: '📅 First appointment booked! That\'s momentum.',
  [CelebrationMilestone.FIRST_FOLLOW_UP]: '🔄 First follow-up sent! Consistency wins.',
  [CelebrationMilestone.FIRST_DEAL_CLOSE]: '🏆 First deal closed! You\'re a closer.',
  [CelebrationMilestone.FIRST_REFERRAL]: '🤝 First referral earned! Trust compounds.',
  [CelebrationMilestone.STREAK_7_DAYS]: '🔥 7-day streak! You\'re building discipline.',
  [CelebrationMilestone.STREAK_30_DAYS]: '💪 30-day streak! You\'re unstoppable.',
  [CelebrationMilestone.STREAK_90_DAYS]: '🚀 90-day streak! You\'re a force of nature.',
  [CelebrationMilestone.GOAL_COMMITTED]: '🎯 Goal committed! Clarity creates power.',
  [CelebrationMilestone.GOAL_MILESTONE_25]: '📊 25% toward your goal! Quarter way there.',
  [CelebrationMilestone.GOAL_MILESTONE_50]: '📊 50% toward your goal! Halfway home.',
  [CelebrationMilestone.GOAL_MILESTONE_75]: '📊 75% toward your goal! Almost there.',
  [CelebrationMilestone.GOAL_COMPLETE]: '🏁 Goal complete! You did it!',
};

export const celebrationService = {
  checkMilestones(userId: string, momentum: MomentumScore, goalCard?: GoalCommitmentCard): CelebrationMilestone[] {
    const triggered: CelebrationMilestone[] = [];
    const existing = (celebrations.get(userId) ?? []).map((c) => c.milestone);

    // Streak milestones
    if (momentum.streakDays >= 7 && !existing.includes(CelebrationMilestone.STREAK_7_DAYS)) {
      triggered.push(CelebrationMilestone.STREAK_7_DAYS);
    }
    if (momentum.streakDays >= 30 && !existing.includes(CelebrationMilestone.STREAK_30_DAYS)) {
      triggered.push(CelebrationMilestone.STREAK_30_DAYS);
    }

    // Goal progress milestones
    if (goalCard) {
      const p = goalCard.progress;
      if (p >= 25 && !existing.includes(CelebrationMilestone.GOAL_MILESTONE_25)) {
        triggered.push(CelebrationMilestone.GOAL_MILESTONE_25);
      }
      if (p >= 50 && !existing.includes(CelebrationMilestone.GOAL_MILESTONE_50)) {
        triggered.push(CelebrationMilestone.GOAL_MILESTONE_50);
      }
    }

    return triggered;
  },

  triggerCelebration(userId: string, milestone: CelebrationMilestone): Celebration {
    const celebration: Celebration = {
      userId,
      milestone,
      message: MILESTONE_MESSAGES[milestone],
      triggeredAt: new Date(),
    };
    const list = celebrations.get(userId) ?? [];
    list.push(celebration);
    celebrations.set(userId, list);
    return celebration;
  },

  isHoarding(userId: string): boolean {
    const list = celebrations.get(userId) ?? [];
    // Anti-hoarder: more than 10 unviewed celebrations triggers hoarding detection
    return list.length > 10;
  },

  getCelebrations(userId: string): Celebration[] {
    return celebrations.get(userId) ?? [];
  },

  /** Reset store (for tests) */
  _reset(): void {
    celebrations.clear();
  },
};