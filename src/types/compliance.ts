// WP11 Compliance Types — Full Implementation

// T-14 hand-forward (Wave 0 gate): the stale local `Role` union below —
// `'REP' | 'UPLINE' | 'ADMIN' | 'DUAL' | 'RVP' | 'EXTERNAL'` — is retired. `EXTERNAL` was never a
// real role (§3.1: "the baseline `EXTERNAL` value is retired; external solo users are `rep` with an
// external org"); the canonical five-role enum is Prisma's `Role` (REP | UPLINE | RVP | ADMIN |
// DUAL), the same one `src/lib/auth/rbac.ts` (T-04) and `src/lib/auth/rbac-matrix.ts` (T-14) use.
// `UserContext.role`/`AuditPayload.role` below now reference that enum directly instead of a
// second, drifting definition.
import type { Role } from '@prisma/client';

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

export interface UserContext {
  user_id: string;
  role: Role;
  regulations?: Regulation[];
  licensed_states?: string[];
  // --- §5.3 / §5.5 context gates (optional so every existing caller keeps
  // compiling; the CFE reads them for licensing, signed release, opt-in, etc.).
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

/**
 * T-53 (master-spec §17.5 / uiux §6.2): the language `content` is WRITTEN in — "a Spanish
 * community introduction is CFE-gated exactly as an English one is". Only affects which SAFE_HARBOR
 * disclaimer text (below) is selected when a disclaimer must be injected; the classifier pass and
 * vocabulary lint are language-agnostic by construction (Haiku is multilingual; the vocabulary
 * classifier's default rule set already covers both languages, see vocabulary.ts's
 * `FORBIDDEN_TERMS_ALL`). Independent of the REP's own `Me -> Language` workspace preference
 * (src/lib/i18n) — a rep can work in English and introduce in Spanish (uiux §6.2).
 */
export type ContentLanguage = 'en' | 'es';

export interface CFEInput {
  content: string;
  channel: Channel;
  userContext: UserContext;
  /** Defaults to 'en' when omitted — every pre-T-53 caller keeps compiling and behaving exactly as
   *  before (English disclaimers, unchanged). */
  language?: ContentLanguage;
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
  /** Fail-closed hold flag (§5.2). true = not released, held for review. */
  held: boolean;
  /** §5.4 band mirrored onto the legacy result shape. */
  band: CFEBand;
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

/**
 * T-53 (master-spec §17.5 / uiux §6.2): the Spanish safe-harbor disclaimer set — same legal content
 * as `SAFE_HARBOR_DISCLAIMERS` above, translated by meaning (not literally), so a Spanish-language
 * income/testimonial/opportunity/insurance/referral disclosure is never silently injected in
 * English into otherwise-Spanish outbound content. Selected by `evaluateClassifierRules` (§5.3)
 * based on `CFEInput.language` (defaults to 'en', i.e. the table above, when unset).
 */
export const SAFE_HARBOR_DISCLAIMERS_ES = {
  income: 'Los resultados individuales varían. Los ejemplos de ingresos no son garantía de ganancias futuras. Tus resultados dependen de tu esfuerzo, tus habilidades y las condiciones del mercado.',
  testimonial: 'Las experiencias compartidas son resultados individuales y no son típicas. Los resultados varían según el esfuerzo individual, las condiciones del mercado y otros factores.',
  opportunity: 'Esto es una oportunidad de negocio, no una oferta de empleo. El éxito requiere esfuerzo, dedicación y desarrollo de habilidades. Los resultados individuales varían.',
  insurance: 'Las recomendaciones de seguros son de carácter general y no constituyen asesoría financiera personalizada. Consulta a un profesional con licencia para obtener orientación específica para tu situación.',
  referral: 'Los referidos son voluntarios y no deben incentivarse más allá de lo permitido por las regulaciones aplicables.',
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
 * T-R51 (OBSERVE variant) — Sapiens AI's `agnes-2.0-flash`, wired as the CFE's five §5.3
 * SEMANTIC classifier client, per an explicit, operator-confirmed decision after Agnes was
 * evaluated against the CFE's own ground-truth battery (100% on INCOME_CLAIM/TESTIMONIAL/
 * OPPORTUNITY/INSURANCE/REFERRAL — see `eval/agnes-compliance-harness`'s
 * `scripts/eval-agnes-compliance.mjs`, the harness this wiring's endpoint/model/call-shape
 * mirrors).
 *
 * SCOPE OF THE §0.3 "Claude-only" EXCEPTION (read before touching anything else): this is a
 * NARROW, explicitly-authorized carve-out for ONE path only — the CFE's five semantic
 * classifiers (`AgnesClassifierClient`, `src/services/compliance/agnes/`). It does NOT apply to:
 *   - the agent GENERATION/runtime path (`src/services/agent-runtime/**`, `AnthropicRuntimeClient`,
 *     `CLAUDE_MODEL_IDS` / `runtime-model-map.ts`) — every draft a rep or agent sends is still
 *     composed ONLY by Claude, unconditionally;
 *   - the §0.5 doctrine vocabulary lint (`vocabulary.ts`) — that stage is, and remains, a local
 *     deterministic regex classifier with no model call of any kind, Claude or otherwise;
 *   - the upline ADVISORY recommendation (`AdjudicationAdvisor`) — still Claude-only (Sonnet 5 /
 *     Opus 4.8), per its own module doc.
 * `HAIKU_MODEL_ID`/`HaikuClassifierClient` are UNCHANGED and remain fully available (injectable
 * via `CFEEngineDeps.classifierClient`) for any caller that wants to keep the Claude classifier
 * path instead of the new default.
 */
export const AGNES_MODEL_ID = 'agnes-2.0-flash';
export const AGNES_ENDPOINT = 'https://apihub.agnes-ai.com/v1/chat/completions';
/** Secret is referenced by NAME only, never by value (§0.4) — mirrors `ANTHROPIC_API_KEY_ENV_VAR`.
 *  NOTE: deliberately `AGNES_AI_API_KEY`, distinct from the eval harness's `AGNES_API_KEY` — the
 *  production build spec named this env var explicitly; the two are NOT interchangeable (see the
 *  T-R51 build report for this discrepancy). */
export const AGNES_API_KEY_ENV_VAR = 'AGNES_AI_API_KEY';

/**
 * §0.5 doctrine-vocabulary OBSERVE mode (T-R51). The vocabulary hard-block itself is UNCHANGED in
 * both values — a forbidden-term match ALWAYS forces `band: 'blocked'` (see `engine.ts`). The mode
 * only controls whether that catch is ALSO recorded (structured, durable) + surfaced in the
 * upline/compliance review view, so the operator can see which terms fire and how often:
 *   - 'block'   — legacy behavior: block only, no observability record attached to the audit event.
 *   - 'observe' — block AND attach a structured `vocabulary_violations` record to the audit event
 *                 (§5.6/§5.7), which the compliance-review surface aggregates by term. DEFAULT.
 * 'advisory' (non-blocking) is deliberately NOT a value here yet — reserved for a possible future
 * change; this build keeps the vocabulary layer blocking in both modes, per explicit operator
 * decision (see T-R51 build report).
 */
export type VocabularyMode = 'block' | 'observe';
export const CFE_VOCABULARY_MODE_ENV_VAR = 'CFE_VOCABULARY_MODE';

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
  /**
   * T-R51 OBSERVE mode: which §0.5 doctrine-vocabulary term(s) matched, if any. ADDITIVE ONLY —
   * present (non-empty) only when `CFE_VOCABULARY_MODE==='observe'` (the default) AND a vocabulary
   * violation actually fired; `undefined`/absent in 'block' mode or when there was no violation.
   * Never influences `band`/`held`/`released` — the block decision is computed before this field
   * is ever populated (see `engine.ts` `evaluateContent`).
   */
  vocabulary_violations?: { forbidden: string; match: string }[];
  /** The mode this decision was evaluated under, when a vocabulary violation fired. Absent when no
   *  violation occurred (mode is then irrelevant to this event). */
  vocabulary_mode?: VocabularyMode;
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
