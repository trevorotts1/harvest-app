// T-36 (master-spec §10.3, SC5 launch gate) — Deliverability provisioning: A2P 10DLC
// (brand/campaign/number) lifecycle, email domain authentication + sender warm-up, and the
// fail-closed `isChannelDeliverable` readiness gate T-37's send paths consult.
//
// PROOF (a): a not-yet-APPROVED A2P registration/number is NOT sendable; APPROVED (brand +
//            campaign + an assigned number) IS sendable.
// PROOF (b): an un-warmed / unauthenticated email sender is NOT deliverable.
// PROOF (c): missing TWILIO_* env vars resolve to UNCONFIGURED/PENDING — never a crash, never a
//            falsely-"ready" result.
// PROOF (d): the readiness gate fails closed on an unknown channel and on an underlying-service
//            throw.

import {
  applyA2PTransition,
  isA2PApproved,
  isA2PProvisioningStatus,
  legalA2PActionsFrom,
} from '../../src/services/deliverability/a2p-state-machine';
import {
  applyWarmupTransition,
  dailyVolumeCapForDay,
  isRampComplete,
  isWarmupActive,
} from '../../src/services/deliverability/email-warmup-schedule';
import {
  InMemoryA2PBrandRepository,
  InMemoryA2PCampaignRepository,
  InMemoryPlatformPhoneNumberRepository,
} from '../../src/services/deliverability/a2p-repository';
import { InMemoryTwilioA2PClient, isTwilioConfigured, createTwilioClient } from '../../src/services/deliverability/twilio-client';
import { A2PProvisioningService } from '../../src/services/deliverability/a2p-service';
import {
  InMemoryEmailDomainAuthRepository,
  InMemoryEmailWarmupRepository,
} from '../../src/services/deliverability/email-warmup-repository';
import { InMemoryEmailAuthClient, DnsEmailAuthClient, EMAIL_DKIM_SELECTOR_ENV_VAR } from '../../src/services/deliverability/email-auth-client';
import { EmailDeliverabilityService } from '../../src/services/deliverability/email-deliverability-service';
import { InMemoryDeliverabilityAuditSink } from '../../src/services/deliverability/deliverability-audit';
import { isChannelDeliverable } from '../../src/services/deliverability/gate';

const ACTOR = { actor_id: 'admin-1' };

// ─── A2P state machine (pure) ───────────────────────────────────────────────────────────────────

describe('A2P 10DLC state machine — pure transitions (§10.3)', () => {
  test('UNREGISTERED -> PENDING via SUBMIT', () => {
    const r = applyA2PTransition('UNREGISTERED', 'SUBMIT');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe('PENDING');
  });

  test('PENDING -> APPROVED via APPROVE, PENDING -> REJECTED via REJECT', () => {
    expect(applyA2PTransition('PENDING', 'APPROVE')).toMatchObject({ ok: true, to: 'APPROVED' });
    expect(applyA2PTransition('PENDING', 'REJECT')).toMatchObject({ ok: true, to: 'REJECTED' });
  });

  test('REJECTED -> PENDING via RESUBMIT', () => {
    expect(applyA2PTransition('REJECTED', 'RESUBMIT')).toMatchObject({ ok: true, to: 'PENDING' });
  });

  test('UNREGISTERED cannot jump straight to APPROVED (must pass through PENDING)', () => {
    const r = applyA2PTransition('UNREGISTERED', 'APPROVE');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Illegal A2P provisioning transition/);
  });

  test('APPROVED is terminal for this action set — no RESUBMIT from APPROVED', () => {
    const r = applyA2PTransition('APPROVED', 'RESUBMIT');
    expect(r.ok).toBe(false);
    expect(legalA2PActionsFrom('APPROVED')).toEqual([]);
  });

  // (a) TEETH: the exact fail-closed capability query the SC5 launch gate depends on.
  test('isA2PApproved is true ONLY for APPROVED — PENDING/UNREGISTERED/REJECTED all false', () => {
    expect(isA2PApproved('APPROVED')).toBe(true);
    expect(isA2PApproved('PENDING')).toBe(false);
    expect(isA2PApproved('UNREGISTERED')).toBe(false);
    expect(isA2PApproved('REJECTED')).toBe(false);
  });

  test('isA2PProvisioningStatus runtime guard rejects unknown values', () => {
    expect(isA2PProvisioningStatus('APPROVED')).toBe(true);
    expect(isA2PProvisioningStatus('NOT_A_REAL_STATUS')).toBe(false);
    expect(isA2PProvisioningStatus(undefined)).toBe(false);
  });
});

// ─── Email warm-up schedule (pure) ──────────────────────────────────────────────────────────────

describe('Email warm-up ramp schedule — pure logic (§10.3)', () => {
  test('ramp fraction grows monotonically and never floors to 0 once started', () => {
    let prev = 0;
    for (let day = 0; day < 10; day++) {
      const cap = dailyVolumeCapForDay(day, 1000);
      expect(cap).toBeGreaterThanOrEqual(prev === 0 ? 1 : prev);
      prev = cap;
    }
  });

  test('a tiny target still gets at least 1/day on ramp day 0 (never floors to 0)', () => {
    expect(dailyVolumeCapForDay(0, 10)).toBeGreaterThanOrEqual(1);
  });

  test('non-positive target -> 0 cap; negative day -> 0 cap (fail closed, never "unlimited")', () => {
    expect(dailyVolumeCapForDay(0, 0)).toBe(0);
    expect(dailyVolumeCapForDay(-1, 1000)).toBe(0);
  });

  test('once ramp is complete, full target volume is allowed', () => {
    expect(isRampComplete(10)).toBe(true);
    expect(dailyVolumeCapForDay(10, 500)).toBe(500);
  });

  test('NOT_STARTED -> RAMPING -> WARMED transition table; PAUSE/RESUME side branch', () => {
    expect(applyWarmupTransition('NOT_STARTED', 'START')).toMatchObject({ ok: true, to: 'RAMPING' });
    expect(applyWarmupTransition('RAMPING', 'COMPLETE_RAMP')).toMatchObject({ ok: true, to: 'WARMED' });
    expect(applyWarmupTransition('RAMPING', 'PAUSE')).toMatchObject({ ok: true, to: 'PAUSED' });
    expect(applyWarmupTransition('PAUSED', 'RESUME')).toMatchObject({ ok: true, to: 'RAMPING' });
    expect(applyWarmupTransition('NOT_STARTED', 'PAUSE').ok).toBe(false);
  });

  // (b) TEETH: the exact fail-closed capability query the email readiness gate depends on.
  test('isWarmupActive is true ONLY for RAMPING/WARMED — NOT_STARTED/PAUSED are not deliverable', () => {
    expect(isWarmupActive('RAMPING')).toBe(true);
    expect(isWarmupActive('WARMED')).toBe(true);
    expect(isWarmupActive('NOT_STARTED')).toBe(false);
    expect(isWarmupActive('PAUSED')).toBe(false);
  });
});

// ─── A2PProvisioningService — the SMS_PLATFORM readiness gate ──────────────────────────────────

function makeA2PService(client: InMemoryTwilioA2PClient | null) {
  return {
    service: new A2PProvisioningService(
      new InMemoryA2PBrandRepository(),
      new InMemoryA2PCampaignRepository(),
      new InMemoryPlatformPhoneNumberRepository(),
      client,
      new InMemoryDeliverabilityAuditSink()
    ),
  };
}

describe('A2PProvisioningService — fail-closed SMS_PLATFORM readiness (§10.3, §10.9-2)', () => {
  test('(a) a brand-new organization with zero provisioning activity is NOT sendable', async () => {
    const { service } = makeA2PService(new InMemoryTwilioA2PClient());
    const status = await service.computeSmsPlatformReadiness('org-fresh');
    expect(status.deliverable).toBe(false);
    expect(status.channel).toBe('SMS_PLATFORM');
  });

  test('(a) full lifecycle: brand+campaign PENDING is NOT sendable; APPROVED + assigned number IS sendable', async () => {
    const client = new InMemoryTwilioA2PClient();
    const { service } = makeA2PService(client);
    const org = 'org-1';

    const brandSubmit = await service.submitBrand(org, ACTOR, { legalBusinessName: 'Acme', ein: '12-3456789', entityType: 'STANDARD' });
    expect(brandSubmit.ok).toBe(true);

    // Still PENDING (not APPROVED yet) — TEETH: not sendable.
    let readiness = await service.computeSmsPlatformReadiness(org);
    expect(readiness.deliverable).toBe(false);
    expect(readiness.reason).toMatch(/not APPROVED/);

    client.nextBrandStatus = 'APPROVED';
    const brandRefresh = await service.refreshBrandStatus(org, ACTOR);
    expect(brandRefresh.ok).toBe(true);
    if (brandRefresh.ok) expect(brandRefresh.record.status).toBe('APPROVED');

    const campaignSubmit = await service.submitCampaign(org, ACTOR, {
      useCase: 'MIXED',
      optInLanguage: 'Reply STOP to opt out.',
      sampleMessages: ['Hi, this is a sample.'],
    });
    expect(campaignSubmit.ok).toBe(true);

    // Brand approved, campaign still PENDING -> still NOT sendable.
    readiness = await service.computeSmsPlatformReadiness(org);
    expect(readiness.deliverable).toBe(false);

    client.nextCampaignStatus = 'APPROVED';
    const campaignRefresh = await service.refreshCampaignStatus(org, ACTOR);
    expect(campaignRefresh.ok).toBe(true);

    // Brand + campaign both APPROVED, but no number provisioned/assigned yet -> still NOT sendable.
    readiness = await service.computeSmsPlatformReadiness(org);
    expect(readiness.deliverable).toBe(false);
    expect(readiness.reason).toMatch(/No platform phone number is assigned/);

    const provisioned = await service.provisionNumber(org, ACTOR);
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) throw new Error('expected ok');
    const assign = await service.assignNumberToCampaign(org, provisioned.record.phone_number, ACTOR);
    expect(assign.ok).toBe(true);

    // NOW fully provisioned -> sendable.
    readiness = await service.computeSmsPlatformReadiness(org);
    expect(readiness.deliverable).toBe(true);
    expect(readiness.reason).toMatch(/APPROVED and a platform number is assigned/);
  });

  test('(a) TEETH: a REJECTED brand is NOT sendable, and cannot skip straight to campaign submission', async () => {
    const client = new InMemoryTwilioA2PClient();
    const { service } = makeA2PService(client);
    const org = 'org-rejected';
    await service.submitBrand(org, ACTOR, { legalBusinessName: 'Acme', ein: '1', entityType: 'STANDARD' });
    client.nextBrandStatus = 'REJECTED';
    await service.refreshBrandStatus(org, ACTOR);

    const readiness = await service.computeSmsPlatformReadiness(org);
    expect(readiness.deliverable).toBe(false);

    const campaignAttempt = await service.submitCampaign(org, ACTOR, { useCase: 'MIXED', optInLanguage: 'x', sampleMessages: [] });
    expect(campaignAttempt.ok).toBe(false);
    if (!campaignAttempt.ok) expect(campaignAttempt.error).toMatch(/must be APPROVED/);
  });

  // (c) PROOF: missing Twilio configuration -> UNCONFIGURED, never a crash, never falsely "ready".
  test('(c) an unconfigured Twilio client (null) never crashes and never fabricates readiness', async () => {
    const { service } = makeA2PService(null);
    expect(service.isConfigured()).toBe(false);

    const submit = await service.submitBrand('org-unconfigured', ACTOR, { legalBusinessName: 'x', ein: '1', entityType: 'STANDARD' });
    expect(submit.ok).toBe(false);
    if (!submit.ok) expect(submit.configured).toBe(false);

    // No state change happened — still UNREGISTERED/not deliverable, not a crash.
    const readiness = await service.computeSmsPlatformReadiness('org-unconfigured');
    expect(readiness.deliverable).toBe(false);

    const provisionAttempt = await service.provisionNumber('org-unconfigured', ACTOR);
    expect(provisionAttempt.ok).toBe(false);
    if (!provisionAttempt.ok) expect(provisionAttempt.configured).toBe(false);
  });

  test('(c) createTwilioClient() / isTwilioConfigured() reflect missing env vars without crashing', () => {
    const savedSid = process.env.TWILIO_ACCOUNT_SID;
    const savedToken = process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    try {
      expect(isTwilioConfigured()).toBe(false);
      expect(createTwilioClient()).toBeNull();

      process.env.TWILIO_ACCOUNT_SID = 'AC_test';
      process.env.TWILIO_AUTH_TOKEN = 'test_token';
      expect(isTwilioConfigured()).toBe(true);
      expect(createTwilioClient()).not.toBeNull();
    } finally {
      if (savedSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
      else process.env.TWILIO_ACCOUNT_SID = savedSid;
      if (savedToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = savedToken;
    }
  });

  test('getProvisioningSummary bundles brand/campaign/numbers/readiness/twilioConfigured for the admin surface', async () => {
    const { service } = makeA2PService(new InMemoryTwilioA2PClient());
    const summary = await service.getProvisioningSummary('org-summary');
    expect(summary).toMatchObject({ brand: null, campaign: null, numbers: [], twilioConfigured: true });
    expect(summary.readiness.deliverable).toBe(false);
  });
});

// ─── EmailDeliverabilityService — the EMAIL readiness gate ─────────────────────────────────────

function makeEmailService(authClient: InMemoryEmailAuthClient = new InMemoryEmailAuthClient()) {
  return new EmailDeliverabilityService(
    new InMemoryEmailDomainAuthRepository(),
    new InMemoryEmailWarmupRepository(),
    authClient,
    new InMemoryDeliverabilityAuditSink()
  );
}

describe('EmailDeliverabilityService — fail-closed EMAIL readiness (§10.3, §10.9-2)', () => {
  test('(b) a domain with no rows on file at all is NOT deliverable (never VERIFIED/RAMPING by omission)', async () => {
    const service = makeEmailService();
    const readiness = await service.computeEmailReadiness('org-1', 'example.com');
    expect(readiness.deliverable).toBe(false);
    expect(readiness.channel).toBe('EMAIL');
  });

  test('(b) unauthenticated (SPF/DKIM/DMARC not all VERIFIED) sender is NOT deliverable even if warm-up is active', async () => {
    const authClient = new InMemoryEmailAuthClient();
    const service = makeEmailService(authClient);
    const org = 'org-2';
    const domain = 'notverified.example.com';

    // Only SPF verified — DKIM/DMARC left at default NOT_CONFIGURED.
    authClient.spfByDomain.set(domain, { status: 'VERIFIED', detail: 'v=spf1 ...' });
    await service.refreshDomainAuthentication(org, domain, ACTOR);
    const started = await service.startWarmup(org, domain, ACTOR, 1000);
    expect(started.ok).toBe(true);

    const readiness = await service.computeEmailReadiness(org, domain);
    expect(readiness.deliverable).toBe(false);
    expect(readiness.reason).toMatch(/not all VERIFIED/);
  });

  test('(b) un-warmed (NOT_STARTED) sender is NOT deliverable even with full SPF/DKIM/DMARC verification', async () => {
    const authClient = new InMemoryEmailAuthClient();
    const service = makeEmailService(authClient);
    const org = 'org-3';
    const domain = 'warmed-check.example.com';
    authClient.verifyAll(domain);
    await service.refreshDomainAuthentication(org, domain, ACTOR);
    // Deliberately never call startWarmup.
    const readiness = await service.computeEmailReadiness(org, domain);
    expect(readiness.deliverable).toBe(false);
    expect(readiness.reason).toMatch(/not sendable until warm-up/);
  });

  test('(b) fully authenticated AND actively warming -> deliverable', async () => {
    const authClient = new InMemoryEmailAuthClient();
    const service = makeEmailService(authClient);
    const org = 'org-4';
    const domain = 'good.example.com';
    authClient.verifyAll(domain);
    await service.refreshDomainAuthentication(org, domain, ACTOR);
    await service.startWarmup(org, domain, ACTOR, 1000);

    const readiness = await service.computeEmailReadiness(org, domain);
    expect(readiness.deliverable).toBe(true);
  });

  test('PAUSE takes an actively-warming domain back to NOT deliverable', async () => {
    const authClient = new InMemoryEmailAuthClient();
    const service = makeEmailService(authClient);
    const org = 'org-5';
    const domain = 'pause.example.com';
    authClient.verifyAll(domain);
    await service.refreshDomainAuthentication(org, domain, ACTOR);
    await service.startWarmup(org, domain, ACTOR, 1000);
    const paused = await service.pauseWarmup(org, domain, ACTOR, 'reputation dip');
    expect(paused.ok).toBe(true);

    const readiness = await service.computeEmailReadiness(org, domain);
    expect(readiness.deliverable).toBe(false);
  });

  test('canSendToday respects the daily ramp cap and recordSend increments the counter', async () => {
    const authClient = new InMemoryEmailAuthClient();
    const service = makeEmailService(authClient);
    const org = 'org-6';
    const domain = 'cap.example.com';
    authClient.verifyAll(domain);
    await service.refreshDomainAuthentication(org, domain, ACTOR);
    // Small target so the day-0 cap is exactly 1 (max(1, floor(10 * 0.02)) = 1).
    await service.startWarmup(org, domain, ACTOR, 10);

    let cap = await service.canSendToday(org, domain);
    expect(cap.allowed).toBe(true);
    expect(cap.cap).toBe(1);

    await service.recordSend(org, domain);
    cap = await service.canSendToday(org, domain);
    expect(cap.allowed).toBe(false);
    expect(cap.remainingToday).toBe(0);
  });

  // (c)-equivalent for email: DKIM verification without a configured selector never crashes and
  // never fabricates VERIFIED.
  test('DnsEmailAuthClient.checkDkim resolves to NOT_CONFIGURED (no crash) when no selector is set', async () => {
    const saved = process.env[EMAIL_DKIM_SELECTOR_ENV_VAR];
    delete process.env[EMAIL_DKIM_SELECTOR_ENV_VAR];
    try {
      const client = new DnsEmailAuthClient();
      const result = await client.checkDkim('example.com');
      expect(result.status).toBe('NOT_CONFIGURED');
    } finally {
      if (saved === undefined) delete process.env[EMAIL_DKIM_SELECTOR_ENV_VAR];
      else process.env[EMAIL_DKIM_SELECTOR_ENV_VAR] = saved;
    }
  });

  test('listDomainsForOrganization ("list domains for org", the SC5 admin surface) enumerates every domain with its readiness', async () => {
    const authClient = new InMemoryEmailAuthClient();
    const service = makeEmailService(authClient);
    const org = 'org-list';

    authClient.verifyAll('warmed.example.com');
    await service.refreshDomainAuthentication(org, 'warmed.example.com', ACTOR);
    await service.startWarmup(org, 'warmed.example.com', ACTOR, 500);

    await service.refreshDomainAuthentication(org, 'cold.example.com', ACTOR); // never warmed

    const domains = await service.listDomainsForOrganization(org);
    expect(domains).toHaveLength(2);
    const warmed = domains.find((d) => d.domain === 'warmed.example.com');
    const cold = domains.find((d) => d.domain === 'cold.example.com');
    expect(warmed?.readiness.deliverable).toBe(true);
    expect(cold?.readiness.deliverable).toBe(false);

    // A different organization sees none of these domains (no cross-org leakage).
    const otherOrgDomains = await service.listDomainsForOrganization('org-different');
    expect(otherOrgDomains).toHaveLength(0);
  });
});

// ─── isChannelDeliverable — the fail-closed T-37 seam ──────────────────────────────────────────

describe('isChannelDeliverable — the fail-closed deliverability gate (§10.3, §10.9-2, SC5)', () => {
  function makeDeps() {
    const twilioClient = new InMemoryTwilioA2PClient();
    const a2pService = new A2PProvisioningService(
      new InMemoryA2PBrandRepository(),
      new InMemoryA2PCampaignRepository(),
      new InMemoryPlatformPhoneNumberRepository(),
      twilioClient
    );
    const emailService = makeEmailService();
    return { a2pService, emailService, twilioClient };
  }

  test('(a) SMS_PLATFORM: not-yet-APPROVED -> NOT deliverable', async () => {
    const deps = makeDeps();
    const result = await isChannelDeliverable(deps, 'SMS_PLATFORM', 'org-gate-1');
    expect(result.deliverable).toBe(false);
    expect(result.channel).toBe('SMS_PLATFORM');
  });

  test('(a) SMS_PLATFORM: fully-approved + assigned number -> deliverable', async () => {
    const deps = makeDeps();
    const client = deps.twilioClient;
    const org = 'org-gate-2';
    await deps.a2pService.submitBrand(org, ACTOR, { legalBusinessName: 'x', ein: '1', entityType: 'STANDARD' });
    client.nextBrandStatus = 'APPROVED';
    await deps.a2pService.refreshBrandStatus(org, ACTOR);
    await deps.a2pService.submitCampaign(org, ACTOR, { useCase: 'MIXED', optInLanguage: 'x', sampleMessages: [] });
    client.nextCampaignStatus = 'APPROVED';
    await deps.a2pService.refreshCampaignStatus(org, ACTOR);
    const provisioned = await deps.a2pService.provisionNumber(org, ACTOR);
    if (!provisioned.ok) throw new Error('expected ok');
    await deps.a2pService.assignNumberToCampaign(org, provisioned.record.phone_number, ACTOR);

    const result = await isChannelDeliverable(deps, 'SMS_PLATFORM', org);
    expect(result.deliverable).toBe(true);
  });

  test('(b) EMAIL: missing domain argument -> NOT deliverable (never throws)', async () => {
    const deps = makeDeps();
    const result = await isChannelDeliverable(deps, 'EMAIL', 'org-gate-3');
    expect(result.deliverable).toBe(false);
    expect(result.channel).toBe('EMAIL');
  });

  test('(b) EMAIL: un-warmed domain -> NOT deliverable; fully warmed -> deliverable', async () => {
    const authClient = new InMemoryEmailAuthClient();
    const deps = { a2pService: makeDeps().a2pService, emailService: makeEmailService(authClient) };
    const org = 'org-gate-4';
    const domain = 'gate.example.com';

    let result = await isChannelDeliverable(deps, 'EMAIL', org, domain);
    expect(result.deliverable).toBe(false);

    authClient.verifyAll(domain);
    await deps.emailService.refreshDomainAuthentication(org, domain, ACTOR);
    await deps.emailService.startWarmup(org, domain, ACTOR, 500);

    result = await isChannelDeliverable(deps, 'EMAIL', org, domain);
    expect(result.deliverable).toBe(true);
  });

  test('FIRST_TOUCH_COMPOSER is always deliverable — never platform-gated (§10.1), regardless of A2P state', async () => {
    const deps = makeDeps();
    // No A2P provisioning has happened for this org at all.
    const result = await isChannelDeliverable(deps, 'FIRST_TOUCH_COMPOSER', 'org-never-provisioned');
    expect(result.deliverable).toBe(true);
    expect(result.channel).toBe('FIRST_TOUCH_COMPOSER');
  });

  // (d) TEETH: fail-closed on an unrecognized channel value (e.g. from an unvalidated caller/body
  // that bypassed the type checker).
  test('(d) an unknown channel value fails CLOSED, not open', async () => {
    const deps = makeDeps();
    const result = await isChannelDeliverable(deps, 'CARRIER_PIGEON' as unknown as never, 'org-x');
    expect(result.deliverable).toBe(false);
    expect(result.reason).toMatch(/Unknown message channel/);
  });

  // (d) TEETH: if the underlying service throws unexpectedly, the gate still resolves to NOT
  // deliverable rather than propagating (a crashed CHECK must never look like a passed check).
  test('(d) an underlying-service throw resolves to NOT deliverable, never propagates', async () => {
    const deps = makeDeps();
    jest.spyOn(deps.a2pService, 'computeSmsPlatformReadiness').mockRejectedValue(new Error('boom'));
    const result = await isChannelDeliverable(deps, 'SMS_PLATFORM', 'org-throws');
    expect(result.deliverable).toBe(false);
    expect(result.reason).toMatch(/failed unexpectedly/);
  });

  // (d) TEETH: removing/breaking the gate's fail-closed default would make this test fail — this
  // guards against a future refactor accidentally flipping the unknown-channel branch to "assume
  // deliverable."
  test('(d) REGRESSION GUARD: the gate never defaults to deliverable:true for anything it does not explicitly recognize', async () => {
    const deps = makeDeps();
    const bogusChannels = ['sms_platform', 'Email', '', null, undefined, 42, {}];
    for (const bogus of bogusChannels) {
      const result = await isChannelDeliverable(deps, bogus as unknown as never, 'org-x');
      expect(result.deliverable).toBe(false);
    }
  });
});
