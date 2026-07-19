// T-36 (§10.3) — A2PProvisioningService: the stateful entry point that owns brand/campaign/number
// provisioning and the SMS_PLATFORM half of the deliverability readiness gate. Mirrors
// src/services/compliance/licensing/licensing-service.ts's shape: a repository (persistence) + an
// injected external client (nullable — see twilio-client.ts) + injected audit sinks, guarded
// transitions from a2p-state-machine.ts, and one fail-closed capability query
// (`computeSmsPlatformReadiness`) other code actually calls to decide "is this sendable."
//
// The `client` this service is constructed with must ALWAYS come from `createTwilioClient()`
// called at request time by the route/caller (never a module-scope singleton) — see
// twilio-client.ts's header. A `null` client means Twilio is UNCONFIGURED; every mutating method
// below resolves that to an explicit `{ ok: false, configured: false, ... }` result — never a
// crash, never a fabricated PENDING/APPROVED status.

import {
  A2PAction,
  A2PBrandRecord,
  A2PCampaignRecord,
  DeliverabilityStatus,
  PlatformPhoneNumberRecord,
} from '../../types/deliverability';
import { applyA2PTransition, isA2PApproved } from './a2p-state-machine';
import { A2PBrandRepository, A2PCampaignRepository, PlatformPhoneNumberRepository } from './a2p-repository';
import { TwilioA2PClient } from './twilio-client';
import { buildDeliverabilityAuditEvent, DeliverabilityAuditSink, NoopDeliverabilityAuditSink } from './deliverability-audit';

function newId(): string {
  return crypto.randomUUID();
}

export interface A2PActorContext {
  actor_id: string;
  actor_role?: string;
}

export interface BrandSubmissionInput {
  legalBusinessName: string;
  ein: string;
  entityType: string;
}

export interface CampaignSubmissionInput {
  useCase: string;
  optInLanguage: string;
  sampleMessages: string[];
}

export type A2POperationOutcome<T> =
  | { ok: true; record: T }
  | { ok: false; error: string; configured: boolean };

/** The SC5 launch-gate admin/ops status surface's per-organization A2P summary — see
 *  A2PProvisioningService.getProvisioningSummary and the GET /api/admin/deliverability route. */
export interface A2PProvisioningSummary {
  brand: A2PBrandRecord | null;
  campaign: A2PCampaignRecord | null;
  numbers: PlatformPhoneNumberRecord[];
  readiness: DeliverabilityStatus;
  twilioConfigured: boolean;
}

export class A2PProvisioningService {
  constructor(
    private readonly brandRepo: A2PBrandRepository,
    private readonly campaignRepo: A2PCampaignRepository,
    private readonly numberRepo: PlatformPhoneNumberRepository,
    private readonly client: TwilioA2PClient | null,
    private readonly auditSink: DeliverabilityAuditSink = new NoopDeliverabilityAuditSink()
  ) {}

  /** Whether a real Twilio client is available to this instance (i.e. TWILIO_ACCOUNT_SID/
   *  TWILIO_AUTH_TOKEN were both set when the caller built this service via createTwilioClient()). */
  isConfigured(): boolean {
    return this.client !== null;
  }

  async getBrand(organizationId: string): Promise<A2PBrandRecord | null> {
    return this.brandRepo.get(organizationId);
  }

  async getCampaign(organizationId: string): Promise<A2PCampaignRecord | null> {
    return this.campaignRepo.get(organizationId);
  }

  async getActiveNumbers(organizationId: string): Promise<PlatformPhoneNumberRecord[]> {
    return this.numberRepo.getActiveForOrganization(organizationId);
  }

  /**
   * Submits (or resubmits, if the prior attempt was REJECTED) a brand registration. Fails closed
   * with `configured: false` and NO state change when Twilio is unconfigured — never marks a
   * brand PENDING without ever having actually contacted Twilio.
   */
  async submitBrand(
    organizationId: string,
    actor: A2PActorContext,
    input: BrandSubmissionInput
  ): Promise<A2POperationOutcome<A2PBrandRecord>> {
    if (!this.client) {
      return {
        ok: false,
        configured: false,
        error:
          'Twilio is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN unset) — cannot submit a ' +
          'real A2P brand registration. Provisioning remains UNREGISTERED.',
      };
    }

    const existing = await this.brandRepo.get(organizationId);
    const from = existing?.status ?? 'UNREGISTERED';
    const action: A2PAction = from === 'REJECTED' ? 'RESUBMIT' : 'SUBMIT';
    const transition = applyA2PTransition(from, action);
    if (!transition.ok) {
      return { ok: false, configured: true, error: transition.error };
    }

    const { brandSid } = await this.client.submitBrandRegistration({
      organizationId,
      legalBusinessName: input.legalBusinessName,
      ein: input.ein,
      entityType: input.entityType,
    });

    const now = new Date().toISOString();
    const record: A2PBrandRecord = {
      id: existing?.id ?? newId(),
      organization_id: organizationId,
      twilio_brand_sid: brandSid,
      status: transition.to,
      entity_type: input.entityType,
      failure_reason: null,
      submitted_at: now,
      approved_at: existing?.approved_at ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await this.brandRepo.upsert(record);
    await this.auditSink.record(
      buildDeliverabilityAuditEvent(
        action === 'RESUBMIT' ? 'a2p_brand.resubmitted' : 'a2p_brand.submitted',
        organizationId,
        actor.actor_id,
        { brandSid, entityType: input.entityType }
      )
    );
    return { ok: true, record };
  }

  /** Polls Twilio for the current brand status and applies the resulting APPROVE/REJECT
   *  transition. Also the method the Twilio webhook handler calls with a pre-fetched status
   *  (see gate.ts's applyBrandStatusUpdate helper) so both the poll and the push paths share one
   *  guarded write path. */
  async refreshBrandStatus(organizationId: string, actor: A2PActorContext): Promise<A2POperationOutcome<A2PBrandRecord>> {
    const existing = await this.brandRepo.get(organizationId);
    if (!existing || !existing.twilio_brand_sid) {
      return { ok: false, configured: this.client !== null, error: 'No brand registration has been submitted for this organization yet.' };
    }
    if (!this.client) {
      return { ok: false, configured: false, error: 'Twilio is not configured — cannot refresh brand status.' };
    }
    const result = await this.client.getBrandStatus(existing.twilio_brand_sid);
    if (result.status === 'UNREGISTERED') {
      // Twilio's own status vocabulary never actually reports this value (mapTwilioStatus only
      // ever returns PENDING/APPROVED/REJECTED) — UNREGISTERED is purely OUR pre-submission
      // default. Treat an unexpected report of it defensively as "no change" rather than
      // crash or (worse) silently apply an invalid transition.
      return { ok: true, record: existing };
    }
    return this.applyBrandStatusResult(organizationId, actor, result.status, result.failureReason);
  }

  /** Applies an already-known Twilio status (from a poll OR a verified webhook payload) to the
   *  brand record via the guarded state machine. Idempotent: re-applying the same terminal status
   *  twice is a no-op transition rejection (APPROVED/REJECTED are terminal in the table), not an
   *  error surfaced to the caller — see the webhook route, which treats `ok: false` here as "already
   *  in this state" rather than a failure. */
  async applyBrandStatusResult(
    organizationId: string,
    actor: A2PActorContext,
    status: 'PENDING' | 'APPROVED' | 'REJECTED',
    failureReason: string | null
  ): Promise<A2POperationOutcome<A2PBrandRecord>> {
    const existing = await this.brandRepo.get(organizationId);
    if (!existing) {
      return { ok: false, configured: this.client !== null, error: 'No brand registration exists for this organization.' };
    }
    if (status === 'PENDING' || existing.status === status) {
      return { ok: true, record: existing }; // no-op: nothing changed
    }
    const action: A2PAction = status === 'APPROVED' ? 'APPROVE' : 'REJECT';
    const transition = applyA2PTransition(existing.status, action);
    if (!transition.ok) {
      return { ok: false, configured: this.client !== null, error: transition.error };
    }
    const now = new Date().toISOString();
    const record: A2PBrandRecord = {
      ...existing,
      status: transition.to,
      failure_reason: transition.to === 'REJECTED' ? failureReason : null,
      approved_at: transition.to === 'APPROVED' ? now : existing.approved_at,
      updated_at: now,
    };
    await this.brandRepo.upsert(record);
    await this.auditSink.record(
      buildDeliverabilityAuditEvent(
        transition.to === 'APPROVED' ? 'a2p_brand.approved' : 'a2p_brand.rejected',
        organizationId,
        actor.actor_id,
        { brandSid: existing.twilio_brand_sid, failureReason }
      )
    );
    return { ok: true, record };
  }

  /** Submits a campaign registration. Requires the org's brand to already be APPROVED (Twilio's
   *  own real-world ordering requirement) — fails closed with a clear error otherwise. */
  async submitCampaign(
    organizationId: string,
    actor: A2PActorContext,
    input: CampaignSubmissionInput
  ): Promise<A2POperationOutcome<A2PCampaignRecord>> {
    if (!this.client) {
      return {
        ok: false,
        configured: false,
        error: 'Twilio is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN unset) — cannot submit a real A2P campaign registration.',
      };
    }
    const brand = await this.brandRepo.get(organizationId);
    if (!brand || !isA2PApproved(brand.status)) {
      return {
        ok: false,
        configured: true,
        error: `The organization's A2P brand must be APPROVED before a campaign can be submitted (currently ${brand?.status ?? 'UNREGISTERED'}).`,
      };
    }

    const existing = await this.campaignRepo.get(organizationId);
    const from = existing?.status ?? 'UNREGISTERED';
    const action: A2PAction = from === 'REJECTED' ? 'RESUBMIT' : 'SUBMIT';
    const transition = applyA2PTransition(from, action);
    if (!transition.ok) {
      return { ok: false, configured: true, error: transition.error };
    }

    const { campaignSid } = await this.client.submitCampaignRegistration({
      organizationId,
      brandSid: brand.twilio_brand_sid ?? '',
      useCase: input.useCase,
      optInLanguage: input.optInLanguage,
      sampleMessages: input.sampleMessages,
    });

    const now = new Date().toISOString();
    const record: A2PCampaignRecord = {
      id: existing?.id ?? newId(),
      organization_id: organizationId,
      twilio_campaign_sid: campaignSid,
      status: transition.to,
      use_case: input.useCase,
      opt_in_language: input.optInLanguage,
      throughput_tier: existing?.throughput_tier ?? null,
      failure_reason: null,
      submitted_at: now,
      approved_at: existing?.approved_at ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await this.campaignRepo.upsert(record);
    await this.auditSink.record(
      buildDeliverabilityAuditEvent(
        action === 'RESUBMIT' ? 'a2p_campaign.resubmitted' : 'a2p_campaign.submitted',
        organizationId,
        actor.actor_id,
        { campaignSid, useCase: input.useCase }
      )
    );
    return { ok: true, record };
  }

  async refreshCampaignStatus(organizationId: string, actor: A2PActorContext): Promise<A2POperationOutcome<A2PCampaignRecord>> {
    const existing = await this.campaignRepo.get(organizationId);
    if (!existing || !existing.twilio_campaign_sid) {
      return { ok: false, configured: this.client !== null, error: 'No campaign registration has been submitted for this organization yet.' };
    }
    if (!this.client) {
      return { ok: false, configured: false, error: 'Twilio is not configured — cannot refresh campaign status.' };
    }
    const result = await this.client.getCampaignStatus(existing.twilio_campaign_sid);
    if (result.status === 'UNREGISTERED') {
      // See the identical guard in refreshBrandStatus above — Twilio never actually reports this
      // value; defend against it as a no-op rather than crash or mis-apply a transition.
      return { ok: true, record: existing };
    }
    return this.applyCampaignStatusResult(organizationId, actor, result.status, result.failureReason, result.throughputTier ?? null);
  }

  async applyCampaignStatusResult(
    organizationId: string,
    actor: A2PActorContext,
    status: 'PENDING' | 'APPROVED' | 'REJECTED',
    failureReason: string | null,
    throughputTier: string | null
  ): Promise<A2POperationOutcome<A2PCampaignRecord>> {
    const existing = await this.campaignRepo.get(organizationId);
    if (!existing) {
      return { ok: false, configured: this.client !== null, error: 'No campaign registration exists for this organization.' };
    }
    if (status === 'PENDING' || existing.status === status) {
      return { ok: true, record: existing };
    }
    const action: A2PAction = status === 'APPROVED' ? 'APPROVE' : 'REJECT';
    const transition = applyA2PTransition(existing.status, action);
    if (!transition.ok) {
      return { ok: false, configured: this.client !== null, error: transition.error };
    }
    const now = new Date().toISOString();
    const record: A2PCampaignRecord = {
      ...existing,
      status: transition.to,
      throughput_tier: transition.to === 'APPROVED' ? throughputTier ?? existing.throughput_tier : existing.throughput_tier,
      failure_reason: transition.to === 'REJECTED' ? failureReason : null,
      approved_at: transition.to === 'APPROVED' ? now : existing.approved_at,
      updated_at: now,
    };
    await this.campaignRepo.upsert(record);
    await this.auditSink.record(
      buildDeliverabilityAuditEvent(
        transition.to === 'APPROVED' ? 'a2p_campaign.approved' : 'a2p_campaign.rejected',
        organizationId,
        actor.actor_id,
        { campaignSid: existing.twilio_campaign_sid, failureReason }
      )
    );
    return { ok: true, record };
  }

  /** Provisions (purchases) a new platform phone number for this org. The number starts life as
   *  PROVISIONED, not ASSIGNED — it must still be explicitly assigned to an APPROVED campaign
   *  before it becomes sendable (see assignNumberToCampaign / computeSmsPlatformReadiness). */
  async provisionNumber(organizationId: string, actor: A2PActorContext): Promise<A2POperationOutcome<PlatformPhoneNumberRecord>> {
    if (!this.client) {
      return {
        ok: false,
        configured: false,
        error: 'Twilio is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN unset) — cannot provision a real platform number.',
      };
    }
    const { phoneNumberSid, phoneNumber } = await this.client.provisionPhoneNumber(organizationId);
    const now = new Date().toISOString();
    const record: PlatformPhoneNumberRecord = {
      id: newId(),
      organization_id: organizationId,
      phone_number: phoneNumber,
      twilio_phone_number_sid: phoneNumberSid,
      campaign_registration_id: null,
      status: 'PROVISIONED',
      released_at: null,
      created_at: now,
      updated_at: now,
    };
    await this.numberRepo.upsert(record);
    await this.auditSink.record(
      buildDeliverabilityAuditEvent('platform_number.provisioned', organizationId, actor.actor_id, { phoneNumber, phoneNumberSid })
    );
    return { ok: true, record };
  }

  /** Assigns a PROVISIONED number to the org's campaign. Requires the campaign to be APPROVED —
   *  fails closed otherwise, mirroring the brand-before-campaign ordering guard above. */
  async assignNumberToCampaign(
    organizationId: string,
    phoneNumber: string,
    actor: A2PActorContext
  ): Promise<A2POperationOutcome<PlatformPhoneNumberRecord>> {
    if (!this.client) {
      return { ok: false, configured: false, error: 'Twilio is not configured — cannot assign a number to a campaign.' };
    }
    const campaign = await this.campaignRepo.get(organizationId);
    if (!campaign || !isA2PApproved(campaign.status)) {
      return {
        ok: false,
        configured: true,
        error: `The organization's A2P campaign must be APPROVED before a number can be assigned to it (currently ${campaign?.status ?? 'UNREGISTERED'}).`,
      };
    }
    const number = await this.numberRepo.get(phoneNumber);
    if (!number || number.organization_id !== organizationId) {
      return { ok: false, configured: true, error: 'No such platform number is provisioned for this organization.' };
    }
    if (number.status === 'RELEASED') {
      return { ok: false, configured: true, error: 'This number has been released and cannot be reassigned.' };
    }
    if (!number.twilio_phone_number_sid) {
      return { ok: false, configured: true, error: 'This number has no Twilio SID on record and cannot be assigned.' };
    }
    await this.client.assignNumberToCampaign(number.twilio_phone_number_sid, campaign.twilio_campaign_sid ?? '');
    const now = new Date().toISOString();
    const record: PlatformPhoneNumberRecord = {
      ...number,
      status: 'ASSIGNED',
      campaign_registration_id: campaign.id,
      updated_at: now,
    };
    await this.numberRepo.upsert(record);
    await this.auditSink.record(
      buildDeliverabilityAuditEvent('platform_number.assigned', organizationId, actor.actor_id, {
        phoneNumber,
        campaignSid: campaign.twilio_campaign_sid,
      })
    );
    return { ok: true, record };
  }

  /**
   * THE fail-closed readiness gate for SMS_PLATFORM (§10.3, §10.9-2): sendable ONLY when the org's
   * brand AND campaign are both APPROVED and at least one active number is ASSIGNED to that exact
   * campaign. A missing row of any kind (never submitted) resolves to its UNREGISTERED default via
   * the repository, which is never APPROVED — so a brand-new organization with zero provisioning
   * activity is correctly NOT deliverable, not a crash, not a silent "assume fine." This method
   * makes no Twilio calls — it is a pure DB read, safe to call on every send-path check.
   */
  async computeSmsPlatformReadiness(organizationId: string): Promise<DeliverabilityStatus> {
    const [brand, campaign, numbers] = await Promise.all([
      this.brandRepo.get(organizationId),
      this.campaignRepo.get(organizationId),
      this.numberRepo.getActiveForOrganization(organizationId),
    ]);
    const brandStatus = brand?.status ?? 'UNREGISTERED';
    const campaignStatus = campaign?.status ?? 'UNREGISTERED';
    const assignedNumber = campaign
      ? numbers.find((n) => n.status === 'ASSIGNED' && n.campaign_registration_id === campaign.id)
      : undefined;

    const detail = {
      brandStatus,
      campaignStatus,
      twilioConfigured: this.isConfigured(),
      activeNumberCount: numbers.length,
      assignedPhoneNumber: assignedNumber?.phone_number ?? null,
    };

    if (!isA2PApproved(brandStatus)) {
      return {
        channel: 'SMS_PLATFORM',
        deliverable: false,
        reason: `A2P brand registration is ${brandStatus}, not APPROVED — platform SMS is not sendable.`,
        detail,
      };
    }
    if (!isA2PApproved(campaignStatus)) {
      return {
        channel: 'SMS_PLATFORM',
        deliverable: false,
        reason: `A2P campaign registration is ${campaignStatus}, not APPROVED — platform SMS is not sendable.`,
        detail,
      };
    }
    if (!assignedNumber) {
      return {
        channel: 'SMS_PLATFORM',
        deliverable: false,
        reason: 'No platform phone number is assigned to the approved campaign — platform SMS is not sendable.',
        detail,
      };
    }
    return {
      channel: 'SMS_PLATFORM',
      deliverable: true,
      reason: 'A2P brand and campaign are APPROVED and a platform number is assigned.',
      detail,
    };
  }

  /**
   * The SC5 launch-gate admin/ops status surface's single entry point for this organization's A2P
   * side: brand + campaign + active numbers + the same fail-closed readiness verdict
   * `computeSmsPlatformReadiness` computes, bundled together so the route/caller need only make
   * one call rather than re-deriving readiness ad hoc. Read-only — makes no Twilio calls itself
   * (computeSmsPlatformReadiness is a pure DB read; getBrand/getCampaign/getActiveNumbers are too).
   */
  async getProvisioningSummary(organizationId: string): Promise<A2PProvisioningSummary> {
    const [brand, campaign, numbers, readiness] = await Promise.all([
      this.getBrand(organizationId),
      this.getCampaign(organizationId),
      this.getActiveNumbers(organizationId),
      this.computeSmsPlatformReadiness(organizationId),
    ]);
    return { brand, campaign, numbers, readiness, twilioConfigured: this.isConfigured() };
  }
}
