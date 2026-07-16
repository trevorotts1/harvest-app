// ═══════════════════════════════════════════════════════════════════════
// WP01: Onboarding & Profile Engine — Type Definitions
// ═══════════════════════════════════════════════════════════════════════

// ─── Role Architecture ─────────────────────────────────────────────────

// T-R3 (Wave-0 gate + T-14 QC carry-forward): the local six-value `Role` enum — which still carried
// the stale `EXTERNAL` value — is RETIRED in favor of the canonical five-role Prisma enum
// (REP | UPLINE | RVP | ADMIN | DUAL, §3.1). `EXTERNAL` was never a real role: per §3.1 "the
// baseline `EXTERNAL` value is retired; external solo users are `rep` with an external org." This is
// now the SAME `Role` the auth layer (src/lib/auth/rbac.ts, rbac-matrix.ts) and the compliance layer
// (src/types/compliance.ts) already use, so there is exactly one Role definition in the codebase and
// nothing downstream can key a step-map / visibility row off a role that does not exist.
import { Role } from '@prisma/client';

export { Role };

// ─── Organization Gate ────────────────────────────────────────────────

// T-17 QC fix (dual-source-of-truth defect): the local `OrgType` enum here used to carry its OWN
// two-value shape (`PRIMERICA` / `NON_PRIMERICA`) that did not match the canonical Prisma `OrgType`
// (`PRIMERICA` / `EXTERNAL`, see prisma/schema.prisma). That mismatch meant `service.ts` — which
// imports `OrgType` from THIS file — branched on a value (`NON_PRIMERICA`) that the rest of the
// platform (the wp01 org-gate, the wp01 solution-number check, `identity-gate.ts`, `next-auth.d.ts`,
// the register route) never produces or checks for, since they all correctly use the Prisma enum.
// Retired in favor of the canonical Prisma enum, the SAME retirement already done for `Role` above:
// there is now exactly one `OrgType` definition in the codebase.
import { OrgType } from '@prisma/client';

export { OrgType };

// ─── Onboarding Steps (Full State Machine) ─────────────────────────────

export enum OnboardingStep {
  REGISTER = 'REGISTER',
  ACCOUNT_TYPE = 'ACCOUNT_TYPE',
  ROLE_ORG_CONTEXT = 'ROLE_ORG_CONTEXT',
  SEVEN_WHYS = 'SEVEN_WHYS',
  GOAL_CARD = 'GOAL_CARD',
  INTENSITY = 'INTENSITY',
  SPONSOR_MATCHING = 'SPONSOR_MATCHING',
  FINRA_DISCLOSURE = 'FINRA_DISCLOSURE',
  CALENDAR_CONNECTION = 'CALENDAR_CONNECTION',
  CONSENT_CAPTURE = 'CONSENT_CAPTURE',
  COMPLETE = 'COMPLETE',
}

// ─── Access Tier ──────────────────────────────────────────────────────

// T-17 QC fix: same dual-source-of-truth defect as `OrgType` above — the local `AccessTier` enum used
// its own member names (`ORG_LINKED_FREE` / `PAID_EXTERNAL`) that did not match the canonical Prisma
// `AccessTier` (`FREE_ORG_LINKED` / `FREE_PAID_EXTERNAL` / `PAID_INDIVIDUAL` / `ENTERPRISE`, see
// prisma/schema.prisma), which `identity-gate.ts` and `next-auth.d.ts` already correctly use. Retired
// in favor of the canonical Prisma enum.
import { AccessTier } from '@prisma/client';

export { AccessTier };

// ─── Onboarding Status ────────────────────────────────────────────────

export enum OnboardingStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  GATED_COMPLETE = 'GATED_COMPLETE',
}

// ─── FINRA U4 Status ──────────────────────────────────────────────────

export enum FinraU4Status {
  VALIDATED = 'VALIDATED',
  PENDING = 'PENDING',
  SUSPENDED = 'SUSPENDED',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

// ─── Intensity Settings ───────────────────────────────────────────────

export enum IntensitySetting {
  CASUAL = 'CASUAL',
  STANDARD = 'STANDARD',
  INTENSIVE = 'INTENSIVE',
}

// ─── Invite Status (Upline Invitation State Machine) ──────────────────

export enum InviteStatus {
  SENT = 'SENT',
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

// ─── Consent / Lawful Basis (WP11 Integration) ──────────────────────

export enum LawfulBasis {
  CONSENT = 'consent',
  CONTRACT = 'contract',
  LEGITIMATE_INTEREST = 'legitimate_interest',
  LEGAL_OBLIGATION = 'legal_obligation',
}

export enum ConsentType {
  PROFILE = 'profile',
  CONTACTS = 'contacts',
  CALENDAR = 'calendar',
  AGENT_LOGS = 'agent_logs',
  SMS_OUTREACH = 'sms_outreach',
  EMAIL_OUTREACH = 'email_outreach',
  ANALYTICS = 'analytics',
}

// ─── Constants ────────────────────────────────────────────────────────

/** Seven Whys emotional resonance threshold — scores below this trigger re-analysis prompt */
export const SEVEN_WHYS_MIN_SCORE = 70;

/** Minimum commitment score (1-10) to proceed past Intensity step */
export const MIN_COMMITMENT_SCORE = 5;

/** Days before an upline invite expires */
export const INVITE_EXPIRY_DAYS = 7;

/** Maximum invite resends allowed */
export const MAX_INVITE_RESENDS = 3;

/**
 * @deprecated T-17 QC fix: this used to be its OWN weaker pattern (`/^\d{6,8}$/`, 6-8 digits) — a
 * second, mismatched source of truth alongside the authoritative §6.3 7-digit rule in
 * `src/services/onboarding/wp01/solution-number.ts` (`SOLUTION_NUMBER_FORMAT = /^\d{7}$/`). A route
 * validating against THIS pattern would accept a 6-digit or 8-digit "solution number" that the
 * authoritative wp01 rule rejects. Corrected here to the same 7-digit format so no path reachable via
 * this constant can diverge from the spec; `OnboardingService.validateSolutionNumberFormat` no longer
 * reads this constant at all — it delegates directly to the wp01 module. Kept only in case an external
 * caller still imports it; new code should import `SOLUTION_NUMBER_FORMAT` from
 * `services/onboarding/wp01/solution-number` directly.
 */
export const SOLUTION_NUMBER_PATTERN = /^\d{7}$/;

/** Ordered list of all steps (legacy linear flow for backward compat) */
export const STEP_ORDER: OnboardingStep[] = [
  OnboardingStep.REGISTER,
  OnboardingStep.ACCOUNT_TYPE,
  OnboardingStep.SEVEN_WHYS,
  OnboardingStep.GOAL_CARD,
  OnboardingStep.INTENSITY,
  OnboardingStep.COMPLETE,
];

// ─── Role-Step Visibility Map ─────────────────────────────────────────
// Each role sees only their permitted steps in order

export const ROLE_STEP_MAP: Record<Role, OnboardingStep[]> = {
  [Role.REP]: [
    OnboardingStep.REGISTER,
    OnboardingStep.ACCOUNT_TYPE,
    OnboardingStep.ROLE_ORG_CONTEXT,
    OnboardingStep.SEVEN_WHYS,
    OnboardingStep.GOAL_CARD,
    OnboardingStep.INTENSITY,
    OnboardingStep.CONSENT_CAPTURE,
  ],
  [Role.UPLINE]: [
    OnboardingStep.REGISTER,
    OnboardingStep.ACCOUNT_TYPE,
    OnboardingStep.ROLE_ORG_CONTEXT,
    OnboardingStep.FINRA_DISCLOSURE,
    OnboardingStep.CALENDAR_CONNECTION,
    OnboardingStep.CONSENT_CAPTURE,
  ],
  [Role.RVP]: [
    OnboardingStep.REGISTER,
    OnboardingStep.ACCOUNT_TYPE,
    OnboardingStep.ROLE_ORG_CONTEXT,
    OnboardingStep.FINRA_DISCLOSURE,
    OnboardingStep.CALENDAR_CONNECTION,
    OnboardingStep.CONSENT_CAPTURE,
  ],
  [Role.DUAL]: [
    OnboardingStep.REGISTER,
    OnboardingStep.ACCOUNT_TYPE,
    OnboardingStep.ROLE_ORG_CONTEXT,
    OnboardingStep.SEVEN_WHYS,
    OnboardingStep.GOAL_CARD,
    OnboardingStep.INTENSITY,
    OnboardingStep.FINRA_DISCLOSURE,
    OnboardingStep.CALENDAR_CONNECTION,
    OnboardingStep.CONSENT_CAPTURE,
  ],
  [Role.ADMIN]: [
    OnboardingStep.REGISTER,
    OnboardingStep.CONSENT_CAPTURE,
  ],
};

// ─── Role Visibility Boundaries ────────────────────────────────────────

export interface VisibilityBoundary {
  canViewDownline: boolean;
  canManageTeam: boolean;
  canAccessFinancials: boolean;
  canCrossOrgAnalytics: boolean;
  canConfigureSponsor: boolean;
  canSkipSponsorMatching: boolean;
  requiresFinraDisclosure: boolean;
  canViewOrgHierarchy: boolean;
}

export const ROLE_VISIBILITY: Record<Role, VisibilityBoundary> = {
  [Role.REP]: {
    canViewDownline: false,
    canManageTeam: false,
    canAccessFinancials: false,
    canCrossOrgAnalytics: false,
    canConfigureSponsor: false,
    canSkipSponsorMatching: false,
    requiresFinraDisclosure: false,
    canViewOrgHierarchy: false,
  },
  [Role.UPLINE]: {
    canViewDownline: true,
    canManageTeam: true,
    canAccessFinancials: false,
    canCrossOrgAnalytics: false,
    canConfigureSponsor: true,
    canSkipSponsorMatching: true,
    requiresFinraDisclosure: true,
    canViewOrgHierarchy: true,
  },
  [Role.RVP]: {
    canViewDownline: true,
    canManageTeam: true,
    canAccessFinancials: true,
    canCrossOrgAnalytics: true,
    canConfigureSponsor: true,
    canSkipSponsorMatching: true,
    requiresFinraDisclosure: true,
    canViewOrgHierarchy: true,
  },
  [Role.DUAL]: {
    canViewDownline: true,
    canManageTeam: true,
    canAccessFinancials: false,
    canCrossOrgAnalytics: false,
    canConfigureSponsor: true,
    canSkipSponsorMatching: true,
    requiresFinraDisclosure: true,
    canViewOrgHierarchy: true,
  },
  [Role.ADMIN]: {
    canViewDownline: true,
    canManageTeam: true,
    canAccessFinancials: true,
    canCrossOrgAnalytics: true,
    canConfigureSponsor: true,
    canSkipSponsorMatching: true,
    requiresFinraDisclosure: false,
    canViewOrgHierarchy: true,
  },
};

// ─── Forbidden Terms (WP11 compliance) ─────────────────────────────────

export const FORBIDDEN_TERMS = ['prospect', 'lead', 'pitch', 'sales call', 'guaranteed income'];

export function findForbiddenTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_TERMS.filter(term => lower.includes(term));
}

// ─── Core Domain Interfaces ───────────────────────────────────────────

export interface SevenWhysResponse {
  question: string;
  answer: string;
  score: number; // 0-100 emotional resonance score
}

export interface GoalCommitmentCard {
  primaryGoal: string;
  targetDate: string; // ISO date string
  commitmentLevel: number; // 1-10
  motivationStatement: string;
  anchorStatement?: string; // Generated from Seven Whys output; feeds WP07
}

export interface IntensityData {
  commitmentScore: number; // 1-10
  weeklyHours: number; // 2-40+
  riskTolerance: 'LOW' | 'MEDIUM' | 'HIGH';
  supportNeeds: string[];
}

export interface CalendarPreferences {
  timezone: string;
  connected: boolean;
  autoCloseEnabled?: boolean;
  visibilityRules?: string[];
}

export interface UplineInvite {
  inviteId: string;
  sponsorId: string;
  recipientEmail: string;
  status: InviteStatus;
  createdAt: string; // ISO datetime
  respondedAt: string | null;
  resendCount: number;
}

// ─── Onboarding Session (Primary State) ────────────────────────────────

export interface OnboardingSession {
  user_id: string;
  role: Role;
  org_type: OrgType;
  current_step: OnboardingStep;
  onboarding_status: OnboardingStatus;
  seven_whys: SevenWhysResponse[] | null;
  seven_whys_score: number | null;
  solution_number: string | null;
  goal_card: GoalCommitmentCard | null;
  intensity_data: IntensityData | null;
  intensity_setting: IntensitySetting | null;
  calendar_preferences: CalendarPreferences | null;
  finra_u4_status: FinraU4Status | null;
  sponsor_id: string | null;
  access_tier: AccessTier | null;
  gdpr_consent: boolean;
  completed: boolean;
  updated_at: string;
}

// ─── Validation Result ─────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ─── Downstream Contracts (TypeScript interfaces only, no implementation) ──

/** WP02: Warm Market & Contacts contract */
export interface WP02WarmMarketContract {
  user_id: string;
  role: Role;
  organization: string[];
  onboarding_status: OnboardingStatus;
  sponsor_id: string | null;
}

/** WP03: Harvest Method / Lead Pipeline contract */
export interface WP03HarvestMethodContract {
  user_id: string;
  intensity_setting: IntensitySetting;
  onboarding_status: OnboardingStatus;
}

/** WP04: AI Agent Layer & Mission Control contract */
export interface WP04AgentLayerContract {
  user_id: string;
  anchor_statement: string;
  intensity_setting: IntensitySetting;
  role: Role;
}

/** WP05: Messaging Engine contract */
export interface WP05MessagingContract {
  user_id: string;
  first_name: string;
  organization: string[];
  role: Role;
}

/** WP09: Calendar & Dashboard entry point contract */
export interface WP09CalendarContract {
  user_id: string;
  calendar_preferences: CalendarPreferences;
  calendar_connected: boolean;
  role: Role;
  intensity_setting: IntensitySetting;
}

/** WP10: Payment & Subscription contract */
export interface WP10PaymentContract {
  user_id: string;
  access_tier: AccessTier;
}

/** WP11: Compliance & Data Governance — consent/lawful basis outcome */
export interface WP11ConsentResult {
  user_id: string;
  consent_captured: boolean;
  lawful_basis: LawfulBasis;
  regulations: string[];
  finra_u4_status: FinraU4Status | null;
}

/** Onboarding completed event (published to shared event bus) */
export interface OnboardingCompletedEvent {
  event: 'user.onboarding_completed';
  user_id: string;
  role: Role;
  access_tier: AccessTier;
  organization: string[];
  anchor_statement: string;
  intensity_setting: IntensitySetting;
}

// ─── Legacy Compatibility Aliases ─────────────────────────────────────
// API routes and existing tests use these shapes; kept for backward compat

export interface OnboardingData {
  currentStep: OnboardingStep;
  orgType?: OrgType | string;
  solutionNumber?: string;
  sevenWhys?: string[];
  goalCard?: GoalCommitmentCard;
  intensityData?: IntensityData;
}

export interface GoalCardData {
  primaryGoal: string;
  targetDate: string;
  commitmentLevel: number;
  motivationStatement: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  phone?: string;
  orgType: OrgType | string;
  solutionNumber?: string;
  organizationId?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}