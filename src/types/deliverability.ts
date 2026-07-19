// T-36 (master-spec §10.3, SC5 launch gate) — Deliverability provisioning types.
//
// A2P 10DLC (brand + campaign registration + platform-number provisioning) and email domain
// authentication + sender warm-up, plus the fail-closed readiness gate T-37 (send paths) consults
// before any platform-sent SMS or email. Mirrors src/types/licensing.ts's conventions exactly:
// pure-data types here, pure transition logic in the sibling `*-state-machine.ts` files, I/O in the
// service/repository layer.
//
// Spec text (verbatim, §10.3): "A2P 10DLC / carrier registration & sender-reputation plan for all
// platform-sent SMS (brand + campaign registration; throughput tiers; opt-in language on file).
// Email domain authentication (SPF, DKIM, DMARC) + a sender warm-up plan for campaigns. Without
// these, the messaging deliverables silently fail in production, so they are a launch gate (SC5),
// not a nice-to-have."

// ─── A2P 10DLC brand + campaign lifecycle ──────────────────────────────────────────────────────

/** The four states named verbatim in §10.3 ("e.g. UNREGISTERED -> PENDING -> APPROVED/REJECTED"). */
export const A2P_PROVISIONING_STATUSES = ['UNREGISTERED', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type A2PProvisioningStatus = (typeof A2P_PROVISIONING_STATUSES)[number];

/** Legal transition actions over the brand/campaign lifecycle. */
export const A2P_ACTIONS = [
  'SUBMIT', // UNREGISTERED -> PENDING (registration submitted to Twilio)
  'APPROVE', // PENDING -> APPROVED (Twilio callback/poll confirms approval)
  'REJECT', // PENDING -> REJECTED (Twilio callback/poll confirms rejection)
  'RESUBMIT', // REJECTED -> PENDING (a corrected registration is resubmitted)
] as const;
export type A2PAction = (typeof A2P_ACTIONS)[number];

export interface A2PTransitionSuccess {
  ok: true;
  from: A2PProvisioningStatus;
  to: A2PProvisioningStatus;
  action: A2PAction;
}
export interface A2PTransitionFailure {
  ok: false;
  from: A2PProvisioningStatus;
  action: A2PAction;
  error: string;
}
export type A2PTransitionResult = A2PTransitionSuccess | A2PTransitionFailure;

/** A durable per-organization A2P brand registration record. */
export interface A2PBrandRecord {
  id: string;
  organization_id: string;
  twilio_brand_sid: string | null;
  status: A2PProvisioningStatus;
  entity_type: string | null;
  failure_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A durable per-organization A2P campaign registration record. */
export interface A2PCampaignRecord {
  id: string;
  organization_id: string;
  twilio_campaign_sid: string | null;
  status: A2PProvisioningStatus;
  use_case: string;
  opt_in_language: string;
  throughput_tier: string | null;
  failure_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Platform phone number lifecycle ───────────────────────────────────────────────────────────

export const PLATFORM_NUMBER_STATUSES = ['UNPROVISIONED', 'PROVISIONED', 'ASSIGNED', 'RELEASED'] as const;
export type PlatformNumberStatus = (typeof PLATFORM_NUMBER_STATUSES)[number];

export interface PlatformPhoneNumberRecord {
  id: string;
  organization_id: string;
  phone_number: string;
  twilio_phone_number_sid: string | null;
  campaign_registration_id: string | null;
  status: PlatformNumberStatus;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Email domain authentication + warm-up ─────────────────────────────────────────────────────

export const EMAIL_AUTH_RECORD_STATUSES = ['NOT_CONFIGURED', 'PENDING', 'VERIFIED', 'FAILED'] as const;
export type EmailAuthRecordStatus = (typeof EMAIL_AUTH_RECORD_STATUSES)[number];

export interface EmailDomainAuthenticationRecord {
  id: string;
  organization_id: string;
  sending_domain: string;
  spf_status: EmailAuthRecordStatus;
  dkim_status: EmailAuthRecordStatus;
  dmarc_status: EmailAuthRecordStatus;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export const EMAIL_WARMUP_STAGES = ['NOT_STARTED', 'RAMPING', 'WARMED', 'PAUSED'] as const;
export type EmailWarmupStage = (typeof EMAIL_WARMUP_STAGES)[number];

export interface EmailWarmupPlanRecord {
  id: string;
  organization_id: string;
  sending_domain: string;
  stage: EmailWarmupStage;
  started_at: string | null;
  current_day: number;
  daily_volume_cap: number;
  target_daily_volume: number;
  sent_today: number;
  last_send_date: string | null;
  paused_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ─── The fail-closed readiness gate (T-37's seam) ──────────────────────────────────────────────

/** The two channels §10.3 actually provisions. First-touch composer handoff (§10.1) sends from the
 *  rep's own number and is never gated by platform A2P provisioning — see gate.ts for the full
 *  MessageChannel-wide wrapper that documents that exception explicitly. */
export type ProvisionedChannel = 'SMS_PLATFORM' | 'EMAIL';

export interface DeliverabilityStatus {
  channel: ProvisionedChannel;
  /** Fail-closed: true only on a positive, verified proof of readiness. */
  deliverable: boolean;
  reason: string;
  detail: Record<string, unknown>;
}

// ─── Audit event contract (mirrors src/services/compliance/data-rights/audit-emit.ts) ──────────

export type DeliverabilityAuditEventType =
  | 'a2p_brand.submitted'
  | 'a2p_brand.approved'
  | 'a2p_brand.rejected'
  | 'a2p_brand.resubmitted'
  | 'a2p_campaign.submitted'
  | 'a2p_campaign.approved'
  | 'a2p_campaign.rejected'
  | 'a2p_campaign.resubmitted'
  | 'platform_number.provisioned'
  | 'platform_number.assigned'
  | 'platform_number.released'
  | 'email_domain_auth.checked'
  | 'email_warmup.started'
  | 'email_warmup.advanced'
  | 'email_warmup.paused';

export interface DeliverabilityAuditEvent {
  type: DeliverabilityAuditEventType;
  organization_id: string;
  actor_id: string; // user_id of the admin/system actor performing the action
  timestamp: string; // ISO 8601
  detail: Record<string, unknown>;
}
