// WP04 AI Agent Layer & Mission Control — Complete Types & Contracts

import { RelationshipType, PipelineStage, LifeEvent } from './warm-market';
import { Role as ComplianceRole } from './compliance';

// ─── Agent Identity ───────────────────────────────────────────────────

export enum AgentType {
  PROSPECTING = 'PROSPECTING',
  PRE_SALE_NURTURE = 'PRE_SALE_NURTURE',
  POST_SALE_NURTURE = 'POST_SALE_NURTURE',
  APPOINTMENT = 'APPOINTMENT',
  REPORTING = 'REPORTING',
  QUOTA = 'QUOTA',
  IPA_VALUE = 'IPA_VALUE',
  INACTIVITY_REENGAGEMENT = 'INACTIVITY_REENGAGEMENT',
}

export const ALL_AGENT_TYPES: AgentType[] = Object.values(AgentType);

/** Tier 1 = 99.9% SLA, Tier 2 = 99.5% SLA */
export enum AgentTier {
  CRITICAL = 'CRITICAL',
  OPERATIONAL = 'OPERATIONAL',
}

export const AGENT_TIER_MAP: Record<AgentType, AgentTier> = {
  [AgentType.PROSPECTING]: AgentTier.CRITICAL,
  [AgentType.PRE_SALE_NURTURE]: AgentTier.CRITICAL,
  [AgentType.POST_SALE_NURTURE]: AgentTier.CRITICAL,
  [AgentType.INACTIVITY_REENGAGEMENT]: AgentTier.CRITICAL,
  [AgentType.APPOINTMENT]: AgentTier.OPERATIONAL,
  [AgentType.REPORTING]: AgentTier.OPERATIONAL,
  [AgentType.QUOTA]: AgentTier.OPERATIONAL,
  [AgentType.IPA_VALUE]: AgentTier.OPERATIONAL,
};

export enum AgentExecutionMode {
  PARALLEL = 'PARALLEL',
  SEQUENTIAL = 'SEQUENTIAL',
}

export const AGENT_EXECUTION_MODE: Record<AgentType, AgentExecutionMode> = {
  [AgentType.PROSPECTING]: AgentExecutionMode.PARALLEL,
  [AgentType.PRE_SALE_NURTURE]: AgentExecutionMode.PARALLEL,
  [AgentType.POST_SALE_NURTURE]: AgentExecutionMode.PARALLEL,
  [AgentType.APPOINTMENT]: AgentExecutionMode.SEQUENTIAL,
  [AgentType.REPORTING]: AgentExecutionMode.PARALLEL,
  [AgentType.QUOTA]: AgentExecutionMode.PARALLEL,
  [AgentType.IPA_VALUE]: AgentExecutionMode.PARALLEL,
  [AgentType.INACTIVITY_REENGAGEMENT]: AgentExecutionMode.PARALLEL,
};

// ─── Agent Actions & Events ──────────────────────────────────────────

export enum AgentActionType {
  // Prospecting
  PRIORITIZE_PROSPECTS = 'PRIORITIZE_PROSPECTS',
  DRAFT_FIRST_TOUCH = 'DRAFT_FIRST_TOUCH',
  UPDATE_PIPELINE_STAGE = 'UPDATE_PIPELINE_STAGE',

  // Nurture
  SEND_NURTURE_MESSAGE = 'SEND_NURTURE_MESSAGE',
  EVALUATE_BUYING_SIGNALS = 'EVALUATE_BUYING_SIGNALS',
  FLAG_READY_FOR_APPOINTMENT = 'FLAG_READY_FOR_APPOINTMENT',

  // Post-sale
  SCHEDULE_CHECK_IN = 'SCHEDULE_CHECK_IN',
  REQUEST_REFERRAL = 'REQUEST_REFERRAL',
  SCHEDULE_RENEWAL_REMINDER = 'SCHEDULE_RENEWAL_REMINDER',

  // Appointment
  CHECK_CALENDAR_AVAILABILITY = 'CHECK_CALENDAR_AVAILABILITY',
  PROPOSE_APPOINTMENT = 'PROPOSE_APPOINTMENT',
  CONFIRM_APPOINTMENT = 'CONFIRM_APPOINTMENT',
  HANDLE_CALENDAR_CONFLICT = 'HANDLE_CALENDAR_CONFLICT',

  // Reporting
  COMPILE_DAILY_BRIEFING = 'COMPILE_DAILY_BRIEFING',
  GENERATE_PIPELINE_SNAPSHOT = 'GENERATE_PIPELINE_SNAPSHOT',

  // Quota
  CHECK_MILESTONE_PROGRESS = 'CHECK_MILESTONE_PROGRESS',
  FLAG_UNDERPERFORMANCE = 'FLAG_UNDERPERFORMANCE',

  // IPA
  CALCULATE_IPA_RATIO = 'CALCULATE_IPA_RATIO',
  CALCULATE_IPA_DOLLAR_VALUE = 'CALCULATE_IPA_DOLLAR_VALUE',

  // Inactivity
  DETECT_INACTIVITY = 'DETECT_INACTIVITY',
  TRIGGER_REENGAGEMENT = 'TRIGGER_REENGAGEMENT',
  ESCALATE_TO_UPLINE = 'ESCALATE_TO_UPLINE',

  // Three Laws
  CHECK_THREE_LAWS_COMPLIANCE = 'CHECK_THREE_LAWS_COMPLIANCE',
  ISSUE_CORRECTIVE_NUDGE = 'ISSUE_CORRECTIVE_NUDGE',

  // Cross-cutting
  COMPLIANCE_BLOCK = 'COMPLIANCE_BLOCK',
  COMPLIANCE_FLAG = 'COMPLIANCE_FLAG',
  LOG_AGENT_EVENT = 'LOG_AGENT_EVENT',
}

export enum AgentActionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  BLOCKED_BY_COMPLIANCE = 'BLOCKED_BY_COMPLIANCE',
  HELD_FOR_REVIEW = 'HELD_FOR_REVIEW',
}

export interface AgentAction {
  id: string;
  agentType: AgentType;
  actionType: AgentActionType;
  status: AgentActionStatus;
  contactId?: string;
  userId: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  complianceResult?: ComplianceGateResult;
  createdAt: Date;
  completedAt?: Date;
}

export interface ComplianceGateResult {
  passed: boolean;
  riskScore: number;
  outcome: 'PASS' | 'FLAG' | 'BLOCK';
  blocked: boolean;
  safeHarborInjected: boolean;
}

export interface AgentEvent {
  id: string;
  agentType: AgentType;
  actionType: AgentActionType;
  userId: string;
  contactId?: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  compliancePassed: boolean;
}

// ─── Three Laws ──────────────────────────────────────────────────────

export enum ThreeLaw {
  GROW_DOWNLINE = 'GROW_DOWNLINE',
  ENGAGE_BASE = 'ENGAGE_BASE',
  INCREASE_WEALTH = 'INCREASE_WEALTH',
}

export const THREE_LAWS: ThreeLaw[] = [
  ThreeLaw.GROW_DOWNLINE,
  ThreeLaw.ENGAGE_BASE,
  ThreeLaw.INCREASE_WEALTH,
];

export interface ThreeLawScore {
  law: ThreeLaw;
  score: number; // 0-100
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  lastActivityDate: string | null;
  correctiveNudge?: CorrectiveNudge;
}

export interface ThreeLawCompositeScore {
  scores: Record<ThreeLaw, ThreeLawScore>;
  compositeScore: number; // 0-100 weighted
  level: ScoringLevel;
  neglectedLaws: ThreeLaw[];
  requiresIntervention: boolean;
}

export enum ScoringLevel {
  DORMANT = 'DORMANT',   // 0
  SEED = 'SEED',         // 1
  GROWER = 'GROWER',     // 2
  THRIVER = 'THRIVER',   // 3
  MASTER = 'MASTER',     // 4
}

export interface CorrectiveNudge {
  id: string;
  law: ThreeLaw;
  severity: 'GENTLE' | 'FIRM' | 'URGENT';
  message: string;
  suggestedAction: string;
  triggeredAt: Date;
  dismissedAt?: Date;
  escalatedToUpline: boolean;
}

// ─── Inactivity Detection ────────────────────────────────────────────

export enum InactivityLevel {
  NONE = 'NONE',
  LOW = 'LOW',           // 3 days
  MEDIUM = 'MEDIUM',     // 5 days
  HIGH = 'HIGH',         // 7 days
  CRITICAL = 'CRITICAL', // 14+ days
}

export const INACTIVITY_THRESHOLDS = {
  [InactivityLevel.NONE]: 0,
  [InactivityLevel.LOW]: 3,
  [InactivityLevel.MEDIUM]: 5,
  [InactivityLevel.HIGH]: 7,
  [InactivityLevel.CRITICAL]: 14,
} as const;

export interface InactivityState {
  userId: string;
  level: InactivityLevel;
  daysInactive: number;
  lastActivityDate: Date | null;
  reengagementSequenceStep: number;
  correctiveNudgesIssued: number;
  uplineNotified: boolean;
}

export enum ReengagementStep {
  NOT_STARTED = 0,
  ANCHOR_REMINDER = 1,     // Day 3: anchor statement nudge
  GENTLE_NUDGE = 2,        // Day 5: gentle activity suggestion
  UPLINE_ALERT = 3,        // Day 7: notify upline
  ESCALATION = 4,          // Day 14: compliance/admin escalation
}

// ─── Mission Control — Rep View ──────────────────────────────────────

export interface DailyBriefing {
  userId: string;
  date: string; // ISO date
  overnightActivity: OvernightActivitySummary;
  newResponses: ContactResponse[];
  todayAppointments: AppointmentSummary[];
  actionQueue: PrioritizedAction[];
  pipelineSnapshot: PipelineSnapshot;
  momentumIndicators: MomentumIndicators;
  anchorStatement: string | null;
  threeLawsStatus: ThreeLawCompositeScore;
  inactivityAlerts: InactivityState[];
  complianceFlags: ComplianceFlagItem[];
}

export interface OvernightActivitySummary {
  prospectingActions: number;
  nurtureMessagesSent: number;
  appointmentsScheduled: number;
  reengagementAttempts: number;
  complianceBlocks: number;
  pipelineStageChanges: PipelineStageChange[];
}

export interface PipelineStageChange {
  contactId: string;
  contactName: string;
  fromStage: PipelineStage;
  toStage: PipelineStage;
  changedAt: Date;
  agentType: AgentType;
}

export interface ContactResponse {
  contactId: string;
  contactName: string;
  messagePreview: string;
  receivedAt: Date;
  suggestedAction: string;
}

export interface AppointmentSummary {
  id: string;
  contactId: string;
  contactName: string;
  scheduledTime: string; // ISO 8601
  durationMinutes: number;
  type: 'INTRO' | 'FOLLOW_UP' | 'CLOSING' | 'CHECK_IN';
  status: 'CONFIRMED' | 'PENDING_CONFIRMATION' | 'NEEDS_RESCHEDULE';
}

export interface PrioritizedAction {
  id: string;
  priority: number; // 1 = highest
  actionType: AgentActionType;
  description: string;
  contactId?: string;
  contactName?: string;
  dueBy?: Date;
  estimatedMinutes: number; // 2 Hour CEO constraint
  agentType: AgentType;
  requiresHumanApproval: boolean;
}

export interface PipelineSnapshot {
  totalContacts: number;
  byStage: Record<PipelineStage, number>;
  introducedCount: number;
  respondedCount: number;
  appointmentCount: number;
  activatedCount: number;
  agentRatio: number;      // introductions / responses
  closingRatio: number;    // appointments / activated
}

export interface MomentumIndicators {
  weeklyScore: number;       // 0-100
  trendDirection: 'UP' | 'FLAT' | 'DOWN';
  daysSinceLastIPA: number;
  ipaValueThisWeek: number;
  ipaTargetThisWeek: number;
  paceStatus: PaceStatus;
}

export enum PaceStatus {
  AHEAD = 'AHEAD',
  ON_TRACK = 'ON_TRACK',
  BEHIND = 'BEHIND',
  CRITICAL = 'CRITICAL',
}

export interface ComplianceFlagItem {
  id: string;
  contentType: string;
  riskScore: number;
  outcome: 'FLAG' | 'BLOCK';
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'ESCALATED';
  createdAt: Date;
}

// ─── Mission Control — Upline View ───────────────────────────────────

export interface UplineDashboard {
  uplineId: string;
  teamOverview: TeamOverview;
  repSummaries: RepSummary[];
  teamInactivityAlerts: InactivityState[];
  teamComplianceFlags: ComplianceFlagItem[];
  coachingInterventions: CoachingIntervention[];
  teamPaceIndicators: Record<string, PaceStatus>;
}

export interface TeamOverview {
  totalReps: number;
  activeReps: number;
  inactiveReps: number;
  totalContacts: number;
  totalAppointmentsThisWeek: number;
  teamAgentRatio: number;
  teamClosingRatio: number;
  averageMomentumScore: number;
}

export interface RepSummary {
  repId: string;
  repName: string;
  paceStatus: PaceStatus;
  momentumScore: number;
  lastActivityDate: Date | null;
  pipelineStageCounts: Record<PipelineStage, number>;
  appointmentsThisWeek: number;
  threeLawScores: ThreeLawCompositeScore;
  inactivityLevel: InactivityLevel;
  pendingComplianceFlags: number;
}

export interface CoachingIntervention {
  id: string;
  repId: string;
  repName: string;
  type: 'INACTIVITY' | 'UNDERPERFORMANCE' | 'COMPLIANCE' | 'THREE_LAW_NEGLECT';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  suggestedAction: string;
  createdAt: Date;
  resolvedAt?: Date;
}

// ─── Quota & IPA ─────────────────────────────────────────────────────

export interface QuotaState {
  userId: string;
  weeklyTarget: number;
  weeklyActual: number;
  monthlyTarget: number;
  monthlyActual: number;
  underperformanceFlagged: boolean;
  lastMilestoneCheck: Date;
}

export interface IPAState {
  userId: string;
  /** Agent ratio: introductions / responses (baseline 20:5:1) */
  agentRatio: number;
  /** Field trainer ratio: appointments run / closed */
  fieldTrainerRatio: number;
  /** Dollar-value equivalent of IPA activities */
  dollarValue: number;
  dataPoints: number;
  /** Self-optimizing: adjusts targets based on rolling 30-day average */
  optimizedTarget: number;
}

/** The 20:5:1 baseline ratio */
export const IPA_BASELINE_RATIO = {
  INTRODUCTIONS: 20,
  RESPONSES: 5,
  APPOINTMENTS: 1,
} as const;

// ─── Appointment Agent — Dual-Calendar Contracts ─────────────────────

export interface CalendarAvailabilityWindow {
  start: string; // ISO 8601
  end: string;   // ISO 8601
  provider: 'google' | 'outlook' | 'apple';
  userId: string;
}

export interface DualCalendarAvailability {
  repWindows: CalendarAvailabilityWindow[];
  uplineWindows: CalendarAvailabilityWindow[];
  overlappingWindows: CalendarAvailabilityWindow[];
  timezone: string;
}

export interface AppointmentRequest {
  contactId: string;
  contactName: string;
  repId: string;
  uplineId?: string;
  preferredTimes?: string[]; // ISO 8601
  durationMinutes: number;
  type: 'INTRO' | 'FOLLOW_UP' | 'CLOSING' | 'CHECK_IN';
  /** Rep's time-blocked hours — appointments must not overlap */
  blockedHours: TimeBlock[];
}

export interface TimeBlock {
  dayOfWeek: number; // 0-6
  startHour: number; // 0-23
  endHour: number;   // 0-23
  label: string;
}

export interface AppointmentResult {
  success: boolean;
  appointmentId?: string;
  scheduledTime?: string;
  conflictDetected?: boolean;
  alternativeTimes?: string[];
  requiresRepConfirmation: boolean;
}

// ─── Role Visibility Enforcement ──────────────────────────────────────

export type AgentViewRole = 'REP' | 'UPLINE' | 'RVP' | 'ADMIN';

export interface RoleVisibilityFilter {
  role: AgentViewRole;
  canSeeAgentEvents: AgentType[];
  canSeePipelineData: boolean;
  canSeeTeamData: boolean;
  canIssueCorrectiveNudges: boolean;
  canApproveComplianceFlags: boolean;
  canViewDownlineActivity: boolean;
  canOverrideAppointments: boolean;
}

export const AGENT_ROLE_VISIBILITY: Record<AgentViewRole, RoleVisibilityFilter> = {
  REP: {
    role: 'REP',
    canSeeAgentEvents: ALL_AGENT_TYPES,
    canSeePipelineData: true,
    canSeeTeamData: false,
    canIssueCorrectiveNudges: false,
    canApproveComplianceFlags: false,
    canViewDownlineActivity: false,
    canOverrideAppointments: true,
  },
  UPLINE: {
    role: 'UPLINE',
    canSeeAgentEvents: ALL_AGENT_TYPES,
    canSeePipelineData: true,
    canSeeTeamData: true,
    canIssueCorrectiveNudges: true,
    canApproveComplianceFlags: true,
    canViewDownlineActivity: true,
    canOverrideAppointments: true,
  },
  RVP: {
    role: 'RVP',
    canSeeAgentEvents: ALL_AGENT_TYPES,
    canSeePipelineData: true,
    canSeeTeamData: true,
    canIssueCorrectiveNudges: true,
    canApproveComplianceFlags: true,
    canViewDownlineActivity: true,
    canOverrideAppointments: true,
  },
  ADMIN: {
    role: 'ADMIN',
    canSeeAgentEvents: ALL_AGENT_TYPES,
    canSeePipelineData: true,
    canSeeTeamData: true,
    canIssueCorrectiveNudges: true,
    canApproveComplianceFlags: true,
    canViewDownlineActivity: true,
    canOverrideAppointments: true,
  },
};

// ─── Integration Contracts ───────────────────────────────────────────

/** WP05 consumes: agent intent + action payloads for messaging/outreach */
export interface WP05AgentIntentContract {
  agentType: AgentType;
  actionType: AgentActionType;
  contactId: string;
  userId: string;
  messageContent: string;
  channel: 'SMS' | 'EMAIL' | 'SOCIAL' | 'IN_APP';
  priority: number;
  requiresComplianceReview: boolean;
  suggestedSendTime?: string; // ISO 8601
}

/** WP07 consumes: agent activity events for gamification/motivation */
export interface WP07ActivityEventContract {
  eventType: 'IPA_COMPLETED' | 'MILESTONE_REACHED' | 'INACTIVITY_DETECTED' | 'THREE_LAW_NEGLECT' | 'APPOINTMENT_SET' | 'RESPONSE_RECEIVED';
  userId: string;
  agentType: AgentType;
  value: number;
  timestamp: string; // ISO 8601
  metadata: Record<string, unknown>;
}

/** WP09 consumes: appointment data for calendar integration */
export interface WP09AppointmentContract {
  appointmentId: string;
  repId: string;
  uplineId?: string;
  contactId: string;
  scheduledTime: string; // ISO 8601
  durationMinutes: number;
  type: 'INTRO' | 'FOLLOW_UP' | 'CLOSING' | 'CHECK_IN';
  status: 'CONFIRMED' | 'PENDING' | 'CANCELLED' | 'RESCHEDULED';
  repTimezone: string;
  /** Calendar event IDs after sync */
  repCalendarEventId?: string;
  uplineCalendarEventId?: string;
}

// ─── Event Pipeline ──────────────────────────────────────────────────

export enum PipelineEventType {
  CONTACT_ADDED = 'CONTACT_ADDED',
  CONTACT_STAGE_CHANGED = 'CONTACT_STAGE_CHANGED',
  RESPONSE_RECEIVED = 'RESPONSE_RECEIVED',
  APPOINTMENT_REQUESTED = 'APPOINTMENT_REQUESTED',
  APPOINTMENT_CONFIRMED = 'APPOINTMENT_CONFIRMED',
  INACTIVITY_DETECTED = 'INACTIVITY_DETECTED',
  QUOTA_MILESTONE_CHECK = 'QUOTA_MILESTONE_CHECK',
  THREE_LAW_NEGLECT = 'THREE_LAW_NEGLECT',
  COMPLIANCE_EVENT = 'COMPLIANCE_EVENT',
}

export interface PipelineEvent {
  id: string;
  type: PipelineEventType;
  userId: string;
  contactId?: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  consumedBy: AgentType[];
}

// ─── 2 Hour CEO Constraint ──────────────────────────────────────────

export const TWO_HOUR_CEO_LIMITS = {
  MAX_DAILY_ACTIONS: 20,
  MAX_ACTION_DURATION_MINUTES: 5,
  MORNING_BRIEFING_MINUTES: 5,
  COMPLIANCE_REVIEW_MINUTES: 5,
  APPOINTMENT_CONFIRM_MINUTES: 1,
  ANCHOR_UPDATE_MINUTES: 5,
  EVENING_RECAP_MINUTES: 5,
  TOTAL_DAILY_MINUTES: 30,
} as const;

// ─── Utility Functions ──────────────────────────────────────────────

export function computeScoringLevel(compositeScore: number): ScoringLevel {
  if (compositeScore >= 80) return ScoringLevel.MASTER;
  if (compositeScore >= 60) return ScoringLevel.THRIVER;
  if (compositeScore >= 40) return ScoringLevel.GROWER;
  if (compositeScore >= 20) return ScoringLevel.SEED;
  return ScoringLevel.DORMANT;
}

export function computeInactivityLevel(daysInactive: number): InactivityLevel {
  if (daysInactive >= 14) return InactivityLevel.CRITICAL;
  if (daysInactive >= 7) return InactivityLevel.HIGH;
  if (daysInactive >= 5) return InactivityLevel.MEDIUM;
  if (daysInactive >= 3) return InactivityLevel.LOW;
  return InactivityLevel.NONE;
}

export function computePaceStatus(weeklyActual: number, weeklyTarget: number): PaceStatus {
  if (weeklyTarget === 0) return PaceStatus.ON_TRACK;
  const ratio = weeklyActual / weeklyTarget;
  if (ratio >= 1.1) return PaceStatus.AHEAD;
  if (ratio >= 0.8) return PaceStatus.ON_TRACK;
  if (ratio >= 0.5) return PaceStatus.BEHIND;
  return PaceStatus.CRITICAL;
}

export function enforceRoleVisibility(
  viewerRole: AgentViewRole,
  targetUserId: string,
  viewerUserId: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const visibility = AGENT_ROLE_VISIBILITY[viewerRole];

  // Reps can only see their own data
  if (viewerRole === 'REP' && targetUserId !== viewerUserId) {
    return {};
  }

  // Upline/RVP can see downline data but strip cross-team details
  if (!visibility.canSeeTeamData) {
    delete data.teamData;
  }

  return data;
}