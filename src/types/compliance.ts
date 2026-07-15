// WP11 Compliance Types — Full Implementation

export type Classifier =
  | 'INCOME_CLAIM'
  | 'TESTIMONIAL'
  | 'OPPORTUNITY'
  | 'INSURANCE'
  | 'REFERRAL';

export const ALL_CLASSIFIERS: Classifier[] = [
  'INCOME_CLAIM',
  'TESTIMONIAL',
  'OPPORTUNITY',
  'INSURANCE',
  'REFERRAL',
];

export type CFEDecision = 'PASS' | 'FLAG' | 'BLOCK';

export type Regulation =
  | 'FINRA'
  | 'STATE_INSURANCE'
  | 'TCPA'
  | 'CAN_SPAM'
  | 'GDPR'
  | 'CCPA';

export const REGULATION_MULTIPLIERS: Record<Regulation, number> = {
  FINRA: 1.4,
  STATE_INSURANCE: 1.5,
  TCPA: 1.3,
  CAN_SPAM: 1.1,
  GDPR: 1.0,
  CCPA: 1.0,
};

export const CLASSIFIER_WEIGHTS: Record<Classifier, number> = {
  INCOME_CLAIM: 0.30,
  TESTIMONIAL: 0.20,
  OPPORTUNITY: 0.15,
  INSURANCE: 0.25,
  REFERRAL: 0.10,
};

export type Channel = 'SMS' | 'EMAIL' | 'SOCIAL' | 'PHONE';

export type Role = 'REP' | 'UPLINE' | 'ADMIN' | 'DUAL' | 'RVP' | 'EXTERNAL';

export interface UserContext {
  user_id: string;
  role: Role;
  regulations?: Regulation[];
  licensed_states?: string[];
}

export interface CFEInput {
  content: string;
  channel: Channel;
  userContext: UserContext;
}

export interface ClassifierResult {
  classifier: Classifier;
  confidence: number;
  matched_patterns: string[];
  details: string;
}

export interface CFEResult {
  outcome: CFEDecision;
  risk_score: number;
  classifier_data: Record<Classifier, number>;
  classifier_results: ClassifierResult[];
  safe_harbor_injected: boolean;
  safe_harbor_disclaimers: string[];
  audit_payload: AuditPayload;
  blocked: boolean;
  http_status: number;
  action: string;
}

export interface AuditPayload {
  content_text: string;
  content_hash: string;
  risk_score: number;
  outcome: CFEDecision;
  classifier_scores: Record<Classifier, number>;
  classifier_results: ClassifierResult[];
  safe_harbor_injected: boolean;
  safe_harbor_disclaimers: string[];
  timestamp: string;
  user_id: string;
  role: Role;
  channel: Channel;
  rule_version: string;
  regulation: Regulation[];
  reviewer_id?: string;
  reviewer_action?: string;
}

// Risk scoring thresholds
export const RISK_THRESHOLDS = {
  AUTO_DEPLOY: { min: 0, max: 10, action: 'auto-deploy' as const },
  FLAG: { min: 11, max: 70, action: 'upline-review' as const },
  BLOCK: { min: 71, max: 100, action: 'block-403' as const },
} as const;

// CFE SLA constants
export const CFE_TIMEOUT_MS = 2000; // 2-second timeout SLA
export const CFE_RULE_VERSION = '1.0.0';

// Data rights SLA constants
export const DATA_EXPORT_SLA_MINUTES = 5;
export const DATA_DELETION_SLA_DAYS = 30;
export const DATA_RECTIFICATION_SLA_DAYS = 15;

// Encryption constants
export const AES_256_ALGORITHM = 'aes-256-gcm';
export const TLS_MIN_VERSION = 'TLSv1.3';
export const KEY_LENGTH_BYTES = 32; // 256 bits
export const IV_LENGTH_BYTES = 16;
export const AUTH_TAG_LENGTH_BYTES = 16;

// Consent types
export type ConsentType =
  | 'profile'
  | 'contacts'
  | 'calendar'
  | 'agent_logs'
  | 'sms_outreach'
  | 'email_outreach'
  | 'analytics';

export const ALL_CONSENT_TYPES: ConsentType[] = [
  'profile',
  'contacts',
  'calendar',
  'agent_logs',
  'sms_outreach',
  'email_outreach',
  'analytics',
];

// TCPA-specific consent
export const TCPA_CONSENT_TYPE: ConsentType = 'sms_outreach';

// Safe-harbor language templates
export const SAFE_HARBOR_DISCLAIMERS = {
  income: 'Individual results vary. Income examples are not guarantees of future earnings. Your results depend on your effort, skills, and market conditions.',
  testimonial: 'The experiences shared are individual results and are not typical. Results vary based on individual effort, market conditions, and other factors.',
  opportunity: 'This is a business opportunity, not an employment offer. Success requires effort, dedication, and skill development. Individual results vary.',
  insurance: 'Insurance recommendations are general in nature and do not constitute personalized financial advice. Consult a licensed professional for guidance specific to your situation.',
  referral: 'Referrals are voluntary and should not be incentivized beyond what is permitted by applicable regulations.',
} as const;

// Pre-generation compliance constraints for agent prompt templates
export const PRE_GENERATION_CONSTRAINTS = {
  WP04_AGENTS: [
    'Never generate income guarantees or projected earnings',
    'Never use terms: prospect, lead, pitch, sales call, guaranteed income',
    'All outreach must be relationship-first and service-first',
    'Respect 2 Hour CEO cognitive load limits',
    'Safe-harbor language must be injected when referencing earnings or opportunity',
  ],
  WP05_MESSAGING: [
    'All outbound messages must pass through CFE before delivery',
    'No message may be sent without CFE passage',
    'TCPA consent required before any SMS outreach',
    'CAN-SPAM unsubscribe link required in every email',
    'No forbidden terms: prospect, lead, pitch, sales call, guaranteed income',
    'Hidden Earnings safe-harbor framing required for any earnings reference',
    '48-hour escalation rule: flagged content unreviewed for 48 hours escalates to compliance officer',
  ],
  WP06_SOCIAL: [
    'All social content must pass CFE before publication',
    'Mandatory WP11 disclosures embedded in all publishable content',
    'No forbidden sales terminology in any published asset',
    'Movement-led tone, not growth-hacking or spam patterns',
    'Content scheduling respects timezone and consent constraints',
  ],
  WP07_MOTIVATION: [
    'No earnings-phrased motivation without complete safe-harbor language',
    'No exploitative or shame-based gamification',
    'Belief-first intervention before work nudges',
    'Motivational notifications respect privacy, consent, and timezone per WP11',
    'Collective uplift framing over individual hustle metrics',
  ],
} as const;

// ============================================================================
// T-08 — Compliance Filter Engine (CFE) core (master-spec §5)
// ============================================================================

/**
 * Runtime model id for the five §5.3 classifiers. Per §4.4 the CFE classifier
 * pass runs on Haiku 4.5. Claude-only (§0.3): this id is the ONLY model the
 * classifier path targets; degradation stays in-roster; a missing key fails
 * CLOSED (never falls back to a non-Claude provider).
 */
export const HAIKU_MODEL_ID = 'claude-haiku-4-5-20251001';

/** Anthropic Messages API contract (used by the real Haiku call path). */
export const ANTHROPIC_MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_VERSION = '2023-06-01';
/** Secret is referenced by NAME only, never by value (§0.4). */
export const ANTHROPIC_API_KEY_ENV_VAR = 'ANTHROPIC_API_KEY';

/** Rule/config version stamped into every audit entry (§5.6, AC §5.8-8). */
export const CFE_RULE_CONFIG_VERSION = '1.0.0';

/**
 * §5.4 banding expressed as the gate's outward vocabulary.
 *   clear   = 0–10  (Pass)  — the ONLY band that may release.
 *   review  = 11–70 (Flag)  — Sonnet 5 adjudication / Approval Inbox.
 *   blocked = 71–100 (Block)— physically prevented (API 403 to the agent).
 */
export type CFEBand = 'clear' | 'review' | 'blocked';

/** Why an item was held CLOSED (§5.2). null when the item was not held. */
export type HeldReason =
  | 'classifier_error'
  | 'classifier_timeout'
  | 'missing_credentials'
  | 'engine_timeout'
  | 'engine_exception'
  | 'cfe_unavailable'
  | 'forbidden_vocabulary';

/** Verdict a single §5.3 classifier's model client returns (Haiku boolean + confidence). */
export interface ClassifierVerdict {
  /** boolean signal (§5.3). */
  flagged: boolean;
  /** 0.0–1.0 confidence that the violation is present. */
  confidence: number;
  rationale?: string;
  matched_patterns?: string[];
}

/**
 * Immutable audit event the CFE emits for the audit trail (T-10) to persist.
 * Mirrors the §5.6 evidence record. The CFE only EMITS; T-10 owns durable,
 * signed, append-only persistence.
 */
export interface CFEAuditEvent {
  content_id: string | null;
  content_text: string;
  content_hash: string;
  channel: Channel;
  user_id: string;
  role: Role;
  band: CFEBand;
  outcome: CFEDecision;
  risk_score: number;
  held: boolean;
  held_reason: HeldReason | null;
  classifier_results: ClassifierResult[];
  classifiers_triggered: Classifier[];
  safe_harbor_injected: boolean;
  safe_harbor_disclaimers: string[];
  regulation: Regulation[];
  rule_version: string;
  reviewer_id?: string;
  reviewer_action?: string;
  timestamp: string;
}

/**
 * The verdict returned by ComplianceFilterEngine.evaluateContent() — the gate
 * every content-producing WP (04/05/06/07) calls before any send/publish/queue.
 *
 * `released` is the single, unmistakable release signal: it is true ONLY when
 * `band === 'clear' && !held`. There is NO code path that sets `released` (or a
 * clear band) as a result of a classifier failure, timeout, or missing key —
 * those all resolve to `held: true` (fail-closed, §5.2).
 */
export interface CFEVerdict {
  band: CFEBand;
  score: number;
  classifierResults: ClassifierResult[];
  held: boolean;
  released: boolean;
  reason: string;
  heldReason: HeldReason | null;
  safeHarbor: { injected: boolean; disclaimers: string[] };
  httpStatus: number;
  ruleVersion: string;
  auditEvent: CFEAuditEvent;
}

/**
 * Declaration-merged extensions to the existing shapes. Fields are optional so
 * every existing caller keeps compiling; the CFE reads them for the §5.3 /
 * §5.5 context gates (licensing, signed release, TCPA opt-in, etc.).
 */
export interface UserContext {
  /** Active insurance license (IBA/POL) for the recipient's state (§5.3-4, §5.5). */
  insurance_licensed?: boolean;
  recipient_state?: string;
  /** Roadmap days 8–30: insurance-recommendation content is hard-blocked (§5.5). */
  licensing_phase?: boolean;
  /** A signed testimonial release is on file (§5.3-2). */
  signed_testimonial_release?: boolean;
  /** Explicit TCPA referral opt-in on file (§5.3-5). */
  referral_opt_in?: boolean;
  /** Recipient/rep is in a state that regulates the business opportunity (§5.3-3). */
  regulated_state?: boolean;
  /** Correlates the decision to a content record for the audit trail. */
  content_id?: string;
}

export interface CFEResult {
  /** Fail-closed hold flag (§5.2). true = not released, held for review. */
  held: boolean;
  /** §5.4 band mirrored onto the legacy result shape. */
  band: CFEBand;
}