// T-40R (WP05 GATE remediation — re-QC 7.2 factory-coverage fix) — DIRECT gate-coverage for the
// shared production factory (`src/services/messaging/send/production-wiring.ts`). Every messaging
// surface T-40R wired (sequence enroll+cron, objection coach, 3-way handoff, email trigger) routes
// through this ONE factory, but until now nothing imported the factory's own exported functions —
// every existing "teeth" test (email-send.service.test.ts, platform-sms-send.service.test.ts,
// sequence.service.test.ts) hand-built its OWN SequenceService/EmailSendService/
// PlatformSmsSendService/dispatcher instead of exercising `buildEmailSendService`/
// `buildPlatformSmsSendService`/`buildSequenceDispatcher`/`buildSequenceService` themselves. The
// re-QC proved the hole is real: mutating `buildEmailSendService` to force `deliverable: true`
// (bypassing the T-36 deliverability gate) left all 1821 existing tests green, because none of them
// ever called the factory. This suite imports the REAL, exported factory functions — never a
// hand-built equivalent — and mocks only the external boundary a unit test must: the Prisma
// delegates the factory's internal repositories read. No Twilio/DNS network call is ever made —
// `computeSmsPlatformReadiness`/`computeEmailReadiness` are pure DB reads (see a2p-service.ts /
// email-deliverability-service.ts) — so seeding the delegate rows is enough to control deliverable
// vs. not, with no network involved.
//
// TESTABILITY SEAM (documented in production-wiring.ts itself): `SendComplianceGate` was never
// threaded through the factory's `db` parameter — `EmailSendService`/`PlatformSmsSendService` both
// default an omitted `sendGate` to `new SendComplianceGate()`, which in turn defaults to the REAL
// imported `prisma` singleton, regardless of what `db` a caller passed to the factory. Exercising the
// REAL factory functions from a unit test therefore needed a way to keep opt-out/quiet-hours/TCPA
// reads off a live database too — `production-wiring.ts` now accepts an optional second
// `overrides: { sendGate }` argument on every build* function for exactly this. Every production
// call-site (the messaging routes, the Inngest cron) omits that argument, so this is purely additive
// — see that file's own doc comment on `ProductionWiringOverrides`.

import { CFEOutcome, MessageChannel } from '@prisma/client';

import {
  buildEmailSendService,
  buildPlatformSmsSendService,
  buildSequenceDispatcher,
  buildSequenceService,
} from '@/services/messaging/send/production-wiring';
import { SendComplianceGate } from '@/services/compliance/send-gate/send-compliance-gate';
import type { OptOutRegistryService } from '@/services/compliance/opt-out/opt-out-registry';
import type { MessagingConsentLedger } from '@/services/compliance/messaging-consent/messaging-consent-ledger';
import type { SendDraftFields } from '@/services/messaging/send/send-decision';
import type { SendContactRow } from '@/services/messaging/send/send-support';
import type { SequenceRow, SequenceStepRow } from '@/services/messaging/sequence/sequence.service';
import type {
  A2PBrandPrismaRow,
  A2PCampaignPrismaRow,
  PlatformPhoneNumberPrismaRow,
} from '@/services/deliverability/a2p-repository';
import type {
  EmailDomainAuthPrismaRow,
  EmailWarmupPlanPrismaRow,
} from '@/services/deliverability/email-warmup-repository';

/** The factory's own `db` parameter type (`AnyPrisma`) is a private, unexported alias — extract it
 *  structurally rather than re-declaring/importing `typeof prisma` (the full generated client). */
type FactoryDb = Parameters<typeof buildEmailSendService>[0];

const DAYTIME = new Date('2026-07-15T19:00:00Z'); // 3 PM EDT — outside quiet hours (same fixed
// clock every other T-39/T-40R messaging suite uses).
const ORG = 'org-1';
const DOMAIN = 'mail.example.org';
const BODY = 'Just a warm note — no pressure at all, wanted to share something that might help.';
const SEEDED_AT = new Date('2026-07-01T00:00:00Z').toISOString();

// ─── SendComplianceGate: the REAL class, stub sub-dependencies at the DB boundary only — the exact
// convention email-send.service.test.ts / sequence.service.test.ts already use for `makeGate`. ──────
function makeGate(opts: { optedOut?: boolean; hasConsent?: boolean } = {}): SendComplianceGate {
  return new SendComplianceGate(
    { isOptedOut: async () => opts.optedOut ?? false } as unknown as OptOutRegistryService,
    { hasMessagingConsent: async () => opts.hasConsent ?? true } as unknown as MessagingConsentLedger
  );
}

function draftRow(overrides: Partial<SendDraftFields> = {}): SendDraftFields {
  return {
    id: 'd-1',
    user_id: 'rep-1',
    contact_id: 'c-1',
    channel: MessageChannel.EMAIL,
    body: BODY,
    cfe_outcome: CFEOutcome.PASS,
    approval_state: 'APPROVED',
    edited_after_approval: false,
    approved_by: 'rep-1',
    approved_at: new Date('2026-07-14T12:00:00Z'),
    cfe_risk_score: 3,
    cfe_classifier_data: { band: 'clear' },
    ...overrides,
  };
}

function contactRow(overrides: Partial<SendContactRow> = {}): SendContactRow {
  return {
    id: 'c-1',
    user_id: 'rep-1',
    phone: 'ENC_PHONE',
    phone_hash: 'ph-1',
    email_hash: 'eh-1',
    timezone: 'America/New_York',
    email: 'ENC_EMAIL',
    ...overrides,
  };
}

// ─── Deliverable fixture rows — real A2P/email-warmup PRISMA ROW shapes (the exact interfaces
// a2p-repository.ts / email-warmup-repository.ts declare their Prisma delegates must return). ──────
function approvedBrandRow(): A2PBrandPrismaRow {
  return {
    id: 'brand-1',
    organization_id: ORG,
    twilio_brand_sid: 'BN1',
    status: 'APPROVED',
    entity_type: 'PRIVATE_PROFIT',
    failure_reason: null,
    submitted_at: SEEDED_AT,
    approved_at: SEEDED_AT,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  };
}
function approvedCampaignRow(): A2PCampaignPrismaRow {
  return {
    id: 'camp-1',
    organization_id: ORG,
    twilio_campaign_sid: 'CN1',
    status: 'APPROVED',
    use_case: 'MARKETING',
    opt_in_language: 'opt-in copy',
    throughput_tier: 'T1',
    failure_reason: null,
    submitted_at: SEEDED_AT,
    approved_at: SEEDED_AT,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  };
}
function assignedNumberRow(): PlatformPhoneNumberPrismaRow {
  return {
    id: 'num-1',
    organization_id: ORG,
    phone_number: '+15550001111',
    twilio_phone_number_sid: 'PN1',
    campaign_registration_id: 'camp-1',
    status: 'ASSIGNED',
    released_at: null,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  };
}
function verifiedDomainAuthRow(): EmailDomainAuthPrismaRow {
  return {
    id: 'auth-1',
    organization_id: ORG,
    sending_domain: DOMAIN,
    spf_status: 'VERIFIED',
    dkim_status: 'VERIFIED',
    dmarc_status: 'VERIFIED',
    last_checked_at: SEEDED_AT,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  };
}
function activeWarmupRow(): EmailWarmupPlanPrismaRow {
  return {
    id: 'warm-1',
    organization_id: ORG,
    sending_domain: DOMAIN,
    stage: 'RAMPING',
    started_at: SEEDED_AT,
    current_day: 3,
    daily_volume_cap: 50,
    target_daily_volume: 200,
    sent_today: 0,
    last_send_date: null,
    paused_reason: null,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
  };
}

interface Stores {
  drafts: Map<string, SendDraftFields & { send_hold_reason?: string | null }>;
  contacts: Map<string, SendContactRow>;
  threads: Array<{ id: string; user_id: string; contact_id: string; channel: MessageChannel }>;
  messages: Array<Record<string, unknown> & { id: string }>;
  sequences: Map<string, SequenceRow>;
  steps: SequenceStepRow[];
}

/**
 * Builds a fully in-memory stand-in for `prisma` exposing every delegate the REAL, exported factory
 * functions read from: the T-37/T-39 send-path tables (draftMessage/contact/messageThread/message),
 * the T-39 sequence tables (outreachSequence/outreachSequenceStep), and the T-36 deliverability
 * tables (a2PBrandRegistration/a2PCampaignRegistration/platformPhoneNumber/
 * emailDomainAuthentication/emailWarmupPlan) `A2PProvisioningService`/`EmailDeliverabilityService`
 * read through their own repositories. `deliverable.smsPlatform`/`deliverable.email` seed an
 * APPROVED+ASSIGNED A2P posture / a VERIFIED+RAMPING email posture respectively; omitting either
 * leaves that channel's tables empty, which both real services' own fail-closed defaults
 * (UNREGISTERED / NOT_CONFIGURED+NOT_STARTED) resolve to NOT deliverable — no bespoke "not
 * deliverable" stub needed, exactly the honest absence-of-provisioning case production would see.
 */
function makeFakeDb(
  seed: {
    drafts?: SendDraftFields[];
    contacts?: SendContactRow[];
    deliverable?: { smsPlatform?: boolean; email?: boolean };
  } = {}
): { db: FactoryDb; stores: Stores } {
  const stores: Stores = {
    drafts: new Map((seed.drafts ?? [draftRow()]).map((d) => [d.id, { ...d, send_hold_reason: null }])),
    contacts: new Map((seed.contacts ?? [contactRow()]).map((c) => [c.id, { ...c }])),
    threads: [],
    messages: [],
    sequences: new Map(),
    steps: [],
  };
  let threadN = 0;
  let msgN = 0;
  let seqN = 0;
  let stepN = 0;

  const a2pBrand = new Map<string, A2PBrandPrismaRow>();
  const a2pCampaign = new Map<string, A2PCampaignPrismaRow>();
  const platformNumbers = new Map<string, PlatformPhoneNumberPrismaRow>();
  const emailAuth = new Map<string, EmailDomainAuthPrismaRow>();
  const emailWarmup = new Map<string, EmailWarmupPlanPrismaRow>();

  if (seed.deliverable?.smsPlatform) {
    a2pBrand.set(ORG, approvedBrandRow());
    a2pCampaign.set(ORG, approvedCampaignRow());
    platformNumbers.set('+15550001111', assignedNumberRow());
  }
  if (seed.deliverable?.email) {
    emailAuth.set(`${ORG}::${DOMAIN}`, verifiedDomainAuthRow());
    emailWarmup.set(`${ORG}::${DOMAIN}`, activeWarmupRow());
  }

  const raw = {
    draftMessage: {
      findFirst: async ({ where }: { where: { id: string; user_id: string } }) => {
        const d = stores.drafts.get(where.id);
        return d && d.user_id === where.user_id ? { ...d } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(stores.drafts.get(where.id)!, data);
        return {};
      },
    },
    contact: {
      findFirst: async ({ where }: { where: { id: string; user_id: string } }) => {
        const c = stores.contacts.get(where.id);
        return c && c.user_id === where.user_id ? { ...c } : null;
      },
    },
    messageThread: {
      findFirst: async ({
        where,
      }: {
        where: { user_id: string; contact_id: string; channel: MessageChannel };
      }) =>
        stores.threads.find(
          (t) => t.user_id === where.user_id && t.contact_id === where.contact_id && t.channel === where.channel
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const t = { id: `thread-${++threadN}`, ...(data as object) } as Stores['threads'][number];
        stores.threads.push(t);
        return { id: t.id };
      },
      update: async () => ({}),
    },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const m = { id: `msg-${++msgN}`, created_at: new Date(), ...data } as Stores['messages'][number];
        stores.messages.push(m);
        return m;
      },
      findFirst: async () => null,
      update: async () => ({}),
    },
    outreachSequence: {
      findFirst: async ({ where }: { where: { id: string; user_id: string } }) => {
        const s = stores.sequences.get(where.id);
        return s && s.user_id === where.user_id ? { ...s } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: SequenceRow = {
          id: `seq-${++seqN}`,
          user_id: String(data.user_id),
          contact_id: String(data.contact_id),
          sequence_type: String(data.sequence_type),
          state: String(data.state ?? 'ACTIVE'),
          pause_reason: (data.pause_reason as string | null) ?? null,
          current_step_index: Number(data.current_step_index ?? 0),
          started_at: DAYTIME,
          updated_at: DAYTIME,
        };
        stores.sequences.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = stores.sequences.get(where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    outreachSequenceStep: {
      findMany: async ({ where }: { where: { sequence_id: string } }) =>
        stores.steps.filter((s) => s.sequence_id === where.sequence_id).sort((a, b) => a.step_index - b.step_index),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: SequenceStepRow = {
          id: `step-${++stepN}`,
          sequence_id: String(data.sequence_id),
          step_index: Number(data.step_index),
          channel: data.channel as MessageChannel,
          scheduled_at: data.scheduled_at as Date,
          status: String(data.status ?? 'SCHEDULED'),
          draft_id: (data.draft_id as string | null) ?? null,
          send_hold_reason: null,
          sent_message_id: null,
          dispatched_at: null,
        };
        stores.steps.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = stores.steps.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    a2PBrandRegistration: {
      findUnique: async ({ where }: { where: { organization_id: string } }) =>
        a2pBrand.get(where.organization_id) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { organization_id: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = a2pBrand.get(where.organization_id);
        const row = { ...(existing ?? create), ...update } as A2PBrandPrismaRow;
        a2pBrand.set(where.organization_id, row);
        return row;
      },
    },
    a2PCampaignRegistration: {
      findUnique: async ({ where }: { where: { organization_id: string } }) =>
        a2pCampaign.get(where.organization_id) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { organization_id: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = a2pCampaign.get(where.organization_id);
        const row = { ...(existing ?? create), ...update } as A2PCampaignPrismaRow;
        a2pCampaign.set(where.organization_id, row);
        return row;
      },
    },
    platformPhoneNumber: {
      findUnique: async ({ where }: { where: { phone_number: string } }) =>
        platformNumbers.get(where.phone_number) ?? null,
      findMany: async ({ where }: { where: { organization_id: string; status: { not: string } } }) =>
        Array.from(platformNumbers.values()).filter(
          (n) => n.organization_id === where.organization_id && n.status !== where.status.not
        ),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { phone_number: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = platformNumbers.get(where.phone_number);
        const row = { ...(existing ?? create), ...update } as PlatformPhoneNumberPrismaRow;
        platformNumbers.set(where.phone_number, row);
        return row;
      },
    },
    emailDomainAuthentication: {
      findUnique: async ({
        where,
      }: {
        where: { organization_id_sending_domain: { organization_id: string; sending_domain: string } };
      }) =>
        emailAuth.get(
          `${where.organization_id_sending_domain.organization_id}::${where.organization_id_sending_domain.sending_domain}`
        ) ?? null,
      findMany: async ({ where }: { where: { organization_id: string } }) =>
        Array.from(emailAuth.values()).filter((r) => r.organization_id === where.organization_id),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { organization_id_sending_domain: { organization_id: string; sending_domain: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = `${where.organization_id_sending_domain.organization_id}::${where.organization_id_sending_domain.sending_domain}`;
        const existing = emailAuth.get(key);
        const row = { ...(existing ?? create), ...update } as EmailDomainAuthPrismaRow;
        emailAuth.set(key, row);
        return row;
      },
    },
    emailWarmupPlan: {
      findUnique: async ({
        where,
      }: {
        where: { organization_id_sending_domain: { organization_id: string; sending_domain: string } };
      }) =>
        emailWarmup.get(
          `${where.organization_id_sending_domain.organization_id}::${where.organization_id_sending_domain.sending_domain}`
        ) ?? null,
      findMany: async ({ where }: { where: { organization_id: string } }) =>
        Array.from(emailWarmup.values()).filter((r) => r.organization_id === where.organization_id),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { organization_id_sending_domain: { organization_id: string; sending_domain: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = `${where.organization_id_sending_domain.organization_id}::${where.organization_id_sending_domain.sending_domain}`;
        const existing = emailWarmup.get(key);
        const row = { ...(existing ?? create), ...update } as EmailWarmupPlanPrismaRow;
        emailWarmup.set(key, row);
        return row;
      },
    },
  };

  return { db: raw as unknown as FactoryDb, stores };
}

/** Save/delete/restore the TWILIO_ and RESEND_API_KEY credentials around a test, guaranteeing the
 *  "reaches the key-less credential check" sanity assertions hold regardless of run order (same
 *  convention tests/unit/deliverability.test.ts already uses). */
function withNoSendCredentials<T>(fn: () => Promise<T>): Promise<T> {
  const saved = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    resend: process.env.RESEND_API_KEY,
  };
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.RESEND_API_KEY;
  return fn().finally(() => {
    if (saved.sid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = saved.sid;
    if (saved.token === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = saved.token;
    if (saved.resend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved.resend;
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// buildEmailSendService — the REAL, exported factory (never a hand-built EmailSendService)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('production-wiring: buildEmailSendService (the REAL factory) enforces all three gates', () => {
  test('GATE (a) CFE: a non-released (BLOCK) draft is HELD NOT_CFE_CLEARED — never reaches compliance/deliverability', async () => {
    const { db } = makeFakeDb({
      drafts: [draftRow({ cfe_outcome: CFEOutcome.BLOCK })],
      deliverable: { email: true }, // deliverable + compliance-clean, so ONLY the CFE gate could HELD it
    });
    const service = buildEmailSendService(db, { sendGate: makeGate() });
    const result = await service.send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_CFE_CLEARED' });
  });

  test('GATE (b) SendComplianceGate: a globally opted-out contact is HELD OPTED_OUT, even though CFE-cleared and deliverable', async () => {
    const { db } = makeFakeDb({ deliverable: { email: true } });
    const service = buildEmailSendService(db, { sendGate: makeGate({ optedOut: true }) });
    const result = await service.send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'OPTED_OUT' });
  });

  test('GATE (c) isChannelDeliverable: an unprovisioned sending domain (no SPF/DKIM/DMARC, no warm-up) is HELD NOT_DELIVERABLE, even though CFE-cleared and compliance-allowed', async () => {
    const { db } = makeFakeDb(); // deliverable omitted entirely — no domain-auth/warm-up rows at all
    const service = buildEmailSendService(db, { sendGate: makeGate() });
    const result = await service.send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_DELIVERABLE' });
  });

  test('sanity: fully CFE-cleared + compliance-allowed + deliverable reaches the key-less credential check (EMAIL_UNCONFIGURED), never a gate HELD — proves all 3 real gates passed', async () => {
    const { db } = makeFakeDb({ deliverable: { email: true } });
    const service = buildEmailSendService(db, { sendGate: makeGate() });
    const result = await withNoSendCredentials(() => service.send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME));
    // EMAIL_UNCONFIGURED is the ONLY reachable HELD reason once all three gates clear in a key-less
    // env (RESEND_API_KEY unset) — anything else here would mean a gate wrongly blocked the clean case.
    expect(result).toEqual({ status: 'HELD', reason: 'EMAIL_UNCONFIGURED' });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// buildPlatformSmsSendService — the REAL, exported factory
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('production-wiring: buildPlatformSmsSendService (the REAL factory) enforces all three gates', () => {
  const smsDraft = () => draftRow({ channel: MessageChannel.SMS_PLATFORM });

  test('GATE (a) CFE: an edited-after-approval draft is HELD EDITED_AFTER_APPROVAL — never reaches compliance/deliverability', async () => {
    const { db } = makeFakeDb({
      drafts: [draftRow({ channel: MessageChannel.SMS_PLATFORM, edited_after_approval: true })],
      deliverable: { smsPlatform: true },
    });
    const service = buildPlatformSmsSendService(db, { sendGate: makeGate() });
    const result = await service.send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'EDITED_AFTER_APPROVAL' });
  });

  test('GATE (b) SendComplianceGate: a globally opted-out contact is HELD OPTED_OUT, even though CFE-cleared and deliverable', async () => {
    const { db } = makeFakeDb({ drafts: [smsDraft()], deliverable: { smsPlatform: true } });
    const service = buildPlatformSmsSendService(db, { sendGate: makeGate({ optedOut: true }) });
    const result = await service.send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'OPTED_OUT' });
  });

  test('GATE (b) SendComplianceGate: no TCPA consent on file is HELD NO_TCPA_CONSENT (SMS_PLATFORM-only gate)', async () => {
    const { db } = makeFakeDb({ drafts: [smsDraft()], deliverable: { smsPlatform: true } });
    const service = buildPlatformSmsSendService(db, { sendGate: makeGate({ hasConsent: false }) });
    const result = await service.send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NO_TCPA_CONSENT' });
  });

  test('GATE (c) isChannelDeliverable: A2P not provisioned (no brand/campaign/number rows) is HELD NOT_DELIVERABLE, even though CFE-cleared and compliance-allowed', async () => {
    const { db } = makeFakeDb({ drafts: [smsDraft()] }); // deliverable omitted — brand/campaign default UNREGISTERED
    const service = buildPlatformSmsSendService(db, { sendGate: makeGate() });
    const result = await service.send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_DELIVERABLE' });
  });

  test('sanity: fully CFE-cleared + compliance-allowed + deliverable (A2P APPROVED + number ASSIGNED) reaches the key-less credential check (TWILIO_UNCONFIGURED), never a gate HELD — proves all 3 real gates passed', async () => {
    const { db } = makeFakeDb({ drafts: [smsDraft()], deliverable: { smsPlatform: true } });
    const service = buildPlatformSmsSendService(db, { sendGate: makeGate() });
    const result = await withNoSendCredentials(() => service.send('rep-1', 'd-1', ORG, DAYTIME));
    expect(result).toEqual({ status: 'HELD', reason: 'TWILIO_UNCONFIGURED' });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// buildSequenceDispatcher — the REAL T-37 seam boundary a cadence step dispatches through
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('production-wiring: buildSequenceDispatcher (the REAL seam) routes through the SAME real, gated services', () => {
  test('TEETH: an OPTED-OUT contact dispatched as an EMAIL step through the REAL dispatcher → HELD OPTED_OUT', async () => {
    const { db } = makeFakeDb({ deliverable: { email: true } });
    const dispatcher = buildSequenceDispatcher(db, { sendGate: makeGate({ optedOut: true }) });
    const result = await dispatcher.dispatch({
      userId: 'rep-1',
      draftId: 'd-1',
      channel: MessageChannel.EMAIL,
      organizationId: ORG,
      sendingDomain: DOMAIN,
      now: DAYTIME,
    });
    expect(result).toEqual({ status: 'HELD', reason: 'OPTED_OUT' });
  });

  test('TEETH: a NON-DELIVERABLE SMS_PLATFORM step (A2P not provisioned) dispatched through the REAL dispatcher → HELD NOT_DELIVERABLE', async () => {
    const { db } = makeFakeDb({ drafts: [draftRow({ channel: MessageChannel.SMS_PLATFORM })] });
    const dispatcher = buildSequenceDispatcher(db, { sendGate: makeGate() });
    const result = await dispatcher.dispatch({
      userId: 'rep-1',
      draftId: 'd-1',
      channel: MessageChannel.SMS_PLATFORM,
      organizationId: ORG,
      now: DAYTIME,
    });
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_DELIVERABLE' });
  });

  test('TEETH: a NON-CFE-CLEARED (BLOCK) draft dispatched as an EMAIL step through the REAL dispatcher → HELD NOT_CFE_CLEARED', async () => {
    const { db } = makeFakeDb({
      drafts: [draftRow({ cfe_outcome: CFEOutcome.BLOCK })],
      deliverable: { email: true },
    });
    const dispatcher = buildSequenceDispatcher(db, { sendGate: makeGate() });
    const result = await dispatcher.dispatch({
      userId: 'rep-1',
      draftId: 'd-1',
      channel: MessageChannel.EMAIL,
      organizationId: ORG,
      sendingDomain: DOMAIN,
      now: DAYTIME,
    });
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_CFE_CLEARED' });
  });

  test('sanity: a fully-clean EMAIL step dispatched through the REAL dispatcher reaches the key-less EMAIL_UNCONFIGURED terminal state, never a gate HELD', async () => {
    const { db } = makeFakeDb({ deliverable: { email: true } });
    const dispatcher = buildSequenceDispatcher(db, { sendGate: makeGate() });
    const result = await withNoSendCredentials(() =>
      dispatcher.dispatch({
        userId: 'rep-1',
        draftId: 'd-1',
        channel: MessageChannel.EMAIL,
        organizationId: ORG,
        sendingDomain: DOMAIN,
        now: DAYTIME,
      })
    );
    expect(result).toEqual({ status: 'HELD', reason: 'EMAIL_UNCONFIGURED' });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// buildSequenceService — the REAL cadence engine over the REAL dispatcher: the WHOLE factory stack
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('production-wiring: buildSequenceService (the REAL cadence engine + REAL dispatcher + REAL EmailSendService), end to end', () => {
  function seedDueEmailStep(stores: Stores): void {
    stores.sequences.set('seq-1', {
      id: 'seq-1',
      user_id: 'rep-1',
      contact_id: 'c-1',
      sequence_type: 'STANDARD',
      state: 'ACTIVE',
      pause_reason: null,
      current_step_index: 0,
      started_at: DAYTIME,
      updated_at: DAYTIME,
    });
    stores.steps.push({
      id: 'step-1',
      sequence_id: 'seq-1',
      step_index: 0,
      channel: MessageChannel.EMAIL,
      scheduled_at: new Date('2026-07-15T00:00:00Z'), // due (before DAYTIME)
      status: 'SCHEDULED',
      draft_id: 'd-1',
      send_hold_reason: null,
      sent_message_id: null,
      dispatched_at: null,
    });
  }

  test('an OPTED-OUT contact stops the whole sequence at the PRE-SCHEDULE gate — real SequenceService, real dispatcher, real EmailSendService', async () => {
    const { db, stores } = makeFakeDb({ deliverable: { email: true } });
    seedDueEmailStep(stores);
    const service = buildSequenceService(db, { sendGate: makeGate({ optedOut: true }) });

    const summary = await service.runDueSteps('rep-1', 'seq-1', { organizationId: ORG, sendingDomain: DOMAIN }, DAYTIME);

    expect(summary.state).toBe('STOPPED');
    expect(summary.pauseReason).toBe('OPT_OUT');
    expect(summary.outcomes).toEqual([{ stepIndex: 0, result: 'STOPPED', reason: 'OPTED_OUT' }]);
  });

  test('a NON-CFE-CLEARED draft is caught at the PER-SEND seam (pre-schedule compliance passes; the REAL EmailSendService HELDs it) — sequence pauses COMPLIANCE_BLOCK', async () => {
    const { db, stores } = makeFakeDb({
      drafts: [draftRow({ cfe_outcome: CFEOutcome.BLOCK })],
      deliverable: { email: true },
    });
    seedDueEmailStep(stores);
    const service = buildSequenceService(db, { sendGate: makeGate() }); // clean compliance — only the CFE gate can HELD this

    const summary = await service.runDueSteps('rep-1', 'seq-1', { organizationId: ORG, sendingDomain: DOMAIN }, DAYTIME);

    expect(summary.state).toBe('PAUSED');
    expect(summary.pauseReason).toBe('COMPLIANCE_BLOCK');
    expect(summary.outcomes).toEqual([{ stepIndex: 0, result: 'HELD', reason: 'NOT_CFE_CLEARED' }]);
  });

  test('sanity: a fully-clean due EMAIL step reaches SENT-blocking-only-on-credential (key-less EMAIL_UNCONFIGURED) through the REAL end-to-end stack, never a gate PAUSE/STOP', async () => {
    const { db, stores } = makeFakeDb({ deliverable: { email: true } });
    seedDueEmailStep(stores);
    const service = buildSequenceService(db, { sendGate: makeGate() });

    const summary = await withNoSendCredentials(() =>
      service.runDueSteps('rep-1', 'seq-1', { organizationId: ORG, sendingDomain: DOMAIN }, DAYTIME)
    );

    // The engine treats any non-OPTED_OUT/QUIET_HOURS HELD as a COMPLIANCE_BLOCK pause (§10.8) — the
    // key-less EMAIL_UNCONFIGURED hold is exactly that, surfaced honestly rather than a fabricated
    // SENT. The point of this assertion is the REASON: it is the credential hold, not a gate hold.
    expect(summary.state).toBe('PAUSED');
    expect(summary.outcomes).toEqual([{ stepIndex: 0, result: 'HELD', reason: 'EMAIL_UNCONFIGURED' }]);
  });
});
