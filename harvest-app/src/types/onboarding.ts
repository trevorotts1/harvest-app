export enum OnboardingStep {
  REGISTER = 'REGISTER',
  ACCOUNT_TYPE = 'ACCOUNT_TYPE',
  ROLE_SELECTION = 'ROLE_SELECTION',
  SEVEN_WHYS = 'SEVEN_WHYS',
  GOAL_CARD = 'GOAL_CARD',
  INTENSITY = 'INTENSITY',
  UPLINE_LINKAGE = 'UPLINE_LINKAGE',
  CALENDAR_CONNECTION = 'CALENDAR_CONNECTION',
  COMPLETE = 'COMPLETE',
}

export enum Role {
  REP = 'REP',
  UPLINE = 'UPLINE',
  RVP = 'RVP',
  EXTERNAL = 'EXTERNAL',
  DUAL = 'DUAL',
}

export enum OrgType {
  PRIMERICA = 'PRIMERICA',
  NON_PRIMERICA = 'NON_PRIMERICA',
  EXTERNAL = 'EXTERNAL',
}

export enum AccessTier {
  ORG_LINKED_FREE = 'ORG_LINKED_FREE',
  PAID_EXTERNAL = 'PAID_EXTERNAL',
}

export enum IntensitySetting {
  CASUAL = 'CASUAL',
  STANDARD = 'STANDARD',
  INTENSIVE = 'INTENSIVE',
}

export enum InviteStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
}

export enum ConsentType {
  PROFILE = 'PROFILE',
  ONBOARDING = 'ONBOARDING',
  CONTACTS = 'CONTACTS',
  CALENDAR = 'CALENDAR',
  TCPA_SMS = 'TCPA_SMS',
}

export enum LawfulBasis {
  CONSENT = 'CONSENT',
  CONTRACT = 'CONTRACT',
  LEGITIMATE_INTEREST = 'LEGITIMATE_INTEREST',
  LEGAL_OBLIGATION = 'LEGAL_OBLIGATION',
}

export type RiskTolerance = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface RoleVisibilityBoundary {
  can_view_self: boolean;
  can_view_downline: boolean;
  can_view_team_dashboard: boolean;
  can_view_org_dashboard: boolean;
  can_approve_flagged_content: boolean;
  can_access_primerica_overlay: boolean;
  can_manage_calendar_visibility: boolean;
  visible_profile_fields: string[];
}

export interface OrgGateDecision {
  org_type: OrgType;
  is_primerica: boolean;
  requires_solution_number: boolean;
  requires_finra_disclosure: boolean;
  access_tier_seed: AccessTier;
  blocked_steps: OnboardingStep[];
  enabled_downstream_packages: string[];
}

export interface ConsentRecord {
  consent_id: string;
  user_id: string;
  consent_type: ConsentType;
  lawful_basis: LawfulBasis;
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  version: string;
  ip_address?: string | null;
  regulations: string[];
}

export interface GoalCardData {
  primaryGoal: string;
  targetDate: string;
  commitmentLevel: number;
  motivationStatement: string;
  anchorStatement?: string;
}

export interface IntensityData {
  commitmentScore: number;
  weeklyHours: number;
  riskTolerance: RiskTolerance;
  supportNeeds: string[];
  intensitySetting?: IntensitySetting;
}

export interface SevenWhysGateResult {
  passed: boolean;
  response_count: number;
  commitment_score: number;
  error?: string;
}

export interface UplineInvitationContract {
  invite_id: string;
  sponsor_id: string;
  sponsor_email: string;
  sponsor_name: string;
  sponsor_role: Role;
  recipient_email: string;
  recipient_role: Role;
  status: InviteStatus;
  created_at: string;
  responded_at: string | null;
  resend_count: number;
  expires_at: string;
  org_type: OrgType;
}

export interface CalendarConnectionContract {
  user_id: string;
  provider: 'google' | 'outlook' | 'apple' | 'none';
  connected: boolean;
  connected_at: string | null;
  timezone: string;
  visibility_rules: CalendarVisibilityRule[];
}

export type CalendarVisibilityRule = 'SHOW_FREE_BUSY' | 'SHOW_BUSY_ONLY' | 'SHOW_DETAILS' | 'HIDE_ALL';

export interface DownstreamContract {
  package_id: 'WP02' | 'WP03' | 'WP04' | 'WP05' | 'WP09' | 'WP10';
  fields: string[];
  description: string;
}

export interface OnboardingData {
  currentStep: OnboardingStep;
  orgType?: OrgType | string;
  role?: Role;
  solutionNumber?: string;
  sevenWhys?: string[];
  goalCard?: GoalCardData;
  intensityData?: IntensityData;
  uplineInvitation?: UplineInvitationContract;
  calendarConnection?: CalendarConnectionContract;
  consentRecords?: ConsentRecord[];
}

export interface OnboardingSession {
  id: string;
  userId: string;
  currentStep: OnboardingStep;
  orgType?: OrgType | string;
  role?: Role;
  solutionNumber?: string | null;
  sevenWhys: string[] | null;
  goalCard: GoalCardData | null;
  intensityData: IntensityData | null;
  uplineInvitation?: UplineInvitationContract | null;
  calendarConnection?: CalendarConnectionContract | null;
  consentRecords?: ConsentRecord[];
  accessTier?: AccessTier | string | null;
  completed: boolean;
  createdAt: Date;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  phone?: string;
  orgType: OrgType | string;
  solutionNumber?: string;
  organizationId?: string;
  role?: Role;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export const STEP_ORDER: OnboardingStep[] = [
  OnboardingStep.REGISTER,
  OnboardingStep.ACCOUNT_TYPE,
  OnboardingStep.ROLE_SELECTION,
  OnboardingStep.SEVEN_WHYS,
  OnboardingStep.GOAL_CARD,
  OnboardingStep.INTENSITY,
  OnboardingStep.UPLINE_LINKAGE,
  OnboardingStep.CALENDAR_CONNECTION,
  OnboardingStep.COMPLETE,
];

export const MIN_COMMITMENT_SCORE = 5;
export const SEVEN_WHYS_MIN_RESPONSES = 7;
export const SOLUTION_NUMBER_PATTERN = /^[A-Za-z0-9-]{4,20}$/;
export const INVITE_EXPIRY_DAYS = 7;
export const MAX_INVITE_RESENDS = 3;

export const GOAL_CARD_SEED: Omit<GoalCardData, 'primaryGoal' | 'targetDate'> = {
  commitmentLevel: 5,
  motivationStatement: '',
  anchorStatement: undefined,
};

export const INTENSITY_CALIBRATION: Record<IntensitySetting, { min_hours: number; max_hours: number }> = {
  [IntensitySetting.CASUAL]: { min_hours: 2, max_hours: 9 },
  [IntensitySetting.STANDARD]: { min_hours: 10, max_hours: 24 },
  [IntensitySetting.INTENSIVE]: { min_hours: 25, max_hours: 40 },
};

export const ROLE_VISIBILITY: Record<Role, RoleVisibilityBoundary> = {
  [Role.REP]: {
    can_view_self: true,
    can_view_downline: false,
    can_view_team_dashboard: false,
    can_view_org_dashboard: false,
    can_approve_flagged_content: false,
    can_access_primerica_overlay: true,
    can_manage_calendar_visibility: false,
    visible_profile_fields: ['own_profile', 'own_pipeline', 'own_calendar_status'],
  },
  [Role.UPLINE]: {
    can_view_self: true,
    can_view_downline: true,
    can_view_team_dashboard: true,
    can_view_org_dashboard: false,
    can_approve_flagged_content: true,
    can_access_primerica_overlay: true,
    can_manage_calendar_visibility: true,
    visible_profile_fields: ['own_profile', 'team_activity', 'team_calendar_availability'],
  },
  [Role.RVP]: {
    can_view_self: true,
    can_view_downline: true,
    can_view_team_dashboard: true,
    can_view_org_dashboard: true,
    can_approve_flagged_content: true,
    can_access_primerica_overlay: true,
    can_manage_calendar_visibility: true,
    visible_profile_fields: ['organization_dashboard', 'team_activity', 'calendar_layers'],
  },
  [Role.EXTERNAL]: {
    can_view_self: true,
    can_view_downline: false,
    can_view_team_dashboard: false,
    can_view_org_dashboard: false,
    can_approve_flagged_content: false,
    can_access_primerica_overlay: false,
    can_manage_calendar_visibility: false,
    visible_profile_fields: ['own_profile', 'universal_features'],
  },
  [Role.DUAL]: {
    can_view_self: true,
    can_view_downline: true,
    can_view_team_dashboard: true,
    can_view_org_dashboard: false,
    can_approve_flagged_content: true,
    can_access_primerica_overlay: true,
    can_manage_calendar_visibility: true,
    visible_profile_fields: ['own_profile', 'rep_surface', 'upline_surface'],
  },
};

export function normalizeOrgType(orgType: OrgType | string | undefined): OrgType | undefined {
  if (!orgType) return undefined;
  if (orgType === OrgType.PRIMERICA || orgType === 'PRIMERICA') return OrgType.PRIMERICA;
  if (orgType === OrgType.NON_PRIMERICA || orgType === 'NON_PRIMERICA') return OrgType.NON_PRIMERICA;
  return OrgType.EXTERNAL;
}

export function calibrateIntensity(commitmentScore: number, weeklyHours: number): IntensitySetting {
  if (commitmentScore >= 8 || weeklyHours >= 25) return IntensitySetting.INTENSIVE;
  if (commitmentScore >= 6 || weeklyHours >= 10) return IntensitySetting.STANDARD;
  return IntensitySetting.CASUAL;
}

export function findForbiddenTerms(value: string): string[] {
  const forbidden = ['prospect', 'lead', 'pitch', 'sales call', 'guaranteed income'];
  const lower = value.toLowerCase();
  return forbidden.filter((term) => lower.includes(term));
}
