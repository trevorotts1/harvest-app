import { Nudge, NudgeType, MomentumScore } from '../../types/gamification';

const nudgeHistory = new Map<string, Nudge[]>();

const NUDGE_MESSAGES: Record<NudgeType, string> = {
  [NudgeType.BELIEF_RESTORE]: 'Your belief needs a boost. Revisit your Seven Whys and remember why you started.',
  [NudgeType.ACTIVITY_REMINDER]: 'You haven\'t been active today. One small action builds momentum.',
  [NudgeType.STREAK_ENCOURAGE]: 'Your streak is building! Keep going — consistency is your superpower.',
  [NudgeType.STREAK_RECOVERY]: 'Your streak slipped. That\'s okay — restart now, one day at a time.',
  [NudgeType.GOAL_REFOCUS]: 'Your goal needs attention. Re-read your commitment card and take one step.',
  [NudgeType.MILESTONE_HINT]: 'You\'re close to a milestone! Push through and unlock your next win.',
};

function createNudge(userId: string, type: NudgeType, extra?: Partial<Pick<Nudge, 'beliefScore' | 'streakDays' | 'daysSinceActivity'>>): Nudge {
  const nudge: Nudge = {
    userId,
    type,
    message: NUDGE_MESSAGES[type],
    createdAt: new Date(),
    ...extra,
  };
  const list = nudgeHistory.get(userId) ?? [];
  list.push(nudge);
  nudgeHistory.set(userId, list);
  return nudge;
}

export const nudgeEngine = {
  /**
   * Get a contextual nudge for the user.
   * beliefScore < 5 triggers BELIEF_RESTORE as highest priority.
   */
  getNudge(userId: string, beliefScore: number, momentum: MomentumScore): Nudge {
    // Priority 1: Belief is critically low
    if (beliefScore < 5) {
      return createNudge(userId, NudgeType.BELIEF_RESTORE, { beliefScore });
    }

    // Priority 2: Inactivity (2+ days)
    if (momentum.daysSinceLastActivity >= 2) {
      return createNudge(userId, NudgeType.STREAK_RECOVERY, {
        daysSinceActivity: momentum.daysSinceLastActivity,
      });
    }

    // Priority 3: No activity today but streak alive
    if (momentum.activitiesToday === 0 && momentum.streakDays > 0) {
      return createNudge(userId, NudgeType.ACTIVITY_REMINDER);
    }

    // Priority 4: Streak encouragement
    if (momentum.streakDays >= 3 && momentum.activitiesToday > 0) {
      return createNudge(userId, NudgeType.STREAK_ENCOURAGE, { streakDays: momentum.streakDays });
    }

    // Default: activity reminder
    return createNudge(userId, NudgeType.ACTIVITY_REMINDER);
  },

  getNudgeHistory(userId: string): Nudge[] {
    return nudgeHistory.get(userId) ?? [];
  },

  /** Reset store (for tests) */
  _reset(): void {
    nudgeHistory.clear();
  },
};