// T-37 — the automated platform SMS send (master-spec §10.1; §2.3 critical path). THE teeth suite:
// a send happens ONLY when all three gates pass, and neutering ANY ONE of the three (CFE-cleared /
// SendComplianceGate(SMS_PLATFORM) / isChannelDeliverable A2P) causes a message that should not have
// been sent — each `flip-one-gate` test below would fail if that gate check were removed from the
// service. Also proves the Twilio credential is fail-safe (missing keys => HELD, no send, no crash)
// and runs entirely KEY-LESS (Twilio is DI-mocked; the T-38 gate is exercised for real).

import { CFEOutcome, MessageChannel } from '@prisma/client';

import { PlatformSmsSendService, type DeliverabilityCheck } from './platform-sms-send.service';
import { InMemoryTwilioMessagingClient } from './twilio-messaging-client';
import type { SendDraftFields } from './send-decision';
import type { SendContactRow, SendPrismaClient } from './send-support';
import type { ChannelDeliverabilityResult } from '../../deliverability/gate';
import { SendComplianceGate } from '../../compliance/send-gate/send-compliance-gate';
import type { OptOutRegistryService } from '../../compliance/opt-out/opt-out-registry';
import type { MessagingConsentLedger } from '../../compliance/messaging-consent/messaging-consent-ledger';

const DAYTIME = new Date('2026-07-15T19:00:00Z'); // 3 PM EDT — outside quiet hours
const BODY = 'Following up — no worries if the timing is not right, just wanted to share this.';
const ORG = 'org-1';

function makeGate(opts: { optedOut?: boolean; hasConsent?: boolean } = {}): SendComplianceGate {
  return new SendComplianceGate(
    { isOptedOut: async () => opts.optedOut ?? false } as unknown as OptOutRegistryService,
    { hasMessagingConsent: async () => opts.hasConsent ?? true } as unknown as MessagingConsentLedger
  );
}

const deliverableYes: DeliverabilityCheck = async (channel) => ({
  channel,
  deliverable: true,
  reason: 'A2P approved + number assigned',
  detail: { assignedPhoneNumber: '+15550001111' },
});
const deliverableNo: DeliverabilityCheck = async (channel): Promise<ChannelDeliverabilityResult> => ({
  channel,
  deliverable: false,
  reason: 'A2P brand PENDING',
  detail: {},
});

function draftRow(overrides: Partial<SendDraftFields> = {}): SendDraftFields {
  return {
    id: 'd-1',
    user_id: 'rep-1',
    contact_id: 'c-1',
    channel: MessageChannel.SMS_PLATFORM,
    body: BODY,
    cfe_outcome: CFEOutcome.PASS,
    approval_state: 'APPROVED',
    edited_after_approval: false,
    ...overrides,
  };
}
function contactRow(overrides: Partial<SendContactRow> = {}): SendContactRow {
  return { id: 'c-1', user_id: 'rep-1', phone: 'ENV', phone_hash: 'ph-1', email_hash: null, timezone: 'America/New_York', ...overrides };
}

interface Stores {
  drafts: Map<string, SendDraftFields & { send_hold_reason?: string | null }>;
  contacts: Map<string, SendContactRow>;
  messages: Array<Record<string, unknown> & { id: string; thread_id: string }>;
}
function makePrisma(seed: { drafts?: SendDraftFields[]; contacts?: SendContactRow[] } = {}): {
  prisma: SendPrismaClient;
  stores: Stores;
} {
  const threads: Array<{ id: string; user_id: string; contact_id: string; channel: MessageChannel }> = [];
  const stores: Stores = {
    drafts: new Map((seed.drafts ?? [draftRow()]).map((d) => [d.id, { ...d }])),
    contacts: new Map((seed.contacts ?? [contactRow()]).map((c) => [c.id, { ...c }])),
    messages: [],
  };
  let threadN = 0;
  let msgN = 0;
  const prisma = {
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
      findFirst: async ({ where }: { where: { user_id: string; contact_id: string; channel: MessageChannel } }) =>
        threads.find((t) => t.user_id === where.user_id && t.contact_id === where.contact_id && t.channel === where.channel) ??
        null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const t = { id: `thread-${++threadN}`, ...(data as object) } as (typeof threads)[number];
        threads.push(t);
        return { id: t.id };
      },
      update: async () => ({}),
    },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const m = { id: `msg-${++msgN}`, created_at: new Date(), ...data } as unknown as Stores['messages'][number];
        stores.messages.push(m);
        return m;
      },
      findFirst: async () => null,
      update: async () => ({}),
    },
  } as unknown as SendPrismaClient;
  return { prisma, stores };
}

function makeService(
  prisma: SendPrismaClient,
  over: {
    gate?: SendComplianceGate;
    checkDeliverable?: DeliverabilityCheck;
    twilio?: InMemoryTwilioMessagingClient | null;
    useDefaultTwilioFactory?: boolean;
  } = {}
) {
  const twilio = over.twilio === undefined ? new InMemoryTwilioMessagingClient() : over.twilio;
  return new PlatformSmsSendService(prisma, {
    sendGate: over.gate ?? makeGate(),
    checkDeliverable: over.checkDeliverable ?? deliverableYes,
    // Default (real) factory only when explicitly asked — otherwise inject the mock (or null).
    ...(over.useDefaultTwilioFactory ? {} : { twilioClientFactory: () => twilio }),
    decryptPhone: () => '+15551234567',
    encryptBody: (s) => s,
  });
}

describe('PlatformSmsSendService.send — all three gates pass', () => {
  test('sends via the platform number and records the Message', async () => {
    const { prisma, stores } = makePrisma();
    const twilio = new InMemoryTwilioMessagingClient();
    const service = makeService(prisma, { twilio });

    const result = await service.send('rep-1', 'd-1', ORG, DAYTIME);

    expect(result.status).toBe('SENT');
    if (result.status !== 'SENT') return;
    expect(twilio.sent).toEqual([{ from: '+15550001111', to: '+15551234567', body: BODY }]);
    expect(stores.messages).toHaveLength(1);
    expect(stores.messages[0]).toMatchObject({
      channel: MessageChannel.SMS_PLATFORM,
      sent_from: 'platform_number',
      delivery_status: 'queued',
      body: BODY,
    });
    expect(stores.drafts.get('d-1')!.send_hold_reason).toBeNull();
  });
});

describe('PlatformSmsSendService.send — each of the 3 gates is LOAD-BEARING', () => {
  test('GATE (a) CFE: a non-released (BLOCK) draft is never sent', async () => {
    const { prisma, stores } = makePrisma({ drafts: [draftRow({ cfe_outcome: CFEOutcome.BLOCK })] });
    const twilio = new InMemoryTwilioMessagingClient();
    const result = await makeService(prisma, { twilio }).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_CFE_CLEARED' });
    expect(twilio.sent).toHaveLength(0);
    expect(stores.drafts.get('d-1')!.send_hold_reason).toBe('NOT_CFE_CLEARED');
  });

  test('GATE (a) CFE: an un-approved (PENDING) draft is never sent', async () => {
    const { prisma } = makePrisma({ drafts: [draftRow({ approval_state: 'PENDING' })] });
    const twilio = new InMemoryTwilioMessagingClient();
    const result = await makeService(prisma, { twilio }).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_APPROVED' });
    expect(twilio.sent).toHaveLength(0);
  });

  test('GATE (b) SendComplianceGate: OPTED_OUT is never sent', async () => {
    const { prisma } = makePrisma();
    const twilio = new InMemoryTwilioMessagingClient();
    const result = await makeService(prisma, { twilio, gate: makeGate({ optedOut: true }) }).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'OPTED_OUT' });
    expect(twilio.sent).toHaveLength(0);
  });

  test('GATE (b) SendComplianceGate: QUIET_HOURS (fail-closed unknown tz) is never sent', async () => {
    const { prisma } = makePrisma({ contacts: [contactRow({ timezone: null })] });
    const twilio = new InMemoryTwilioMessagingClient();
    const result = await makeService(prisma, { twilio }).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'QUIET_HOURS' });
    expect(twilio.sent).toHaveLength(0);
  });

  test('GATE (b) SendComplianceGate: NO_TCPA_CONSENT is never sent (platform cadence requires consent)', async () => {
    const { prisma } = makePrisma();
    const twilio = new InMemoryTwilioMessagingClient();
    const result = await makeService(prisma, { twilio, gate: makeGate({ hasConsent: false }) }).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NO_TCPA_CONSENT' });
    expect(twilio.sent).toHaveLength(0);
  });

  test('GATE (c) isChannelDeliverable: A2P not APPROVED is never sent', async () => {
    const { prisma, stores } = makePrisma();
    const twilio = new InMemoryTwilioMessagingClient();
    const result = await makeService(prisma, { twilio, checkDeliverable: deliverableNo }).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_DELIVERABLE' });
    expect(twilio.sent).toHaveLength(0);
    expect(stores.drafts.get('d-1')!.send_hold_reason).toBe('NOT_DELIVERABLE');
  });
});

describe('PlatformSmsSendService.send — Twilio credential is fail-safe (KEY-LESS)', () => {
  test('injected null client (keys absent) => HELD TWILIO_UNCONFIGURED, no crash, no send', async () => {
    const { prisma } = makePrisma();
    const result = await makeService(prisma, { twilio: null }).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'TWILIO_UNCONFIGURED' });
  });

  test('the DEFAULT factory (real createTwilioMessagingClient) is null in a key-less env => HELD', async () => {
    const { prisma } = makePrisma();
    // useDefaultTwilioFactory => the service uses the real createTwilioMessagingClient, which returns
    // null because TWILIO_* is unset in the test env — proving the real wiring fails safe.
    const result = await makeService(prisma, { useDefaultTwilioFactory: true }).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'TWILIO_UNCONFIGURED' });
  });
});

describe('PlatformSmsSendService.send — other fail-closed paths', () => {
  test('deliverable but no assigned platform number => HELD NO_PLATFORM_NUMBER', async () => {
    const { prisma } = makePrisma();
    const twilio = new InMemoryTwilioMessagingClient();
    const checkDeliverable: DeliverabilityCheck = async (channel) => ({ channel, deliverable: true, reason: 'ok', detail: {} });
    const result = await makeService(prisma, { twilio, checkDeliverable }).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NO_PLATFORM_NUMBER' });
    expect(twilio.sent).toHaveLength(0);
  });

  test('a SMS_HANDOFF draft cannot be routed through the platform send', async () => {
    const { prisma } = makePrisma({ drafts: [draftRow({ channel: MessageChannel.SMS_HANDOFF })] });
    const result = await makeService(prisma).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'CHANNEL_MISMATCH' });
  });

  test('a Twilio send failure AFTER the gates pass => FAILED + a FAILED message in the timeline', async () => {
    const { prisma, stores } = makePrisma();
    const twilio = new InMemoryTwilioMessagingClient();
    twilio.failNext = true;
    const result = await makeService(prisma, { twilio }).send('rep-1', 'd-1', ORG, DAYTIME);
    expect(result.status).toBe('FAILED');
    expect(stores.messages).toHaveLength(1);
    expect(stores.messages[0]).toMatchObject({ delivery_status: 'FAILED', sent_from: 'platform_number' });
  });

  test('OWNERSHIP: another rep cannot send this draft (NOT_FOUND)', async () => {
    const { prisma } = makePrisma();
    const twilio = new InMemoryTwilioMessagingClient();
    const result = await makeService(prisma, { twilio }).send('rep-999', 'd-1', ORG, DAYTIME);
    expect(result).toEqual({ status: 'NOT_FOUND' });
    expect(twilio.sent).toHaveLength(0);
  });
});
