// T-11 — Data Rights types (master-spec §16.3).
//
// Covers: retention schedules + past-retention detection, the GDPR/CCPA-deletion-vs-FINRA-
// retention legal-hold carve-out, legal hold, and data minimization. Kept separate from
// src/types/compliance.ts (owned by the CFE build, T-08) so the two build units don't collide on
// the same file; this module only adds new, localized types.

import {
  DATA_EXPORT_SLA_MINUTES,
  DATA_DELETION_SLA_DAYS,
  DATA_RECTIFICATION_SLA_DAYS,
} from './compliance';

export { DATA_EXPORT_SLA_MINUTES, DATA_DELETION_SLA_DAYS, DATA_RECTIFICATION_SLA_DAYS };

// ─────────────────────────────────────────────────────────────────────────
// Retention schedules (§16.3 "Retention:")
// ─────────────────────────────────────────────────────────────────────────

/**
 * The four retention categories named explicitly in master-spec §16.3:
 *   - "active user data for subscription duration + 90 days"
 *   - "deleted-user data purged within 30 days"
 *   - "agent logs 12 months then anonymized"
 *   - "compliance/communications audit logs retained per FINRA (7 years) in the segregated archive"
 */
export type DataCategory =
  | 'ACTIVE_USER_DATA'
  | 'DELETED_USER_DATA'
  | 'AGENT_LOGS'
  | 'FINRA_COMMUNICATIONS_ARCHIVE';

export type RetentionAction = 'purge' | 'anonymize' | 'retain_in_segregated_archive';

/**
 * What a record's reference date means for a given category — i.e. what the retention clock
 * starts counting from. Callers supply the actual Date for their record; this module never reads
 * application data directly, since Subscription/AgentRun/AuditEntry are models owned elsewhere.
 */
export type RetentionBasis =
  | 'from_subscription_period_end' // ACTIVE_USER_DATA
  | 'from_deletion_completed' // DELETED_USER_DATA
  | 'from_record_created' // AGENT_LOGS, FINRA_COMMUNICATIONS_ARCHIVE
  ;

export interface RetentionRule {
  category: DataCategory;
  description: string;
  /** Retention window length in days from `basis`. Null = governed by an external event, not a fixed window (not used currently; every category below has a fixed window). */
  retentionPeriodDays: number;
  basis: RetentionBasis;
  action: RetentionAction;
  /** True for the FINRA legal-hold carve-out set — never eligible for GDPR/CCPA deletion-driven purge regardless of this schedule (§16.3, §3.4). */
  isCarveOut: boolean;
}

const DAYS_90 = 90;
const DAYS_30 = 30;
const DAYS_365 = 365;
const DAYS_7_YEARS = 365 * 7;

export const RETENTION_SCHEDULE: Record<DataCategory, RetentionRule> = {
  ACTIVE_USER_DATA: {
    category: 'ACTIVE_USER_DATA',
    description: 'Active user data retained for subscription duration + 90 days after period end.',
    retentionPeriodDays: DAYS_90,
    basis: 'from_subscription_period_end',
    action: 'purge',
    isCarveOut: false,
  },
  DELETED_USER_DATA: {
    category: 'DELETED_USER_DATA',
    description: 'Deleted-user data (post GDPR/CCPA deletion request) purged within 30 days.',
    retentionPeriodDays: DAYS_30,
    basis: 'from_deletion_completed',
    action: 'purge',
    isCarveOut: false,
  },
  AGENT_LOGS: {
    category: 'AGENT_LOGS',
    description: 'Agent activity logs retained 12 months, then anonymized (not deleted).',
    retentionPeriodDays: DAYS_365,
    basis: 'from_record_created',
    action: 'anonymize',
    isCarveOut: false,
  },
  FINRA_COMMUNICATIONS_ARCHIVE: {
    category: 'FINRA_COMMUNICATIONS_ARCHIVE',
    description:
      'Compliance/communications audit logs (FINRA 2210/3110) retained 7 years in the segregated, ' +
      'access-restricted archive. This is the legal-hold carve-out set: a user deletion request ' +
      'never purges these records regardless of this schedule — only this schedule\'s own 7-year ' +
      'clock (a separate, periodic archive-purge job) may eventually retire them.',
    retentionPeriodDays: DAYS_7_YEARS,
    basis: 'from_record_created',
    action: 'retain_in_segregated_archive',
    isCarveOut: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Legal hold (§16.3 "GDPR/CCPA deletion vs. FINRA retention"; §3.4 "Deletion cascade with legal hold")
// ─────────────────────────────────────────────────────────────────────────

export type LegalHoldStatus = 'ACTIVE' | 'LIFTED';

export interface LegalHoldRecord {
  id: string;
  user_id: string;
  status: LegalHoldStatus;
  reason: string;
  placed_by: string;
  placed_at: string; // ISO 8601
  lifted_by?: string | null;
  lifted_at?: string | null;
  note?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Deletion status (extends UserDataDeletion.status, a plain String column — no schema enum, so
// HELD is a new allowed value with no migration needed for the column itself).
// ─────────────────────────────────────────────────────────────────────────

export type DeletionStatus = 'PENDING' | 'PROCESSING' | 'HELD' | 'COMPLETED' | 'FAILED';

// T-R29 (reachability build — master-spec §5.7 "24-hour cooling-off period for deletion
// confirmation" / §9.3 "24-hour confirmation cooling-off period"): the real, reachable
// `/api/data-rights/deletion/confirm` route (src/app/api/data-rights/deletion/confirm/route.ts)
// enforces this window BEFORE calling `DataRightsService.processDeletion` — `processDeletion`
// itself is left UNMODIFIED (T-11's crux logic), so the clock lives here, at the route layer,
// keyed off the ALREADY-PERSISTED `UserDataDeletion.requested_at` timestamp `requestDeletion`
// writes. No schema change: this is a duration constant, not a new column.
export const DELETION_CONFIRMATION_COOLING_OFF_HOURS = 24;

export interface RetainedRecordRef {
  /** e.g. "AuditEntry:<id>" */
  ref: string;
  reason: string; // e.g. "FINRA 2210/3110 — 7yr communications retention (§16.2, §16.3)"
}

// T-R45 (§18.2 "the tree re-parents to their upline with notification"): what processDeletion did
// to the deleted rep's DIRECT downline (see data-rights.ts's processDeletion for the full logic).
// `reparented_user_ids` is empty when the deleted rep simply had no downline — the no-op case.
export interface ReparentedDownlineSummary {
  /** The deleted rep's OWN `upline_id` at the moment of deletion (their sponsor) — every entry in
   *  `reparented_user_ids` now points here. `null` covers the top-of-tree edge: the deleted rep had
   *  no upline of their own, so their downline is promoted to top-level (`upline_id: null`) rather
   *  than left on the anonymized ghost node. */
  new_upline_id: string | null;
  /** ids of every direct-downline user moved to `new_upline_id`. Grandchildren are NOT listed here
   *  (and are untouched) — only the direct children's `upline_id` changes. */
  reparented_user_ids: string[];
}

export interface DeletionCertificate {
  user_id: string;
  deletion_id: string;
  requested_at: string;
  completed_at: string | null;
  status: DeletionStatus;
  /**
   * Ordinary PII fields deleted/anonymized across every user-owned model — User (incl.
   * password_hash/image), Contact, WhySession, OnboardingSession, ContactInteraction, Message,
   * DraftMessage (incl. cfe_classifier_data), WarmMarketExercise, UplineInvite.recipient_email
   * (both as sponsor and as the deleted user's own address on someone else's invite),
   * LicensingRecord.license_number, AgentRun (input_summary/output_ref/reasoning_log), and
   * Milestone.shareable_asset_ref (§16.3). None of these are FINRA-retained; the carve-out below
   * is AuditEntry only (see src/services/compliance/data-rights/data-rights.ts's processDeletion
   * for the full A/B/C classification of every model in prisma/schema.prisma).
   */
  deleted_fields: string[];
  /** The FINRA legal-hold carve-out set: what was retained, and why. Empty when the deletion is HELD (nothing was processed). */
  retained_records: RetainedRecordRef[];
  /** Present only when status === 'HELD'. */
  legal_hold?: { hold_id: string; reason: string; placed_at: string };
  /** Hashes needed for a downstream cross-rep opt-out cascade (§3.4) — the messaging/opt-out
   *  registry cascade itself is out of scope for T-11 (owned by WP05); this just carries the
   *  per-contact hashes forward so that cascade can be wired without re-deriving them. */
  cascade_hashes: Array<{ contact_id: string; phone_hash: string | null; email_hash: string | null }>;
  certificate_url: string;
  /** Present only when status === 'COMPLETED' (a HELD deletion never reaches the re-parent step). */
  reparented_downline?: ReparentedDownlineSummary;
}

export interface UserDataDeletionRecord {
  id: string;
  user_id: string;
  status: DeletionStatus;
  anonymized_fields: string[];
  retained_fields: string[];
  deletion_certificate_url: string | null;
  requested_at: string;
  completed_at: string | null;
}

export type ExportStatus = 'PENDING' | 'COMPLETED' | 'FAILED';
export type ExportFormat = 'json' | 'csv';

export interface UserDataExportRecord {
  id: string;
  user_id: string;
  status: ExportStatus;
  expires_at: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Data minimization (§16.3 "Minimization:")
// ─────────────────────────────────────────────────────────────────────────

/** A data-collection surface where minimization is enforced. */
export type MinimizationSurface = 'signup' | 'contact_import' | 'agent_log_capture';

/**
 * The minimal field allowlist per collection surface. Any field not on this list is dropped
 * before storage — "collect only what onboarding needs; contact data is the user's property,
 * never mined for platform benefit or sold" (§16.3).
 */
export const MINIMIZATION_ALLOWLIST: Record<MinimizationSurface, readonly string[]> = {
  // WP01 onboarding needs identity + role + org linkage + consent — nothing else.
  signup: ['email', 'name', 'phone', 'role', 'org_type', 'upline_id', 'gdpr_consent'],
  // WP02 contact import needs only what the warm-market/harvest method actually operates on.
  contact_import: [
    'first_name',
    'last_name',
    'phone',
    'email',
    'relationship_type',
    'source',
    'import_batch_id',
  ],
  // Agent runs capture what the Activity Ledger needs to render receipts — never raw prompts
  // containing contact PII beyond a summary.
  agent_log_capture: [
    'agent_key',
    'user_id',
    'trigger',
    'model_used',
    'input_summary',
    'output_ref',
    'token_input',
    'token_output',
    'cost_cents',
    'status',
  ],
};
