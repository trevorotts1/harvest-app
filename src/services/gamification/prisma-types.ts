// T-43 (WP07) — the narrow, DI-mockable Prisma surface every gamification service reads/writes
// through. Same convention as `mission-control/prisma-types.ts` / `ContactFlagsPrismaClient` /
// `OnboardingGatePrismaClient`: declare only the shape actually used, so tests supply an in-memory
// fake with zero real Prisma/DB involved.

export interface MomentumEventRow {
  id?: string;
  user_id: string;
  event_type: string;
  points: number;
  law: string;
  source_ref: string | null;
  created_at: Date;
}

export interface MilestoneRow {
  id?: string;
  user_id: string;
  milestone_key: string;
  achieved_at: Date;
  celebrated: boolean;
  shareable_asset_ref: string | null;
}

export interface QuoteRow {
  id: string;
  text: string;
  attribution: string | null;
  org_scope: string;
  cfe_cleared: boolean;
  tags: string[];
}

export interface CourseProgressRow {
  id?: string;
  user_id: string;
  module_key: string;
  status: string;
  completed_at: Date | null;
}

export interface GoalCommitmentCardRow {
  user_id: string;
  income_target: string | null;
  promotion_timeline: string | null;
  top_three_dreams: unknown;
  financial_goals: unknown;
  weekly_activity_math: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface StreakStateRow {
  user_id: string;
  current_streak_days: number;
  longest_streak_days: number;
  last_qualifying_date: string | null;
  grace_day_used_for_week: string | null;
  updated_at: Date;
}

export interface NotificationPreferenceRow {
  user_id: string;
  morning_briefing_enabled: boolean;
  morning_briefing_time: string;
  midday_motivation_enabled: boolean;
  evening_recap_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
}

export interface NotificationLogRow {
  id?: string;
  user_id: string;
  type: string;
  unmutable: boolean;
  dedupe_key: string;
  deep_link: string | null;
  created_at: Date;
}

export interface ReferralRow {
  id: string;
  referrer_user_id: string;
  relationship_type: string;
  channel: string;
  script_text: string;
  cfe_outcome: string | null;
  cfe_cleared: boolean;
  referred_contact_id: string | null;
  created_at: Date;
}

export interface ContactRow {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  is_a_list: boolean;
  pipeline_stage: string;
  last_contact_date: Date | null;
  is_client: boolean;
  do_not_contact: boolean;
  referred_by_contact_id: string | null;
  created_at: Date;
}

export interface UserRow {
  id: string;
  name: string;
  org_type: string;
  intensity_setting: string;
  onboarding_status: string;
  gated_complete_at: Date | null;
  upline_id: string | null;
}

export interface DraftMessageRow {
  id: string;
  user_id: string;
  contact_id: string;
  approval_state: string;
  created_at: Date;
}

/** The full delegate surface used across gamification/*.service.ts. Individual services narrow this
 *  down further in their own local interfaces where only a subset is needed — this is the superset
 *  reference type new services can `Pick<>` from. */
export interface GamificationPrismaClient {
  momentumEvent: {
    findMany(args: { where: { user_id: string; event_type?: string | { in: string[] } } }): Promise<MomentumEventRow[]>;
    create(args: { data: Omit<MomentumEventRow, 'id' | 'created_at'> }): Promise<MomentumEventRow>;
  };
  milestone: {
    findMany(args: { where: { user_id: string } }): Promise<MilestoneRow[]>;
    findUnique(args: { where: { user_id_milestone_key: { user_id: string; milestone_key: string } } }): Promise<MilestoneRow | null>;
    create(args: { data: Omit<MilestoneRow, 'id'> }): Promise<MilestoneRow>;
    update(args: { where: { user_id_milestone_key: { user_id: string; milestone_key: string } }; data: Partial<MilestoneRow> }): Promise<MilestoneRow>;
  };
  quoteLibrary: {
    findMany(args: { where: Record<string, unknown> }): Promise<QuoteRow[]>;
  };
  courseProgress: {
    findMany(args: { where: { user_id: string } }): Promise<CourseProgressRow[]>;
    upsert(args: {
      where: { user_id_module_key: { user_id: string; module_key: string } };
      create: Omit<CourseProgressRow, 'id'>;
      update: Partial<CourseProgressRow>;
    }): Promise<CourseProgressRow>;
  };
  goalCommitmentCard: {
    findUnique(args: { where: { user_id: string } }): Promise<GoalCommitmentCardRow | null>;
    upsert(args: {
      where: { user_id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<GoalCommitmentCardRow>;
  };
  streakState: {
    findUnique(args: { where: { user_id: string } }): Promise<StreakStateRow | null>;
    upsert(args: {
      where: { user_id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<StreakStateRow>;
  };
  notificationPreference: {
    findUnique(args: { where: { user_id: string } }): Promise<NotificationPreferenceRow | null>;
    upsert(args: {
      where: { user_id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<NotificationPreferenceRow>;
  };
  notificationLog: {
    findUnique(args: { where: { user_id_type_dedupe_key: { user_id: string; type: string; dedupe_key: string } } }): Promise<NotificationLogRow | null>;
    create(args: { data: Omit<NotificationLogRow, 'id' | 'created_at'> }): Promise<NotificationLogRow>;
    findMany(args: { where: { user_id: string; type?: string } }): Promise<NotificationLogRow[]>;
  };
  referral: {
    create(args: { data: Omit<ReferralRow, 'id' | 'created_at'> }): Promise<ReferralRow>;
    update(args: { where: { id: string }; data: Partial<ReferralRow> }): Promise<ReferralRow>;
    findFirst(args: { where: { id: string; referrer_user_id: string } }): Promise<ReferralRow | null>;
  };
  contact: {
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number }): Promise<ContactRow[]>;
    findFirst(args: { where: { id: string; user_id: string } }): Promise<ContactRow | null>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<ContactRow>;
  };
  contactMethodProfile?: {
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number }): Promise<{ contact_id: string; readiness_tier: string | null }[]>;
  };
  user: {
    findUnique(args: { where: { id: string }; select?: Record<string, unknown> }): Promise<UserRow | null>;
    update(args: { where: { id: string }; data: Partial<UserRow> }): Promise<UserRow>;
    findMany(args: { where: Record<string, unknown> }): Promise<UserRow[]>;
  };
  draftMessage: {
    findMany(args: { where: Record<string, unknown> }): Promise<DraftMessageRow[]>;
  };
  whySession: {
    findFirst(args: { where: { user_id: string }; orderBy?: Record<string, unknown> }): Promise<{ anchor_statement: string | null } | null>;
  };
}
