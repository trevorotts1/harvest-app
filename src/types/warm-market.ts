// WP02: Warm Market & Contact Engine — Types

// T-22 (§7.1 "Ingestion (four modalities)"): the master spec names exactly four ingestion paths —
// CSV upload, iOS native (CNContactStore), Android native (Contacts Provider), and Google Contacts
// (OAuth, People API). `IOS_NATIVE`/`ANDROID_NATIVE`/`GOOGLE_OAUTH` are additive members (CSV already
// existed); `MANUAL`/`MOBILE`/`SOCIAL`/`SYNC` are retained as pre-existing values other build units
// (demo seed data, T-23/T-24) already reference — nothing here is removed or renumbered. `Contact
// .source` is a plain `String` column (see prisma/schema.prisma design notes), so adding members is
// a TS-only change with no migration.
export enum ContactSource {
  CSV = 'CSV',
  MANUAL = 'MANUAL',
  MOBILE = 'MOBILE',
  SOCIAL = 'SOCIAL',
  SYNC = 'SYNC',
  IOS_NATIVE = 'IOS_NATIVE',
  ANDROID_NATIVE = 'ANDROID_NATIVE',
  GOOGLE_OAUTH = 'GOOGLE_OAUTH',
}

/**
 * §7.1 "Web gets CSV + Google Contacts (native import is native-only)": the two modalities that may
 * ONLY be invoked from the native app shell (Capacitor-class wrapper), never from the web PWA. The
 * Vault's ingestion route (`VaultService.assertModalityAllowed`) refuses these sources unless the
 * caller-declared `clientPlatform` matches.
 */
export const NATIVE_SHELL_ONLY_SOURCES: readonly ContactSource[] = [
  ContactSource.IOS_NATIVE,
  ContactSource.ANDROID_NATIVE,
];

/** The client runtime declaring itself on an import request (§7.1, §17.3 mobile/web parity). */
export type ClientPlatform = 'web' | 'ios' | 'android';

/**
 * A single not-yet-persisted contact row as fetched by any of the four ingestion modalities, prior
 * to normalization/encryption. `birthdate`/`isMinor` feed the §18.5/§7.6 "minors unreachable" gate —
 * `isMinor` covers an explicitly flagged/detectable minor (e.g. a mapped CSV column), `birthdate`
 * (ISO 8601 date) covers an age-derived minor from a native/Google contact's birthday field.
 */
export interface RawContactImportRow {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  industry?: string | null;
  birthdate?: string | null;
  isMinor?: boolean;
  /** T-29R2 (WP03 gate remediation follow-up, §8.2 "Excluded: state-unlicensed" eligibility): the
   *  contact's own jurisdiction (a US state, raw/un-normalized as fuzzy-mapped from a CSV "state"/
   *  "jurisdiction" column by csv-parser.ts) — `VaultService.upsertRow` normalizes this to the
   *  two-letter postal code (`eligibility.ts`'s `normalizeJurisdiction`) before persisting to
   *  `Contact.jurisdiction`. Omitted/null is tolerated on every ingestion path — an import never
   *  fails for lacking this column, it simply leaves the contact's jurisdiction unknown. */
  jurisdiction?: string | null;
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

// T-23 (§7.2 "relationship-type inference (family, friend, work, church, neighbor, coach,
// former_colleague, other) via Haiku 4.5"). Mirrors `Contact.relationship_type` (a plain `String?`
// column, same convention as `ContactSource`/`PipelineStage` above — additive, no migration).
export enum RelationshipType {
  FAMILY = 'FAMILY',
  FRIEND = 'FRIEND',
  WORK = 'WORK',
  CHURCH = 'CHURCH',
  NEIGHBOR = 'NEIGHBOR',
  COACH = 'COACH',
  FORMER_COLLEAGUE = 'FORMER_COLLEAGUE',
  OTHER = 'OTHER',
}

// T-23 (§7.5 "Contact pipeline to agents"): the typed contract `GET /api/v1/contacts/agent-queue`
// returns to WP04's agent layer. PII fields are DECRYPTED (§7.2/§16.4 — the agent layer must act on
// a real name/phone/email, not the AES-256-GCM ciphertext Contact's own columns hold at rest).
export interface AgentQueueContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  relationshipType: RelationshipType | null;
  segmentScore: number;
  isAList: boolean;
  isRecruitTarget: boolean;
  isClient: boolean;
  pipelineStage: PipelineStage;
  lastContactDate: Date | null;
  doNotContact: boolean;
}

export type AgentQueueStatus = 'ready';

export interface AgentQueueResult {
  status: AgentQueueStatus;
  limit: number;
  count: number;
  contacts: AgentQueueContact[];
}

// T-23 (§7.5 "after outreach it updates last_contact_date and pipeline_stage").
export interface RecordOutreachInput {
  contactId: string;
  toStage: PipelineStage;
  contactedAt?: Date;
}

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
