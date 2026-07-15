// WP11 §16.5 — State insurance licensing state machine (T-13).
//
// This is the source of truth for whether a rep may perform a licensed-only (state insurance /
// financial-recommendation) activity. WP01 onboarding and WP03 method-exclusions consume the
// capability query exported from ../services/compliance/licensing (canPerformLicensedActivity /
// isLicensed); the CFE's Insurance-Recommendation classifier (§5.3 item 4) consumes the licensed-
// jurisdiction list via UserContext.licensed_states (src/types/compliance.ts) — see
// LicensingService.getLicensedJurisdictions.
//
// Spec text (verbatim, §16.5): "Unlicensed → Pre-Licensing → Licensed → License Expired. Gates:
// Unlicensed = no insurance recommendations (CFE hard-block); Pre-Licensing = education content
// only + exam nudges; Licensed = full insurance features (must maintain active IBA/POL per
// state); Expired = downgraded to Pre-Licensing restrictions + renewal prompts. Rules
// parameterized per state; the strictest state governs a multi-state rep; updates via config, not
// code."

/** The four licensing states named verbatim in §16.5, in spec order. */
export const LICENSING_STATES = [
  'UNLICENSED',
  'PRE_LICENSING',
  'LICENSED',
  'LICENSE_EXPIRED',
] as const;

export type LicensingState = (typeof LICENSING_STATES)[number];

/**
 * Legal transition actions (§16.5's arrow chain, plus the renewal loop back onto LICENSED that
 * "renewal prompts" implies for an Expired rep). Every action maps to exactly one legal
 * (from, to) pair — see LICENSING_TRANSITIONS in licensing-state-machine.ts. Any other
 * (state, action) combination is illegal and is rejected by applyTransition().
 */
export const LICENSING_ACTIONS = [
  'START_PRE_LICENSING', // UNLICENSED     -> PRE_LICENSING     (IBA filed / PFSU enrollment begins, §13.3)
  'OBTAIN_LICENSE', // PRE_LICENSING  -> LICENSED          (state exam passed, license issued)
  'EXPIRE_LICENSE', // LICENSED       -> LICENSE_EXPIRED   (active IBA/POL not maintained, §16.5)
  'RENEW_LICENSE', // LICENSE_EXPIRED -> LICENSED          (renewal completed)
] as const;

export type LicensingAction = (typeof LICENSING_ACTIONS)[number];

/**
 * The three content-gating tiers named in §16.5's Gates clause, mapped 1:1 from LicensingState.
 * LICENSE_EXPIRED intentionally shares EDUCATION_ONLY with PRE_LICENSING ("downgraded to
 * Pre-Licensing restrictions") — same capability tier, distinct state (renewal vs. never-started).
 */
export type ContentGateLevel =
  | 'BLOCKED_NO_INSURANCE_CONTENT'
  | 'EDUCATION_ONLY'
  | 'FULL_INSURANCE_FEATURES';

/** Result of a legal transition. */
export interface TransitionSuccess {
  ok: true;
  from: LicensingState;
  to: LicensingState;
  action: LicensingAction;
}

/** Result of an illegal transition attempt — always rejected, never applied. */
export interface TransitionFailure {
  ok: false;
  from: LicensingState;
  action: LicensingAction;
  error: string;
}

export type TransitionResult = TransitionSuccess | TransitionFailure;

/**
 * A durable per-(user, jurisdiction) licensing record. Jurisdiction is a two-letter US state
 * postal code (§16.5 "rules parameterized per state"); a rep with no record for a state is
 * UNLICENSED there by fail-closed default (no row = no license, never inferred otherwise).
 */
export interface LicensingRecordData {
  id: string;
  user_id: string;
  jurisdiction: string;
  state: LicensingState;
  license_number: string | null;
  issued_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Who/why is performing a transition — recorded on every emitted audit event (§16.5, T-10 hook). */
export interface LicensingActorContext {
  actor_id: string;
  actor_role?: string;
  reason?: string;
}

/**
 * Emitted on every successful state change. The full immutable/signed audit store is T-10's
 * build; this module only emits — LicensingEventSink implementations (in-memory here for tests;
 * a T-10-owned sink in production) are responsible for durable/signed persistence.
 */
export interface LicensingAuditEvent {
  id: string;
  user_id: string;
  jurisdiction: string;
  from_state: LicensingState;
  to_state: LicensingState;
  action: LicensingAction;
  actor_id: string;
  actor_role?: string;
  reason?: string;
  occurred_at: string;
}

/** Outcome of LicensingService.applyTransition — a discriminated union mirroring TransitionResult. */
export type LicensingTransitionOutcome =
  | { ok: true; state: LicensingState; record: LicensingRecordData }
  | { ok: false; state: LicensingState; error: string };

/**
 * Per-state parameterization (§16.5 "updates via config, not code"). Renewal-window/CE
 * requirements vary by jurisdiction; ops/compliance edits this table (or its future config-file/
 * DB backing) without a code deploy. The state machine's states/transitions themselves are NOT
 * parameterized — those are the universal §16.5 chain — only the operational parameters below are.
 */
export interface StateLicensingConfig {
  jurisdiction: string;
  /** Days before expires_at that a renewal prompt should fire (§16.5 "renewal prompts"). */
  renewal_window_days: number;
  requires_continuing_education: boolean;
}
