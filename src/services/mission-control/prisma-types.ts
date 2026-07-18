// WP04 (T-32) — the narrow, DI-mockable Prisma surface Mission Control reads/writes through. Same
// convention as every other service in this codebase (AgentRuntimeStore, ContactFlagsPrismaClient,
// OnboardingGatePrismaClient, ...): declare only the shape actually used, so tests can supply an
// in-memory fake with zero real Prisma/DB involved, and so a broken query in one zone's fake can be
// simulated in isolation (proves AC-5.2-6 / master-spec §9.5 independent zone failure with teeth).

export interface MomentumEventRow {
  law: string;
  points: number;
  created_at: Date;
}

export interface MilestoneRow {
  milestone_key: string;
  achieved_at: Date;
  celebrated: boolean;
}

export interface AgentRunRow {
  id: string;
  agent_key: string;
  status: string; // PENDING | RUNNING | COMPLETED | FAILED | HELD
  reasoning_log: string | null;
  finished_at: Date | null;
  created_at: Date;
}

export interface DraftMessageRow {
  id: string;
  user_id: string;
  contact_id: string;
  channel: string;
  cfe_outcome: string | null;
  approval_state: string;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
}

export interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  pipeline_stage: string;
  is_client: boolean;
  updated_at: Date;
  created_at: Date;
}

export interface AppointmentRow {
  id: string;
  rep_id: string;
  contact_id: string;
  status: string;
  confirmed_start: Date | null;
  created_at: Date;
}

export interface TeamEventRow {
  id: string;
  organization_id: string;
  type: string;
  starts_at: Date;
}

export interface AttendanceRow {
  id: string;
  event_id: string;
  user_id: string;
  state: string;
}

export interface MissionControlPrismaClient {
  momentumEvent: {
    findMany(args: { where: { user_id: string } }): Promise<MomentumEventRow[]>;
    create(args: {
      data: { user_id: string; event_type: string; points: number; law: string; source_ref?: string | null };
    }): Promise<{ id: string }>;
  };
  milestone: {
    findMany(args: { where: { user_id: string } }): Promise<MilestoneRow[]>;
  };
  agentRun: {
    findMany(args: {
      where: { user_id: string; agent_key?: string; created_at?: { gte: Date } };
      orderBy: { created_at: 'desc' };
      take?: number;
    }): Promise<AgentRunRow[]>;
  };
  draftMessage: {
    findMany(args: {
      where: { user_id: string; approval_state?: { in: string[] } | string };
      orderBy?: { created_at: 'asc' | 'desc' };
    }): Promise<DraftMessageRow[]>;
    findFirst(args: { where: { id: string; user_id: string } }): Promise<DraftMessageRow | null>;
    update(args: {
      where: { id: string };
      data: { approval_state: string; approved_by?: string; approved_at?: Date };
    }): Promise<DraftMessageRow>;
  };
  contact: {
    findMany(args: { where: { user_id: string; id?: { in: string[] } } }): Promise<ContactRow[]>;
  };
  appointment: {
    findMany(args: { where: { rep_id: string; status?: string } }): Promise<AppointmentRow[]>;
    findFirst(args: { where: { id: string; rep_id: string } }): Promise<AppointmentRow | null>;
    update(args: { where: { id: string }; data: { status: string } }): Promise<AppointmentRow>;
  };
  teamEvent: {
    findMany(args: {
      where: { organization_id: string; starts_at: { gte: Date } };
      orderBy: { starts_at: 'asc' };
      take: number;
    }): Promise<TeamEventRow[]>;
    findFirst(args: { where: { id: string; organization_id: string } }): Promise<TeamEventRow | null>;
  };
  attendance: {
    findMany(args: { where: { event_id: { in: string[] }; user_id: string } }): Promise<AttendanceRow[]>;
    upsert(args: {
      where: { event_id_user_id: { event_id: string; user_id: string } };
      create: { event_id: string; user_id: string; state: string };
      update: { state: string };
    }): Promise<AttendanceRow>;
  };
}
