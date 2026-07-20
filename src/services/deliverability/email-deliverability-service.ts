// T-36 (§10.3) — EmailDeliverabilityService: owns SPF/DKIM/DMARC verification + the sender
// warm-up ramp, and the EMAIL half of the deliverability readiness gate. Same shape as
// A2PProvisioningService: repositories for persistence, an injected EmailAuthClient for the DNS
// checks, injected audit sinks, guarded stage transitions from email-warmup-schedule.ts, and one
// fail-closed capability query (`computeEmailReadiness`).

import { EmailDomainAuthenticationRecord, EmailWarmupPlanRecord } from '../../types/deliverability';
import {
  applyWarmupTransition,
  dailyVolumeCapForDay,
  isRampComplete,
  isWarmupActive,
  utcDateString,
} from './email-warmup-schedule';
import { EmailDomainAuthRepository, EmailWarmupRepository } from './email-warmup-repository';
import { EmailAuthClient } from './email-auth-client';
import { buildDeliverabilityAuditEvent, DeliverabilityAuditSink, NoopDeliverabilityAuditSink } from './deliverability-audit';
import { DeliverabilityStatus } from '../../types/deliverability';

function newId(): string {
  return crypto.randomUUID();
}

export interface DeliverabilityActorContext {
  actor_id: string;
  actor_role?: string;
}

export type EmailOperationOutcome<T> = { ok: true; record: T } | { ok: false; error: string };

/** The SC5 launch-gate admin/ops status surface's per-(org, domain) email summary — see
 *  EmailDeliverabilityService.listDomainsForOrganization and the GET /api/admin/deliverability
 *  route ("list domains for org"). */
export interface EmailDomainStatusSummary {
  domain: string;
  auth: EmailDomainAuthenticationRecord | null;
  warmup: EmailWarmupPlanRecord | null;
  readiness: DeliverabilityStatus;
}

export class EmailDeliverabilityService {
  constructor(
    private readonly authRepo: EmailDomainAuthRepository,
    private readonly warmupRepo: EmailWarmupRepository,
    private readonly authClient: EmailAuthClient,
    private readonly auditSink: DeliverabilityAuditSink = new NoopDeliverabilityAuditSink()
  ) {}

  async getDomainAuthentication(organizationId: string, domain: string): Promise<EmailDomainAuthenticationRecord | null> {
    return this.authRepo.get(organizationId, domain);
  }

  async getWarmupPlan(organizationId: string, domain: string): Promise<EmailWarmupPlanRecord | null> {
    return this.warmupRepo.get(organizationId, domain);
  }

  /** Runs live SPF/DKIM/DMARC checks against `domain` and persists the result. Never crashes on a
   *  missing DKIM selector or a DNS failure — every check resolves to an explicit status
   *  (NOT_CONFIGURED/FAILED/VERIFIED), never thrown. */
  async refreshDomainAuthentication(
    organizationId: string,
    domain: string,
    actor: DeliverabilityActorContext
  ): Promise<EmailDomainAuthenticationRecord> {
    const [spf, dkim, dmarc] = await Promise.all([
      this.authClient.checkSpf(domain),
      this.authClient.checkDkim(domain),
      this.authClient.checkDmarc(domain),
    ]);
    const existing = await this.authRepo.get(organizationId, domain);
    const now = new Date().toISOString();
    const record: EmailDomainAuthenticationRecord = {
      id: existing?.id ?? newId(),
      organization_id: organizationId,
      sending_domain: domain,
      spf_status: spf.status,
      dkim_status: dkim.status,
      dmarc_status: dmarc.status,
      last_checked_at: now,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await this.authRepo.upsert(record);
    await this.auditSink.record(
      buildDeliverabilityAuditEvent('email_domain_auth.checked', organizationId, actor.actor_id, {
        domain,
        spf: spf.status,
        dkim: dkim.status,
        dmarc: dmarc.status,
      })
    );
    return record;
  }

  /** Starts (or resumes, from PAUSED) the warm-up ramp for (org, domain). `targetDailyVolume` is
   *  the org's chosen steady-state send volume once fully warmed; required and re-affirmed on a
   *  fresh START (a RESUME keeps the previously configured target). */
  async startWarmup(
    organizationId: string,
    domain: string,
    actor: DeliverabilityActorContext,
    targetDailyVolume: number
  ): Promise<EmailOperationOutcome<EmailWarmupPlanRecord>> {
    if (targetDailyVolume <= 0) {
      return { ok: false, error: 'targetDailyVolume must be a positive integer.' };
    }
    const existing = await this.warmupRepo.get(organizationId, domain);
    const from = existing?.stage ?? 'NOT_STARTED';
    const action = from === 'PAUSED' ? 'RESUME' : 'START';
    const transition = applyWarmupTransition(from, action);
    if (!transition.ok) {
      return { ok: false, error: transition.error };
    }

    const now = new Date().toISOString();
    const currentDay = action === 'RESUME' ? existing?.current_day ?? 0 : 0;
    // A RESUME whose day was already past the ramp curve resolves straight to WARMED rather than
    // regressing to "still ramping" — see email-warmup-schedule.ts's WARMUP_TRANSITIONS comment.
    const stage = action === 'RESUME' && isRampComplete(currentDay) ? 'WARMED' : transition.to;
    const target = action === 'RESUME' ? existing?.target_daily_volume ?? targetDailyVolume : targetDailyVolume;

    const record: EmailWarmupPlanRecord = {
      id: existing?.id ?? newId(),
      organization_id: organizationId,
      sending_domain: domain,
      stage,
      started_at: existing?.started_at ?? now,
      current_day: currentDay,
      daily_volume_cap: dailyVolumeCapForDay(currentDay, target),
      target_daily_volume: target,
      sent_today: existing?.sent_today ?? 0,
      last_send_date: existing?.last_send_date ?? null,
      paused_reason: null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await this.warmupRepo.upsert(record);
    await this.auditSink.record(
      buildDeliverabilityAuditEvent('email_warmup.started', organizationId, actor.actor_id, { domain, targetDailyVolume: target })
    );
    return { ok: true, record };
  }

  /** Advances the ramp by one day (an ops action, or a scheduled daily job in production —
   *  out of scope here, this method is the seam it would call). Recomputes the daily cap and
   *  flips to WARMED once the ramp curve is exhausted. */
  async advanceWarmupDay(
    organizationId: string,
    domain: string,
    actor: DeliverabilityActorContext
  ): Promise<EmailOperationOutcome<EmailWarmupPlanRecord>> {
    const existing = await this.warmupRepo.get(organizationId, domain);
    if (!existing || existing.stage !== 'RAMPING') {
      return { ok: false, error: 'No actively-RAMPING warm-up plan exists for this (organization, domain).' };
    }
    const nextDay = existing.current_day + 1;
    const now = new Date().toISOString();
    const stage = isRampComplete(nextDay) ? 'WARMED' : 'RAMPING';
    const record: EmailWarmupPlanRecord = {
      ...existing,
      stage,
      current_day: nextDay,
      daily_volume_cap: dailyVolumeCapForDay(nextDay, existing.target_daily_volume),
      sent_today: 0,
      last_send_date: null,
      updated_at: now,
    };
    await this.warmupRepo.upsert(record);
    await this.auditSink.record(
      buildDeliverabilityAuditEvent('email_warmup.advanced', organizationId, actor.actor_id, { domain, day: nextDay, stage })
    );
    return { ok: true, record };
  }

  async pauseWarmup(
    organizationId: string,
    domain: string,
    actor: DeliverabilityActorContext,
    reason: string
  ): Promise<EmailOperationOutcome<EmailWarmupPlanRecord>> {
    const existing = await this.warmupRepo.get(organizationId, domain);
    const from = existing?.stage ?? 'NOT_STARTED';
    const transition = applyWarmupTransition(from, 'PAUSE');
    if (!transition.ok) {
      return { ok: false, error: transition.error };
    }
    const now = new Date().toISOString();
    const record: EmailWarmupPlanRecord = { ...(existing as EmailWarmupPlanRecord), stage: 'PAUSED', paused_reason: reason, updated_at: now };
    await this.warmupRepo.upsert(record);
    await this.auditSink.record(buildDeliverabilityAuditEvent('email_warmup.paused', organizationId, actor.actor_id, { domain, reason }));
    return { ok: true, record };
  }

  /**
   * Read-only capacity check for T-37's send scheduler: does today's counter still have room
   * under the current ramp-day cap? Handles the daily reset itself (a stale `last_send_date` from
   * a previous UTC day is treated as `sent_today: 0` for this read) without mutating anything —
   * the actual counter increment happens in `recordSend`, called only after a real send succeeds.
   */
  async canSendToday(organizationId: string, domain: string): Promise<{ allowed: boolean; remainingToday: number; cap: number }> {
    const plan = await this.warmupRepo.get(organizationId, domain);
    if (!plan || !isWarmupActive(plan.stage)) {
      return { allowed: false, remainingToday: 0, cap: 0 };
    }
    const today = utcDateString();
    const sentToday = plan.last_send_date === today ? plan.sent_today : 0;
    return { allowed: sentToday < plan.daily_volume_cap, remainingToday: Math.max(0, plan.daily_volume_cap - sentToday), cap: plan.daily_volume_cap };
  }

  /** Increments today's send counter (resetting it first if the last recorded send was on a
   *  different UTC day). Called by T-37's send path immediately after a platform email actually
   *  sends — never before, so a failed send never consumes warm-up capacity. */
  async recordSend(organizationId: string, domain: string): Promise<void> {
    const plan = await this.warmupRepo.get(organizationId, domain);
    if (!plan) return;
    const today = utcDateString();
    const sentToday = plan.last_send_date === today ? plan.sent_today : 0;
    await this.warmupRepo.upsert({ ...plan, sent_today: sentToday + 1, last_send_date: today, updated_at: new Date().toISOString() });
  }

  /**
   * THE fail-closed readiness gate for EMAIL (§10.3, §10.9-2): deliverable ONLY when SPF, DKIM,
   * AND DMARC are all VERIFIED, AND the warm-up plan is actively RAMPING or WARMED (never
   * NOT_STARTED or PAUSED). A domain with no rows at all defaults to NOT_CONFIGURED/NOT_STARTED —
   * never VERIFIED/RAMPING by omission. Pure DB read; makes no DNS/network calls.
   */
  async computeEmailReadiness(organizationId: string, domain: string): Promise<DeliverabilityStatus> {
    const [auth, warmup] = await Promise.all([this.authRepo.get(organizationId, domain), this.warmupRepo.get(organizationId, domain)]);
    const spf = auth?.spf_status ?? 'NOT_CONFIGURED';
    const dkim = auth?.dkim_status ?? 'NOT_CONFIGURED';
    const dmarc = auth?.dmarc_status ?? 'NOT_CONFIGURED';
    const stage = warmup?.stage ?? 'NOT_STARTED';

    const detail = {
      spf,
      dkim,
      dmarc,
      warmupStage: stage,
      currentDay: warmup?.current_day ?? 0,
      dailyVolumeCap: warmup?.daily_volume_cap ?? 0,
      sentToday: warmup?.sent_today ?? 0,
    };

    const allVerified = spf === 'VERIFIED' && dkim === 'VERIFIED' && dmarc === 'VERIFIED';
    if (!allVerified) {
      return {
        channel: 'EMAIL',
        deliverable: false,
        reason: `Email domain authentication incomplete (SPF ${spf}, DKIM ${dkim}, DMARC ${dmarc}) — not all VERIFIED, so email is not sendable.`,
        detail,
      };
    }
    if (!isWarmupActive(stage)) {
      return {
        channel: 'EMAIL',
        deliverable: false,
        reason: `Sender warm-up is ${stage} — email is not sendable until warm-up is actively RAMPING or WARMED.`,
        detail,
      };
    }
    return {
      channel: 'EMAIL',
      deliverable: true,
      reason: 'SPF/DKIM/DMARC are all VERIFIED and sender warm-up is active.',
      detail,
    };
  }

  /**
   * The SC5 launch-gate admin/ops status surface's "list domains for org" capability: every
   * sending domain this organization has EITHER run an authentication check for OR started a
   * warm-up plan for (the union of both repositories' `listForOrganization`, since a domain could
   * in principle have one row without the other yet), each bundled with its own fail-closed
   * readiness verdict via `computeEmailReadiness`. Read-only; makes no DNS/network calls itself.
   */
  async listDomainsForOrganization(organizationId: string): Promise<EmailDomainStatusSummary[]> {
    const [authRecords, warmupRecords] = await Promise.all([
      this.authRepo.listForOrganization(organizationId),
      this.warmupRepo.listForOrganization(organizationId),
    ]);
    const authByDomain = new Map(authRecords.map((r) => [r.sending_domain, r]));
    const warmupByDomain = new Map(warmupRecords.map((r) => [r.sending_domain, r]));
    const domains = new Set<string>([...authByDomain.keys(), ...warmupByDomain.keys()]);

    const summaries: EmailDomainStatusSummary[] = [];
    for (const domain of domains) {
      const readiness = await this.computeEmailReadiness(organizationId, domain);
      summaries.push({
        domain,
        auth: authByDomain.get(domain) ?? null,
        warmup: warmupByDomain.get(domain) ?? null,
        readiness,
      });
    }
    return summaries;
  }
}
