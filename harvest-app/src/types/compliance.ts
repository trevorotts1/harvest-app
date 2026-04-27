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