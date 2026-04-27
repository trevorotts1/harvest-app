export enum CelebrationMilestone {
  FIRST_CONTACT = 'FIRST_CONTACT',
  FIRST_APPOINTMENT = 'FIRST_APPOINTMENT',
  FIRST_FOLLOW_UP = 'FIRST_FOLLOW_UP',
  FIRST_DEAL_CLOSE = 'FIRST_DEAL_CLOSE',
  FIRST_REFERRAL = 'FIRST_REFERRAL',
  STREAK_7_DAYS = 'STREAK_7_DAYS',
  STREAK_30_DAYS = 'STREAK_30_DAYS',
  STREAK_90_DAYS = 'STREAK_90_DAYS',
  GOAL_COMMITTED = 'GOAL_COMMITTED',
  GOAL_MILESTONE_25 = 'GOAL_MILESTONE_25',
  GOAL_MILESTONE_50 = 'GOAL_MILESTONE_50',
  GOAL_MILESTONE_75 = 'GOAL_MILESTONE_75',
  GOAL_COMPLETE = 'GOAL_COMPLETE',
}

export enum NudgeType {
  BELIEF_RESTORE = 'BELIEF_RESTORE',
  ACTIVITY_REMINDER = 'ACTIVITY_REMINDER',
  STREAK_ENCOURAGE = 'STREAK_ENCOURAGE',
  STREAK_RECOVERY = 'STREAK_RECOVERY',
  GOAL_REFOCUS = 'GOAL_REFOCUS',
  MILESTONE_HINT = 'MILESTONE_HINT',
}

export interface MomentumScore {
  userId: string;
  score: number;
  streakDays: number;
  activitiesToday: number;
  daysSinceLastActivity: number;
  lastActivityAt: Date | null;
  updatedAt: Date;
}

export interface GoalCommitmentCard {
  userId: string;
  primaryGoal: string;
  targetDate: string;
  commitmentLevel: number;
  motivationStatement: string;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Celebration {
  userId: string;
  milestone: CelebrationMilestone;
  message: string;
  triggeredAt: Date;
}

export interface Nudge {
  userId: string;
  type: NudgeType;
  message: string;
  beliefScore?: number;
  streakDays?: number;
  daysSinceActivity?: number;
  createdAt: Date;
}