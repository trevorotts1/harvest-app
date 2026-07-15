// WP02: Warm Market & Contact Engine — Types

export enum ContactSource {
  CSV = 'CSV',
  MANUAL = 'MANUAL',
  MOBILE = 'MOBILE',
  SOCIAL = 'SOCIAL',
  SYNC = 'SYNC',
}

export enum InteractionType {
  CALL = 'CALL',
  TEXT = 'TEXT',
  EMAIL = 'EMAIL',
  MEETING = 'MEETING',
  SOCIAL_ENGAGE = 'SOCIAL_ENGAGE',
  REFERRAL = 'REFERRAL',
  NOTE = 'NOTE',
}

// Mirrors prisma/schema.prisma's PipelineStage enum (master-spec §3.1) so values assigned here
// remain valid literals for the Prisma-generated field type without a direct @prisma/client import.
export enum PipelineStage {
  IDENTIFIED = 'IDENTIFIED',
  INTRODUCED = 'INTRODUCED',
  RESPONDED = 'RESPONDED',
  APPOINTMENT_PROPOSED = 'APPOINTMENT_PROPOSED',
  APPOINTMENT_CONFIRMED = 'APPOINTMENT_CONFIRMED',
  MET = 'MET',
  CLOSED_CLIENT = 'CLOSED_CLIENT',
  CLOSED_RECRUIT = 'CLOSED_RECRUIT',
  DORMANT = 'DORMANT',
  DO_NOT_CONTACT = 'DO_NOT_CONTACT',
}

export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  PipelineStage.IDENTIFIED,
  PipelineStage.INTRODUCED,
  PipelineStage.RESPONDED,
  PipelineStage.APPOINTMENT_PROPOSED,
  PipelineStage.APPOINTMENT_CONFIRMED,
  PipelineStage.MET,
  PipelineStage.CLOSED_CLIENT,
  PipelineStage.CLOSED_RECRUIT,
  PipelineStage.DORMANT,
  PipelineStage.DO_NOT_CONTACT,
];

export type RelationshipStrength = number;

export interface HiddenEarningsEstimate {
  contactId: string;
  estimatedAnnualEarnings: number;
  relationshipStrength: RelationshipStrength;
  industryMultiplier: number;
  safeHarborDisclaimer: string;
  isEstimate: true;
}

export interface ContactData {
  id: string;
  userId: string;
  name: string;
  phone: string | null;
  email: string | null;
  relationshipStrength: RelationshipStrength;
  source: ContactSource;
  industry: string | null;
  notes: string | null;
  linkedUserId: string | null;
  pipelineStage: PipelineStage;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactInteractionData {
  id: string;
  contactId: string;
  type: InteractionType;
  notes: string;
  createdAt: Date;
}

export interface ContactWithScore extends ContactData {
  earningsEstimate: HiddenEarningsEstimate;
  lastInteractionDate: Date | null;
  interactionCount: number;
}

export interface ImportContactInput {
  name: string;
  phone?: string;
  email?: string;
  industry?: string;
  notes?: string;
  linkedUserId?: string;
}

export interface CSVImportRow {
  name: string;
  phone?: string;
  email?: string;
  industry?: string;
  notes?: string;
}

export interface MoveContactPayload {
  contactId: string;
  toStage: PipelineStage;
}

export interface PipelineSummary {
  stage: PipelineStage;
  count: number;
  contacts: ContactData[];
}

export const INDUSTRY_MULTIPLIERS: Record<string, number> = {
  finance: 1.5,
  insurance: 1.4,
  real_estate: 1.3,
  healthcare: 1.2,
  education: 1.0,
  retail: 0.9,
  hospitality: 0.8,
  other: 1.0,
};

export const SAFE_HARBOR_EARNINGS_DISCLAIMER =
  'This estimate is for informational purposes only and does not constitute a guarantee of earnings. Individual results vary based on effort, market conditions, and other factors. This is not a promise of income.';
