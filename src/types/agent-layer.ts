// WP04: AI Agent Layer & Mission Control — Types

export enum AgentType {
  PROSPECTING = 'PROSPECTING',
  NURTURE = 'NURTURE',
  APPOINTMENT = 'APPOINTMENT',
  FOLLOWUP = 'FOLLOWUP',
  REACTIVATION = 'REACTIVATION',
}

export const ALL_AGENT_TYPES: AgentType[] = [
  AgentType.PROSPECTING,
  AgentType.NURTURE,
  AgentType.APPOINTMENT,
  AgentType.FOLLOWUP,
  AgentType.REACTIVATION,
];

export enum AgentStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  SLEEPING = 'SLEEPING',
}

export enum ThreeLawsViolation {
  NEGLECT = 'NEGLECT',
  DISORGANIZED = 'DISORGANIZED',
  HOARDING = 'HOARDING',
  BURNOUT = 'BURNOUT',
}

export interface AgentState {
  agentType: AgentType;
  status: AgentStatus;
  lastRunAt: Date | null;
  currentQueue: QueuedAction[];
}

export interface QueuedAction {
  id: string;
  contactId: string;
  actionType: string;
  scheduledFor: Date;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
}

export interface ActionableInsight {
  type: ThreeLawsViolation;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendation: string;
  priority: number; // 1 = highest
}

export interface DailyBriefing {
  date: string;
  pendingActions: QueuedAction[];
  agentStatuses: AgentState[];
  progressScore: number;
  weeklyGoal: WeeklyGoal;
  violations: ActionableInsight[];
}

export interface WeeklyGoal {
  contactsReached: number;
  contactsReachedTarget: number;
  appointmentsSet: number;
  appointmentsSetTarget: number;
  followupsCompleted: number;
  followupsCompletedTarget: number;
}

export interface MissionControl {
  dailyBriefing: DailyBriefing;
  todayTodos: QueuedAction[];
  progressScore: number;
  weeklyGoal: WeeklyGoal;
}

export interface RepDashboard {
  userId: string;
  agents: AgentState[];
  briefing: DailyBriefing;
  progressScore: number;
  pipelineSummary: Record<string, number>;
}

export interface UplineOverview {
  uplineId: string;
  teamSize: number;
  teamProgressScores: { userId: string; score: number }[];
  avgProgressScore: number;
  topPerformers: { userId: string; score: number }[];
  alerts: ActionableInsight[];
}

export interface AgentActionInput {
  agentType: AgentType;
  contactId: string;
  contactData: Record<string, unknown>;
  userId: string;
}

export interface AgentActionResult {
  actionId: string;
  agentType: AgentType;
  content: string;
  compliant: boolean;
  cfeResult: import('../types/compliance').CFEResult;
  timestamp: Date;
}