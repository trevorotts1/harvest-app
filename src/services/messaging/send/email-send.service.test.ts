// T-39 (WP05 §10.5/§10.7 email path) — THE email teeth: an automated email is dispatched ONLY when
// all three gates pass, IN ORDER — (a) CFE-cleared + approved + unedited, (b) SendComplianceGate
// (opt-out + recipient quiet hours), (c) isChannelDeliverable('EMAIL') SPF/DKIM/DMARC + warm-up —
// and neutering ANY ONE lets nothing through. The RESEND_API_KEY credential is fail-safe (absent →
// HELD EMAIL_UNCONFIGURED, no send, no crash), so the suite runs entirely KEY-LESS (email client is
// DI-mocked; the T-38 gate runs for real). Also proves the T-R19/T-R16 fold-ins: a recorded send
// carries a linked cfe_audit_id + the draft's approval attribution.
//
// Finally, the STRONGEST "goes-through-the-seam" teeth (§10.2): a REAL SeamSequenceDispatcher wired
// to this REAL EmailSendService — a cadence EMAIL step for a NON-cleared draft is HELD and NOTHING
// is dispatched to the provider (the send would have gone out if the engine bypassed the seam).

import { CFEOutcome, MessageChannel } from '@prisma/client';

import { EmailSendService, type EmailDeliverabilityCheck } from './email-send.service';
import { InMemoryEmailSendClient } from './email-send-client';
import { SeamSequenceDispatcher } from '../sequence/sequence.service';
import type { SendDraftFields } from './send-decision';
import type { SendContactRow, SendPrismaClient } from './send-support';
import type { ChannelDeliverabilityResult } from '../../deliverability/gate';
import { SendComplianceGate } from '../../compliance/send-gate/send-compliance-gate';
import type { OptOutRegistryService } from '../../compliance/opt-out/opt-out-registry';
import type { MessagingConsentLedger } from '../../compliance/messaging-consent/messaging-consent-ledger';

const DAYTIME = new Date('2026-07-15T19:00:00Z'); // 3 PM EDT — outside quiet hours
const BODY = 'Just a warm note — no pressure at all, wanted to share something that might help.';
const ORG = 'org-1';
const DOMAIN = 'mail.example.org';

function makeGate(opts: { optedOut?: boolean } = {}): SendComplianceGate {
  return new SendComplianceGate(
    { isOptedOut: async () => opts.optedOut ?? false } as unknown as OptOutRegistryService,
    { hasMessagingConsent: async () => true } as unknown as MessagingConsentLedger
  );
}

const deliverableYes: EmailDeliverabilityCheck = async (channel) => ({
  channel,
  deliverable: true,
  reason: 'SPF/DKIM/DMARC verified + warm-up active',
  detail: {},
});
const deliverableNo: EmailDeliverabilityCheck = async (channel): Promise<ChannelDeliverabilityResult> => ({
  channel,
  deliverable: false,
  reason: 'DKIM PENDING',
  detail: {},
});

function draftRow(overrides: Partial<SendDraftFields & { send_hold_reason?: string | null }> = {}): SendDraftFields & { send_hold_reason?: string | null } {
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
    send_hold_reason: null,
    ...overrides,
  };
}
function contactRow(overrides: Partial<SendContactRow> = {}): SendContactRow {
  return { id: 'c-1', user_id: 'rep-1', phone: null, phone_hash: null, email_hash: 'eh-1', timezone: 'America/New_York', email: 'ENV_EMAIL', ...overrides };
}

interface Stores {
  drafts: Map<string, SendDraftFields & { send_hold_reason?: string | null }>;
  contacts: Map<string, SendContactRow>;
  messages: Array<Record<string, unknown> & { id: string }>;
  audits: Array<Record<string, unknown> & { id: string; sequence: number }>;
}

function makePrisma(seed: { drafts?: (SendDraftFields & { send_hold_reason?: string | null })[]; contacts?: SendContactRow[]; withAudit?: boolean } = {}): { prisma: SendPrismaClient; stores: Stores } {
  const threads: Array<{ id: string; user_id: string; contact_id: string; channel: MessageChannel }> = [];
  const stores: Stores = {
    drafts: new Map((seed.drafts ?? [draftRow()]).map((d) => [d.id, { ...d }])),
    contacts: new Map((seed.contacts ?? [contactRow()]).map((c) => [c.id, { ...c }])),
    messages: [],
    audits: [],
  };
  let threadN = 0;
  let msgN = 0;
  const base: Record<string, unknown> = {
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
        threads.find((t) => t.user_id === where.user_id && t.contact_id === where.contact_id && t.channel === where.channel) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const t = { id: `thread-${++threadN}`, ...(data as object) } as (typeof threads)[number];
        threads.push(t);
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
  };
  if (seed.withAudit) {
    base.auditEntry = {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...(data as object) } as Stores['audits'][number];
        stores.audits.push(row);
        return row;
      },
      findFirst: async ({ orderBy }: { orderBy?: Record<string, unknown> }) => {
        if (orderBy && (orderBy as { sequence?: string }).sequence === 'desc') {
          return [...stores.audits].sort((a, b) => b.sequence - a.sequence)[0] ?? null;
        }
        return stores.audits[0] ?? null;
      },
      findMany: async () => [...stores.audits],
      findUnique: async ({ where }: { where: { id: string } }) => stores.audits.find((a) => a.id === where.id) ?? null,
    };
  }
  return { prisma: base as unknown as SendPrismaClient, stores };
}

function makeService(prisma: SendPrismaClient, over: { gate?: SendComplianceGate; checkDeliverable?: EmailDeliverabilityCheck; client?: InMemoryEmailSendClient | null; useDefaultFactory?: boolean } = {}) {
  const client = over.client === undefined ? new InMemoryEmailSendClient() : over.client;
  return new EmailSendService(prisma, {
    checkDeliverable: over.checkDeliverable ?? deliverableYes,
    sendGate: over.gate ?? makeGate(),
    ...(over.useDefaultFactory ? {} : { emailClientFactory: () => client }),
    decryptEmail: () => 'jamie@example.com',
    encryptBody: (s) => s,
  });
}

describe('EmailSendService.send — all three gates pass', () => {
  test('sends via the authenticated domain and records the Message with CAN-SPAM footer', async () => {
    const { prisma, stores } = makePrisma();
    const client = new InMemoryEmailSendClient();
    const result = await makeService(prisma, { client }).send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result.status).toBe('SENT');
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0].from).toBe(`no-reply@${DOMAIN}`);
    expect(client.sent[0].unsubscribeUrl).toContain('unsubscribe');
    expect(client.sent[0].physicalAddress.length).toBeGreaterThan(0);
    expect(stores.messages[0]).toMatchObject({ channel: MessageChannel.EMAIL, sent_from: 'email_domain' });
  });
});

describe('EmailSendService.send — each of the 3 gates is LOAD-BEARING (flip one → nothing sent)', () => {
  test('GATE (a) CFE: a non-released (BLOCK) draft is HELD, never sent', async () => {
    const { prisma } = makePrisma({ drafts: [draftRow({ cfe_outcome: CFEOutcome.BLOCK })] });
    const client = new InMemoryEmailSendClient();
    const result = await makeService(prisma, { client }).send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_CFE_CLEARED' });
    expect(client.sent).toHaveLength(0);
  });

  test('GATE (a) approval: a PENDING draft is HELD, never sent', async () => {
    const { prisma } = makePrisma({ drafts: [draftRow({ approval_state: 'PENDING' })] });
    const client = new InMemoryEmailSendClient();
    const result = await makeService(prisma, { client }).send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_APPROVED' });
    expect(client.sent).toHaveLength(0);
  });

  test('GATE (b) SendComplianceGate: an opted-out recipient is HELD, never sent', async () => {
    const { prisma } = makePrisma();
    const client = new InMemoryEmailSendClient();
    const result = await makeService(prisma, { client, gate: makeGate({ optedOut: true }) }).send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'OPTED_OUT' });
    expect(client.sent).toHaveLength(0);
  });

  test('GATE (b) SendComplianceGate: recipient quiet hours (unknown tz, fail-closed) is HELD, never sent', async () => {
    const { prisma } = makePrisma({ contacts: [contactRow({ timezone: null })] });
    const client = new InMemoryEmailSendClient();
    const result = await makeService(prisma, { client }).send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'QUIET_HOURS' });
    expect(client.sent).toHaveLength(0);
  });

  test('GATE (c) isChannelDeliverable: unverified domain is HELD NOT_DELIVERABLE, never sent', async () => {
    const { prisma } = makePrisma();
    const client = new InMemoryEmailSendClient();
    const result = await makeService(prisma, { client, checkDeliverable: deliverableNo }).send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NOT_DELIVERABLE' });
    expect(client.sent).toHaveLength(0);
  });

  test('no authenticated sending domain → HELD NO_SENDING_DOMAIN (fail-closed, never a guessed sender)', async () => {
    const { prisma } = makePrisma();
    const client = new InMemoryEmailSendClient();
    const result = await makeService(prisma, { client }).send('rep-1', 'd-1', ORG, null, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'NO_SENDING_DOMAIN' });
    expect(client.sent).toHaveLength(0);
  });
});

describe('EmailSendService.send — RESEND_API_KEY is fail-safe (KEY-LESS)', () => {
  test('injected null client (key absent) → HELD EMAIL_UNCONFIGURED, no send, no crash', async () => {
    const { prisma } = makePrisma();
    const result = await makeService(prisma, { client: null }).send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'EMAIL_UNCONFIGURED' });
  });

  test('the DEFAULT factory (real createEmailSendClient) is null in a key-less env → HELD', async () => {
    const { prisma } = makePrisma();
    const result = await makeService(prisma, { useDefaultFactory: true }).send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'HELD', reason: 'EMAIL_UNCONFIGURED' });
  });
});

describe('EmailSendService.send — ownership + fold-ins', () => {
  test('OWNERSHIP: another rep cannot send this draft (NOT_FOUND), nothing sent', async () => {
    const { prisma } = makePrisma();
    const client = new InMemoryEmailSendClient();
    const result = await makeService(prisma, { client }).send('rep-999', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result).toEqual({ status: 'NOT_FOUND' });
    expect(client.sent).toHaveLength(0);
  });

  test('T-R19/T-R16 fold-in: a recorded send links a cfe_audit_id and carries the draft approval attribution', async () => {
    const { prisma, stores } = makePrisma({ withAudit: true });
    const client = new InMemoryEmailSendClient();
    const result = await makeService(prisma, { client }).send('rep-1', 'd-1', ORG, DOMAIN, undefined, DAYTIME);
    expect(result.status).toBe('SENT');
    expect(stores.audits).toHaveLength(1); // a durable compliance-evidence AuditEntry was written
    const msg = stores.messages[0];
    expect(typeof msg.cfe_audit_id).toBe('string');
    expect(msg.cfe_audit_id).toBeTruthy();
    expect(msg.approved_by).toBe('rep-1');
    expect(msg.approved_at).toEqual(new Date('2026-07-14T12:00:00Z'));
  });
});

// ─── The STRONGEST "goes-through-the-seam" teeth: a cadence EMAIL step via the REAL seam ────────────
describe('SeamSequenceDispatcher → REAL EmailSendService: a step can never send around the gate (§10.2)', () => {
  function dispatcherFor(prisma: SendPrismaClient, client: InMemoryEmailSendClient | null): SeamSequenceDispatcher {
    const emailService = makeService(prisma, { client });
    // firstTouch / platformSms are irrelevant for the EMAIL channel — stub them; the point is that
    // the EMAIL route goes through the REAL, fully-gated EmailSendService.
    const stub = { prepareHandoff: async () => ({ status: 'NOT_FOUND' as const }) };
    const smsStub = { send: async () => ({ status: 'NOT_FOUND' as const }) };
    return new SeamSequenceDispatcher(stub as never, smsStub as never, emailService);
  }

  test('TEETH: a NON-cleared (BLOCK) draft dispatched as an EMAIL step → HELD NOT_CFE_CLEARED, provider NEVER called', async () => {
    const { prisma } = makePrisma({ drafts: [draftRow({ cfe_outcome: CFEOutcome.BLOCK })] });
    const client = new InMemoryEmailSendClient();
    const dispatcher = dispatcherFor(prisma, client);

    const result = await dispatcher.dispatch({ userId: 'rep-1', draftId: 'd-1', channel: MessageChannel.EMAIL, organizationId: ORG, sendingDomain: DOMAIN, now: DAYTIME });

    expect(result).toEqual({ status: 'HELD', reason: 'NOT_CFE_CLEARED' });
    expect(client.sent).toHaveLength(0); // if the seam were bypassed, this would be 1
  });

  test('a fully-cleared, gated-OK draft dispatched as an EMAIL step → SENT through the seam', async () => {
    const { prisma } = makePrisma();
    const client = new InMemoryEmailSendClient();
    const dispatcher = dispatcherFor(prisma, client);
    const result = await dispatcher.dispatch({ userId: 'rep-1', draftId: 'd-1', channel: MessageChannel.EMAIL, organizationId: ORG, sendingDomain: DOMAIN, now: DAYTIME });
    expect(result.status).toBe('SENT');
    expect(client.sent).toHaveLength(1);
  });

  test('an unconfigured provider (null client) makes the EMAIL step HELD EMAIL_UNCONFIGURED, not sent', async () => {
    const { prisma } = makePrisma();
    const dispatcher = dispatcherFor(prisma, null);
    const result = await dispatcher.dispatch({ userId: 'rep-1', draftId: 'd-1', channel: MessageChannel.EMAIL, organizationId: ORG, sendingDomain: DOMAIN, now: DAYTIME });
    expect(result).toEqual({ status: 'HELD', reason: 'EMAIL_UNCONFIGURED' });
  });
});
