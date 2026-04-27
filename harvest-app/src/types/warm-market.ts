// WP02 Warm Market — Complete Types & Contracts

// ─── Relationship Taxonomy ───────────────────────────────────────────

export enum RelationshipType {
  FAMILY = 'family',
  FRIEND = 'friend',
  WORK = 'work',
  CHURCH = 'church',
  NEIGHBOR = 'neighbor',
  COACH = 'coach',
  FORMER_COLLEAGUE = 'former_colleague',
  OTHER = 'other',
}

export const ALL_RELATIONSHIP_TYPES: RelationshipType[] = Object.values(RelationshipType);

/** Weight multipliers for segment scoring by relationship type */
export const RELATIONSHIP_WEIGHTS: Record<RelationshipType, number> = {
  [RelationshipType.FAMILY]: 1.0,
  [RelationshipType.FRIEND]: 0.85,
  [RelationshipType.WORK]: 0.7,
  [RelationshipType.CHURCH]: 0.75,
  [RelationshipType.NEIGHBOR]: 0.55,
  [RelationshipType.COACH]: 0.65,
  [RelationshipType.FORMER_COLLEAGUE]: 0.5,
  [RelationshipType.OTHER]: 0.3,
};

/** Auto-segmentation: infer relationship type from contact data cues */
export function inferRelationshipType(cues: {
  isFamily?: boolean;
  isCoworker?: boolean;
  isChurchAffiliated?: boolean;
  isNeighbor?: boolean;
  isCoachOrMentor?: boolean;
  isFormerCoworker?: boolean;
}): RelationshipType {
  if (cues.isFamily) return RelationshipType.FAMILY;
  if (cues.isCoworker) return RelationshipType.WORK;
  if (cues.isChurchAffiliated) return RelationshipType.CHURCH;
  if (cues.isCoachOrMentor) return RelationshipType.COACH;
  if (cues.isNeighbor) return RelationshipType.NEIGHBOR;
  if (cues.isFormerCoworker) return RelationshipType.FORMER_COLLEAGUE;
  return RelationshipType.OTHER;
}

// ─── Pipeline Stages & Transitions ───────────────────────────────────

export enum PipelineStage {
  NEW = 'new',
  ENGAGED = 'engaged',
  PIPELINE = 'pipeline',
  ACTIVATED = 'activated',
  ARCHIVED = 'archived',
}

export const PIPELINE_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  [PipelineStage.NEW]: [PipelineStage.ENGAGED, PipelineStage.ARCHIVED],
  [PipelineStage.ENGAGED]: [PipelineStage.PIPELINE, PipelineStage.ARCHIVED],
  [PipelineStage.PIPELINE]: [PipelineStage.ACTIVATED, PipelineStage.ARCHIVED],
  [PipelineStage.ACTIVATED]: [PipelineStage.ARCHIVED],
  [PipelineStage.ARCHIVED]: [PipelineStage.NEW],
};

export function isValidTransition(from: PipelineStage, to: PipelineStage): boolean {
  return PIPELINE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Data Classification ────────────────────────────────────────────

export enum ContactDataClassification {
  PUBLIC = 'PUBLIC',
  INTERNAL = 'INTERNAL',
  CONFIDENTIAL = 'CONFIDENTIAL',
  RESTRICTED = 'RESTRICTED',
}

/** Field-level data classification for PII */
export const FIELD_DATA_CLASSIFICATION: Record<string, ContactDataClassification> = {
  firstName: ContactDataClassification.RESTRICTED,
  lastName: ContactDataClassification.RESTRICTED,
  phone: ContactDataClassification.RESTRICTED,
  email: ContactDataClassification.RESTRICTED,
  notes: ContactDataClassification.CONFIDENTIAL,
  relationshipType: ContactDataClassification.INTERNAL,
  segmentScore: ContactDataClassification.INTERNAL,
  pipelineStage: ContactDataClassification.INTERNAL,
  trustScore: ContactDataClassification.INTERNAL,
  lifeEvents: ContactDataClassification.CONFIDENTIAL,
  lastContactDate: ContactDataClassification.INTERNAL,
};

// ─── Contact Record ──────────────────────────────────────────────────

export interface ContactRecord {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  relationshipType: RelationshipType;
  pipelineStage: PipelineStage;
  segmentScore: number;
  segmentScoreFactors?: SegmentScoreFactors | null;
  isRecruitTarget: boolean;
  isClient: boolean;
  isAList: boolean;
  lastContactDate?: Date | null;
  notes?: string | null;
  source: string;
  importBatchId?: string | null;
  dataClassification: ContactDataClassification;
  consentGivenAt?: Date | null;
  encryptedPiiPayload?: string | null;
  encryptedPiiIv?: string | null;
  encryptedPiiAuthTag?: string | null;
  lifeEvents?: LifeEvent[] | null;
  trustScore?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Segment Scoring (Multi-factor 0-100) ─────────────────────────────

export interface SegmentScoreFactors {
  relationshipWeight: number;   // 0-100, weighted by RELATIONSHIP_WEIGHTS
  recency: number;             // 0-100, based on lastContactDate
  lifeEvents: number;          // 0-100, bonus for recent life events
  engagementHistory: number;   // 0-100, based on interaction count + recency
  trust: number;               // 0-100, trust score
}

export const SEGMENT_SCORE_WEIGHTS = {
  relationshipWeight: 0.25,
  recency: 0.20,
  lifeEvents: 0.15,
  engagementHistory: 0.25,
  trust: 0.15,
} as const;

export function calculateSegmentScore(factors: SegmentScoreFactors): number {
  const raw =
    factors.relationshipWeight * SEGMENT_SCORE_WEIGHTS.relationshipWeight +
    factors.recency * SEGMENT_SCORE_WEIGHTS.recency +
    factors.lifeEvents * SEGMENT_SCORE_WEIGHTS.lifeEvents +
    factors.engagementHistory * SEGMENT_SCORE_WEIGHTS.engagementHistory +
    factors.trust * SEGMENT_SCORE_WEIGHTS.trust;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

// ─── Life Events ──────────────────────────────────────────────────────

export interface LifeEvent {
  type: string;
  date: string; // ISO 8601
  description?: string;
}

// ─── Hidden Earnings ──────────────────────────────────────────────────

export interface HiddenEarningsEstimate {
  totalContacts: number;
  segmentBreakdown: Record<RelationshipType, number>;
  estimatedAppointments: number;
  estimatedClients: number;
  avgMonthlyValue: number;
  estimatedMonthlyValue: number;
  disclaimerText: string;
  lastCalculated: Date;
}

export const HIDDEN_EARNINGS_DISCLAIMER =
  'Based on industry averages. Individual results vary. This is potential, not a guarantee. Success depends on your effort, skills, and market conditions.';

export function calculateHiddenEarnings(
  contactCount: number,
  avgMonthlyValue = 350
): HiddenEarningsEstimate {
  const appointments = Math.floor(contactCount * 0.25);
  const clients = Math.floor(appointments * 0.20);
  const value = clients * avgMonthlyValue;

  return {
    totalContacts: contactCount,
    segmentBreakdown: {} as Record<RelationshipType, number>,
    estimatedAppointments: appointments,
    estimatedClients: clients,
    avgMonthlyValue,
    estimatedMonthlyValue: value,
    disclaimerText: HIDDEN_EARNINGS_DISCLAIMER,
    lastCalculated: new Date(),
  };
}

// ─── Memory Jogger ────────────────────────────────────────────────────

export interface MemoryJoggerCategory {
  key: string;
  label: string;
  prompt: string;
}

export const MEMORY_JOGGER_CATEGORIES: MemoryJoggerCategory[] = [
  { key: 'church', label: 'Church', prompt: 'Who do you know from your place of worship?' },
  { key: 'gym', label: 'Gym / Fitness', prompt: 'Who do you see regularly at the gym or fitness classes?' },
  { key: 'school', label: 'School', prompt: 'Who from school or alumni groups comes to mind?' },
  { key: 'work', label: 'Work', prompt: 'Who are your current or former coworkers?' },
  { key: 'hobbies', label: 'Hobbies', prompt: 'Who do you know through hobbies or clubs?' },
  { key: 'family_friends', label: 'Family Friends', prompt: 'Who are friends of your family members?' },
  { key: 'former_colleagues', label: 'Former Colleagues', prompt: 'Who have you worked with in the past?' },
];

export const LOW_CONTACT_TRIGGER_THRESHOLD = 5; // contacts in category to trigger jogger

export function getMemoryJoggerPrompt(categoryKey: string): MemoryJoggerCategory | undefined {
  return MEMORY_JOGGER_CATEGORIES.find((c) => c.key === categoryKey);
}

export function shouldTriggerMemoryJogger(contactCountInCategory: number): boolean {
  return contactCountInCategory < LOW_CONTACT_TRIGGER_THRESHOLD;
}

// ─── Native Mobile Ingestion Contracts ────────────────────────────────

export interface IOSContactPayload {
  /** Mirrors CNContactStore fields — normalized for server ingestion */
  givenName: string;
  familyName: string;
  phoneNumbers: { label: string; value: string }[];
  emailAddresses: { label: string; value: string }[];
  organizationName?: string;
  department?: string;
  note?: string;
}

export interface IOSContactPermission {
  granted: boolean;
  status: 'notDetermined' | 'restricted' | 'denied' | 'authorized';
}

export const IOS_CONTACTS_NORMALIZATION = {
  phoneStripNonDigits: true,
  emailLowercase: true,
  nameTrimWhitespace: true,
  emptyNameFallback: 'Unknown',
} as const;

export interface AndroidContactPayload {
  /** Mirrors ContactsContract fields — normalized for server ingestion */
  displayName: string;
  givenName?: string;
  familyName?: string;
  phoneNumbers: { type: string; number: string }[];
  emailAddresses: { type: string; address: string }[];
  company?: string;
  note?: string;
}

export interface AndroidContactPermission {
  granted: boolean;
  permission: 'READ_CONTACTS';
  rationaleShown?: boolean;
}

export const ANDROID_CONTACTS_NORMALIZATION = {
  phoneStripNonDigits: true,
  emailLowercase: true,
  nameSplitDisplay: true,
  emptyNameFallback: 'Unknown',
} as const;

// ─── CSV / Manual Ingestion Contracts ────────────────────────────────

export interface CSVFieldMapping {
  csvColumn: string;
  contactField: string; // key of ContactRecord
  transform?: 'lowercase' | 'uppercase' | 'trim' | 'phone_format' | 'none';
}

export const CSV_IMPORT_LIMITS = {
  MAX_ROWS: 5000,
  MAX_FILE_SIZE_MB: 10,
  REQUIRED_COLUMNS: ['firstName', 'lastName'],
  OPTIONAL_COLUMNS: ['phone', 'email', 'relationship_type', 'notes'],
} as const;

export const MANUAL_ENTRY_LIMITS = {
  MAX_DAILY_ADDS: 200,
} as const;

export type ConflictResolution = 'skip' | 'overwrite' | 'merge' | 'error';

export interface CSVIngestionConfig {
  fieldMapping: CSVFieldMapping[];
  conflictResolution: ConflictResolution;
  defaultRelationshipType?: RelationshipType;
  source: string;
}

export interface IngestionResult {
  imported: number;
  skipped: number;
  errors: number;
  errorDetails?: Array<{ row: number; message: string }>;
  importBatchId: string;
}

// ─── WP11 Privacy Hooks ──────────────────────────────────────────────

export interface ConsentGate {
  consentType: string;
  required: boolean;
  granted: boolean;
  grantedAt?: Date | null;
}

export interface PrivacyHooks {
  /** Encrypt PII fields before storage */
  encryptPII: (data: Record<string, unknown>, keyBase64: string) => {
    encryptedPayload: string;
    iv: string;
    authTag: string;
  };
  /** Consent gate: check before any data operation */
  checkConsent: (userId: string, consentType: string) => Promise<ConsentGate>;
  /** Classify a field's data sensitivity */
  classifyField: (fieldName: string) => ContactDataClassification;
  /** Export all data for a user (WP11 data rights) */
  exportUserData: (userId: string) => Promise<Record<string, unknown>>;
  /** Delete all data for a user (WP11 data rights) */
  deleteUserData: (userId: string) => Promise<{ success: boolean; anonymizedFields: string[] }>;
}

// ─── WP04 Agent Feed Contract ─────────────────────────────────────────

export interface WP04AgentFeed {
  /** Fields the AI agent reads to decide outreach timing & approach */
  contactId: string;
  userId: string;
  firstName: string;
  lastName: string;
  relationshipType: RelationshipType;
  pipelineStage: PipelineStage;
  segmentScore: number;
  lastContactDate: string | null;   // ISO 8601
  trustScore: number | null;
  lifeEvents: LifeEvent[] | null;
  isRecruitTarget: boolean;
  isClient: boolean;
  daysSinceLastContact: number | null;
  consentSms: boolean;
  consentEmail: boolean;
}

// ─── WP05 Message Personalization Contract ────────────────────────────

export interface WP05MessagePersonalization {
  /** Fields available for message personalization — no forbidden sales terms */
  contactId: string;
  firstName: string;
  lastName: string;
  relationshipType: RelationshipType;
  pipelineStage: PipelineStage;
  lastContactDate: string | null;   // ISO 8601
  lifeEvents: LifeEvent[] | null;
  notes: string | null;
  recentInteractionSummary: string | null;
}

// ─── Forbidden Sales Terms ────────────────────────────────────────────

export const FORBIDDEN_SALES_TERMS = [
  'prospect',
  'lead',
  'pitch',
  'sales call',
  'guaranteed income',
  'cold call',
  'closing deal',
  'hard sell',
] as const;

export function containsForbiddenTerms(text: string): { found: boolean; terms: string[] } {
  const lower = text.toLowerCase();
  const found = FORBIDDEN_SALES_TERMS.filter((term) => lower.includes(term));
  return { found: found.length > 0, terms: found };
}